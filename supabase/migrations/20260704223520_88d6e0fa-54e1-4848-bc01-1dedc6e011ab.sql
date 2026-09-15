
ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.athletes ADD COLUMN IF NOT EXISTS training_group text;

ALTER TABLE public.rack_set_logs
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_1rm numeric,
  ADD COLUMN IF NOT EXISTS prescribed_load numeric,
  ADD COLUMN IF NOT EXISTS prescribed_reps integer;

-- Compute e1RM (Epley) and capture prescription snapshot on insert/update.
CREATE OR REPLACE FUNCTION public.trg_rack_log_compute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _pres_load numeric;
  _pres_reps integer;
BEGIN
  IF NEW.load IS NOT NULL AND NEW.reps IS NOT NULL AND NEW.reps > 0 THEN
    NEW.estimated_1rm := round((NEW.load * NEW.reps * 0.0333 + NEW.load)::numeric, 2);
  END IF;
  IF NEW.prescribed_load IS NULL OR NEW.prescribed_reps IS NULL THEN
    SELECT COALESCE(ws.load, we.load),
           COALESCE(NULLIF(regexp_replace(COALESCE(ws.reps, we.reps, ''), '\D', '', 'g'), '')::int, NULL)
      INTO _pres_load, _pres_reps
    FROM public.workout_exercises we
    LEFT JOIN public.workout_sets ws
      ON ws.workout_exercise_id = we.id AND ws.position = NEW.set_position
    WHERE we.id = NEW.workout_exercise_id
    LIMIT 1;
    IF NEW.prescribed_load IS NULL THEN NEW.prescribed_load := _pres_load; END IF;
    IF NEW.prescribed_reps IS NULL THEN NEW.prescribed_reps := _pres_reps; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rack_log_compute ON public.rack_set_logs;
CREATE TRIGGER trg_rack_log_compute
BEFORE INSERT OR UPDATE ON public.rack_set_logs
FOR EACH ROW EXECUTE FUNCTION public.trg_rack_log_compute();

-- Update rep-max trigger to only fire when auto-accepted or coach-approved.
CREATE OR REPLACE FUNCTION public.trg_rack_log_rep_max()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ex_id uuid;
  _ex_name text;
BEGIN
  IF NEW.status <> 'completed' OR NEW.load IS NULL OR NEW.reps IS NULL OR NEW.reps < 1 THEN
    RETURN NEW;
  END IF;
  IF NEW.approval_status NOT IN ('auto','approved') THEN
    RETURN NEW;
  END IF;
  SELECT exercise_id, exercise_name INTO _ex_id, _ex_name
  FROM public.workout_exercises WHERE id = NEW.workout_exercise_id;
  PERFORM public.record_rep_max_candidate(
    NEW.athlete_id, _ex_id, _ex_name, NEW.reps, NEW.load, NEW.completed_at::date, 'auto: rack console'
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_rack_log_rep_max ON public.rack_set_logs;
CREATE TRIGGER trg_rack_log_rep_max
AFTER INSERT OR UPDATE ON public.rack_set_logs
FOR EACH ROW EXECUTE FUNCTION public.trg_rack_log_rep_max();
