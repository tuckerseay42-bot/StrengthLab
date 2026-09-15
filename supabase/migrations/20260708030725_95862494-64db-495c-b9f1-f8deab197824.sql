
CREATE TABLE public.athlete_kpi_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id uuid REFERENCES public.athletes(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, athlete_id, metric_key)
);

CREATE INDEX idx_athlete_kpi_pins_lookup ON public.athlete_kpi_pins(user_id, athlete_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_kpi_pins TO authenticated;
GRANT ALL ON public.athlete_kpi_pins TO service_role;

ALTER TABLE public.athlete_kpi_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own KPI pins"
  ON public.athlete_kpi_pins FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_athlete_kpi_pins_updated
  BEFORE UPDATE ON public.athlete_kpi_pins
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
