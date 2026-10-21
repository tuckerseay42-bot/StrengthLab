-- Parent notifications (injury marked, missed session, new PR) are opt-in
-- per organization and OFF by default — nothing sends until a coach
-- explicitly turns a kind on in Settings.
ALTER TABLE public.organizations
  ADD COLUMN notify_parent_injury boolean NOT NULL DEFAULT false,
  ADD COLUMN notify_parent_missed_session boolean NOT NULL DEFAULT false,
  ADD COLUMN notify_parent_pr boolean NOT NULL DEFAULT false;
