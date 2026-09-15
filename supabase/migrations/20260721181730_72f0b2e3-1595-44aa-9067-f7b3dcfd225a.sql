
-- Phase 3&4: harden live-training + logs tables

-- 1) rack_session_athletes: two conflicting override_reason CHECKs. Drop both, add one union set.
ALTER TABLE public.rack_session_athletes DROP CONSTRAINT IF EXISTS rack_session_athletes_override_chk;
ALTER TABLE public.rack_session_athletes DROP CONSTRAINT IF EXISTS rack_session_athletes_override_reason_check;
ALTER TABLE public.rack_session_athletes
  ADD CONSTRAINT rack_session_athletes_override_reason_chk
  CHECK (override_reason = ANY (ARRAY['assigned','substitute','manual','manual_workout','template','one_off','makeup']));

-- 2) rack_set_logs: two conflicting override_status CHECKs. Drop both, add union.
ALTER TABLE public.rack_set_logs DROP CONSTRAINT IF EXISTS rack_set_logs_override_chk;
ALTER TABLE public.rack_set_logs DROP CONSTRAINT IF EXISTS rack_set_logs_override_status_check;
ALTER TABLE public.rack_set_logs
  ADD CONSTRAINT rack_set_logs_override_status_chk
  CHECK (override_status = ANY (ARRAY['assigned','overridden','substitute','manual','manual_workout','one_off']));

-- 3) Duplicate rep-max trigger on rack_set_logs — drop the redundant one.
DROP TRIGGER IF EXISTS trg_rack_set_logs_rep_max ON public.rack_set_logs;

-- 4) Value-range CHECKs on lifts / lift_sets / tests
ALTER TABLE public.lifts
  ADD CONSTRAINT lifts_load_nonneg_chk       CHECK (load IS NULL OR load >= 0)         NOT VALID,
  ADD CONSTRAINT lifts_reps_nonneg_chk       CHECK (reps IS NULL OR reps >= 0)         NOT VALID,
  ADD CONSTRAINT lifts_sets_nonneg_chk       CHECK (sets IS NULL OR sets >= 0)         NOT VALID,
  ADD CONSTRAINT lifts_velocity_nonneg_chk   CHECK (velocity IS NULL OR velocity >= 0) NOT VALID,
  ADD CONSTRAINT lifts_time_nonneg_chk       CHECK (time_seconds IS NULL OR time_seconds >= 0) NOT VALID,
  ADD CONSTRAINT lifts_distance_nonneg_chk   CHECK (distance_in IS NULL OR distance_in >= 0)   NOT VALID;

ALTER TABLE public.lift_sets
  ADD CONSTRAINT lift_sets_load_nonneg_chk     CHECK (load IS NULL OR load >= 0)         NOT VALID,
  ADD CONSTRAINT lift_sets_reps_nonneg_chk     CHECK (reps IS NULL OR reps >= 0)         NOT VALID,
  ADD CONSTRAINT lift_sets_velocity_nonneg_chk CHECK (velocity IS NULL OR velocity >= 0) NOT VALID;

-- 5) test_assignments: prevent double-scheduling same test on same day for same target
CREATE UNIQUE INDEX IF NOT EXISTS test_assignments_athlete_unique
  ON public.test_assignments (athlete_id, test_type, scheduled_date)
  WHERE athlete_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS test_assignments_team_unique
  ON public.test_assignments (team_id, test_type, scheduled_date)
  WHERE team_id IS NOT NULL AND athlete_id IS NULL;

-- 6) Missing FK indexes
CREATE INDEX IF NOT EXISTS rack_sessions_workout_id_idx        ON public.rack_sessions (workout_id);
CREATE INDEX IF NOT EXISTS rack_sessions_active_athlete_id_idx ON public.rack_sessions (active_athlete_id);
CREATE INDEX IF NOT EXISTS rack_sessions_session_date_idx      ON public.rack_sessions (session_date);
CREATE INDEX IF NOT EXISTS rsa_assigned_workout_id_idx         ON public.rack_session_athletes (assigned_workout_id);
CREATE INDEX IF NOT EXISTS rsa_active_workout_id_idx           ON public.rack_session_athletes (active_workout_id);
CREATE INDEX IF NOT EXISTS rsa_source_team_id_idx              ON public.rack_session_athletes (source_team_id);
CREATE INDEX IF NOT EXISTS rack_set_logs_workout_exercise_idx  ON public.rack_set_logs (workout_exercise_id);

-- 7) rack_sessions default status enforced already; add index for common "today per org" scan
CREATE INDEX IF NOT EXISTS rack_sessions_org_date_status_idx
  ON public.rack_sessions (organization_id, session_date, status);
