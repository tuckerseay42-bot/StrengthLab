
ALTER TABLE public.workout_sets
  ADD COLUMN IF NOT EXISTS time_seconds numeric,
  ADD COLUMN IF NOT EXISTS distance_in numeric;

ALTER TABLE public.rack_set_logs
  ADD COLUMN IF NOT EXISTS time_seconds numeric,
  ADD COLUMN IF NOT EXISTS distance_in numeric;
