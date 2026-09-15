
CREATE OR REPLACE FUNCTION public.trg_rack_log_to_lift()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ex_name text;
  _org_id uuid;
  _override_name text;
BEGIN
  IF NEW.approval_status = 'rejected' THEN
    DELETE FROM public.lifts WHERE source_rack_log_id = NEW.id;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF NEW.approval_status NOT IN ('auto','approved') THEN
    DELETE FROM public.lifts WHERE source_rack_log_id = NEW.id;
    RETURN NEW;
  END IF;

  IF NEW.load IS NULL AND NEW.time_seconds IS NULL AND NEW.distance_in IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT substitute_exercise_name INTO _override_name
    FROM public.rack_athlete_exercise_overrides
   WHERE rack_session_id = NEW.rack_session_id
     AND athlete_id = NEW.athlete_id
     AND workout_exercise_id = NEW.workout_exercise_id
   LIMIT 1;

  IF _override_name IS NOT NULL AND btrim(_override_name) <> '' THEN
    _ex_name := _override_name;
  ELSE
    SELECT exercise_name INTO _ex_name FROM public.workout_exercises WHERE id = NEW.workout_exercise_id;
    IF _ex_name IS NULL THEN _ex_name := 'Exercise'; END IF;
  END IF;

  SELECT organization_id INTO _org_id FROM public.athletes WHERE id = NEW.athlete_id;

  INSERT INTO public.lifts (
    organization_id, athlete_id, exercise, load, sets, reps, velocity,
    time_seconds, distance_in, lift_date, notes, source_rack_log_id
  ) VALUES (
    _org_id, NEW.athlete_id, _ex_name, NEW.load, 1, NEW.reps, NEW.avg_velocity,
    NEW.time_seconds, NEW.distance_in,
    COALESCE(NEW.completed_at::date, CURRENT_DATE),
    'auto: rack console', NEW.id
  )
  ON CONFLICT ON CONSTRAINT lifts_source_rack_log_id_unique DO UPDATE
    SET load = EXCLUDED.load,
        reps = EXCLUDED.reps,
        velocity = EXCLUDED.velocity,
        time_seconds = EXCLUDED.time_seconds,
        distance_in = EXCLUDED.distance_in,
        lift_date = EXCLUDED.lift_date,
        exercise = EXCLUDED.exercise;
  RETURN NEW;
END;
$function$;
