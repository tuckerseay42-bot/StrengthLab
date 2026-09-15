
CREATE TABLE public.test_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  athlete_id uuid REFERENCES public.athletes(id) ON DELETE CASCADE,
  test_type text NOT NULL,
  scheduled_date date NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (team_id IS NOT NULL OR athlete_id IS NOT NULL)
);

CREATE INDEX ON public.test_assignments (organization_id, scheduled_date);
CREATE INDEX ON public.test_assignments (team_id, scheduled_date);
CREATE INDEX ON public.test_assignments (athlete_id, scheduled_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_assignments TO authenticated;
GRANT ALL ON public.test_assignments TO service_role;

ALTER TABLE public.test_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage" ON public.test_assignments
  FOR ALL TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "athletes read own" ON public.test_assignments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.athletes a
      WHERE a.user_id = auth.uid()
        AND (test_assignments.athlete_id = a.id
             OR (test_assignments.team_id IS NOT NULL AND test_assignments.team_id = a.team_id))
    )
  );
