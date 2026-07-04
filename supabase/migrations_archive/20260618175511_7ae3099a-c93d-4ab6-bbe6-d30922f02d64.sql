REVOKE EXECUTE ON FUNCTION public.user_role(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_org_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_role(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.user_org_ids() TO service_role;