
-- Program hierarchy: phases → cycles → sessions, plus on-demand version snapshots.

CREATE TABLE public.program_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  goal text,
  color text,
  position integer NOT NULL DEFAULT 0,
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.program_phases(program_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_phases TO authenticated;
GRANT ALL ON public.program_phases TO service_role;
ALTER TABLE public.program_phases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members manage phases" ON public.program_phases
  FOR ALL USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));
CREATE TRIGGER trg_program_phases_touch BEFORE UPDATE ON public.program_phases
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.program_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id uuid NOT NULL REFERENCES public.program_phases(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  weeks smallint NOT NULL DEFAULT 1,
  intensity text,
  volume text,
  focus text,
  position integer NOT NULL DEFAULT 0,
  start_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.program_cycles(phase_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_cycles TO authenticated;
GRANT ALL ON public.program_cycles TO service_role;
ALTER TABLE public.program_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members manage cycles" ON public.program_cycles
  FOR ALL USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));
CREATE TRIGGER trg_program_cycles_touch BEFORE UPDATE ON public.program_cycles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.program_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.program_cycles(id) ON DELETE CASCADE,
  phase_id uuid NOT NULL REFERENCES public.program_phases(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workout_id uuid REFERENCES public.workouts(id) ON DELETE SET NULL,
  name text NOT NULL,
  week smallint NOT NULL DEFAULT 1,
  day smallint NOT NULL DEFAULT 1,
  position integer NOT NULL DEFAULT 0,
  scheduled_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.program_sessions(cycle_id, week, day, position);
CREATE INDEX ON public.program_sessions(program_id, scheduled_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_sessions TO authenticated;
GRANT ALL ON public.program_sessions TO service_role;
ALTER TABLE public.program_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members manage program sessions" ON public.program_sessions
  FOR ALL USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));
CREATE TRIGGER trg_program_sessions_touch BEFORE UPDATE ON public.program_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.program_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  notes text,
  snapshot jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.program_versions(program_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_versions TO authenticated;
GRANT ALL ON public.program_versions TO service_role;
ALTER TABLE public.program_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members manage program versions" ON public.program_versions
  FOR ALL USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));
