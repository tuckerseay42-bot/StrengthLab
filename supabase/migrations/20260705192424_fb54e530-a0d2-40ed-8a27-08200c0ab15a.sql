
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT organization_id FROM public.organization_members
  WHERE user_id = auth.uid()
  ORDER BY created_at ASC
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;

ALTER TABLE public.athletes       ALTER COLUMN organization_id SET DEFAULT public.current_org_id();
ALTER TABLE public.teams          ALTER COLUMN organization_id SET DEFAULT public.current_org_id();
ALTER TABLE public.programs       ALTER COLUMN organization_id SET DEFAULT public.current_org_id();
ALTER TABLE public.workouts       ALTER COLUMN organization_id SET DEFAULT public.current_org_id();
ALTER TABLE public.tests          ALTER COLUMN organization_id SET DEFAULT public.current_org_id();
ALTER TABLE public.lifts          ALTER COLUMN organization_id SET DEFAULT public.current_org_id();
ALTER TABLE public.attendance     ALTER COLUMN organization_id SET DEFAULT public.current_org_id();
ALTER TABLE public.exercises      ALTER COLUMN organization_id SET DEFAULT public.current_org_id();
ALTER TABLE public.rep_maxes      ALTER COLUMN organization_id SET DEFAULT public.current_org_id();
ALTER TABLE public.rack_sessions  ALTER COLUMN organization_id SET DEFAULT public.current_org_id();
ALTER TABLE public.custom_metrics ALTER COLUMN organization_id SET DEFAULT public.current_org_id();
ALTER TABLE public.leaderboards   ALTER COLUMN organization_id SET DEFAULT public.current_org_id();
ALTER TABLE public.registrations  ALTER COLUMN organization_id SET DEFAULT public.current_org_id();
