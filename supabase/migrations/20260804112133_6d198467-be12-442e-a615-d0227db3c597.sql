
CREATE OR REPLACE FUNCTION public.get_roster_by_qr_token(_token uuid)
RETURNS TABLE(athlete_id uuid, display_name text, grade smallint, class_period text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id,
         COALESCE(NULLIF(TRIM(COALESCE(a.preferred_name, a.first_name, '') || ' ' || COALESCE(a.last_name, '')), ''), a.name),
         a.grade,
         a.class_period
  FROM public.athletes a
  JOIN public.teams t ON t.qr_token = _token
  WHERE a.organization_id = t.organization_id
    AND a.archived_at IS NULL
    AND (a.team_id = t.id OR EXISTS (
      SELECT 1 FROM public.athlete_teams at
      WHERE at.athlete_id = a.id AND at.team_id = t.id AND at.left_at IS NULL
    ))
  ORDER BY 2
$$;

GRANT EXECUTE ON FUNCTION public.get_roster_by_qr_token(uuid) TO anon, authenticated;

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
  END IF;

  RETURN v_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.roster_check_in(uuid, uuid, numeric) TO anon, authenticated;
