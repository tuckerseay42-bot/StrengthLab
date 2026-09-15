
-- 1. Harden merge_exercises: require caller org-membership on both exercises, and same org.
CREATE OR REPLACE FUNCTION public.merge_exercises(_alias_id uuid, _primary_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _alias_name text;
  _primary_name text;
  _alias_org uuid;
  _primary_org uuid;
BEGIN
  IF _alias_id = _primary_id THEN
    RAISE EXCEPTION 'Cannot merge an exercise into itself';
  END IF;
  SELECT name, organization_id INTO _alias_name, _alias_org FROM public.exercises WHERE id = _alias_id;
  SELECT name, organization_id INTO _primary_name, _primary_org FROM public.exercises WHERE id = _primary_id;
  IF _alias_name IS NULL OR _primary_name IS NULL THEN
    RAISE EXCEPTION 'Exercise not found';
  END IF;

  IF _alias_org IS DISTINCT FROM _primary_org THEN
    RAISE EXCEPTION 'Cannot merge exercises across organizations';
  END IF;

  IF NOT public.is_super_admin() THEN
    IF _alias_org IS NULL OR NOT public.is_org_member(_alias_org) THEN
      RAISE EXCEPTION 'Not authorized to merge these exercises';
    END IF;
  END IF;

  UPDATE public.workout_exercises SET exercise_id = _primary_id WHERE exercise_id = _alias_id;
  UPDATE public.rep_maxes SET exercise_id = _primary_id WHERE exercise_id = _alias_id;
  UPDATE public.lifts SET exercise = _primary_name WHERE lower(exercise) = lower(_alias_name);
  DELETE FROM public.exercise_relationships
    WHERE from_exercise_id = _alias_id OR to_exercise_id = _alias_id;
  DELETE FROM public.exercises WHERE id = _alias_id;
END;
$function$;

-- 2. Explicit deny for direct writes to athlete_pin_hashes (writes go through SECURITY DEFINER fns).
DROP POLICY IF EXISTS "No direct writes to athlete_pin_hashes" ON public.athlete_pin_hashes;
CREATE POLICY "No direct writes to athlete_pin_hashes"
  ON public.athlete_pin_hashes
  AS RESTRICTIVE
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- 3. Tighten exercise_relationships policy to check both endpoints.
DROP POLICY IF EXISTS "exercise_relationships via exercise" ON public.exercise_relationships;
CREATE POLICY "exercise_relationships via exercise"
  ON public.exercise_relationships
  FOR ALL
  TO authenticated
  USING (
    public.is_org_member((SELECT organization_id FROM public.exercises WHERE id = from_exercise_id))
    AND public.is_org_member((SELECT organization_id FROM public.exercises WHERE id = to_exercise_id))
  )
  WITH CHECK (
    public.is_org_member((SELECT organization_id FROM public.exercises WHERE id = from_exercise_id))
    AND public.is_org_member((SELECT organization_id FROM public.exercises WHERE id = to_exercise_id))
    AND (SELECT organization_id FROM public.exercises WHERE id = from_exercise_id)
      = (SELECT organization_id FROM public.exercises WHERE id = to_exercise_id)
  );
