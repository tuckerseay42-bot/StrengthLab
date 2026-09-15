
-- 1) Per-athlete slot table inside a rack session
CREATE TABLE public.rack_session_athletes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rack_session_id uuid NOT NULL REFERENCES public.rack_sessions(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  quadrant smallint NOT NULL CHECK (quadrant BETWEEN 1 AND 8),
  source_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  assigned_workout_id uuid REFERENCES public.workouts(id) ON DELETE SET NULL,
  active_workout_id uuid REFERENCES public.workouts(id) ON DELETE SET NULL,
  override_reason text NOT NULL DEFAULT 'assigned'
    CHECK (override_reason IN ('assigned','manual_workout','template','one_off','makeup')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rack_session_id, athlete_id),
  UNIQUE (rack_session_id, quadrant)
);

CREATE INDEX idx_rsa_session ON public.rack_session_athletes(rack_session_id);
CREATE INDEX idx_rsa_athlete ON public.rack_session_athletes(athlete_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rack_session_athletes TO authenticated;
GRANT ALL ON public.rack_session_athletes TO service_role;

ALTER TABLE public.rack_session_athletes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rack_session_athletes via session" ON public.rack_session_athletes FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.rack_sessions rs
    WHERE rs.id = rack_session_athletes.rack_session_id
      AND (public.is_org_member(rs.organization_id)
           OR public.is_self_athlete(rack_session_athletes.athlete_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.rack_sessions rs
    WHERE rs.id = rack_session_athletes.rack_session_id
      AND public.is_org_member(rs.organization_id)
  ));

CREATE TRIGGER trg_rack_session_athletes_touch
  BEFORE UPDATE ON public.rack_session_athletes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Denormalized fields on rack_set_logs for reporting / leaderboards
ALTER TABLE public.rack_set_logs
  ADD COLUMN IF NOT EXISTS active_workout_id uuid REFERENCES public.workouts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS override_status text NOT NULL DEFAULT 'assigned'
    CHECK (override_status IN ('assigned','overridden','one_off')),
  ADD COLUMN IF NOT EXISTS quadrant smallint;

CREATE INDEX IF NOT EXISTS idx_rack_set_logs_active_workout
  ON public.rack_set_logs(active_workout_id);

-- 3) Backfill: one slot row per athlete for existing sessions
INSERT INTO public.rack_session_athletes
  (rack_session_id, athlete_id, quadrant, source_team_id, assigned_workout_id, active_workout_id, override_reason)
SELECT
  rs.id,
  aid::uuid,
  (row_number() OVER (PARTITION BY rs.id ORDER BY ord))::smallint AS quadrant,
  a.team_id,
  rs.workout_id,
  rs.workout_id,
  'assigned'
FROM public.rack_sessions rs
CROSS JOIN LATERAL unnest(rs.athlete_ids) WITH ORDINALITY AS u(aid, ord)
LEFT JOIN public.athletes a ON a.id = aid::uuid
ON CONFLICT (rack_session_id, athlete_id) DO NOTHING;

-- Backfill active_workout_id on existing logs from the parent session
UPDATE public.rack_set_logs l
SET active_workout_id = rs.workout_id
FROM public.rack_sessions rs
WHERE l.rack_session_id = rs.id
  AND l.active_workout_id IS NULL
  AND rs.workout_id IS NOT NULL;
