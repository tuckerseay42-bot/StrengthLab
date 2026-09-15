-- 1. Organization branding
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS brand_primary text,
  ADD COLUMN IF NOT EXISTS brand_secondary text,
  ADD COLUMN IF NOT EXISTS default_theme text CHECK (default_theme IN ('light','dark')) DEFAULT 'dark',
  ADD COLUMN IF NOT EXISTS email_sender_name text,
  ADD COLUMN IF NOT EXISTS report_header text;

-- 2. Athlete invitation status
DO $$ BEGIN
  CREATE TYPE public.athlete_invite_status AS ENUM
    ('not_invited','sent','delivered','opened','pin_set','active','expired','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS invite_status public.athlete_invite_status NOT NULL DEFAULT 'not_invited',
  ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_error text,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

-- 3. Athlete PIN hashes
CREATE TABLE IF NOT EXISTS public.athlete_pin_hashes (
  athlete_id uuid PRIMARY KEY REFERENCES public.athletes(id) ON DELETE CASCADE,
  hash text NOT NULL,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.athlete_pin_hashes TO authenticated;
GRANT ALL ON public.athlete_pin_hashes TO service_role;

ALTER TABLE public.athlete_pin_hashes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Athletes can read their own pin row"
  ON public.athlete_pin_hashes FOR SELECT TO authenticated
  USING (public.is_self_athlete(athlete_id));

CREATE TRIGGER athlete_pin_hashes_touch
  BEFORE UPDATE ON public.athlete_pin_hashes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Rack set logs — duplicate-submit guard
CREATE UNIQUE INDEX IF NOT EXISTS rack_set_logs_dedup_idx
  ON public.rack_set_logs (rack_session_id, workout_exercise_id, set_position, athlete_id)
  WHERE status = 'completed';

-- 5. Platform owner role
DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'platform_owner';
EXCEPTION WHEN others THEN NULL; END $$;
