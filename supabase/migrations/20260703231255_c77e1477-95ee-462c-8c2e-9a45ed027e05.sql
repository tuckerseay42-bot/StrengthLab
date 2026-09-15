
-- Add measurement type + metric flag to exercises
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS measurement_type text NOT NULL DEFAULT 'load',
  ADD COLUMN IF NOT EXISTS is_metric boolean NOT NULL DEFAULT false;

ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_measurement_type_check;
ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_measurement_type_check
  CHECK (measurement_type IN ('load','seconds','inches','reps'));

-- Velocity prescription on workout prescriptions (planned) and sets (logged targets)
ALTER TABLE public.workout_exercises
  ADD COLUMN IF NOT EXISTS target_velocity_min numeric,
  ADD COLUMN IF NOT EXISTS target_velocity_max numeric;

ALTER TABLE public.workout_sets
  ADD COLUMN IF NOT EXISTS target_velocity_min numeric,
  ADD COLUMN IF NOT EXISTS target_velocity_max numeric;
