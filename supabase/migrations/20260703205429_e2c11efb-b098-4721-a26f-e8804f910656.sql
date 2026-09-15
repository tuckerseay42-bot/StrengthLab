
-- 1. Drop coaching_cues from exercises
ALTER TABLE public.exercises DROP COLUMN IF EXISTS coaching_cues;

-- 2. Remap categories
UPDATE public.exercises SET category = 'Lift'       WHERE category IN ('Main Lift','Dynamic Effort','Brief Maximal Tension');
UPDATE public.exercises SET category = 'Accessory'  WHERE category IN ('Accessories','Conditioning','Recovery');
UPDATE public.exercises SET category = 'Speed'      WHERE category = 'Sprint';
-- Plyometrics, Warm-Up, Jumps already valid; anything else -> Accessory
UPDATE public.exercises SET category = 'Accessory'
  WHERE category IS NOT NULL AND category NOT IN ('Lift','Jumps','Plyometrics','Speed','Accessory','Warm-Up');

-- 3. Custom metrics
CREATE TABLE public.custom_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  description text,
  kind text NOT NULL DEFAULT 'test_value', -- 'test_value' | 'bw_coefficient' | 'ratio'
  test_type text,             -- for test_value / bw_coefficient
  numerator_test text,        -- for ratio
  denominator_test text,      -- for ratio
  lower_is_better boolean NOT NULL DEFAULT false,
  unit text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_metrics TO anon, authenticated;
GRANT ALL ON public.custom_metrics TO service_role;
ALTER TABLE public.custom_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open custom_metrics" ON public.custom_metrics FOR ALL USING (true) WITH CHECK (true);

-- 4. Leaderboards
CREATE TABLE public.leaderboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  metric_id uuid NOT NULL REFERENCES public.custom_metrics(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  sport text,
  grade smallint,
  position text,
  row_limit smallint NOT NULL DEFAULT 10
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leaderboards TO anon, authenticated;
GRANT ALL ON public.leaderboards TO service_role;
ALTER TABLE public.leaderboards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open leaderboards" ON public.leaderboards FOR ALL USING (true) WITH CHECK (true);
