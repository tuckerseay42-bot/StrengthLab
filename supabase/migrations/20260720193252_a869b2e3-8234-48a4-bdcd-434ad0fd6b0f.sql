
-- athletes: consolidate archive pattern
UPDATE public.athletes
   SET archived_at = COALESCE(archived_at, deactivated_at, CASE WHEN status = 'archived' THEN now() END)
 WHERE archived_at IS NULL AND (deactivated_at IS NOT NULL OR status = 'archived');

ALTER TABLE public.athletes DROP COLUMN IF EXISTS deactivated_at;

-- graduation_year sanity + index
ALTER TABLE public.athletes
  DROP CONSTRAINT IF EXISTS athletes_graduation_year_chk;
ALTER TABLE public.athletes
  ADD CONSTRAINT athletes_graduation_year_chk
  CHECK (graduation_year IS NULL OR (graduation_year BETWEEN 1950 AND 2100));

CREATE INDEX IF NOT EXISTS athletes_graduation_year_idx
  ON public.athletes (graduation_year) WHERE graduation_year IS NOT NULL;
CREATE INDEX IF NOT EXISTS athletes_team_id_idx    ON public.athletes (team_id);
CREATE INDEX IF NOT EXISTS athletes_program_id_idx ON public.athletes (program_id);

-- athlete_teams: historical tracking
ALTER TABLE public.athlete_teams
  ADD COLUMN IF NOT EXISTS joined_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS left_at   timestamptz;

UPDATE public.athlete_teams SET joined_at = created_at WHERE joined_at > created_at;

-- athlete_badges: FK index
CREATE INDEX IF NOT EXISTS athlete_badges_badge_id_idx ON public.athlete_badges (badge_id);

-- attendance: status enum-like column
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'present';

UPDATE public.attendance
   SET status = CASE WHEN present THEN 'present' ELSE 'absent' END
 WHERE status = 'present' AND present = false;

ALTER TABLE public.attendance
  DROP CONSTRAINT IF EXISTS attendance_status_chk;
ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_status_chk
  CHECK (status IN ('present','absent','excused','late'));

-- registrations: FK index
CREATE INDEX IF NOT EXISTS registrations_team_id_idx ON public.registrations (team_id);
