-- Post-advisor hardening: get_sop_field_tokens should be callable by
-- signed-in users only (the resolve-fill function and the app), never anon,
-- and must pin search_path. The live function drifted to SECURITY DEFINER
-- plpgsql, so revoke + ALTER rather than redefining it here.
REVOKE EXECUTE ON FUNCTION public.get_sop_field_tokens() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sop_field_tokens() TO authenticated;
ALTER FUNCTION public.get_sop_field_tokens() SET search_path = public;
