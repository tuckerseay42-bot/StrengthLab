
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tests; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lifts; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lift_sets; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.test_types; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
ALTER TABLE public.tests REPLICA IDENTITY FULL;
ALTER TABLE public.lifts REPLICA IDENTITY FULL;
ALTER TABLE public.lift_sets REPLICA IDENTITY FULL;
