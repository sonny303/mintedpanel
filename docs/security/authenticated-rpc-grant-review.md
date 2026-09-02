# `authenticated` RPC grant review

**Status:** open. Verified against hosted `fkvuhfsqcmujywzgczmc` 2026-09-02 with
read-only queries. No exploit was executed and nothing was written.
**Severity:** low today, high the moment a Supabase login is issued to anyone
outside the company.
**Owner:** needs a PM decision, then an additive migration.

## Summary

Some `SECURITY DEFINER` functions that write **global** rows are EXECUTE-granted
to the `authenticated` Postgres role and check only that the caller is not
anonymous. They do not check membership, role, or org.

Today that is nearly harmless: the only holders of an `authenticated` token are
6 internal users, all admins, all trusted. It matters because it is a
prerequisite for any feature that hands a Supabase login to someone outside the
company. The client portal spike (S1, option B) is exactly such a feature, which
is how this surfaced. It is **not** a flaw in that spike's design and does not
change its recommendation.

## Why an application-layer guard does not cover this

The client portal would decide what to _render_. It does not decide what a token
can _reach_.

PostgREST is exposed publicly at `https://<ref>.supabase.co/rest/v1/`, because
the main application UI reads through it under RLS. A user who logs in through
Supabase Auth holds a JWT whose Postgres role is `authenticated`. That token
works against PostgREST directly, from devtools or curl, whether or not the
person ever loads the portal UI. A `/api/client/*` guard sits beside that path,
not in front of it.

So "clients only see their own org's data" is a correct design intent that
nothing currently enforces at the database layer for these specific functions.

## What was verified

**Reads are properly walled.** A user with no `memberships` row gets nothing
from the 51 org-wide SELECT policies, because they all resolve through
`user_org_ids()`. Five tables including `provider_ssn_vault` have RLS enabled
with zero policies, so they are deny-all. This is a write and integrity issue,
not a cross-tenant read leak.

**Two functions check only `auth.role() <> 'anon'`:**

| Function                                                                   | Writes                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------- |
| `author_global_sop(...)`                                                   | `sop_templates` rows, global tier                 |
| `upsert_global_portal(p_id, p_name, p_portal_key, p_payer_id, p_form_url)` | `portals` with `org_id = NULL`, read by every org |

Both are `SECURITY DEFINER`, both are EXECUTE-granted to `authenticated`, and
neither consults `memberships`, `user_role()`, or `user_is_admin_anywhere()`.
The `org_id = NULL` insert in `upsert_global_portal` was read directly from the
function body.

**A second path reaches the admin-anywhere gate:**

`create_organization(p_name text)` is `SECURITY DEFINER` and its only guard is
`IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'`. It inserts the
caller as `admin` of the new org. That flips `user_is_admin_anywhere()` to true,
which is the entire predicate on the `payer_forms_retire` UPDATE policy, so the
caller can then retire global payer forms other orgs depend on.

**Scale of the grant surface:** 42 `SECURITY DEFINER` functions are
EXECUTE-granted to `authenticated`; 10 are also granted to `anon` (the public
token routes for capture, share, and SSN intake, which are token-guarded by
design and were not assessed here). The two above are the ones whose only check
is non-anonymity while writing global rows. The rest take an explicit `p_org_id`
and were not individually audited; that audit is part of the work below.

## Impact

Integrity and availability of shared catalog data, not tenant confidentiality:

- global SOP templates, which drive task generation for every org;
- the global portal registry, which the Chrome extension resolves against;
- global payer forms, via the retire path.

Blast radius is cross-org because these rows are deliberately global. A bad or
malicious write is visible to every customer at once.

## Reproduction (do not run against production)

Read-only verification only. The chain was confirmed by reading grants and
function bodies:

```sql
-- grants
select p.proname, p.prosecdef,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by p.proname;

-- guards
select proname, prosrc from pg_proc
where proname in ('author_global_sop','upsert_global_portal',
                  'create_organization','user_is_admin_anywhere');

-- the policy that admin-anywhere unlocks
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname='public'
  and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%admin_anywhere%';
```

## Recommended fix

Additive and non-breaking. Needs PM sign-off before an operator applies it.

1. **Add a real authorization check inside the two global authoring functions.**
   Global authoring is an internal capability, so `user_is_admin_anywhere()` is
   the natural predicate, matching how `payer_forms` already gates. Raise
   instead of silently no-oping.
2. **Decide who may call `create_organization`.** Self-serve org creation by any
   authenticated user is the root of the escalation. Options: restrict EXECUTE
   to a service role and create orgs through a server route, or gate it behind
   an invite or allowlist. This is a product decision about signup, not purely
   a security one.
3. **Audit the remaining 40 `authenticated`-executable `SECURITY DEFINER`
   functions** for the same pattern: does the function trust a caller-supplied
   `p_org_id` without confirming membership in it? `user_role(p_org)` inside the
   function is the correct check.
4. **Before issuing any external token**, prefer a distinct role or JWT claim
   for non-staff identities so the `authenticated` grant surface is not shared
   between staff and customers. This is the durable fix and it is what makes
   S1's option B safe to build on.

Items 1 through 3 are worth doing regardless of whether the client portal ships.
Item 4 is a hard pre-req if it does.

## Related

- [`docs/spikes/S1-client-identity-scope.md`](../spikes/S1-client-identity-scope.md)
  — why a client would hold an `authenticated` token in the first place.
- `AGENTS.md` and the `api-isolation-gate` skill — the `/api` guard, which is a
  separate path and is not affected by this.
