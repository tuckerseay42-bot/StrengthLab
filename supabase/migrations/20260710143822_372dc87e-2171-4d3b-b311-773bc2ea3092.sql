
CREATE OR REPLACE FUNCTION public.trg_rack_log_to_lift()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ex_name text;
  _org_id uuid;
BEGIN
  -- Rejected sets: remove any previously-materialized lift row.
  IF NEW.approval_status = 'rejected' THEN
    DELETE FROM public.lifts WHERE source_rack_log_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Only completed + (auto | approved) sets materialize a lift row.
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF NEW.approval_status NOT IN ('auto','approved') THEN
    -- Ensure no stale lift exists while pending review.
    DELETE FROM public.lifts WHERE source_rack_log_id = NEW.id;
    RETURN NEW;
  END IF;

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
$function$;

CREATE OR REPLACE FUNCTION public.rollup_rep_maxes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inserted_count integer := 0;
BEGIN
  WITH rack_bests AS (
    SELECT rsl.athlete_id, we.exercise_id, we.exercise_name, rsl.reps,
           MAX(rsl.load) AS load, MAX(rsl.completed_at)::date AS tested_at
    FROM public.rack_set_logs rsl
    JOIN public.workout_exercises we ON we.id = rsl.workout_exercise_id
    WHERE rsl.status = 'completed'
      AND rsl.approval_status IN ('auto','approved')
      AND rsl.load IS NOT NULL AND rsl.reps IS NOT NULL AND rsl.reps > 0
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
$function$;

-- Clean up any lift rows currently backed by non-approved rack logs so leaderboards/PRs recompute cleanly.
DELETE FROM public.lifts l
USING public.rack_set_logs r
WHERE l.source_rack_log_id = r.id
  AND (r.status <> 'completed' OR r.approval_status NOT IN ('auto','approved'));
