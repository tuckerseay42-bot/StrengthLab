
CREATE TABLE public.athlete_pins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  pin_salt text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_pins TO authenticated;
GRANT ALL ON public.athlete_pins TO service_role;

ALTER TABLE public.athlete_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own pin"
ON public.athlete_pins FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER athlete_pins_touch
BEFORE UPDATE ON public.athlete_pins
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
