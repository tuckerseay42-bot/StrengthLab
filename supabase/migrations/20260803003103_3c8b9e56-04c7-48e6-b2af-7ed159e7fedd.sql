ALTER TABLE public.gps_sessions
  ADD COLUMN IF NOT EXISTS acceleration_count integer,
  ADD COLUMN IF NOT EXISTS deceleration_count integer;