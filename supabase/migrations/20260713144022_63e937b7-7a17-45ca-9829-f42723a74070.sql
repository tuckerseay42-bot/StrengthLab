
-- ============================================================
-- BATCH A: security definer lockdown + hot-path indexes
-- ============================================================

-- Lock down internal SECURITY DEFINER helpers to authenticated only.
-- Keep public token flows (get_invite, get_athlete_by_join_token,
-- get_team_by_qr_token, submit_registration) callable by anon.
DO $$
DECLARE
  fn text;
  sig text;
  internal_fns text[] := ARRAY[
    'has_role(uuid, app_role)',
    'has_permission(uuid, text)',
    'is_org_member(uuid)',
    'is_org_owner(uuid)',
    'is_super_admin()',
    'current_org_id()',
    'is_self_athlete(uuid)',
    'claim_athlete(uuid)',
    'accept_invite(uuid)',
    'rollup_rep_maxes()',
    'record_rep_max_candidate(uuid, uuid, text, integer, numeric, date, text)',
    'merge_exercises(uuid, uuid)',
    'grant_owner_to_first_user()',
    'touch_updated_at()',
    'trg_rack_log_compute()',
    'trg_rack_log_rep_max()',
    'trg_rack_log_to_lift()',
    'trg_lift_sets_rep_max()',
    'trg_lifts_rep_max()'
  ];
BEGIN
  FOREACH sig IN ARRAY internal_fns LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', sig);
    EXCEPTION WHEN undefined_function THEN
      -- Function may not exist in this branch; skip.
      NULL;
    END;
  END LOOP;
END $$;

-- Public token-scoped fns: ensure anon can call them (idempotent).
GRANT EXECUTE ON FUNCTION public.get_invite(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_athlete_by_join_token(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_by_qr_token(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_registration(uuid, jsonb) TO anon, authenticated;

-- ============================================================
-- Hot-path indexes (created if missing).
-- ============================================================
CREATE INDEX IF NOT EXISTS athletes_org_name_idx
  ON public.athletes (organization_id, name);

CREATE INDEX IF NOT EXISTS rack_set_logs_session_idx
  ON public.rack_set_logs (rack_session_id);

CREATE INDEX IF NOT EXISTS rack_set_logs_session_athlete_idx
  ON public.rack_set_logs (rack_session_id, athlete_id);

CREATE INDEX IF NOT EXISTS attendance_org_date_idx
  ON public.attendance (organization_id, session_date DESC);

CREATE INDEX IF NOT EXISTS tests_athlete_type_date_idx
  ON public.tests (athlete_id, test_type, test_date DESC);

CREATE INDEX IF NOT EXISTS lifts_athlete_ex_date_idx
  ON public.lifts (athlete_id, exercise, lift_date DESC);

CREATE INDEX IF NOT EXISTS teams_org_name_idx
  ON public.teams (organization_id, name)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS rep_maxes_athlete_ex_idx
  ON public.rep_maxes (athlete_id, exercise_id, reps);
