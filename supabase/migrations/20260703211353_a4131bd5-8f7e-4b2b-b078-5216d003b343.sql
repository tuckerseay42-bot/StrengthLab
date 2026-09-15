
ALTER TABLE public.custom_metrics
  ADD COLUMN IF NOT EXISTS formula text,
  ADD COLUMN IF NOT EXISTS variables jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.leaderboards
  ADD COLUMN IF NOT EXISTS since_days integer,
  ADD COLUMN IF NOT EXISTS date_from date,
  ADD COLUMN IF NOT EXISTS date_to date;
