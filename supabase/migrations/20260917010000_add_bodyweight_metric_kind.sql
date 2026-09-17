-- "Bodyweight" is a first-class custom-metric kind that reads athletes.bodyweight
-- directly — no test/exercise link to configure or misconfigure.
ALTER TABLE public.custom_metrics DROP CONSTRAINT IF EXISTS custom_metrics_kind_chk;
ALTER TABLE public.custom_metrics ADD CONSTRAINT custom_metrics_kind_chk
  CHECK (kind = ANY (ARRAY['test_value','attendance_pct','bw_coefficient','improvement_pct','formula','ratio','lift_max','lift_metric','bodyweight']));
