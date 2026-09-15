-- Link rolled-up rep maxes to the exercise library by name so %-of-1RM lookups match.
UPDATE public.rep_maxes rm
SET exercise_id = e.id
FROM public.exercises e
WHERE rm.exercise_id IS NULL
  AND lower(trim(e.name)) = lower(trim(rm.exercise_name))
  AND (e.organization_id IS NULL OR e.organization_id = rm.organization_id);

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