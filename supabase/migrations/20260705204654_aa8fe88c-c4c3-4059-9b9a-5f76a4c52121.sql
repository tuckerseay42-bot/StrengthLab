
-- Public read of a single team by qr_token (safe columns only)
CREATE OR REPLACE FUNCTION public.get_team_by_qr_token(_token uuid)
RETURNS TABLE(id uuid, name text, sport text, color text, season text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, name, sport, color, season
  FROM public.teams
  WHERE qr_token = _token AND archived_at IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_team_by_qr_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_team_by_qr_token(uuid) TO anon, authenticated;

-- Public read of a single athlete by join_token (safe columns only)
CREATE OR REPLACE FUNCTION public.get_athlete_by_join_token(_token uuid)
RETURNS TABLE(id uuid, name text, first_name text, last_name text, preferred_name text, athlete_email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, name, first_name, last_name, preferred_name, athlete_email
  FROM public.athletes
  WHERE join_token = _token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_athlete_by_join_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_athlete_by_join_token(uuid) TO anon, authenticated;

-- Public registration submission via team qr_token
CREATE OR REPLACE FUNCTION public.submit_registration(_token uuid, _payload jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _team RECORD;
  _reg_id uuid;
  _fn text := btrim(coalesce(_payload->>'first_name', ''));
  _ln text := btrim(coalesce(_payload->>'last_name', ''));
BEGIN
  IF _fn = '' OR _ln = '' THEN
    RAISE EXCEPTION 'first_name and last_name are required';
  END IF;

  SELECT id, organization_id, sport INTO _team
  FROM public.teams WHERE qr_token = _token AND archived_at IS NULL;
  IF _team.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired link';
  END IF;

  INSERT INTO public.registrations (
    team_id, organization_id, first_name, last_name, preferred_name, student_id,
    grade, sport, sport_fall, sport_winter, sport_spring, date_of_birth,
    position, graduation_year, height_in, weight_lb, parent_email, athlete_email, status
  ) VALUES (
    _team.id, _team.organization_id, _fn, _ln,
    NULLIF(btrim(_payload->>'preferred_name'), ''),
    NULLIF(btrim(_payload->>'student_id'), ''),
    NULLIF(_payload->>'grade','')::smallint,
    COALESCE(NULLIF(_payload->>'sport',''), _team.sport),
    NULLIF(_payload->>'sport_fall',''),
    NULLIF(_payload->>'sport_winter',''),
    NULLIF(_payload->>'sport_spring',''),
    NULLIF(_payload->>'date_of_birth','')::date,
    NULLIF(btrim(_payload->>'position'), ''),
    NULLIF(_payload->>'graduation_year','')::smallint,
    NULLIF(_payload->>'height_in','')::numeric,
    NULLIF(_payload->>'weight_lb','')::numeric,
    NULLIF(btrim(_payload->>'parent_email'), ''),
    NULLIF(btrim(_payload->>'athlete_email'), ''),
    'pending'
  ) RETURNING id INTO _reg_id;

  RETURN _reg_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_registration(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_registration(uuid, jsonb) TO anon, authenticated;
