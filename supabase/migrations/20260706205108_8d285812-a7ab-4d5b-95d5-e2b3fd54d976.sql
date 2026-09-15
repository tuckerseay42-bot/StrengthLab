
CREATE OR REPLACE FUNCTION public.record_rep_max_candidate(_athlete_id uuid, _exercise_id uuid, _exercise_name text, _reps integer, _load numeric, _tested_at date, _note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org_id uuid;
BEGIN
  IF _athlete_id IS NULL OR _reps IS NULL OR _reps < 1 OR _load IS NULL OR _load <= 0 THEN
    RETURN;
  END IF;
  IF _exercise_id IS NULL AND (_exercise_name IS NULL OR btrim(_exercise_name) = '') THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rep_maxes rm
    WHERE rm.athlete_id = _athlete_id
      AND COALESCE(rm.exercise_id::text, lower(rm.exercise_name)) = COALESCE(_exercise_id::text, lower(_exercise_name))
      AND rm.reps = _reps
      AND rm.load >= _load
  ) THEN
    RETURN;
  END IF;

  SELECT organization_id INTO _org_id FROM public.athletes WHERE id = _athlete_id;

  INSERT INTO public.rep_maxes (organization_id, athlete_id, exercise_id, exercise_name, reps, load, tested_at, notes)
  VALUES (_org_id, _athlete_id, _exercise_id, COALESCE(_exercise_name, 'Exercise'), _reps, _load, _tested_at, _note);
END;
$function$;

ALTER TABLE public.lifts
  ADD COLUMN IF NOT EXISTS time_seconds numeric,
  ADD COLUMN IF NOT EXISTS distance_in numeric,
  ADD COLUMN IF NOT EXISTS source_rack_log_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lifts_source_rack_log_id_unique') THEN
    ALTER TABLE public.lifts
      ADD CONSTRAINT lifts_source_rack_log_id_unique UNIQUE (source_rack_log_id);
  END IF;
END $$;

ALTER TABLE public.custom_metrics
  ADD COLUMN IF NOT EXISTS measurement text NOT NULL DEFAULT 'load';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_metrics_measurement_check') THEN
    ALTER TABLE public.custom_metrics
      ADD CONSTRAINT custom_metrics_measurement_check
      CHECK (measurement IN ('load','time','height'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.trg_rack_log_to_lift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ex_name text;
  _org_id uuid;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF NEW.load IS NULL AND NEW.time_seconds IS NULL AND NEW.distance_in IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT exercise_name INTO _ex_name FROM public.workout_exercises WHERE id = NEW.workout_exercise_id;
  IF _ex_name IS NULL THEN _ex_name := 'Exercise'; END IF;

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
        lift_date = EXCLUDED.lift_date;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rack_log_to_lift ON public.rack_set_logs;
CREATE TRIGGER trg_rack_log_to_lift
AFTER INSERT OR UPDATE ON public.rack_set_logs
FOR EACH ROW EXECUTE FUNCTION public.trg_rack_log_to_lift();

INSERT INTO public.lifts (
  organization_id, athlete_id, exercise, load, sets, reps, velocity,
  time_seconds, distance_in, lift_date, notes, source_rack_log_id
)
SELECT a.organization_id, rsl.athlete_id, COALESCE(we.exercise_name, 'Exercise'),
       rsl.load, 1, rsl.reps, rsl.avg_velocity,
       rsl.time_seconds, rsl.distance_in,
       COALESCE(rsl.completed_at::date, CURRENT_DATE),
       'auto: rack console (backfill)', rsl.id
FROM public.rack_set_logs rsl
LEFT JOIN public.workout_exercises we ON we.id = rsl.workout_exercise_id
JOIN public.athletes a ON a.id = rsl.athlete_id
WHERE rsl.status = 'completed'
  AND (rsl.load IS NOT NULL OR rsl.time_seconds IS NOT NULL OR rsl.distance_in IS NOT NULL)
ON CONFLICT ON CONSTRAINT lifts_source_rack_log_id_unique DO NOTHING;
