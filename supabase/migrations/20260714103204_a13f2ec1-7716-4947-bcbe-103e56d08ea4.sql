
ALTER TABLE public.rack_set_logs
  ADD COLUMN IF NOT EXISTS rest_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS rest_seconds integer;

CREATE OR REPLACE FUNCTION public.trg_rack_log_rest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _prev timestamptz;
BEGIN
  IF NEW.status = 'completed' AND NEW.completed_at IS NOT NULL THEN
    SELECT MAX(completed_at) INTO _prev
    FROM public.rack_set_logs
    WHERE rack_session_id = NEW.rack_session_id
      AND athlete_id = NEW.athlete_id
      AND id <> NEW.id
      AND status = 'completed'
      AND completed_at < NEW.completed_at;
    IF _prev IS NOT NULL THEN
      NEW.rest_seconds := GREATEST(0, EXTRACT(EPOCH FROM (NEW.completed_at - _prev))::int);
      IF NEW.rest_started_at IS NULL THEN
        NEW.rest_started_at := _prev;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rack_log_rest ON public.rack_set_logs;
CREATE TRIGGER rack_log_rest
  BEFORE INSERT OR UPDATE ON public.rack_set_logs
  FOR EACH ROW EXECUTE FUNCTION public.trg_rack_log_rest();
