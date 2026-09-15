
-- Add status + used_at to invites
ALTER TABLE public.organization_invites
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS used_at timestamptz;

-- Backfill status from existing state
UPDATE public.organization_invites
   SET status = CASE
     WHEN accepted_at IS NOT NULL THEN 'accepted'
     WHEN expires_at < now() THEN 'expired'
     ELSE 'pending'
   END
 WHERE status = 'pending';

-- Backfill used_at from accepted_at
UPDATE public.organization_invites SET used_at = accepted_at WHERE used_at IS NULL AND accepted_at IS NOT NULL;

-- Enum check
ALTER TABLE public.organization_invites
  DROP CONSTRAINT IF EXISTS organization_invites_status_check;
ALTER TABLE public.organization_invites
  ADD CONSTRAINT organization_invites_status_check
  CHECK (status IN ('pending','accepted','expired','revoked'));

-- Guard trigger: prevent mutating a terminal invite except allowed transitions
CREATE OR REPLACE FUNCTION public.trg_invite_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Auto-expire on read/update if past expiry and still pending
  IF NEW.status = 'pending' AND NEW.expires_at < now() THEN
    NEW.status := 'expired';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Cannot re-open a terminal invite
    IF OLD.status IN ('accepted','revoked') AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'Invite is % and cannot change status', OLD.status USING ERRCODE = 'check_violation';
    END IF;
    -- Cannot accept an expired invite
    IF OLD.status = 'expired' AND NEW.status = 'accepted' THEN
      RAISE EXCEPTION 'Invite has expired' USING ERRCODE = 'check_violation';
    END IF;
    -- Marking accepted sets used_at
    IF NEW.status = 'accepted' AND NEW.used_at IS NULL THEN
      NEW.used_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invite_guard ON public.organization_invites;
CREATE TRIGGER invite_guard
  BEFORE INSERT OR UPDATE ON public.organization_invites
  FOR EACH ROW EXECUTE FUNCTION public.trg_invite_guard();

-- Update accept_invite to use the new status + used_at fields
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
  UPDATE public.organization_invites
     SET accepted_at = now(), used_at = now(), status = 'accepted'
   WHERE id = _invite.id;
  RETURN _invite.organization_id;
END $$;

-- Ensure slug index (unique already exists but confirm btree)
CREATE INDEX IF NOT EXISTS organizations_slug_idx ON public.organizations (slug);
