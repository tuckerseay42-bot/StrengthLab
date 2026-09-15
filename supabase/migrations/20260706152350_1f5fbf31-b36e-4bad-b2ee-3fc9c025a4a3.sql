
CREATE TABLE public.test_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  value text NOT NULL,
  label text NOT NULL,
  unit text NOT NULL DEFAULT '',
  lower_is_better boolean NOT NULL DEFAULT false,
  group_name text NOT NULL DEFAULT 'Other',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, value)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_types TO authenticated;
GRANT ALL ON public.test_types TO service_role;

ALTER TABLE public.test_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view test types"
  ON public.test_types FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "Org members can insert test types"
  ON public.test_types FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "Org members can update test types"
  ON public.test_types FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "Org members can delete test types"
  ON public.test_types FOR DELETE TO authenticated
  USING (public.is_org_member(organization_id));

CREATE TRIGGER test_types_touch_updated_at
  BEFORE UPDATE ON public.test_types
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
