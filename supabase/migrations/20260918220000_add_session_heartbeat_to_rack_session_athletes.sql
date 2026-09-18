-- Nothing currently records when an athlete opens their Today/live-logging
-- view, or whether their tab is still open — the Command Center can only
-- infer activity from rack_set_logs rows, which don't exist until the
-- athlete's first completed set. Add a lightweight heartbeat pair so the
-- coach can see "opened", "still active", and "opened but hasn't logged
-- anything yet" as distinct states in real time.
ALTER TABLE public.rack_session_athletes
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

ALTER PUBLICATION supabase_realtime ADD TABLE public.rack_session_athletes;
ALTER TABLE public.rack_session_athletes REPLICA IDENTITY FULL;
