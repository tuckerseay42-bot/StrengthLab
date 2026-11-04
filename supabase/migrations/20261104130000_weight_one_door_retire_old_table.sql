-- Weight tracking rebuild, step 6: one door at the database level, and retire the
-- old table.
--
-- 1) Any change to athletes.bodyweight (a profile edit, a roster import, a team
--    roster import) now also records a weigh-in, so no screen or import can put
--    a weight on an athlete that the history doesn't know about. The weigh-in
--    trigger already keeps athletes.bodyweight equal to the latest weigh-in; the
--    "already the latest" check below stops the two from chasing each other.
-- 2) bodyweight_logs is retired: nothing writes it anymore (the kiosks use
--    kiosk_check_in / log_weigh_in), its history was carried into weigh_ins in
--    the previous migration, and it was readable and writable by anyone holding
--    the public key. It stays as a read-only record for coaches only.

CREATE OR REPLACE FUNCTION public.athletes_bodyweight_to_weigh_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest numeric;
BEGIN
  -- Out-of-range numbers (an import typo) are left alone; they must never block
  -- the athlete row from saving.
  IF NEW.bodyweight IS NULL OR NEW.bodyweight < 40 OR NEW.bodyweight > 700 THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.bodyweight IS NOT DISTINCT FROM OLD.bodyweight THEN
    RETURN NULL;
  END IF;

  SELECT w.value INTO v_latest
  FROM public.weigh_ins w
  WHERE w.athlete_id = NEW.id
  ORDER BY w.logged_at DESC, w.created_at DESC
  LIMIT 1;

  -- Already the latest weigh-in: this is the sync writing it back, not a new weight.
  IF v_latest IS NOT DISTINCT FROM NEW.bodyweight THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.weigh_ins (athlete_id, organization_id, logged_at, value, source, logged_by)
  VALUES (NEW.id, NEW.organization_id, now(), NEW.bodyweight, 'manual', auth.uid());
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_athletes_bodyweight_to_weigh_in
  AFTER INSERT OR UPDATE OF bodyweight ON public.athletes
  FOR EACH ROW EXECUTE FUNCTION public.athletes_bodyweight_to_weigh_in();

-- Retire the old table.
DROP TRIGGER IF EXISTS trg_bodyweight_logs_mirror ON public.bodyweight_logs;
DROP FUNCTION IF EXISTS public.bodyweight_logs_mirror();

DROP POLICY IF EXISTS "Open bodyweight_logs" ON public.bodyweight_logs;
CREATE POLICY "bodyweight_logs legacy read" ON public.bodyweight_logs
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

REVOKE ALL ON public.bodyweight_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.bodyweight_logs FROM authenticated;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.bodyweight_logs;
EXCEPTION WHEN undefined_object THEN
  NULL;
END;
$$;

COMMENT ON TABLE public.bodyweight_logs IS
  'Retired. Read-only history from before weigh_ins; weigh_ins is the source of truth.';
