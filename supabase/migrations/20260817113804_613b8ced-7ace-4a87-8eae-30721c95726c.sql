CREATE OR REPLACE FUNCTION public.is_athlete_of_team(_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.athletes a
    WHERE a.user_id = auth.uid()
      AND (
        a.team_id = _team_id
        OR EXISTS (
          SELECT 1 FROM public.athlete_teams at
          WHERE at.athlete_id = a.id AND at.team_id = _team_id
        )
      )
  )
$$;

DROP POLICY IF EXISTS "athletes read own team memberships teams" ON public.teams;
CREATE POLICY "athletes read own team memberships teams"
ON public.teams FOR SELECT TO authenticated
USING (public.is_athlete_of_team(id));

DROP POLICY IF EXISTS "athletes read assigned workout_assignments" ON public.workout_assignments;
CREATE POLICY "athletes read assigned workout_assignments"
ON public.workout_assignments FOR SELECT TO authenticated
USING (
  public.is_self_athlete(athlete_id)
  OR (team_id IS NOT NULL AND public.is_athlete_of_team(team_id))
);