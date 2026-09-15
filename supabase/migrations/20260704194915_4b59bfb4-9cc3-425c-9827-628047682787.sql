
-- Helper: upsert a single rep-max candidate; only inserts when it beats existing record for that rep count
CREATE OR REPLACE FUNCTION public.record_rep_max_candidate(
  _athlete_id uuid,
  _exercise_id uuid,
  _exercise_name text,
  _reps integer,
  _load numeric,
  _tested_at date,
  _note text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  INSERT INTO public.rep_maxes (athlete_id, exercise_id, exercise_name, reps, load, tested_at, notes)
  VALUES (_athlete_id, _exercise_id, COALESCE(_exercise_name, 'Exercise'), _reps, _load, _tested_at, _note);
END;
$$;

-- Extend the batch rollup to include lifts + lift_sets
CREATE OR REPLACE FUNCTION public.rollup_rep_maxes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer := 0;
BEGIN
  WITH rack_bests AS (
    SELECT rsl.athlete_id, we.exercise_id, we.exercise_name, rsl.reps,
           MAX(rsl.load) AS load, MAX(rsl.completed_at)::date AS tested_at
    FROM public.rack_set_logs rsl
    JOIN public.workout_exercises we ON we.id = rsl.workout_exercise_id
    WHERE rsl.status = 'completed' AND rsl.load IS NOT NULL AND rsl.reps IS NOT NULL AND rsl.reps > 0
    GROUP BY rsl.athlete_id, we.exercise_id, we.exercise_name, rsl.reps
  ),
  lift_row_bests AS (
    SELECT l.athlete_id, NULL::uuid AS exercise_id, l.exercise AS exercise_name, l.reps::int AS reps,
           MAX(l.load) AS load, MAX(l.lift_date) AS tested_at
    FROM public.lifts l
    WHERE l.load IS NOT NULL AND l.reps IS NOT NULL AND l.reps > 0
    GROUP BY l.athlete_id, l.exercise, l.reps
  ),
  lift_set_bests AS (
    SELECT l.athlete_id, NULL::uuid AS exercise_id, l.exercise AS exercise_name, ls.reps::int AS reps,
           MAX(ls.load) AS load, MAX(l.lift_date) AS tested_at
    FROM public.lift_sets ls
    JOIN public.lifts l ON l.id = ls.lift_id
    WHERE ls.load IS NOT NULL AND ls.reps IS NOT NULL AND ls.reps > 0
    GROUP BY l.athlete_id, l.exercise, ls.reps
  ),
  bests AS (
    SELECT athlete_id, exercise_id, exercise_name, reps, MAX(load) AS load, MAX(tested_at) AS tested_at
    FROM (
      SELECT * FROM rack_bests
      UNION ALL SELECT * FROM lift_row_bests
      UNION ALL SELECT * FROM lift_set_bests
    ) u
    GROUP BY athlete_id, exercise_id, exercise_name, reps
  )
  INSERT INTO public.rep_maxes (athlete_id, exercise_id, exercise_name, reps, load, tested_at, notes)
  SELECT b.athlete_id, b.exercise_id, b.exercise_name, b.reps, b.load, b.tested_at, 'auto: rollup'
  FROM bests b
  WHERE NOT EXISTS (
    SELECT 1 FROM public.rep_maxes rm
    WHERE rm.athlete_id = b.athlete_id
      AND COALESCE(rm.exercise_id::text, lower(rm.exercise_name)) = COALESCE(b.exercise_id::text, lower(b.exercise_name))
      AND rm.reps = b.reps
      AND rm.load >= b.load
  );
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

-- Trigger: rack_set_logs → record rep max on completed set
CREATE OR REPLACE FUNCTION public.trg_rack_log_rep_max()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ex_id uuid;
  _ex_name text;
BEGIN
  IF NEW.status <> 'completed' OR NEW.load IS NULL OR NEW.reps IS NULL OR NEW.reps < 1 THEN
    RETURN NEW;
  END IF;
  SELECT exercise_id, exercise_name INTO _ex_id, _ex_name
  FROM public.workout_exercises WHERE id = NEW.workout_exercise_id;
  PERFORM public.record_rep_max_candidate(
    NEW.athlete_id, _ex_id, _ex_name, NEW.reps, NEW.load, NEW.completed_at::date, 'auto: rack console'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rack_set_logs_rep_max ON public.rack_set_logs;
CREATE TRIGGER trg_rack_set_logs_rep_max
AFTER INSERT OR UPDATE ON public.rack_set_logs
FOR EACH ROW EXECUTE FUNCTION public.trg_rack_log_rep_max();

-- Trigger: lifts row (single-set summary) → record rep max
CREATE OR REPLACE FUNCTION public.trg_lifts_rep_max()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.record_rep_max_candidate(
    NEW.athlete_id, NULL, NEW.exercise, NEW.reps::int, NEW.load, NEW.lift_date, 'auto: lifts'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lifts_rep_max ON public.lifts;
CREATE TRIGGER trg_lifts_rep_max
AFTER INSERT OR UPDATE ON public.lifts
FOR EACH ROW EXECUTE FUNCTION public.trg_lifts_rep_max();

-- Trigger: lift_sets → record rep max
CREATE OR REPLACE FUNCTION public.trg_lift_sets_rep_max()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _athlete_id uuid;
  _exercise text;
  _date date;
BEGIN
  SELECT athlete_id, exercise, lift_date INTO _athlete_id, _exercise, _date
  FROM public.lifts WHERE id = NEW.lift_id;
  PERFORM public.record_rep_max_candidate(
    _athlete_id, NULL, _exercise, NEW.reps::int, NEW.load, _date, 'auto: lift_sets'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lift_sets_rep_max ON public.lift_sets;
CREATE TRIGGER trg_lift_sets_rep_max
AFTER INSERT OR UPDATE ON public.lift_sets
FOR EACH ROW EXECUTE FUNCTION public.trg_lift_sets_rep_max();
