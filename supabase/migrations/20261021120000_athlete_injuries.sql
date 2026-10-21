-- Injury history: a running record per athlete instead of the flat
-- "injured" status badge, which only ever holds one current state with no
-- memory of what happened, when, or whether it's resolved.
CREATE TABLE public.athlete_injuries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  description text NOT NULL,
  body_part text,
  severity text NOT NULL DEFAULT 'moderate' CHECK (severity IN ('minor', 'moderate', 'severe')),
  started_on date NOT NULL DEFAULT CURRENT_DATE,
  resolved_on date,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_injuries TO authenticated;
GRANT ALL ON public.athlete_injuries TO service_role;

ALTER TABLE public.athlete_injuries ENABLE ROW LEVEL SECURITY;

-- Same access shape as rep_maxes/attendance: org staff manage it, the
-- athlete themself can read their own.
CREATE POLICY "athlete_injuries org access" ON public.athlete_injuries FOR ALL
  USING (public.is_org_member(organization_id) OR public.is_self_athlete(athlete_id))
  WITH CHECK (public.is_org_member(organization_id));

CREATE INDEX ON public.athlete_injuries(athlete_id);
CREATE INDEX ON public.athlete_injuries(organization_id);

CREATE TRIGGER trg_athlete_injuries_touch
  BEFORE UPDATE ON public.athlete_injuries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
