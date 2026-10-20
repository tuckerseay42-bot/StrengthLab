-- rollup_rep_maxes() has never set organization_id on the rows it inserts
-- into rep_maxes, relying on that column's current_org_id() default instead.
-- That default resolves to whichever org the CALLING session belongs to —
-- fine only as long as every possible caller is a member of the one org
-- every affected athlete also belongs to. It also means any row this
-- function inserts for an athlete in a different org than the caller's gets
-- stamped with the wrong organization_id, making it invisible to that
-- athlete's own coach afterward (the "rep_maxes org access" RLS policy
-- filters by organization_id). Every other place that writes rep_maxes/lifts
-- (record_rep_max_candidate, trg_rack_log_to_lift) already scopes by the
-- athlete's own organization_id instead of the caller's — this brings the
-- rollup in line with that and removes the dependency entirely.
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

-- One-time repair: any rep_maxes row already stamped with the wrong
-- organization_id (anything other than its own athlete's org) gets
-- corrected so it becomes visible to that athlete's actual coach.
UPDATE public.rep_maxes rm
SET organization_id = a.organization_id
FROM public.athletes a
WHERE a.id = rm.athlete_id
  AND rm.organization_id IS DISTINCT FROM a.organization_id;
