
CREATE TABLE public.exercise_relationships (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_exercise_id UUID NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  to_exercise_id   UUID NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  ratio NUMERIC NOT NULL CHECK (ratio > 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_exercise_id, to_exercise_id),
  CHECK (from_exercise_id <> to_exercise_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exercise_relationships TO anon, authenticated;
GRANT ALL ON public.exercise_relationships TO service_role;

ALTER TABLE public.exercise_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Open exercise_relationships" ON public.exercise_relationships
  FOR ALL TO public USING (true) WITH CHECK (true);

CREATE INDEX exercise_relationships_from_idx ON public.exercise_relationships(from_exercise_id);
CREATE INDEX exercise_relationships_to_idx   ON public.exercise_relationships(to_exercise_id);
