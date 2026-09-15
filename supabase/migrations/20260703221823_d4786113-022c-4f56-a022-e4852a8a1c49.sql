
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS sport_fall text,
  ADD COLUMN IF NOT EXISTS sport_winter text,
  ADD COLUMN IF NOT EXISTS sport_spring text;

ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS sport_fall text,
  ADD COLUMN IF NOT EXISTS sport_winter text,
  ADD COLUMN IF NOT EXISTS sport_spring text;
