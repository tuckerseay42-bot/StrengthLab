DROP POLICY IF EXISTS "attendance org access" ON public.attendance;
CREATE POLICY "attendance org access" ON public.attendance
FOR ALL
USING (public.is_org_member(organization_id) OR public.is_self_athlete(athlete_id))
WITH CHECK (public.is_org_member(organization_id) OR public.is_self_athlete(athlete_id));