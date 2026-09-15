ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_1rm_formula text NOT NULL DEFAULT 'epley';

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_default_1rm_formula_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_default_1rm_formula_check
  CHECK (default_1rm_formula IN ('epley','brzycki','lombardi','oconner'));

-- Canonical SQL mirror of src/lib/one-rm.ts estimate1RM().
CREATE OR REPLACE FUNCTION public.estimate_1rm(_load numeric, _reps integer, _formula text DEFAULT 'epley')
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _load IS NULL OR _reps IS NULL OR _reps < 1 THEN NULL
    WHEN _reps = 1 THEN round(_load, 2)
    WHEN _formula = 'brzycki' AND _reps < 37 THEN round(_load * 36.0 / (37 - _reps), 2)
    WHEN _formula = 'lombardi' THEN round(_load * power(_reps, 0.10), 2)
    WHEN _formula = 'oconner' THEN round(_load * (1 + 0.025 * _reps), 2)
    ELSE round(_load * (1 + _reps / 30.0), 2)
  END
$$;

GRANT EXECUTE ON FUNCTION public.estimate_1rm(numeric, integer, text) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.trg_rack_log_compute()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _pres_load numeric;
  _pres_reps integer;
  _formula text;
BEGIN
  IF NEW.load IS NOT NULL AND NEW.reps IS NOT NULL AND NEW.reps > 0 THEN
    SELECT o.default_1rm_formula INTO _formula
    FROM public.athletes a
    JOIN public.organizations o ON o.id = a.organization_id
    WHERE a.id = NEW.athlete_id;
    NEW.estimated_1rm := public.estimate_1rm(NEW.load, NEW.reps, COALESCE(_formula, 'epley'));
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
$function$;