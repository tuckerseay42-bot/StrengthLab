
-- Prevent duplicate assignments per (workout, target, date).
-- Partial unique indexes because athlete_id / team_id are mutually exclusive per row.
CREATE UNIQUE INDEX IF NOT EXISTS workout_assignments_uniq_athlete_date
  ON public.workout_assignments (workout_id, athlete_id, scheduled_date)
  WHERE athlete_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS workout_assignments_uniq_team_date
  ON public.workout_assignments (workout_id, team_id, scheduled_date)
  WHERE team_id IS NOT NULL;
