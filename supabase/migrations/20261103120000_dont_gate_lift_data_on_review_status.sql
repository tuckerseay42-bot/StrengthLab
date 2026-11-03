-- Root cause of "rep maxes / prescribed weights go missing for no reason":
-- the moment a coach opens Log Review, a silent background sync
-- (log-review.tsx's syncValidation) flips any set that LOOKS unusual
-- (>=30% off a baseline or the prescribed load — often just a kid's first
-- entry for a lift with no baseline yet) to approval_status = 'pending'.
-- Both trg_rack_log_to_lift() and rollup_rep_maxes() only ever counted
-- approval_status IN ('auto','approved') sets, so that single silent flip
-- made the set invisible to `lifts` (leaderboards/PRs) and `rep_maxes`
-- (Training Maxes, and every %-of-1RM prescribed weight in Training View)
-- until a coach happened to find that exact row in Log Review and approved
-- it. Nothing else used 'pending' as "excluded" — it's a coach review
-- queue state, not a data-visibility gate — so both functions now only
-- exclude a set once a coach has explicitly rejected it.

CREATE OR REPLACE FUNCTION public.trg_rack_log_to_lift()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ex_name text;
  _org_id uuid;
  _override RECORD;
BEGIN
  IF NEW.approval_status = 'rejected' THEN
    DELETE FROM public.lifts WHERE source_rack_log_id = NEW.id;
    RETURN NEW;
  END IF;
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF NEW.load IS NULL AND NEW.time_seconds IS NULL AND NEW.distance_in IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT substitute_exercise_name INTO _override
  FROM public.rack_athlete_exercise_overrides
  WHERE rack_session_id = NEW.rack_session_id
    AND athlete_id = NEW.athlete_id
    AND workout_exercise_id = NEW.workout_exercise_id;

  IF _override.substitute_exercise_name IS NOT NULL THEN
    _ex_name := _override.substitute_exercise_name;
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
      AND rsl.approval_status <> 'rejected'
      AND rsl.load IS NOT NULL AND rsl.reps IS NOT NULL AND rsl.reps > 0
    GROUP BY rsl.athlete_id, we.exercise_id, we.exercise_name, rsl.reps
  ),
  lift_row_bests AS (
    SELECT l.athlete_id,
           (SELECT e.id FROM public.exercises e
             WHERE lower(trim(e.name)) = lower(trim(l.exercise)) LIMIT 1) AS exercise_id,
           l.exercise AS exercise_name, l.reps::int AS reps,
           MAX(l.load) AS load, MAX(l.lift_date) AS tested_at
    FROM public.lifts l
    WHERE l.load IS NOT NULL AND l.reps IS NOT NULL AND l.reps > 0
    GROUP BY l.athlete_id, l.exercise, l.reps
  ),
  lift_set_bests AS (
    SELECT l.athlete_id,
           (SELECT e.id FROM public.exercises e
             WHERE lower(trim(e.name)) = lower(trim(l.exercise)) LIMIT 1) AS exercise_id,
           l.exercise AS exercise_name, ls.reps::int AS reps,
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
  INSERT INTO public.rep_maxes (organization_id, athlete_id, exercise_id, exercise_name, reps, load, tested_at, notes)
  SELECT a.organization_id, b.athlete_id, b.exercise_id, b.exercise_name, b.reps, b.load, b.tested_at, 'auto: rollup'
  FROM bests b
  JOIN public.athletes a ON a.id = b.athlete_id
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

-- Re-fire the log-to-lift trigger for every set that got silently
-- sidelined by the old gate, so `lifts` (leaderboards/PRs) catches up
-- immediately instead of waiting on a coach to touch each row.
UPDATE public.rack_set_logs
SET notes = notes
WHERE status = 'completed' AND approval_status = 'pending';

-- And run the rollup once now so Training Maxes / prescribed weights
-- reflect the fix immediately rather than waiting on the next
-- client-triggered (throttled) call.
SELECT public.rollup_rep_maxes();
