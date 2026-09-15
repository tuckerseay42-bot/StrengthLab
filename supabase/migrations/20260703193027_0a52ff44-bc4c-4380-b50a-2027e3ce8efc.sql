
-- ATHLETES
CREATE TABLE public.athletes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  grade smallint,
  sport text,
  position text,
  bodyweight numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.athletes TO anon, authenticated;
GRANT ALL ON public.athletes TO service_role;
ALTER TABLE public.athletes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open athletes" ON public.athletes FOR ALL USING (true) WITH CHECK (true);

-- TESTS (sprint times, jumps, strength tests)
CREATE TABLE public.tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  test_type text NOT NULL, -- e.g. 'sprint_10y','sprint_40y','vertical_jump','broad_jump','bench_1rm','squat_1rm','deadlift_1rm'
  value numeric NOT NULL,
  unit text, -- 's','in','lb'
  test_date date NOT NULL DEFAULT current_date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.tests(athlete_id);
CREATE INDEX ON public.tests(test_type);
CREATE INDEX ON public.tests(test_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tests TO anon, authenticated;
GRANT ALL ON public.tests TO service_role;
ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open tests" ON public.tests FOR ALL USING (true) WITH CHECK (true);

-- LIFTS
CREATE TABLE public.lifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  exercise text NOT NULL,
  load numeric,
  sets smallint,
  reps smallint,
  velocity numeric,
  lift_date date NOT NULL DEFAULT current_date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.lifts(athlete_id);
CREATE INDEX ON public.lifts(exercise);
CREATE INDEX ON public.lifts(lift_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lifts TO anon, authenticated;
GRANT ALL ON public.lifts TO service_role;
ALTER TABLE public.lifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open lifts" ON public.lifts FOR ALL USING (true) WITH CHECK (true);

-- ATTENDANCE
CREATE TABLE public.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  session_date date NOT NULL DEFAULT current_date,
  present boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(athlete_id, session_date)
);
CREATE INDEX ON public.attendance(session_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance TO anon, authenticated;
GRANT ALL ON public.attendance TO service_role;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open attendance" ON public.attendance FOR ALL USING (true) WITH CHECK (true);
