ALTER TABLE public.athletes ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS gender text;