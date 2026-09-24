-- The roster check-in kiosk (checkin.$token.tsx) lets any athlete tap a
-- name from a shared-device list with no login. With only a name + grade
-- shown, teammates with the same/similar name (siblings, common surnames)
-- are easy to mix up, and there's nothing to visually confirm "is this
-- me" before logging attendance/bodyweight under the wrong athlete.
-- Add position + photo_url so the client can show a real disambiguation
-- confirm step.
DROP FUNCTION IF EXISTS public.get_roster_by_qr_token(uuid);

CREATE FUNCTION public.get_roster_by_qr_token(_token uuid)
RETURNS TABLE(athlete_id uuid, display_name text, grade smallint, class_period text, position text, photo_url text)
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
  ORDER BY 2
$$;

GRANT EXECUTE ON FUNCTION public.get_roster_by_qr_token(uuid) TO anon, authenticated;
