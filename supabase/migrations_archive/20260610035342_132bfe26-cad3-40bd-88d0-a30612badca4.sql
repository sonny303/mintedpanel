
REVOKE ALL ON FUNCTION public.user_org_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.user_org_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_role(uuid) TO authenticated;
