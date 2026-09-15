
CREATE TABLE public.workouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workouts TO authenticated, anon;
GRANT ALL ON public.workouts TO service_role;
ALTER TABLE public.workouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open workouts" ON public.workouts FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.workout_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id uuid NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Block',
  position int NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workout_blocks TO authenticated, anon;
GRANT ALL ON public.workout_blocks TO service_role;
ALTER TABLE public.workout_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open workout_blocks" ON public.workout_blocks FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.workout_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id uuid NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
  block_id uuid REFERENCES public.workout_blocks(id) ON DELETE SET NULL,
  exercise_id uuid REFERENCES public.exercises(id) ON DELETE SET NULL,
  exercise_name text NOT NULL,
  position int NOT NULL DEFAULT 0,
  sets int,
  reps text,
  load numeric,
  percent_of_exercise_id uuid REFERENCES public.exercises(id) ON DELETE SET NULL,
  percent numeric,
  tempo text,
  rest_seconds int,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workout_exercises TO authenticated, anon;
GRANT ALL ON public.workout_exercises TO service_role;
ALTER TABLE public.workout_exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open workout_exercises" ON public.workout_exercises FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.workout_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id uuid NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
  athlete_id uuid REFERENCES public.athletes(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  scheduled_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'assigned',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workout_assignments TO authenticated, anon;
GRANT ALL ON public.workout_assignments TO service_role;
ALTER TABLE public.workout_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open workout_assignments" ON public.workout_assignments FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX ON public.workout_blocks(workout_id);
CREATE INDEX ON public.workout_exercises(workout_id);
CREATE INDEX ON public.workout_assignments(athlete_id);
CREATE INDEX ON public.workout_assignments(team_id);
CREATE INDEX ON public.workout_assignments(scheduled_date);
