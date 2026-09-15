GRANT SELECT, INSERT, UPDATE, DELETE ON public.programs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.programs TO authenticated;
GRANT ALL ON public.programs TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_workouts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_workouts TO authenticated;
GRANT ALL ON public.program_workouts TO service_role;

DROP POLICY IF EXISTS "programs authenticated all" ON public.programs;
CREATE POLICY "open programs" ON public.programs
FOR ALL TO public
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "program_workouts authenticated all" ON public.program_workouts;
CREATE POLICY "open program_workouts" ON public.program_workouts
FOR ALL TO public
USING (true)
WITH CHECK (true);