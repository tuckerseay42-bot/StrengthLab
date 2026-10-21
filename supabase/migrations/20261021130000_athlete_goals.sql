-- Per-athlete goals (e.g. "Squat 400 by spring") with measurable progress
-- where possible — against a lift's e1RM or a test type — instead of just a
-- note with no way to tell how close someone actually is.
CREATE TABLE public.athlete_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  title text NOT NULL,
  metric_kind text NOT NULL DEFAULT 'custom' CHECK (metric_kind IN ('exercise_1rm', 'test', 'custom')),
  exercise_id uuid REFERENCES public.exercises(id) ON DELETE SET NULL,
  exercise_name text,
  test_type text,
  target_value numeric,
  target_date date,
  starting_value numeric,
  achieved_on date,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_goals TO authenticated;
GRANT ALL ON public.athlete_goals TO service_role;

ALTER TABLE public.athlete_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "athlete_goals org access" ON public.athlete_goals FOR ALL
  USING (public.is_org_member(organization_id) OR public.is_self_athlete(athlete_id))
  WITH CHECK (public.is_org_member(organization_id));

CREATE INDEX ON public.athlete_goals(athlete_id);
CREATE INDEX ON public.athlete_goals(organization_id);

CREATE TRIGGER trg_athlete_goals_touch
  BEFORE UPDATE ON public.athlete_goals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
