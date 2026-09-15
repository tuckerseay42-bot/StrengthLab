
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TYPE public.org_member_role AS ENUM ('owner','coach');

CREATE TABLE public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.org_member_role NOT NULL DEFAULT 'coach',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;
GRANT ALL ON public.organization_members TO service_role;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.organization_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.org_member_role NOT NULL DEFAULT 'coach',
  token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  invited_by UUID REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_invites TO authenticated;
GRANT ALL ON public.organization_invites TO service_role;
ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(lower(auth.jwt() ->> 'email') = 'tucker.seay42@gmail.com', false);
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_org_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = _org_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(_org_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = _org_id AND user_id = auth.uid() AND role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_invite(_token UUID)
RETURNS TABLE(email TEXT, organization_name TEXT, member_role public.org_member_role, expires_at TIMESTAMPTZ, accepted_at TIMESTAMPTZ)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT i.email, o.name, i.role, i.expires_at, i.accepted_at
  FROM public.organization_invites i
  JOIN public.organizations o ON o.id = i.organization_id
  WHERE i.token = _token;
$$;
GRANT EXECUTE ON FUNCTION public.get_invite(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_invite(_token UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _invite RECORD; _user_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _invite FROM public.organization_invites WHERE token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invite'; END IF;
  IF _invite.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Invite already used'; END IF;
  IF _invite.expires_at < now() THEN RAISE EXCEPTION 'Invite expired'; END IF;
  SELECT email INTO _user_email FROM auth.users WHERE id = auth.uid();
  IF lower(_user_email) <> lower(_invite.email) THEN
    RAISE EXCEPTION 'Sign in with % to accept this invite', _invite.email;
  END IF;
  INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (_invite.organization_id, auth.uid(), _invite.role)
    ON CONFLICT DO NOTHING;
  UPDATE public.organization_invites SET accepted_at = now() WHERE id = _invite.id;
  RETURN _invite.organization_id;
END $$;
GRANT EXECUTE ON FUNCTION public.accept_invite(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_self_athlete(_athlete_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.athletes WHERE id = _athlete_id AND user_id = auth.uid());
$$;

CREATE POLICY "org members can view" ON public.organizations FOR SELECT
  USING (public.is_org_member(id));
CREATE POLICY "super admin manages orgs" ON public.organizations FOR ALL
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "owners update org" ON public.organizations FOR UPDATE
  USING (public.is_org_owner(id));

CREATE POLICY "members view members" ON public.organization_members FOR SELECT
  USING (public.is_org_member(organization_id) OR user_id = auth.uid());
CREATE POLICY "owners manage members" ON public.organization_members FOR ALL
  USING (public.is_org_owner(organization_id))
  WITH CHECK (public.is_org_owner(organization_id));

CREATE POLICY "owners view invites" ON public.organization_invites FOR SELECT
  USING (public.is_org_owner(organization_id));
CREATE POLICY "owners manage invites" ON public.organization_invites FOR ALL
  USING (public.is_org_owner(organization_id))
  WITH CHECK (public.is_org_owner(organization_id));

ALTER TABLE public.athletes       ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.teams          ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.programs       ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.workouts       ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.tests          ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.lifts          ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.attendance     ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.exercises      ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.rep_maxes      ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.rack_sessions  ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.custom_metrics ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.leaderboards   ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.registrations  ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

DO $$
DECLARE _org_id UUID; _user_id UUID;
BEGIN
  SELECT id INTO _user_id FROM auth.users WHERE lower(email) = 'tucker.seay42@gmail.com' LIMIT 1;
  INSERT INTO public.organizations (name, slug, created_by)
    VALUES ('Team Stats Hub', 'team-stats-hub', _user_id)
    RETURNING id INTO _org_id;
  IF _user_id IS NOT NULL THEN
    INSERT INTO public.organization_members (organization_id, user_id, role)
      VALUES (_org_id, _user_id, 'owner') ON CONFLICT DO NOTHING;
  END IF;
  UPDATE public.athletes       SET organization_id = _org_id WHERE organization_id IS NULL;
  UPDATE public.teams          SET organization_id = _org_id WHERE organization_id IS NULL;
  UPDATE public.programs       SET organization_id = _org_id WHERE organization_id IS NULL;
  UPDATE public.workouts       SET organization_id = _org_id WHERE organization_id IS NULL;
  UPDATE public.tests          SET organization_id = _org_id WHERE organization_id IS NULL;
  UPDATE public.lifts          SET organization_id = _org_id WHERE organization_id IS NULL;
  UPDATE public.attendance     SET organization_id = _org_id WHERE organization_id IS NULL;
  UPDATE public.exercises      SET organization_id = _org_id WHERE organization_id IS NULL;
  UPDATE public.rep_maxes      SET organization_id = _org_id WHERE organization_id IS NULL;
  UPDATE public.rack_sessions  SET organization_id = _org_id WHERE organization_id IS NULL;
  UPDATE public.custom_metrics SET organization_id = _org_id WHERE organization_id IS NULL;
  UPDATE public.leaderboards   SET organization_id = _org_id WHERE organization_id IS NULL;
  UPDATE public.registrations  SET organization_id = _org_id WHERE organization_id IS NULL;
END $$;

ALTER TABLE public.athletes       ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.teams          ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.programs       ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.workouts       ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.tests          ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.lifts          ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.attendance     ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.exercises      ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.rep_maxes      ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.rack_sessions  ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.custom_metrics ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.leaderboards   ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.registrations  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX ON public.athletes(organization_id);
CREATE INDEX ON public.teams(organization_id);
CREATE INDEX ON public.programs(organization_id);
CREATE INDEX ON public.workouts(organization_id);
CREATE INDEX ON public.tests(organization_id);
CREATE INDEX ON public.lifts(organization_id);
CREATE INDEX ON public.attendance(organization_id);
CREATE INDEX ON public.exercises(organization_id);
CREATE INDEX ON public.rep_maxes(organization_id);
CREATE INDEX ON public.rack_sessions(organization_id);
CREATE INDEX ON public.custom_metrics(organization_id);
CREATE INDEX ON public.leaderboards(organization_id);
CREATE INDEX ON public.registrations(organization_id);

DROP POLICY "Open athletes" ON public.athletes;
CREATE POLICY "athletes org access" ON public.athletes FOR ALL
  USING (public.is_org_member(organization_id) OR user_id = auth.uid())
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY "Open teams" ON public.teams;
CREATE POLICY "teams org access" ON public.teams FOR ALL
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY "open programs" ON public.programs;
CREATE POLICY "programs org access" ON public.programs FOR ALL
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY "open workouts" ON public.workouts;
CREATE POLICY "workouts org access" ON public.workouts FOR ALL
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY "Open tests" ON public.tests;
CREATE POLICY "tests org access" ON public.tests FOR ALL
  USING (public.is_org_member(organization_id) OR public.is_self_athlete(athlete_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY "Open lifts" ON public.lifts;
CREATE POLICY "lifts org access" ON public.lifts FOR ALL
  USING (public.is_org_member(organization_id) OR public.is_self_athlete(athlete_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY "Open attendance" ON public.attendance;
CREATE POLICY "attendance org access" ON public.attendance FOR ALL
  USING (public.is_org_member(organization_id) OR public.is_self_athlete(athlete_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY "Open exercises" ON public.exercises;
CREATE POLICY "exercises org access" ON public.exercises FOR ALL
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY "open rep_maxes" ON public.rep_maxes;
CREATE POLICY "rep_maxes org access" ON public.rep_maxes FOR ALL
  USING (public.is_org_member(organization_id) OR public.is_self_athlete(athlete_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY "Open rack_sessions" ON public.rack_sessions;
CREATE POLICY "rack_sessions org access" ON public.rack_sessions FOR ALL
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY "Open custom_metrics" ON public.custom_metrics;
CREATE POLICY "custom_metrics org access" ON public.custom_metrics FOR ALL
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY "Open leaderboards" ON public.leaderboards;
CREATE POLICY "leaderboards org access" ON public.leaderboards FOR ALL
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY "Open registrations" ON public.registrations;
CREATE POLICY "registrations org access" ON public.registrations FOR ALL
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY "open program_workouts" ON public.program_workouts;
CREATE POLICY "program_workouts via program" ON public.program_workouts FOR ALL
  USING (EXISTS (SELECT 1 FROM public.programs p WHERE p.id = program_workouts.program_id AND public.is_org_member(p.organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.programs p WHERE p.id = program_workouts.program_id AND public.is_org_member(p.organization_id)));

DROP POLICY "open workout_assignments" ON public.workout_assignments;
CREATE POLICY "workout_assignments via workout" ON public.workout_assignments FOR ALL
  USING (EXISTS (SELECT 1 FROM public.workouts w WHERE w.id = workout_assignments.workout_id AND (public.is_org_member(w.organization_id) OR public.is_self_athlete(workout_assignments.athlete_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workouts w WHERE w.id = workout_assignments.workout_id AND public.is_org_member(w.organization_id)));

DROP POLICY "open workout_blocks" ON public.workout_blocks;
CREATE POLICY "workout_blocks via workout" ON public.workout_blocks FOR ALL
  USING (EXISTS (SELECT 1 FROM public.workouts w WHERE w.id = workout_blocks.workout_id AND public.is_org_member(w.organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workouts w WHERE w.id = workout_blocks.workout_id AND public.is_org_member(w.organization_id)));

DROP POLICY "open workout_exercises" ON public.workout_exercises;
CREATE POLICY "workout_exercises via workout" ON public.workout_exercises FOR ALL
  USING (EXISTS (SELECT 1 FROM public.workouts w WHERE w.id = workout_exercises.workout_id AND public.is_org_member(w.organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workouts w WHERE w.id = workout_exercises.workout_id AND public.is_org_member(w.organization_id)));

DROP POLICY "open workout_sets" ON public.workout_sets;
CREATE POLICY "workout_sets via exercise" ON public.workout_sets FOR ALL
  USING (EXISTS (SELECT 1 FROM public.workout_exercises we JOIN public.workouts w ON w.id = we.workout_id WHERE we.id = workout_sets.workout_exercise_id AND public.is_org_member(w.organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workout_exercises we JOIN public.workouts w ON w.id = we.workout_id WHERE we.id = workout_sets.workout_exercise_id AND public.is_org_member(w.organization_id)));

DROP POLICY "lift_sets are readable/writable by all authenticated users" ON public.lift_sets;
CREATE POLICY "lift_sets via lift" ON public.lift_sets FOR ALL
  USING (EXISTS (SELECT 1 FROM public.lifts l WHERE l.id = lift_sets.lift_id AND (public.is_org_member(l.organization_id) OR public.is_self_athlete(l.athlete_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.lifts l WHERE l.id = lift_sets.lift_id AND public.is_org_member(l.organization_id)));

DROP POLICY "Open rack_set_logs" ON public.rack_set_logs;
CREATE POLICY "rack_set_logs via session" ON public.rack_set_logs FOR ALL
  USING (EXISTS (SELECT 1 FROM public.rack_sessions rs WHERE rs.id = rack_set_logs.rack_session_id AND (public.is_org_member(rs.organization_id) OR public.is_self_athlete(rack_set_logs.athlete_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rack_sessions rs WHERE rs.id = rack_set_logs.rack_session_id AND public.is_org_member(rs.organization_id)));

DROP POLICY "Open exercise_relationships" ON public.exercise_relationships;
CREATE POLICY "exercise_relationships via exercise" ON public.exercise_relationships FOR ALL
  USING (EXISTS (SELECT 1 FROM public.exercises e WHERE e.id = exercise_relationships.from_exercise_id AND public.is_org_member(e.organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.exercises e WHERE e.id = exercise_relationships.from_exercise_id AND public.is_org_member(e.organization_id)));

CREATE TRIGGER touch_organizations BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
