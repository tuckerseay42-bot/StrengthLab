-- Weight tracking rebuild, step 1 (additive: nothing existing is removed or changed).
--
-- Problem: weight lived in two places that disagreed. athletes.bodyweight is one
-- number with no date; bodyweight_logs keeps ONE row per athlete per UTC day
-- (a second weigh-in overwrites the first), has no real time, and is readable
-- and writable by anyone holding the public key (policy USING (true), granted
-- to anon). None of the weekly-average rules can be built on that.
--
-- This adds public.weigh_ins: every weigh-in kept with its time, the Eastern
-- calendar day stored alongside it (so a 9pm weigh-in is not tomorrow's), and
-- access limited to the org's coaches plus the athlete themself. Writes go
-- through log_weigh_in / kiosk_check_in. athletes.bodyweight is kept equal to
-- the latest weigh-in automatically, so every screen that reads it (strength
-- vs bodyweight scores, spider charts, print report) keeps working untouched.
-- The old table keeps working and is mirrored in until its writers are moved.

CREATE TABLE public.weigh_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  logged_at timestamptz NOT NULL DEFAULT now(),
  log_date date NOT NULL,
  value numeric NOT NULL CHECK (value >= 40 AND value <= 700),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('checkin', 'manual', 'import')),
  logged_by uuid,
  legacy_log_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_weigh_ins_athlete_time ON public.weigh_ins (athlete_id, logged_at DESC);
CREATE INDEX idx_weigh_ins_org_date ON public.weigh_ins (organization_id, log_date);

-- The Eastern calendar day a weigh-in belongs to. Weeks run Monday to Sunday
-- on this date, so it must not be the server's UTC day.
CREATE OR REPLACE FUNCTION public.weigh_ins_set_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.log_date := (NEW.logged_at AT TIME ZONE 'America/New_York')::date;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_weigh_ins_set_date
  BEFORE INSERT OR UPDATE OF logged_at ON public.weigh_ins
  FOR EACH ROW EXECUTE FUNCTION public.weigh_ins_set_date();

-- Keep athletes.bodyweight equal to the latest weigh-in.
CREATE OR REPLACE FUNCTION public.weigh_ins_sync_current()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_athlete uuid;
  v_latest numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_athlete := OLD.athlete_id;
  ELSE
    v_athlete := NEW.athlete_id;
  END IF;

  SELECT w.value INTO v_latest
  FROM public.weigh_ins w
  WHERE w.athlete_id = v_athlete
  ORDER BY w.logged_at DESC, w.created_at DESC
  LIMIT 1;

  IF v_latest IS NOT NULL THEN
    UPDATE public.athletes
    SET bodyweight = v_latest
    WHERE id = v_athlete AND bodyweight IS DISTINCT FROM v_latest;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_weigh_ins_sync_current
  AFTER INSERT OR UPDATE OR DELETE ON public.weigh_ins
  FOR EACH ROW EXECUTE FUNCTION public.weigh_ins_sync_current();

-- Carry over existing history. created_at is the true time of the weigh-in;
-- anything outside 40-700 lb (which the old table never enforced) is skipped.
INSERT INTO public.weigh_ins (athlete_id, organization_id, logged_at, value, source, legacy_log_id)
SELECT b.athlete_id, b.organization_id, b.created_at, b.value, b.source, b.id
FROM public.bodyweight_logs b
WHERE b.value >= 40 AND b.value <= 700
ON CONFLICT (legacy_log_id) DO NOTHING;

-- Until every writer is moved over, anything still writing the old table is
-- mirrored into the new one so the two can never disagree.
CREATE OR REPLACE FUNCTION public.bodyweight_logs_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.weigh_ins WHERE legacy_log_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.value >= 40 AND NEW.value <= 700 THEN
    INSERT INTO public.weigh_ins (athlete_id, organization_id, logged_at, value, source, legacy_log_id)
    VALUES (
      NEW.athlete_id,
      NEW.organization_id,
      CASE WHEN TG_OP = 'INSERT' THEN NEW.created_at ELSE now() END,
      NEW.value,
      NEW.source,
      NEW.id
    )
    ON CONFLICT (legacy_log_id)
    DO UPDATE SET value = EXCLUDED.value, logged_at = EXCLUDED.logged_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bodyweight_logs_mirror
  AFTER INSERT OR UPDATE OR DELETE ON public.bodyweight_logs
  FOR EACH ROW EXECUTE FUNCTION public.bodyweight_logs_mirror();

-- Access: coaches in the org, and an athlete for their own rows. No anonymous
-- access of any kind. Athletes and kiosks add weigh-ins through the functions
-- below, never directly.
ALTER TABLE public.weigh_ins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weigh_ins read" ON public.weigh_ins
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id) OR public.is_self_athlete(athlete_id));

CREATE POLICY "weigh_ins coach insert" ON public.weigh_ins
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "weigh_ins coach update" ON public.weigh_ins
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "weigh_ins coach delete" ON public.weigh_ins
  FOR DELETE TO authenticated
  USING (public.is_org_member(organization_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.weigh_ins TO authenticated;
GRANT ALL ON public.weigh_ins TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.weigh_ins;
ALTER TABLE public.weigh_ins REPLICA IDENTITY FULL;

-- Shared by both doors below; not callable from the app directly.
-- Rejects out-of-range weights, asks for confirmation when a weigh-in is 30%
-- or more off the athlete's last two weeks, otherwise saves it and returns the
-- athlete's last ten weeks of weigh-ins so the caller can show feedback.
CREATE OR REPLACE FUNCTION public.record_weigh_in(
  _athlete_id uuid,
  _org_id uuid,
  _value numeric,
  _logged_at timestamptz,
  _source text,
  _logged_by uuid,
  _confirmed boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg numeric;
BEGIN
  IF _value IS NULL OR _value < 40 OR _value > 700 THEN
    RAISE EXCEPTION 'Weight must be between 40 and 700 lb';
  END IF;

  SELECT AVG(w.value) INTO v_avg
  FROM public.weigh_ins w
  WHERE w.athlete_id = _athlete_id
    AND w.logged_at >= _logged_at - interval '14 days'
    AND w.logged_at < _logged_at;

  IF v_avg IS NOT NULL AND NOT COALESCE(_confirmed, false)
     AND abs(_value - v_avg) / v_avg >= 0.30 THEN
    RETURN jsonb_build_object('status', 'confirm', 'recent_avg', round(v_avg, 1));
  END IF;

  INSERT INTO public.weigh_ins (athlete_id, organization_id, logged_at, value, source, logged_by)
  VALUES (_athlete_id, _org_id, _logged_at, _value, _source, _logged_by);

  RETURN jsonb_build_object(
    'status', 'ok',
    'logs', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('logged_at', w.logged_at, 'log_date', w.log_date, 'value', w.value)
        ORDER BY w.logged_at
      )
      FROM public.weigh_ins w
      WHERE w.athlete_id = _athlete_id
        AND w.logged_at >= now() - interval '70 days'
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_weigh_in(uuid, uuid, numeric, timestamptz, text, uuid, boolean)
  FROM PUBLIC, anon, authenticated;

-- Door 1: a signed-in coach (any athlete in their org, any date up to now) or a
-- signed-in athlete (themself, now only).
CREATE OR REPLACE FUNCTION public.log_weigh_in(
  _athlete_id uuid,
  _value numeric,
  _logged_at timestamptz DEFAULT NULL,
  _source text DEFAULT NULL,
  _confirmed boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_at timestamptz;
  v_source text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  SELECT a.organization_id INTO v_org
  FROM public.athletes a
  WHERE a.id = _athlete_id AND a.archived_at IS NULL;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Athlete not found';
  END IF;

  IF public.is_org_member(v_org) THEN
    v_at := COALESCE(_logged_at, now());
    v_source := COALESCE(_source, 'manual');
  ELSIF public.is_self_athlete(_athlete_id) THEN
    v_at := now();
    v_source := 'checkin';
  ELSE
    RAISE EXCEPTION 'Not allowed';
  END IF;

  IF v_source NOT IN ('checkin', 'manual', 'import') THEN
    RAISE EXCEPTION 'Unknown weigh-in source';
  END IF;
  IF v_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'A weigh-in cannot be in the future';
  END IF;

  RETURN public.record_weigh_in(_athlete_id, v_org, _value, v_at, v_source, auth.uid(), _confirmed);
END;
$$;

REVOKE ALL ON FUNCTION public.log_weigh_in(uuid, numeric, timestamptz, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_weigh_in(uuid, numeric, timestamptz, text, boolean) TO authenticated;

-- Door 2: the no-login team kiosk (tap or type your name). Same roster check
-- as roster_check_in. Marks attendance for the Eastern day and, if a weight was
-- typed, records it and hands back the athlete's own recent history for the
-- on-screen feedback. Returns {status:'confirm'} before saving anything when
-- the weight looks like a typo.
CREATE OR REPLACE FUNCTION public.kiosk_check_in(
  _token uuid,
  _athlete_id uuid,
  _bodyweight numeric DEFAULT NULL,
  _confirmed boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_name text;
  v_result jsonb := jsonb_build_object('status', 'ok', 'logs', '[]'::jsonb);
BEGIN
  SELECT a.organization_id,
         COALESCE(NULLIF(TRIM(COALESCE(a.preferred_name, a.first_name, '') || ' ' || COALESCE(a.last_name, '')), ''), a.name)
    INTO v_org, v_name
  FROM public.athletes a
  JOIN public.teams t ON t.qr_token = _token
  WHERE a.id = _athlete_id
    AND a.organization_id = t.organization_id
    AND a.archived_at IS NULL
    AND (a.team_id = t.id OR EXISTS (
      SELECT 1 FROM public.athlete_teams at
      WHERE at.athlete_id = a.id AND at.team_id = t.id AND at.left_at IS NULL
    ));

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Athlete not found on this team roster';
  END IF;

  IF _bodyweight IS NOT NULL THEN
    v_result := public.record_weigh_in(_athlete_id, v_org, _bodyweight, now(), 'checkin', NULL, _confirmed);
    IF v_result->>'status' = 'confirm' THEN
      RETURN v_result || jsonb_build_object('name', v_name);
    END IF;
  END IF;

  INSERT INTO public.attendance (athlete_id, organization_id, session_date, present, status)
  VALUES (_athlete_id, v_org, (now() AT TIME ZONE 'America/New_York')::date, true, 'present')
  ON CONFLICT (athlete_id, session_date)
  DO UPDATE SET present = true, status = 'present';

  RETURN v_result || jsonb_build_object('name', v_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.kiosk_check_in(uuid, uuid, numeric, boolean) TO anon, authenticated;
