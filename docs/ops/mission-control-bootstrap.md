# Mission Control bootstrap runbook

How an operator turns on Mission Control's platform-admin layer in a Supabase
environment: verify the migration's objects, insert the first platform admin,
and prove the RLS behavior with rollback-wrapped probes. Schema reference:
[SCHEMA.md › Mission Control](../../SCHEMA.md#mission-control-platform-administration).

There is no self-bootstrap path in the product. Once one platform admin exists,
every further grant or revoke goes through `grant_platform_admin` /
`revoke_platform_admin`, which write `admin_audit_log` rows. The insert below is
the one deliberate exception, and it is an operator action.

## Status

| Environment                       | Migration `20261030180000`                   | Bootstrap               |
| --------------------------------- | -------------------------------------------- | ----------------------- |
| Staging `vmznysvietfaddakkegt`    | applied 2026-10-30, ledger `20261030204806`  | pending operator run    |
| Production `fkvuhfsqcmujywzgczmc` | not applied; ships with a production release | after the release apply |

Build sessions apply to staging only. Production is applied through the
release process, then bootstrapped by an operator.

## 1. Verify the objects (not the filename)

Ledger versions are minted by the apply tool and never match the repo
filename. Check the objects:

```sql
-- Four functions, all SECURITY DEFINER with search_path pinned.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef, p.proconfig, md5(p.prosrc) AS body_md5
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('is_platform_admin', 'grant_platform_admin',
                    'revoke_platform_admin', 'platform_metrics')
ORDER BY p.proname;

-- Six policies, all PERMISSIVE SELECT TO authenticated.
SELECT tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND policyname LIKE 'mc\_%'
ORDER BY tablename;

-- Both tables and their columns.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('platform_admins', 'admin_audit_log')
ORDER BY table_name, ordinal_position;
```

Expected: 4 functions (`prosecdef = true`, `proconfig = {search_path=public}`),
6 policies (`mc_platform_admins_select_self`,
`mc_admin_audit_log_select_platform_admin`, and
`mc_{organizations,memberships,profiles,pending_invites}_select_platform_admin`),
8 columns on `platform_admins`, 11 on `admin_audit_log`. The staging apply's
body hashes are `grant_platform_admin 97ac7780…`, `is_platform_admin cef322a2…`,
`platform_metrics 5357c812…`, `revoke_platform_admin 30a315c5…`.

## 2. Insert the first platform admin

The person must already have a Supabase Auth account (they have signed in, or
were invited). Run as the database owner (SQL editor or `psql`), never from the
app.

With `psql`:

```sql
\set email 'person@example.com'
INSERT INTO public.platform_admins (user_id, granted_by, note)
SELECT id, id, 'bootstrap'
FROM auth.users
WHERE lower(email) = lower(:'email')
ON CONFLICT (user_id) DO UPDATE
  SET revoked_at = NULL, revoked_by = NULL, updated_at = now();
```

In the Supabase SQL editor, replace `:'email'` with a quoted literal. The
statement reports `INSERT 0 1` for one row; `INSERT 0 0` means no Auth user has
that email, so stop and check the address. Re-running it is safe: it
re-activates a revoked row and changes nothing else.

The bootstrap row is the one grant with no ledger row. Record it in the release
or PR notes (who, which environment, when).

Confirm:

```sql
SELECT pa.user_id, pa.granted_at, pa.revoked_at, pa.note
FROM public.platform_admins pa
JOIN auth.users u ON u.id = pa.user_id
WHERE lower(u.email) = lower(:'email');
```

## 3. Probe the behavior (rollback-wrapped)

A shape check proves nothing about what a user can see. Impersonate real
users inside a transaction that always rolls back. Substitute the user id; use
one non-admin and the bootstrapped admin.

```sql
BEGIN;
SELECT set_config('request.jwt.claims',
  '{"sub":"<user-uuid>","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT public.is_platform_admin();                   -- non-admin false, admin true
SELECT count(*) FROM public.platform_admins;          -- non-admin 0, admin 1 (own row)
SELECT count(*) FROM public.admin_audit_log;          -- non-admin 0
SELECT count(*) FROM public.organizations;            -- non-admin: their memberships only; admin: all
SELECT public.platform_metrics();                     -- non-admin: ERROR 42501 platform_admin_required
ROLLBACK;
```

`platform_metrics()` raising aborts the transaction, so run it last or on its
own. For the admin, also confirm tenant tables are not widened: with an
organization the admin is not a member of, `SELECT count(*) FROM
public.providers WHERE org_id = '<that-org>'` returns 0.

The full regression packet (synthetic fixtures, every assertion, three leak
modes) runs in a disposable container:

```bash
node scripts/security/verify-mission-control.mjs
```

## 4. Day-to-day changes

Grant and revoke from the app (Mission Control M4) or by calling the RPCs as a
signed-in platform admin. Both write `admin_audit_log`; revoking the last
active admin is refused (`23514 last_platform_admin`).

An operator who must revoke outside the app (for example, a departed admin who
is the only one left) should add the replacement admin first through step 2,
then revoke as that admin through the RPC, so the ledger records it.

## 5. The staging membership trigger stays

Staging carries `trg_grant_sowmya_staging_access` (AFTER INSERT on
`public.organizations`), which adds one fixed staging identity as `admin` of
every new organization. It was applied directly to staging and has no repo
migration file. Mission Control M1 leaves it in place (additive rule). It is
slated for retirement once Mission Control can grant memberships (Milestone 3,
"grant myself admin membership"), and retiring it needs PM sign-off.
