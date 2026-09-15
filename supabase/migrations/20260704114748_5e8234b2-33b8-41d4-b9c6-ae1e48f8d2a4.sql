-- PROGRAMS
CREATE TABLE public.programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  weeks smallint NOT NULL DEFAULT 4,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.programs TO authenticated;
GRANT ALL ON public.programs TO service_role;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "programs authenticated all" ON public.programs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER programs_touch BEFORE UPDATE ON public.programs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- PROGRAM WORKOUTS
CREATE TABLE public.program_workouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  workout_id uuid NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
  week smallint NOT NULL DEFAULT 1,
  day smallint NOT NULL DEFAULT 1,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX program_workouts_program_idx ON public.program_workouts(program_id, week, day, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_workouts TO authenticated;
GRANT ALL ON public.program_workouts TO service_role;
ALTER TABLE public.program_workouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "program_workouts authenticated all" ON public.program_workouts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ATHLETE ASSIGNMENT
ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES public.programs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS program_start_date date;

-- REP MAX ROLLUP: compute best load per athlete+exercise+reps from completed rack_set_logs
CREATE OR REPLACE FUNCTION public.rollup_rep_maxes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer := 0;
BEGIN
  WITH bests AS (
    SELECT
      rsl.athlete_id,
      we.exercise_id,
      we.exercise_name,
      rsl.reps,
      MAX(rsl.load) AS load,
      MAX(rsl.completed_at) AS tested_at
    FROM public.rack_set_logs rsl
    JOIN public.workout_exercises we ON we.id = rsl.workout_exercise_id
    WHERE rsl.status = 'completed'
      AND rsl.load IS NOT NULL
      AND rsl.reps IS NOT NULL
      AND rsl.reps > 0
    GROUP BY rsl.athlete_id, we.exercise_id, we.exercise_name, rsl.reps
  )
  INSERT INTO public.rep_maxes (athlete_id, exercise_id, exercise_name, reps, load, tested_at, notes)
  SELECT b.athlete_id, b.exercise_id, b.exercise_name, b.reps, b.load, b.tested_at::date, 'auto: rack console'
  FROM bests b
  WHERE NOT EXISTS (
    SELECT 1 FROM public.rep_maxes rm
    WHERE rm.athlete_id = b.athlete_id
      AND COALESCE(rm.exercise_id::text, rm.exercise_name) = COALESCE(b.exercise_id::text, b.exercise_name)
      AND rm.reps = b.reps
      AND rm.load >= b.load
  );
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rollup_rep_maxes() TO anon, authenticated, service_role;

-- Nightly cron: run rollup at 02:15 UTC
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'nightly-rep-max-rollup',
  '15 2 * * *',
  $$ SELECT public.rollup_rep_maxes(); $$
);