
-- ============================================================================
-- Group 1: teams/athletes/athlete_teams/athlete_badges/attendance/registrations
-- Most hardening already applied in prior migrations. Fill remaining gaps.
-- ============================================================================

-- (athletes.status is a participation state enum (active/inactive/archived) and
--  is distinct from archived_at soft-delete; no is_active boolean exists, so
--  no consolidation needed.)

-- No further changes needed for Group 1 — audit confirmed:
--   * athletes.archived_at + graduation_year CHECK + partial index ✓
--   * athlete_teams composite PK provides UNIQUE(athlete_id,team_id); joined_at/left_at ✓
--   * attendance UNIQUE(athlete_id,session_date) + status CHECK ✓
--   * registrations FKs + status CHECK ✓
--   * athlete_badges FK indexes ✓
--   * RLS on athletes/attendance permits org members OR self ✓


-- ============================================================================
-- Group 2: programs hierarchy
-- ============================================================================

-- 2a) Sibling-position uniqueness (deferrable so drag-drop reorder can shuffle)
ALTER TABLE public.program_phases
  ADD CONSTRAINT program_phases_program_position_uniq
  UNIQUE (program_id, position) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.program_cycles
  ADD CONSTRAINT program_cycles_phase_position_uniq
  UNIQUE (phase_id, position) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.program_sessions
  ADD CONSTRAINT program_sessions_cycle_week_day_position_uniq
  UNIQUE (cycle_id, week, day, position) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.program_workouts
  ADD CONSTRAINT program_workouts_program_week_day_position_uniq
  UNIQUE (program_id, week, day, position) DEFERRABLE INITIALLY DEFERRED;

-- 2b) Missing FK indexes across program hierarchy
CREATE INDEX IF NOT EXISTS program_phases_organization_id_idx  ON public.program_phases (organization_id);
CREATE INDEX IF NOT EXISTS program_cycles_program_id_idx       ON public.program_cycles (program_id);
CREATE INDEX IF NOT EXISTS program_cycles_organization_id_idx  ON public.program_cycles (organization_id);
CREATE INDEX IF NOT EXISTS program_sessions_phase_id_idx       ON public.program_sessions (phase_id);
CREATE INDEX IF NOT EXISTS program_sessions_workout_id_idx     ON public.program_sessions (workout_id);
CREATE INDEX IF NOT EXISTS program_sessions_organization_id_idx ON public.program_sessions (organization_id);
CREATE INDEX IF NOT EXISTS program_versions_created_by_idx     ON public.program_versions (created_by);
CREATE INDEX IF NOT EXISTS program_versions_organization_id_idx ON public.program_versions (organization_id);
CREATE INDEX IF NOT EXISTS program_workouts_workout_id_idx     ON public.program_workouts (workout_id);

-- 2c) Date-range sanity for program_phases (cycles use `weeks` derivation, no end_date column)
ALTER TABLE public.program_phases
  ADD CONSTRAINT program_phases_date_range_chk
  CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date);

-- 2d) program_versions: append-only + auto version_number
ALTER TABLE public.program_versions
  ADD COLUMN IF NOT EXISTS version_number integer;

-- Backfill version_number per program by created_at order
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY program_id ORDER BY created_at) AS n
  FROM public.program_versions
)
UPDATE public.program_versions pv
   SET version_number = n
  FROM numbered
 WHERE pv.id = numbered.id AND pv.version_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS program_versions_program_version_uniq
  ON public.program_versions (program_id, version_number);

-- Trigger: auto-assign next version_number on insert
CREATE OR REPLACE FUNCTION public.trg_program_versions_autonumber()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.version_number IS NULL THEN
    SELECT COALESCE(MAX(version_number), 0) + 1
      INTO NEW.version_number
      FROM public.program_versions
     WHERE program_id = NEW.program_id;
  END IF;
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS program_versions_autonumber ON public.program_versions;
CREATE TRIGGER program_versions_autonumber
  BEFORE INSERT ON public.program_versions
  FOR EACH ROW EXECUTE FUNCTION public.trg_program_versions_autonumber();

-- Replace the permissive ALL policy with insert-only + read (append-only)
DROP POLICY IF EXISTS "org members manage program versions" ON public.program_versions;

CREATE POLICY "org members read program versions"
  ON public.program_versions FOR SELECT
  TO authenticated
  USING (is_org_member(organization_id));

CREATE POLICY "org members insert program versions"
  ON public.program_versions FOR INSERT
  TO authenticated
  WITH CHECK (is_org_member(organization_id));
-- (no UPDATE / DELETE policies → RLS blocks both = append-only)

-- 2e) RLS: athletes get read-only access to programs they're assigned to
--     (via program_sessions.workout_id → workout_assignments.athlete_id)
CREATE POLICY "assigned athletes read programs"
  ON public.programs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.program_sessions ps
        JOIN public.workout_assignments wa ON wa.workout_id = ps.workout_id
       WHERE ps.program_id = programs.id
         AND is_self_athlete(wa.athlete_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.athletes a
       WHERE a.program_id = programs.id
         AND is_self_athlete(a.id)
    )
  );
