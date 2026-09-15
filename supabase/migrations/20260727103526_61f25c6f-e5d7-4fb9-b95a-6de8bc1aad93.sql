ALTER TABLE public.athletes ADD COLUMN IF NOT EXISTS class_period text;
CREATE INDEX IF NOT EXISTS athletes_class_period_idx ON public.athletes(class_period);