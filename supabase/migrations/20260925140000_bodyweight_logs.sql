-- Every check-in flow that asks for bodyweight (roster_check_in for the
-- no-login kiosk, athleteCheckIn for the PIN-based kiosks) only ever wrote
-- the value onto athletes.bodyweight — a single current value with no
-- history, so there was never anything to build a "check-ins + bodyweight"
-- report from. Add a real per-date log.
CREATE TABLE public.bodyweight_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  log_date date NOT NULL DEFAULT CURRENT_DATE,
  value numeric NOT NULL,
  source text NOT NULL DEFAULT 'checkin' CHECK (source IN ('checkin', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, log_date)
);

CREATE INDEX idx_bodyweight_logs_athlete ON public.bodyweight_logs(athlete_id);
CREATE INDEX idx_bodyweight_logs_date ON public.bodyweight_logs(log_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bodyweight_logs TO anon, authenticated;
GRANT ALL ON public.bodyweight_logs TO service_role;
ALTER TABLE public.bodyweight_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open bodyweight_logs" ON public.bodyweight_logs FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.bodyweight_logs;
ALTER TABLE public.bodyweight_logs REPLICA IDENTITY FULL;

-- roster_check_in (the no-login "/checkin/$token" kiosk) — log alongside
-- the existing athletes.bodyweight write, don't replace it.
CREATE OR REPLACE FUNCTION public.roster_check_in(_token uuid, _athlete_id uuid, _bodyweight numeric DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_name text;
BEGIN
  SELECT a.organization_id,
         COALESCE(NULLIF(TRIM(COALESCE(a.preferred_name, a.first_name, '') || ' ' || COALESCE(a.last_name, '')), ''), a.name)
    INTO v_org, v_name
  FROM public.athletes a
  JOIN public.teams t ON t.qr_token = _token
  WHERE a.id = _athlete_id
    AND a.organization_id = t.organization_id
    AND a.archived_at IS NULL
    AND (a.team_id = t.id OR EXISTS (
      SELECT 1 FROM public.athlete_teams at
      WHERE at.athlete_id = a.id AND at.team_id = t.id AND at.left_at IS NULL
    ));

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Athlete not found on this team roster';
  END IF;

  IF _bodyweight IS NOT NULL AND (_bodyweight < 40 OR _bodyweight > 700) THEN
    RAISE EXCEPTION 'Bodyweight looks out of range';
  END IF;

  INSERT INTO public.attendance (athlete_id, organization_id, session_date, present, status)
  VALUES (_athlete_id, v_org, CURRENT_DATE, true, 'present')
  ON CONFLICT (athlete_id, session_date)
  DO UPDATE SET present = true, status = 'present';

  IF _bodyweight IS NOT NULL THEN
    UPDATE public.athletes SET bodyweight = _bodyweight WHERE id = _athlete_id;
    INSERT INTO public.bodyweight_logs (athlete_id, organization_id, log_date, value, source)
    VALUES (_athlete_id, v_org, CURRENT_DATE, _bodyweight, 'checkin')
    ON CONFLICT (athlete_id, log_date) DO UPDATE SET value = _bodyweight, source = 'checkin';
  END IF;

  RETURN v_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.roster_check_in(uuid, uuid, numeric) TO anon, authenticated;
