-- Team check-in kiosk: once an athlete has checked in today, take their name off
-- the "find your name" list, so the next kid cannot tap it by mistake and log a
-- weight for them.
--
-- A coach can bring a name back (a kid tapped the wrong name, or needs to log
-- again). That sets kiosk_reopened on today's attendance row. It does not change
-- present/absent, so no "marked absent" notice goes to a parent. When the kid
-- checks in again at the kiosk the flag clears and the name goes away again.
-- "Today" is the Eastern day, the same as weigh-ins.
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS kiosk_reopened boolean NOT NULL DEFAULT false;

-- Same columns as before; only the WHERE changes. Dropped and re-created (not
-- "or replace") so it works whatever shape the earlier version has. Postgres
-- reserves the word "position" as a bare column name, so it is quoted here.
DROP FUNCTION IF EXISTS public.get_roster_by_qr_token(uuid);

CREATE FUNCTION public.get_roster_by_qr_token(_token uuid)
RETURNS TABLE(athlete_id uuid, display_name text, grade smallint, class_period text, "position" text, photo_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id,
         COALESCE(NULLIF(TRIM(COALESCE(a.preferred_name, a.first_name, '') || ' ' || COALESCE(a.last_name, '')), ''), a.name),
         a.grade,
         a.class_period,
         a.position,
         a.photo_url
  FROM public.athletes a
  JOIN public.teams t ON t.qr_token = _token
  WHERE a.organization_id = t.organization_id
    AND a.archived_at IS NULL
    AND (a.team_id = t.id OR EXISTS (
      SELECT 1 FROM public.athlete_teams at
      WHERE at.athlete_id = a.id AND at.team_id = t.id AND at.left_at IS NULL
    ))
    AND NOT EXISTS (
      SELECT 1 FROM public.attendance att
      WHERE att.athlete_id = a.id
        AND att.session_date = (now() AT TIME ZONE 'America/New_York')::date
        AND att.present = true
        AND att.kiosk_reopened = false
    )
  ORDER BY 2
$$;

GRANT EXECUTE ON FUNCTION public.get_roster_by_qr_token(uuid) TO anon, authenticated;

-- Same as before, except checking in clears a coach's "bring name back".
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

  INSERT INTO public.attendance (athlete_id, organization_id, session_date, present, status, kiosk_reopened)
  VALUES (_athlete_id, v_org, (now() AT TIME ZONE 'America/New_York')::date, true, 'present', false)
  ON CONFLICT (athlete_id, session_date)
  DO UPDATE SET present = true, status = 'present', kiosk_reopened = false;

  RETURN v_result || jsonb_build_object('name', v_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.kiosk_check_in(uuid, uuid, numeric, boolean) TO anon, authenticated;
