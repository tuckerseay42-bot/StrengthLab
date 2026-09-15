
-- Badges system
CREATE TABLE public.badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  icon text NOT NULL DEFAULT 'Award',
  color text NOT NULL DEFAULT 'primary',
  criteria jsonb NOT NULL DEFAULT '{"type":"manual"}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.badges TO authenticated;
GRANT ALL ON public.badges TO service_role;
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read badges"
  ON public.badges FOR SELECT TO authenticated
  USING (organization_id IS NULL OR public.is_org_member(organization_id));
CREATE POLICY "Org members manage badges"
  ON public.badges FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_member(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND public.is_org_member(organization_id));

CREATE TRIGGER badges_touch_updated_at BEFORE UPDATE ON public.badges
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.athlete_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  badge_id uuid NOT NULL REFERENCES public.badges(id) ON DELETE CASCADE,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  awarded_by uuid,
  evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, badge_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_badges TO authenticated;
GRANT ALL ON public.athlete_badges TO service_role;
ALTER TABLE public.athlete_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members and self read athlete badges"
  ON public.athlete_badges FOR SELECT TO authenticated
  USING (
    public.is_self_athlete(athlete_id)
    OR EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND public.is_org_member(a.organization_id))
  );
CREATE POLICY "Org members manage athlete badges"
  ON public.athlete_badges FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND public.is_org_member(a.organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND public.is_org_member(a.organization_id)));

CREATE INDEX idx_athlete_badges_athlete ON public.athlete_badges(athlete_id);
CREATE INDEX idx_badges_org ON public.badges(organization_id);
