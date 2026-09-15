ALTER TABLE public.athletes ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
