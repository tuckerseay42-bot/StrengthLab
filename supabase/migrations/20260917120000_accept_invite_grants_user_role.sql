-- accept_invite() only ever wrote to organization_members, never to
-- user_roles. Every page-level canView/canEdit gate (Performance
-- Dashboard, Settings, Dashboard Settings, etc.) reads roles from
-- user_roles via useMyPermissions(), not organization_members — so a
-- brand-new user accepting an "owner" invite to their own new
-- organization got org-scoped data access but zero rows in user_roles,
-- and was locked out of every owner/admin/coach-gated page in the app.
-- org_member_role ('owner'|'coach') is a strict subset of app_role's
-- values, so the mapping is a direct cast.
CREATE OR REPLACE FUNCTION public.accept_invite(_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _invite RECORD; _user_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _invite FROM public.organization_invites WHERE token = _token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invite'; END IF;
  IF _invite.status = 'accepted' OR _invite.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invite already used';
  END IF;
  IF _invite.status = 'revoked' THEN RAISE EXCEPTION 'Invite has been revoked'; END IF;
  IF _invite.status = 'expired' OR _invite.expires_at < now() THEN
    UPDATE public.organization_invites SET status = 'expired' WHERE id = _invite.id AND status = 'pending';
    RAISE EXCEPTION 'Invite has expired';
  END IF;
  SELECT email INTO _user_email FROM auth.users WHERE id = auth.uid();
  IF lower(_user_email) <> lower(_invite.email) THEN
    RAISE EXCEPTION 'Sign in with % to accept this invite', _invite.email;
  END IF;
  INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (_invite.organization_id, auth.uid(), _invite.role)
    ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role)
    VALUES (auth.uid(), _invite.role::text::public.app_role)
    ON CONFLICT DO NOTHING;
  UPDATE public.organization_invites
     SET accepted_at = now(), used_at = now(), status = 'accepted'
   WHERE id = _invite.id;
  RETURN _invite.organization_id;
END $$;

-- One-time backfill: grant the matching user_roles row to every existing
-- organization_members row that doesn't already have one, so accounts that
-- accepted an invite before this fix stop being locked out.
INSERT INTO public.user_roles (user_id, role)
SELECT om.user_id, om.role::text::public.app_role
FROM public.organization_members om
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = om.user_id AND ur.role = om.role::text::public.app_role
)
ON CONFLICT DO NOTHING;
