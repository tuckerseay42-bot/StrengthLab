-- Lets a coach tag an injury with the movement patterns it rules out, and
-- tag each exercise with which patterns it involves, so Training View can
-- flag "this prescribed lift conflicts with an active restriction" instead
-- of relying on the coach to remember every athlete's limitations.
ALTER TABLE public.athlete_injuries
  ADD COLUMN restricted_patterns text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.exercises
  ADD COLUMN movement_patterns text[] NOT NULL DEFAULT '{}';
