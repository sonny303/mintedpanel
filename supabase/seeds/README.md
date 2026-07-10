# Seed universe (production fixtures)

`seed_universe_v1.sql` injects the Stage 0 seed universe defined in
`docs/redesign/seed-universe.md` into the hosted project
(`fkvuhfsqcmujywzgczmc`) as real rows: 11 fictional organizations, their P5
owner parties + `owner` role assignments, operator memberships, and the
canonical 22-status set per org (287 rows total). Applied to hosted on
2026-07-10 and verified idempotent (second run inserts 0 rows) with Kansas
Fitness Physio / South Park Physician Group counts unchanged.

Files in this directory are **not** picked up by `supabase db reset` (that
uses `supabase/seed.sql`, the local fixture); they are run manually.

## Properties

- INSERT-only, one transaction, `ON CONFLICT ... DO NOTHING` on the correct
  conflict target per table — safe to re-run any time; a re-run inserts 0 rows.
- Every row has a fixed hardcoded UUID with the `5eed` prefix
  (`5eed0001-…` orgs, `5eed0002-…` parties, `5eed0003-…` role assignments,
  `5eed0004-…` memberships, `5eed0005-…` status configs), so seed data is
  greppable and the rollback is exact.
- Persona → login mapping (fictional `.test` logins would need `auth.users`
  rows, which GoTrue owns, so P1/P2 map to existing production logins):
  **sowmya@minted.com** is admin on all 11 orgs (P1), **test@minted.com** is
  specialist on Shelby Sports Rehab (P2 multi-operator). The 11 owner parties
  use `.test` emails and have no logins.

## How to roll back

Run `seed_universe_v1_rollback.sql` against the hosted project (e.g. via the
Supabase MCP `execute_sql` or the SQL editor). It deletes in reverse
dependency order, scoped only to the hardcoded seed UUIDs / seeded org ids —
it cannot touch customer orgs. If app usage later created other data under a
seed org (providers, cases, audit_log rows, …), the final `organizations`
DELETE fails loudly on its FK; remove that data deliberately first — nothing
in the rollback cascades into it silently.
