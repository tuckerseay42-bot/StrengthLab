REVOKE EXECUTE ON FUNCTION public.rollup_rep_maxes() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rollup_rep_maxes() TO service_role;