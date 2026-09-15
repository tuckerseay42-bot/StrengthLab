
ALTER TABLE public.custom_metrics
  ADD COLUMN IF NOT EXISTS exercise_name text,
  ADD COLUMN IF NOT EXISTS since_days integer;

-- Seed default metrics (id captured via CTE + upsert-by-name behaviour)
WITH new_metrics AS (
  INSERT INTO public.custom_metrics (name, description, kind, test_type, numerator_test, denominator_test, lower_is_better, unit, exercise_name, since_days)
  SELECT * FROM (VALUES
    ('40-Yard Dash',        'Fastest 40-yard sprint',              'test_value',     'sprint_40y',   NULL, NULL, true,  's',      NULL,          NULL::int),
    ('Vertical Jump',       'Best vertical jump',                  'test_value',     'vertical_jump',NULL, NULL, false, 'in',     NULL,          NULL::int),
    ('Back Squat 1RM',      'Best back squat 1RM',                 'test_value',     'squat_1rm',    NULL, NULL, false, 'lb',     NULL,          NULL::int),
    ('Relative Squat',      'Back squat / bodyweight^(2/3)',       'bw_coefficient', 'squat_1rm',    NULL, NULL, false, 'coef',   NULL,          NULL::int),
    ('Attendance (30d)',    'Attendance % over last 30 days',      'attendance_pct', NULL,           NULL, NULL, false, '%',      NULL,          30),
    ('Squat Improvement',   '% improvement in Back Squat 1RM',     'improvement_pct','squat_1rm',    NULL, NULL, false, '%',      NULL,          NULL::int)
  ) AS v(name, description, kind, test_type, numerator_test, denominator_test, lower_is_better, unit, exercise_name, since_days)
  WHERE NOT EXISTS (SELECT 1 FROM public.custom_metrics cm WHERE cm.name = v.name)
  RETURNING id, name
)
INSERT INTO public.leaderboards (name, metric_id, row_limit)
SELECT nm.name, nm.id, 10 FROM new_metrics nm
WHERE NOT EXISTS (SELECT 1 FROM public.leaderboards lb WHERE lb.name = nm.name);
