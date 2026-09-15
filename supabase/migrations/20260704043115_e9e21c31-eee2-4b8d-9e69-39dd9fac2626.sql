
-- Expand app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'administrator';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'coach';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'assistant_coach';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'athlete';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'sport_coach';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'parent';
