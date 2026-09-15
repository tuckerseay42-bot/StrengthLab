CREATE OR REPLACE FUNCTION public.submit_registration(_token uuid, _payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    position, graduation_year, height_in, weight_lb, parent_email, athlete_email, gender, status
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
    NULLIF(btrim(_payload->>'gender'), ''),
    'pending'
  ) RETURNING id INTO _reg_id;

  RETURN _reg_id;
END;
$function$;