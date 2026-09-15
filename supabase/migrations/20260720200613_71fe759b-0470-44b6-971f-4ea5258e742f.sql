
-- Cleanup: drop the older duplicate measurement_type check
ALTER TABLE public.exercises DROP CONSTRAINT IF EXISTS exercises_measurement_type_check;

-- Ordering: deferrable unique(parent, position) at each workout level
ALTER TABLE public.workout_blocks
  DROP CONSTRAINT IF EXISTS workout_blocks_workout_position_uniq,
  ADD CONSTRAINT workout_blocks_workout_position_uniq
    UNIQUE (workout_id, position) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.workout_exercises
  DROP CONSTRAINT IF EXISTS workout_exercises_block_position_uniq,
  ADD CONSTRAINT workout_exercises_block_position_uniq
    UNIQUE (workout_id, block_id, position) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.workout_sets
  DROP CONSTRAINT IF EXISTS workout_sets_exercise_position_uniq,
  ADD CONSTRAINT workout_sets_exercise_position_uniq
    UNIQUE (workout_exercise_id, position) DEFERRABLE INITIALLY DEFERRED;

-- Value sanity checks. NOTE: reps is text (allows ranges like "8-10"),
-- load is numeric. Guard the numerics.
ALTER TABLE public.workout_exercises
  DROP CONSTRAINT IF EXISTS workout_exercises_ranges_chk,
  ADD CONSTRAINT workout_exercises_ranges_chk CHECK (
    (sets IS NULL OR sets >= 0)
    AND (load IS NULL OR load >= 0)
    AND (rest_seconds IS NULL OR rest_seconds >= 0)
    AND (percent IS NULL OR percent >= 0)
  );

ALTER TABLE public.workout_sets
  DROP CONSTRAINT IF EXISTS workout_sets_ranges_chk,
  ADD CONSTRAINT workout_sets_ranges_chk CHECK (
    (sets IS NULL OR sets >= 0)
    AND (load IS NULL OR load >= 0)
    AND (percent IS NULL OR percent >= 0)
    AND (time_seconds IS NULL OR time_seconds >= 0)
    AND (distance_in IS NULL OR distance_in >= 0)
    AND (rm_reps IS NULL OR rm_reps >= 0)
  );

-- Missing FK indexes
CREATE INDEX IF NOT EXISTS workouts_team_id_idx ON public.workouts(team_id);
CREATE INDEX IF NOT EXISTS workout_exercises_block_id_idx ON public.workout_exercises(block_id);
CREATE INDEX IF NOT EXISTS workout_exercises_exercise_id_idx ON public.workout_exercises(exercise_id);
CREATE INDEX IF NOT EXISTS workout_exercises_percent_ref_idx ON public.workout_exercises(percent_of_exercise_id);
CREATE INDEX IF NOT EXISTS workout_sets_percent_ref_idx ON public.workout_sets(percent_of_exercise_id);

-- Hot query path: today's workout for athlete
CREATE INDEX IF NOT EXISTS workout_assignments_athlete_date_idx
  ON public.workout_assignments(athlete_id, scheduled_date);
CREATE INDEX IF NOT EXISTS workout_assignments_team_date_idx
  ON public.workout_assignments(team_id, scheduled_date);

-- Controlled vocabulary for exercises.category
ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_category_chk,
  ADD CONSTRAINT exercises_category_chk CHECK (
    category IS NULL OR category IN
      ('Accessory','Jumps','Lift','Plyometrics','Speed','Warm-Up')
  );

-- exercise_relationships: typed relationship + per-type uniqueness
ALTER TABLE public.exercise_relationships
  ADD COLUMN IF NOT EXISTS relationship_type text NOT NULL DEFAULT 'variation_of';

ALTER TABLE public.exercise_relationships
  DROP CONSTRAINT IF EXISTS exercise_relationships_type_chk,
  ADD CONSTRAINT exercise_relationships_type_chk CHECK (
    relationship_type IN
      ('variation_of','superset_pair','progression_from','regression_from','alternative_for')
  );

-- Drop old (from,to) unique and re-add including type
ALTER TABLE public.exercise_relationships
  DROP CONSTRAINT IF EXISTS exercise_relationships_from_exercise_id_to_exercise_id_key,
  DROP CONSTRAINT IF EXISTS exercise_relationships_from_to_type_uniq,
  ADD CONSTRAINT exercise_relationships_from_to_type_uniq
    UNIQUE (from_exercise_id, to_exercise_id, relationship_type);
