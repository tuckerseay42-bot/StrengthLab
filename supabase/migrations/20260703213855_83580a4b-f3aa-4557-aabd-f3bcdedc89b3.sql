
CREATE TABLE public.workout_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_exercise_id uuid NOT NULL REFERENCES public.workout_exercises(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  sets int,
  reps text,
  load numeric,
  percent numeric,
  percent_of_exercise_id uuid REFERENCES public.exercises(id) ON DELETE SET NULL,
  rm_reps int,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workout_sets TO authenticated, anon;
GRANT ALL ON public.workout_sets TO service_role;
ALTER TABLE public.workout_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open workout_sets" ON public.workout_sets FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX ON public.workout_sets(workout_exercise_id);

CREATE TABLE public.rep_maxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  exercise_id uuid REFERENCES public.exercises(id) ON DELETE SET NULL,
  exercise_name text NOT NULL,
  reps int NOT NULL,
  load numeric NOT NULL,
  tested_at date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rep_maxes TO authenticated, anon;
GRANT ALL ON public.rep_maxes TO service_role;
ALTER TABLE public.rep_maxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open rep_maxes" ON public.rep_maxes FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX ON public.rep_maxes(athlete_id);
CREATE INDEX ON public.rep_maxes(exercise_name);
