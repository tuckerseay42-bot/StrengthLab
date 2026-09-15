
-- Rack Console MVP schema

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS rack_count integer NOT NULL DEFAULT 8;

CREATE TABLE IF NOT EXISTS public.rack_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  rack_number integer NOT NULL,
  workout_id uuid REFERENCES public.workouts(id) ON DELETE SET NULL,
  session_date date NOT NULL DEFAULT CURRENT_DATE,
  athlete_ids uuid[] NOT NULL DEFAULT '{}',
  active_athlete_id uuid REFERENCES public.athletes(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, rack_number, session_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rack_sessions TO authenticated, anon;
GRANT ALL ON public.rack_sessions TO service_role;
ALTER TABLE public.rack_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open rack_sessions" ON public.rack_sessions FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.rack_set_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rack_session_id uuid NOT NULL REFERENCES public.rack_sessions(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  workout_exercise_id uuid NOT NULL REFERENCES public.workout_exercises(id) ON DELETE CASCADE,
  set_position integer NOT NULL,
  load numeric,
  reps integer,
  avg_velocity numeric,
  peak_velocity numeric,
  rpe numeric,
  rir numeric,
  notes text,
  status text NOT NULL DEFAULT 'completed', -- completed | skipped
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rack_session_id, athlete_id, workout_exercise_id, set_position)
);

CREATE INDEX IF NOT EXISTS idx_rack_set_logs_session ON public.rack_set_logs (rack_session_id);
CREATE INDEX IF NOT EXISTS idx_rack_set_logs_athlete ON public.rack_set_logs (athlete_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rack_set_logs TO authenticated, anon;
GRANT ALL ON public.rack_set_logs TO service_role;
ALTER TABLE public.rack_set_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open rack_set_logs" ON public.rack_set_logs FOR ALL USING (true) WITH CHECK (true);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_rack_sessions_touch ON public.rack_sessions;
CREATE TRIGGER trg_rack_sessions_touch BEFORE UPDATE ON public.rack_sessions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_rack_set_logs_touch ON public.rack_set_logs;
CREATE TRIGGER trg_rack_set_logs_touch BEFORE UPDATE ON public.rack_set_logs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.rack_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rack_set_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.workout_exercises;
ALTER PUBLICATION supabase_realtime ADD TABLE public.workout_sets;

ALTER TABLE public.rack_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.rack_set_logs REPLICA IDENTITY FULL;
ALTER TABLE public.workout_exercises REPLICA IDENTITY FULL;
ALTER TABLE public.workout_sets REPLICA IDENTITY FULL;
