CREATE OR REPLACE FUNCTION public.merge_athletes(_keep uuid, _drop uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _keep_row public.athletes%ROWTYPE;
  _drop_row public.athletes%ROWTYPE;
BEGIN
  IF _keep = _drop THEN
    RAISE EXCEPTION 'Cannot merge an athlete into itself';
  END IF;

  SELECT * INTO _keep_row FROM public.athletes WHERE id = _keep;
  SELECT * INTO _drop_row FROM public.athletes WHERE id = _drop;
  IF _keep_row.id IS NULL OR _drop_row.id IS NULL THEN
    RAISE EXCEPTION 'Athlete not found';
  END IF;
  IF _keep_row.organization_id IS DISTINCT FROM _drop_row.organization_id THEN
    RAISE EXCEPTION 'Cannot merge athletes across organizations';
  END IF;
  IF NOT public.is_org_member(_keep_row.organization_id) THEN
    RAISE EXCEPTION 'Not authorized to merge these athletes';
  END IF;

  -- de-duplicate rows that would violate unique keys
  DELETE FROM public.attendance d
   WHERE d.athlete_id = _drop
     AND EXISTS (SELECT 1 FROM public.attendance k
                  WHERE k.athlete_id = _keep AND k.session_date = d.session_date);
  DELETE FROM public.athlete_teams d
   WHERE d.athlete_id = _drop
     AND EXISTS (SELECT 1 FROM public.athlete_teams k
                  WHERE k.athlete_id = _keep AND k.team_id = d.team_id);
  DELETE FROM public.athlete_badges d
   WHERE d.athlete_id = _drop
     AND EXISTS (SELECT 1 FROM public.athlete_badges k
                  WHERE k.athlete_id = _keep AND k.badge_id = d.badge_id);
  DELETE FROM public.athlete_kpi_pins d
   WHERE d.athlete_id = _drop
     AND EXISTS (SELECT 1 FROM public.athlete_kpi_pins k
                  WHERE k.athlete_id = _keep AND k.user_id = d.user_id AND k.metric_key = d.metric_key);
  DELETE FROM public.rack_session_athletes d
   WHERE d.athlete_id = _drop
     AND EXISTS (SELECT 1 FROM public.rack_session_athletes k
                  WHERE k.athlete_id = _keep AND k.rack_session_id = d.rack_session_id);
  DELETE FROM public.rack_set_logs d
   WHERE d.athlete_id = _drop
     AND EXISTS (SELECT 1 FROM public.rack_set_logs k
                  WHERE k.athlete_id = _keep
                    AND k.rack_session_id = d.rack_session_id
                    AND k.workout_exercise_id = d.workout_exercise_id
                    AND k.set_position = d.set_position);
  DELETE FROM public.rack_athlete_exercise_overrides d
   WHERE d.athlete_id = _drop
     AND EXISTS (SELECT 1 FROM public.rack_athlete_exercise_overrides k
                  WHERE k.athlete_id = _keep
                    AND k.rack_session_id = d.rack_session_id
                    AND k.workout_exercise_id = d.workout_exercise_id);

  -- repoint remaining child rows
  UPDATE public.tests SET athlete_id = _keep WHERE athlete_id = _drop;
  UPDATE public.lifts SET athlete_id = _keep WHERE athlete_id = _drop;
  UPDATE public.attendance SET athlete_id = _keep WHERE athlete_id = _drop;
  UPDATE public.rep_maxes SET athlete_id = _keep WHERE athlete_id = _drop;
  UPDATE public.athlete_badges SET athlete_id = _keep WHERE athlete_id = _drop;
  UPDATE public.athlete_teams SET athlete_id = _keep WHERE athlete_id = _drop;
  UPDATE public.athlete_kpi_pins SET athlete_id = _keep WHERE athlete_id = _drop;
  UPDATE public.gps_sessions SET athlete_id = _keep WHERE athlete_id = _drop;
  UPDATE public.test_assignments SET athlete_id = _keep WHERE athlete_id = _drop;
  UPDATE public.workout_assignments SET athlete_id = _keep WHERE athlete_id = _drop;
  UPDATE public.rack_session_athletes SET athlete_id = _keep WHERE athlete_id = _drop;
  UPDATE public.rack_set_logs SET athlete_id = _keep WHERE athlete_id = _drop;
  UPDATE public.rack_athlete_exercise_overrides SET athlete_id = _keep WHERE athlete_id = _drop;
  UPDATE public.rack_sessions SET active_athlete_id = _keep WHERE active_athlete_id = _drop;

  -- keep a PIN if the kept athlete has none
  IF NOT EXISTS (SELECT 1 FROM public.athlete_pin_hashes WHERE athlete_id = _keep) THEN
    UPDATE public.athlete_pin_hashes SET athlete_id = _keep WHERE athlete_id = _drop;
  ELSE
    DELETE FROM public.athlete_pin_hashes WHERE athlete_id = _drop;
  END IF;

  -- fill blanks on the kept record, never overwrite
  UPDATE public.athletes k SET
    athlete_email      = COALESCE(k.athlete_email, _drop_row.athlete_email),
    parent_email       = COALESCE(k.parent_email, _drop_row.parent_email),
    student_id         = COALESCE(k.student_id, _drop_row.student_id),
    grade              = COALESCE(k.grade, _drop_row.grade),
    graduation_year    = COALESCE(k.graduation_year, _drop_row.graduation_year),
    bodyweight         = COALESCE(k.bodyweight, _drop_row.bodyweight),
    height_in          = COALESCE(k.height_in, _drop_row.height_in),
    date_of_birth      = COALESCE(k.date_of_birth, _drop_row.date_of_birth),
    gender             = COALESCE(k.gender, _drop_row.gender),
    photo_url          = COALESCE(k.photo_url, _drop_row.photo_url),
    team_id            = COALESCE(k.team_id, _drop_row.team_id),
    program_id         = COALESCE(k.program_id, _drop_row.program_id),
    program_start_date = COALESCE(k.program_start_date, _drop_row.program_start_date),
    class_period       = COALESCE(k.class_period, _drop_row.class_period),
    training_group     = COALESCE(k.training_group, _drop_row.training_group),
    sport              = COALESCE(k.sport, _drop_row.sport),
    position           = COALESCE(k.position, _drop_row.position),
    sport_fall         = COALESCE(k.sport_fall, _drop_row.sport_fall),
    sport_winter       = COALESCE(k.sport_winter, _drop_row.sport_winter),
    sport_spring       = COALESCE(k.sport_spring, _drop_row.sport_spring),
    user_id            = COALESCE(k.user_id, _drop_row.user_id),
    notes              = NULLIF(btrim(concat_ws(E'\n', k.notes, _drop_row.notes)), '')
  WHERE k.id = _keep;

  DELETE FROM public.athletes WHERE id = _drop;
  RETURN _keep;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_athletes(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_athletes(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_athletes(uuid, uuid) TO service_role;