
CREATE OR REPLACE FUNCTION public.merge_exercises(_alias_id uuid, _primary_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _alias_name text;
  _primary_name text;
BEGIN
  IF _alias_id = _primary_id THEN
    RAISE EXCEPTION 'Cannot merge an exercise into itself';
  END IF;
  SELECT name INTO _alias_name FROM public.exercises WHERE id = _alias_id;
  SELECT name INTO _primary_name FROM public.exercises WHERE id = _primary_id;
  IF _alias_name IS NULL OR _primary_name IS NULL THEN
    RAISE EXCEPTION 'Exercise not found';
  END IF;

  -- Repoint references from alias -> primary
  UPDATE public.workout_exercises SET exercise_id = _primary_id WHERE exercise_id = _alias_id;
  UPDATE public.rep_maxes SET exercise_id = _primary_id WHERE exercise_id = _alias_id;

  -- Text-based lifts: rename matching exercise names
  UPDATE public.lifts SET exercise = _primary_name WHERE lower(exercise) = lower(_alias_name);

  -- Clean up relationships involving alias
  DELETE FROM public.exercise_relationships
    WHERE from_exercise_id = _alias_id OR to_exercise_id = _alias_id;

  -- Finally remove the alias exercise
  DELETE FROM public.exercises WHERE id = _alias_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_exercises(uuid, uuid) TO authenticated;
