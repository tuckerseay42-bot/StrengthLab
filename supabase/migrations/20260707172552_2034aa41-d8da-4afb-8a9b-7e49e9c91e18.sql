
CREATE OR REPLACE FUNCTION public.trg_rack_log_rep_max()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ex_id uuid;
  _ex_name text;
  _we_percent numeric;
  _ws_percent numeric;
  _ws_rm int;
  _best_load numeric;
BEGIN
  IF NEW.status <> 'completed' OR NEW.load IS NULL OR NEW.reps IS NULL OR NEW.reps < 1 THEN
    RETURN NEW;
  END IF;
  IF NEW.approval_status NOT IN ('auto','approved') THEN
    RETURN NEW;
  END IF;

  SELECT exercise_id, exercise_name, percent
    INTO _ex_id, _ex_name, _we_percent
  FROM public.workout_exercises WHERE id = NEW.workout_exercise_id;

  SELECT percent, rm_reps INTO _ws_percent, _ws_rm
  FROM public.workout_sets
  WHERE workout_exercise_id = NEW.workout_exercise_id AND position = NEW.set_position
  LIMIT 1;

  IF COALESCE(_ws_percent, _we_percent) IS NOT NULL OR _ws_rm IS NOT NULL THEN
    SELECT MAX(load) INTO _best_load FROM public.rep_maxes
    WHERE athlete_id = NEW.athlete_id
      AND COALESCE(exercise_id::text, lower(exercise_name)) = COALESCE(_ex_id::text, lower(_ex_name))
      AND reps = NEW.reps;
    IF _best_load IS NULL OR NEW.load <= _best_load THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM public.record_rep_max_candidate(
    NEW.athlete_id, _ex_id, _ex_name, NEW.reps, NEW.load, NEW.completed_at::date, 'auto: rack console'
  );
  RETURN NEW;
END;
$function$;

DELETE FROM public.rep_maxes rm
WHERE rm.notes = 'auto: rack console'
  AND EXISTS (
    SELECT 1
    FROM public.rack_set_logs rsl
    JOIN public.workout_exercises we ON we.id = rsl.workout_exercise_id
    LEFT JOIN public.workout_sets ws
      ON ws.workout_exercise_id = we.id AND ws.position = rsl.set_position
    WHERE rsl.athlete_id = rm.athlete_id
      AND rsl.reps = rm.reps
      AND rsl.load = rm.load
      AND (COALESCE(ws.percent, we.percent) IS NOT NULL OR ws.rm_reps IS NOT NULL)
  );
