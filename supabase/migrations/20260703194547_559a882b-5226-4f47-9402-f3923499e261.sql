
-- TEAMS
CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sport text,
  season text,
  color text DEFAULT '#F97316',
  qr_token uuid NOT NULL DEFAULT gen_random_uuid(),
  notes text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX teams_qr_token_idx ON public.teams(qr_token);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO anon, authenticated;
GRANT ALL ON public.teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open teams" ON public.teams FOR ALL USING (true) WITH CHECK (true);

-- Default team + backfill athletes
INSERT INTO public.teams (name, sport) VALUES ('Default Team', 'General');

-- ATHLETES expansion
ALTER TABLE public.athletes
  ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN first_name text,
  ADD COLUMN last_name text,
  ADD COLUMN preferred_name text,
  ADD COLUMN student_id text,
  ADD COLUMN graduation_year smallint,
  ADD COLUMN height_in numeric,
  ADD COLUMN parent_email text,
  ADD COLUMN athlete_email text,
  ADD COLUMN photo_url text,
  ADD COLUMN status text NOT NULL DEFAULT 'active';

UPDATE public.athletes
SET team_id = (SELECT id FROM public.teams WHERE name = 'Default Team' LIMIT 1)
WHERE team_id IS NULL;

-- REGISTRATIONS
CREATE TABLE public.registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  preferred_name text,
  student_id text,
  grade smallint,
  sport text,
  position text,
  graduation_year smallint,
  height_in numeric,
  weight_lb numeric,
  parent_email text,
  athlete_email text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registrations TO anon, authenticated;
GRANT ALL ON public.registrations TO service_role;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open registrations" ON public.registrations FOR ALL USING (true) WITH CHECK (true);

-- EXERCISES
CREATE TABLE public.exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  equipment text,
  primary_muscles text[] DEFAULT '{}',
  coaching_cues text,
  video_url text,
  image_url text,
  is_custom boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exercises_name_idx ON public.exercises(name);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exercises TO anon, authenticated;
GRANT ALL ON public.exercises TO service_role;
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open exercises" ON public.exercises FOR ALL USING (true) WITH CHECK (true);

-- Seed exercise library
INSERT INTO public.exercises (name, category, equipment, primary_muscles, coaching_cues) VALUES
('Back Squat', 'Main Lift', 'Barbell', ARRAY['Quads','Glutes','Hamstrings'], 'Chest up, knees track over toes, hit depth.'),
('Front Squat', 'Main Lift', 'Barbell', ARRAY['Quads','Glutes','Core'], 'Elbows high, torso vertical.'),
('Box Squat', 'Main Lift', 'Barbell', ARRAY['Quads','Glutes','Hamstrings'], 'Sit back to box, stay tight, drive up.'),
('Overhead Squat', 'Main Lift', 'Barbell', ARRAY['Quads','Shoulders','Core'], 'Active shoulders, upright torso.'),
('Bench Press', 'Main Lift', 'Barbell', ARRAY['Chest','Triceps','Shoulders'], 'Retract scaps, bar to chest, drive feet.'),
('Incline Bench Press', 'Main Lift', 'Barbell', ARRAY['Upper Chest','Shoulders'], 'Slight arch, bar to upper chest.'),
('Close Grip Bench', 'Accessories', 'Barbell', ARRAY['Triceps','Chest'], 'Hands shoulder-width, elbows tucked.'),
('Overhead Press', 'Main Lift', 'Barbell', ARRAY['Shoulders','Triceps'], 'Squeeze glutes, press through the bar.'),
('Sumo Deadlift', 'Main Lift', 'Barbell', ARRAY['Glutes','Hamstrings','Back'], 'Wide stance, chest up, push floor away.'),
('Conventional Deadlift', 'Main Lift', 'Barbell', ARRAY['Hamstrings','Glutes','Back'], 'Neutral spine, bar over midfoot.'),
('Trap Bar Deadlift', 'Main Lift', 'Trap Bar', ARRAY['Quads','Glutes','Back'], 'Stand tall, drive through heels.'),
('Romanian Deadlift', 'Accessories', 'Barbell', ARRAY['Hamstrings','Glutes'], 'Soft knees, hinge at hips.'),
('Hang Clean', 'Dynamic Effort', 'Barbell', ARRAY['Posterior Chain','Traps'], 'Explosive triple extension.'),
('Power Clean', 'Dynamic Effort', 'Barbell', ARRAY['Posterior Chain','Traps'], 'Jump and shrug, fast elbows.'),
('Snatch', 'Dynamic Effort', 'Barbell', ARRAY['Posterior Chain','Shoulders'], 'Bar close, punch overhead.'),
('Push Press', 'Dynamic Effort', 'Barbell', ARRAY['Shoulders','Legs'], 'Dip, drive, press.'),
('Split Squat', 'Accessories', 'Dumbbell', ARRAY['Quads','Glutes'], 'Front knee tracks toe, torso tall.'),
('Bulgarian Split Squat', 'Accessories', 'Dumbbell', ARRAY['Quads','Glutes'], 'Rear foot elevated, sink low.'),
('Walking Lunge', 'Accessories', 'Dumbbell', ARRAY['Quads','Glutes'], 'Long stride, knee to floor.'),
('Step Up', 'Accessories', 'Dumbbell', ARRAY['Quads','Glutes'], 'Drive through front heel.'),
('Pull Up', 'Accessories', 'Bodyweight', ARRAY['Lats','Biceps'], 'Full range, chin over bar.'),
('Chin Up', 'Accessories', 'Bodyweight', ARRAY['Lats','Biceps'], 'Supinated grip, elbows down.'),
('Bent Over Row', 'Accessories', 'Barbell', ARRAY['Back','Biceps'], 'Flat back, row to belly.'),
('DB Row', 'Accessories', 'Dumbbell', ARRAY['Back','Biceps'], 'Elbow drives back.'),
('Face Pull', 'Accessories', 'Cable', ARRAY['Rear Delts','Upper Back'], 'Pull to face, high elbows.'),
('Plank', 'Accessories', 'Bodyweight', ARRAY['Core'], 'Straight line, brace hard.'),
('Box Jump', 'Plyometrics', 'Box', ARRAY['Quads','Glutes','Calves'], 'Soft landing, stand tall.'),
('Broad Jump', 'Plyometrics', 'Bodyweight', ARRAY['Posterior Chain'], 'Big arm swing, hips through.'),
('Vertical Jump', 'Plyometrics', 'Bodyweight', ARRAY['Posterior Chain'], 'Countermovement, explode up.'),
('Depth Jump', 'Plyometrics', 'Box', ARRAY['Posterior Chain'], 'Step off, minimize ground time.'),
('Med Ball Slam', 'Plyometrics', 'Med Ball', ARRAY['Core','Lats'], 'Full extension, drive down.'),
('Med Ball Rotational Throw', 'Plyometrics', 'Med Ball', ARRAY['Core','Hips'], 'Rotate through the hips.'),
('10 Yard Sprint', 'Sprint', 'Track', ARRAY['Posterior Chain'], 'Positive shin angle, drive out.'),
('20 Yard Sprint', 'Sprint', 'Track', ARRAY['Posterior Chain'], 'Progressive rise, punch ground.'),
('40 Yard Sprint', 'Sprint', 'Track', ARRAY['Posterior Chain'], 'Drive phase then transition tall.'),
('Fly 10', 'Sprint', 'Track', ARRAY['Posterior Chain'], 'Max velocity through zone.'),
('Pro Agility (5-10-5)', 'Sprint', 'Cones', ARRAY['Posterior Chain'], 'Low hips at change of direction.'),
('L-Drill (3 Cone)', 'Sprint', 'Cones', ARRAY['Posterior Chain'], 'Tight turns, plant outside foot.'),
('Sled Push', 'Conditioning', 'Sled', ARRAY['Legs','Core'], 'Low body angle, drive knees.'),
('Farmer Carry', 'Accessories', 'Dumbbell', ARRAY['Grip','Core'], 'Tall posture, quick steps.'),
('Foam Roll', 'Recovery', 'Foam Roller', ARRAY['Full Body'], 'Slow passes, breathe.'),
('Dynamic Warm Up', 'Warm-Up', 'None', ARRAY['Full Body'], 'Progressive intensity.');
