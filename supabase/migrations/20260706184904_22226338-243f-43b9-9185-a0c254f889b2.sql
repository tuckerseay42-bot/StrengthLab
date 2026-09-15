
CREATE TABLE public.athlete_teams (
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (athlete_id, team_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_teams TO authenticated;
GRANT ALL ON public.athlete_teams TO service_role;

ALTER TABLE public.athlete_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members manage athlete_teams in their org"
ON public.athlete_teams
FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.teams t
          WHERE t.id = athlete_teams.team_id
            AND public.is_org_member(t.organization_id))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.teams t
          WHERE t.id = athlete_teams.team_id
            AND public.is_org_member(t.organization_id))
);

CREATE POLICY "Athlete can view own team memberships"
ON public.athlete_teams
FOR SELECT
TO authenticated
USING (public.is_self_athlete(athlete_id));

CREATE INDEX athlete_teams_team_idx ON public.athlete_teams(team_id);
CREATE INDEX athlete_teams_athlete_idx ON public.athlete_teams(athlete_id);
