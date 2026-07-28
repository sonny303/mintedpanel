-- FIX for 20260728120000: the "provider must belong to the same org" clause on
-- provider_field_verifications was a TAUTOLOGY, so a writer could stamp another
-- tenant's provider under their own org_id.
--
-- The original read:
--   exists (select 1 from providers p
--            where p.id = provider_id and p.org_id = org_id)
--
-- which looks correct and is not. Inside the subquery the unqualified `org_id`
-- binds to the INNERMOST scope — providers.org_id — so Postgres rewrote the
-- clause as `p.org_id = p.org_id`, always true. (You can see it in the stored
-- expression: pg_get_expr shows `(p.org_id = p.org_id)`.) `provider_id`
-- survived only by luck: `providers` has no column of that name to capture it,
-- so it bound to the new row as intended.
--
-- Caught by a rollback-wrapped probe against live: a real admin in org A
-- successfully stamped a provider from org B. The shape checks (RLS on, three
-- policies, no DELETE grant) all passed — only exercising the behaviour found
-- it.
--
-- The scalar-subquery form cannot be captured: `p.org_id` is explicit inside
-- the subquery, and the `= org_id` comparison happens in the OUTER scope where
-- it unambiguously means the new row's column. Verified after applying:
-- cross-org insert rejected, own-org insert and re-stamp update both pass.

drop policy if exists provider_field_verifications_insert on public.provider_field_verifications;
create policy provider_field_verifications_insert
  on public.provider_field_verifications for insert
  with check (
    org_id in (select public.user_org_ids())
    and public.user_role(org_id) in ('admin', 'specialist')
    and (select p.org_id from public.providers p where p.id = provider_id) = org_id
  );

drop policy if exists provider_field_verifications_update on public.provider_field_verifications;
create policy provider_field_verifications_update
  on public.provider_field_verifications for update
  using (
    org_id in (select public.user_org_ids())
    and public.user_role(org_id) in ('admin', 'specialist')
  )
  with check (
    org_id in (select public.user_org_ids())
    and public.user_role(org_id) in ('admin', 'specialist')
    and (select p.org_id from public.providers p where p.id = provider_id) = org_id
  );
