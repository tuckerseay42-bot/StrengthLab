
CREATE TABLE IF NOT EXISTS public.lift_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lift_id uuid NOT NULL REFERENCES public.lifts(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  load numeric,
  reps smallint,
  velocity numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lift_sets TO authenticated;
GRANT ALL ON public.lift_sets TO service_role;

ALTER TABLE public.lift_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lift_sets are readable/writable by all authenticated users"
  ON public.lift_sets FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS lift_sets_lift_id_idx ON public.lift_sets(lift_id, position);
