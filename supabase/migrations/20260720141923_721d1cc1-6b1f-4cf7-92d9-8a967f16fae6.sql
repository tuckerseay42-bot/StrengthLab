
-- 1) Add updated_at + touch trigger to tables missing them
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'athlete_badges','athlete_teams','attendance','custom_metrics',
    'exercise_relationships','exercises','leaderboards','lift_sets',
    'lifts','organization_invites','organization_members','program_versions',
    'program_workouts','registrations','rep_maxes','role_permissions',
    'teams','test_assignments','tests','user_roles','workout_assignments',
    'workout_blocks','workout_exercises','workout_sets'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_touch ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t, t);
  END LOOP;
END $$;

-- 2) Standardize soft-delete: add archived_at
ALTER TABLE public.athletes ADD COLUMN IF NOT EXISTS archived_at timestamptz;
UPDATE public.athletes SET archived_at = deactivated_at WHERE archived_at IS NULL AND deactivated_at IS NOT NULL;
UPDATE public.athletes SET archived_at = now() WHERE archived_at IS NULL AND status <> 'active';

ALTER TABLE public.exercises ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.programs ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.badges ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.custom_metrics ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.leaderboards ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.spider_graph_templates ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.test_types ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- 3) CHECK constraints on status/enum-like text fields (permissive, forward-compatible)
ALTER TABLE public.rack_sessions DROP CONSTRAINT IF EXISTS rack_sessions_status_chk;
ALTER TABLE public.rack_sessions ADD CONSTRAINT rack_sessions_status_chk
  CHECK (status IN ('active','paused','completed','cancelled'));

ALTER TABLE public.rack_set_logs DROP CONSTRAINT IF EXISTS rack_set_logs_status_chk;
ALTER TABLE public.rack_set_logs ADD CONSTRAINT rack_set_logs_status_chk
  CHECK (status IN ('pending','in_progress','completed','skipped','failed'));

ALTER TABLE public.rack_set_logs DROP CONSTRAINT IF EXISTS rack_set_logs_validation_chk;
ALTER TABLE public.rack_set_logs ADD CONSTRAINT rack_set_logs_validation_chk
  CHECK (validation_status IN ('normal','review','flagged'));

ALTER TABLE public.rack_set_logs DROP CONSTRAINT IF EXISTS rack_set_logs_approval_chk;
ALTER TABLE public.rack_set_logs ADD CONSTRAINT rack_set_logs_approval_chk
  CHECK (approval_status IN ('auto','pending','approved','rejected'));

ALTER TABLE public.rack_set_logs DROP CONSTRAINT IF EXISTS rack_set_logs_override_chk;
ALTER TABLE public.rack_set_logs ADD CONSTRAINT rack_set_logs_override_chk
  CHECK (override_status IN ('assigned','substitute','manual','manual_workout'));

ALTER TABLE public.rack_session_athletes DROP CONSTRAINT IF EXISTS rack_session_athletes_override_chk;
ALTER TABLE public.rack_session_athletes ADD CONSTRAINT rack_session_athletes_override_chk
  CHECK (override_reason IN ('assigned','substitute','manual','manual_workout'));

ALTER TABLE public.workout_assignments DROP CONSTRAINT IF EXISTS workout_assignments_status_chk;
ALTER TABLE public.workout_assignments ADD CONSTRAINT workout_assignments_status_chk
  CHECK (status IN ('assigned','in_progress','completed','skipped','cancelled'));

ALTER TABLE public.athletes DROP CONSTRAINT IF EXISTS athletes_status_chk;
ALTER TABLE public.athletes ADD CONSTRAINT athletes_status_chk
  CHECK (status IN ('active','inactive','archived'));

ALTER TABLE public.athletes DROP CONSTRAINT IF EXISTS athletes_gender_chk;
ALTER TABLE public.athletes ADD CONSTRAINT athletes_gender_chk
  CHECK (gender IS NULL OR gender IN ('male','female','other','prefer_not_to_say'));

ALTER TABLE public.custom_metrics DROP CONSTRAINT IF EXISTS custom_metrics_kind_chk;
ALTER TABLE public.custom_metrics ADD CONSTRAINT custom_metrics_kind_chk
  CHECK (kind IN ('test_value','attendance_pct','bw_coefficient','improvement_pct','formula','lift_metric'));

ALTER TABLE public.custom_metrics DROP CONSTRAINT IF EXISTS custom_metrics_measurement_chk;
ALTER TABLE public.custom_metrics ADD CONSTRAINT custom_metrics_measurement_chk
  CHECK (measurement IN ('load','reps','velocity','time','distance','count'));

ALTER TABLE public.exercises DROP CONSTRAINT IF EXISTS exercises_measurement_type_chk;
ALTER TABLE public.exercises ADD CONSTRAINT exercises_measurement_type_chk
  CHECK (measurement_type IN ('load','inches','seconds','reps','count'));

ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_status_chk;
ALTER TABLE public.registrations ADD CONSTRAINT registrations_status_chk
  CHECK (status IN ('pending','approved','rejected'));

-- 4) Missing UNIQUE constraints (partial where appropriate)
CREATE UNIQUE INDEX IF NOT EXISTS athletes_user_id_uniq
  ON public.athletes(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS athletes_join_token_uniq
  ON public.athletes(join_token);
CREATE UNIQUE INDEX IF NOT EXISTS athletes_org_student_id_uniq
  ON public.athletes(organization_id, student_id)
  WHERE student_id IS NOT NULL AND archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS teams_qr_token_uniq
  ON public.teams(qr_token);
CREATE UNIQUE INDEX IF NOT EXISTS teams_org_name_uniq
  ON public.teams(organization_id, lower(name)) WHERE archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS exercises_org_name_uniq
  ON public.exercises(organization_id, lower(name)) WHERE archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS workout_assignments_athlete_uniq
  ON public.workout_assignments(workout_id, athlete_id, scheduled_date)
  WHERE athlete_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS workout_assignments_team_uniq
  ON public.workout_assignments(workout_id, team_id, scheduled_date)
  WHERE team_id IS NOT NULL AND athlete_id IS NULL;
