---
name: supabase-migrations
description: Schema work on Minted Panel's Supabase database — writing migrations, checking whether one is applied to hosted, regenerating types.ts, or verifying RLS policies. Use whenever adding a column/table/RPC/policy, editing supabase/migrations/, running MCP apply_migration or generate_typescript_types, or debugging a "column does not exist" / write-then-vanish / RLS visibility problem.
---

# Supabase schema work

## The live DB is the source of truth

`supabase/migrations/` opens with a squashed baseline
(`20260704210000_baseline_live_schema.sql`) dumped from live and verified to
rebuild it exactly, plus post-baseline migrations. Never edit the baseline or
anything in `supabase/migrations_archive/`.

## Never decide "is this applied?" by comparing filenames

Repo filenames and `supabase_migrations.schema_migrations.version` are
**different numbering spaces** — MCP `apply_migration` mints its own timestamp,
so `20260809120100_*.sql` can be live under version `20260808024259`. That
comparison reports healthy migrations as missing and has already produced one
false P0.

**Verify the OBJECT instead:**

| Checking   | Query                                  |
| ---------- | -------------------------------------- |
| Column     | `information_schema.columns`           |
| Policy     | `pg_policies.qual` / `.with_check`     |
| Function   | `pg_get_function_arguments` / `prosrc` |
| Constraint | `pg_constraint.consrc` / `conname`     |

For **RLS behavior**, a shape check proves nothing about what a user can see.
Impersonate a real member inside a rolled-back transaction:

```sql
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"<user-uuid>","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
-- probe here
ROLLBACK;
```

Recipes: `docs/ops/3m-uat-readiness-checklist.md`.

## Adding a migration (repo-first)

1. New file `supabase/migrations/YYYYMMDDHHMMSS_<slug>.sql`. Never edit an
   existing one.
2. Apply the **identical** SQL to hosted via MCP `apply_migration` — unless the
   change is operator-gated (see below).
3. Guard anything depending on hosted-only objects or elevated privileges so a
   clean repo-only rebuild still passes: `to_regclass('public.launches')`,
   `ADD COLUMN IF NOT EXISTS`, `CREATE … IF NOT EXISTS`, exception-guarded
   event triggers.
4. Regenerate `src/integrations/supabase/types.ts` via MCP
   `generate_typescript_types`, overwrite, run prettier. **It is generated, not
   hand-edited.**
5. Update `SCHEMA.md` and the table register.

**Do not re-apply the baseline to hosted** — its objects exist. It is for fresh
rebuilds only (local stacks, new projects, CI).

## Before regenerating types.ts

If any repo migration is **not yet applied to hosted**, a regen reflects the
_pre-migration_ schema and will silently **delete** types for columns the repo
just added. Either apply first, or hand-edit narrowly and say so in the PR.
The reverse trap is equally real: a hand-edit that adds an arg for a migration
that was later retired leaves the checked-in type _ahead_ of reality.

Postgres function arguments carry **no nullability**, so the generator types
every RPC arg non-nullable. Where an RPC genuinely accepts NULL, the cast
belongs at the **call site**, where a regen cannot silently revert it.

## Rules that have each cost a real incident

- **Additive only.** Columns and tables are deprecated in place (stop-write,
  frozen mirror), never dropped. Destructive migrations need explicit PM
  sign-off.
- **A restated policy is a COPY, and copies drift.** Policies do not compose
  across tables, so a child table's SELECT policy carrying a private copy of
  its parent's visibility rule goes stale the moment the parent widens.
  `payerGovernance.test.ts` has a final-state sweep for exactly this class.
- **`exists (… where provider_id = org_id)` inside a policy is a TAUTOLOGY** —
  the unqualified name binds to the innermost scope, so Postgres stores
  `p.org_id = p.org_id` and every shape check passes while the policy leaks
  across tenants. Use the scalar form
  `(select p.org_id from providers p where p.id = provider_id) = org_id`.
- **PostgREST resolves an RPC by its named-argument SET.** Adding a defaulted
  arg to an existing signature creates an unresolvable overload — every call
  400s with PGRST202. Always **DROP + CREATE**, never add an arg in place.
- **App code and hosted signature must ship in lockstep.** Shipping code that
  sends a new arg before the migration is applied breaks the feature 100%.
  When in doubt, converge the code on the live signature — the smaller,
  reversible direction.
- **A CHECK constraint cannot contain a subquery.** Express set membership over
  `array_to_string(col, ',')` or use a trigger.
- **`RETURNS <table>` on a SECURITY DEFINER RPC re-applies that table's SELECT
  policy to the returned row** — the insert succeeds and the return vanishes.
  Return `jsonb` when the caller may not be able to read the row back.
- **Probe behavior before you claim it.** Run rollback-wrapped probes on hosted
  (impersonating a real member) rather than reasoning about the SQL. A JS fake
  cannot prove transactionality, and a shape check cannot prove visibility.

## Sandbox note

Cloud sandboxes cannot reach `*.supabase.co` over HTTP, but the **Supabase MCP
tools work** (`execute_sql`, `apply_migration`, `generate_typescript_types`,
`list_migrations`). That is the only DB channel from a sandbox.
