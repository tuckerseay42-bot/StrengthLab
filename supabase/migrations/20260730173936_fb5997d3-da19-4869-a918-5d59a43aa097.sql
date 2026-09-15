CREATE TABLE public.gps_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  athlete_id uuid REFERENCES public.athletes(id) ON DELETE SET NULL,
  player_name text NOT NULL,
  session_date date NOT NULL,
  top_speed numeric,
  peak_acceleration numeric,
  sprint_yards numeric,
  player_load numeric,
  sprint_count integer,
  source_file text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gps_sessions TO authenticated;
GRANT ALL ON public.gps_sessions TO service_role;

ALTER TABLE public.gps_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage gps sessions"
ON public.gps_sessions FOR ALL TO authenticated
USING (public.is_org_member(organization_id))
WITH CHECK (public.is_org_member(organization_id));

CREATE UNIQUE INDEX gps_sessions_unique_row
  ON public.gps_sessions (organization_id, session_date, lower(player_name));
CREATE INDEX gps_sessions_org_date_idx ON public.gps_sessions (organization_id, session_date DESC);
CREATE INDEX gps_sessions_athlete_idx ON public.gps_sessions (athlete_id);

CREATE TRIGGER gps_sessions_touch_updated_at
BEFORE UPDATE ON public.gps_sessions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();