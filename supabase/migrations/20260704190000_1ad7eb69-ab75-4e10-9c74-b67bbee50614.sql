-- Security hardening (audit v3, blocker B7): rls_auto_enable() is a
-- SECURITY DEFINER event-trigger function (event trigger `ensure_rls`) that was
-- also exposed to the anon role via a blanket PUBLIC EXECUTE grant, making it
-- callable unauthenticated at /rest/v1/rpc/rls_auto_enable. The event trigger
-- fires as the function owner and does not rely on these role grants, so
-- revoking RPC access has no functional impact on DDL or the app.
--
-- Guarded with to_regprocedure so a repo-only rebuild that has not yet created
-- the hosted-only function still applies cleanly.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public;
    revoke execute on function public.rls_auto_enable() from anon;
    revoke execute on function public.rls_auto_enable() from authenticated;
  end if;
end $$;
