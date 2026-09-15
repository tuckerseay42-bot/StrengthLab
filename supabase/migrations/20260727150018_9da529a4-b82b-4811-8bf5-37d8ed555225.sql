
CREATE TABLE public.rack_athlete_exercise_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rack_session_id uuid NOT NULL REFERENCES public.rack_sessions(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  workout_exercise_id uuid NOT NULL REFERENCES public.workout_exercises(id) ON DELETE CASCADE,
  substitute_exercise_id uuid REFERENCES public.exercises(id) ON DELETE SET NULL,
  substitute_exercise_name text NOT NULL,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rack_session_id, athlete_id, workout_exercise_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rack_athlete_exercise_overrides TO authenticated;
GRANT ALL ON public.rack_athlete_exercise_overrides TO service_role;

ALTER TABLE public.rack_athlete_exercise_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage exercise overrides"
  ON public.rack_athlete_exercise_overrides
  FOR ALL TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "athletes view own exercise overrides"
  ON public.rack_athlete_exercise_overrides
  FOR SELECT TO authenticated
  USING (public.is_self_athlete(athlete_id));

CREATE INDEX rack_athlete_ex_ovr_session_idx
  ON public.rack_athlete_exercise_overrides (rack_session_id);
CREATE INDEX rack_athlete_ex_ovr_athlete_idx
  ON public.rack_athlete_exercise_overrides (athlete_id);

CREATE TRIGGER rack_athlete_ex_ovr_touch
  BEFORE UPDATE ON public.rack_athlete_exercise_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
