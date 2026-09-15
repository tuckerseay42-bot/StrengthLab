
ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS join_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS athletes_join_token_key ON public.athletes(join_token);
CREATE UNIQUE INDEX IF NOT EXISTS athletes_user_id_key ON public.athletes(user_id) WHERE user_id IS NOT NULL;

-- Ensure 'athlete' role exists in app_role enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'athlete') THEN
    ALTER TYPE public.app_role ADD VALUE 'athlete';
  END IF;
END $$;

-- Security definer: link current auth user to athlete row via join_token
CREATE OR REPLACE FUNCTION public.claim_athlete(_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _athlete_id uuid;
  _existing_user uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, user_id INTO _athlete_id, _existing_user
  FROM public.athletes WHERE join_token = _token;

  IF _athlete_id IS NULL THEN
    RAISE EXCEPTION 'Invalid token';
  END IF;

  IF _existing_user IS NOT NULL AND _existing_user <> auth.uid() THEN
    RAISE EXCEPTION 'Athlete already linked to another account';
  END IF;

  UPDATE public.athletes SET user_id = auth.uid() WHERE id = _athlete_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'athlete')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN _athlete_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_athlete(uuid) TO authenticated;
