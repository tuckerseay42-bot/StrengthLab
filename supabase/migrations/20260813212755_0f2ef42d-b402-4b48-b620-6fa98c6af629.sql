ALTER TABLE public.custom_metrics DROP CONSTRAINT IF EXISTS custom_metrics_kind_chk;
ALTER TABLE public.custom_metrics ADD CONSTRAINT custom_metrics_kind_chk CHECK (kind = ANY (ARRAY['test_value','attendance_pct','bw_coefficient','improvement_pct','formula','ratio','lift_max','lift_metric']));
ALTER TABLE public.custom_metrics DROP CONSTRAINT IF EXISTS custom_metrics_measurement_check;
ALTER TABLE public.custom_metrics DROP CONSTRAINT IF EXISTS custom_metrics_measurement_chk;
ALTER TABLE public.custom_metrics ADD CONSTRAINT custom_metrics_measurement_chk CHECK (measurement = ANY (ARRAY['load','time','height','distance','reps','velocity','speed','count']));

DROP POLICY IF EXISTS "rack_set_logs via session" ON public.rack_set_logs;
CREATE POLICY "rack_set_logs via session" ON public.rack_set_logs FOR ALL
USING (EXISTS (SELECT 1 FROM rack_sessions rs WHERE rs.id = rack_set_logs.rack_session_id AND (is_org_member(rs.organization_id) OR is_self_athlete(rack_set_logs.athlete_id))))
WITH CHECK (EXISTS (SELECT 1 FROM rack_sessions rs WHERE rs.id = rack_set_logs.rack_session_id AND (is_org_member(rs.organization_id) OR is_self_athlete(rack_set_logs.athlete_id))));

DROP POLICY IF EXISTS "rack_session_athletes via session" ON public.rack_session_athletes;
CREATE POLICY "rack_session_athletes via session" ON public.rack_session_athletes FOR ALL
USING (EXISTS (SELECT 1 FROM rack_sessions rs WHERE rs.id = rack_session_athletes.rack_session_id AND (is_org_member(rs.organization_id) OR is_self_athlete(rack_session_athletes.athlete_id))))
WITH CHECK (EXISTS (SELECT 1 FROM rack_sessions rs WHERE rs.id = rack_session_athletes.rack_session_id AND (is_org_member(rs.organization_id) OR is_self_athlete(rack_session_athletes.athlete_id))));