---
name: api-isolation-gate
description: Add or verify org-isolation gate coverage for Minted Panel /api routes. Use whenever adding, editing, or reviewing a route under src/server/, touching guard.ts or a service that takes a server ctx, or running scripts/verify-org-isolation.mjs or verify-isolation-local.mjs. Required before merging any new /api resource route.
---

# /api org-isolation gate

**The gate is the wall.** `/api` routes use the service-role Supabase client,
which **bypasses RLS entirely** — `src/server/guard.ts` is the only tenant
isolation on those paths. A missed org filter is a cross-tenant data leak that
no database policy will catch.

**A red gate run is stop-ship until a human reads it.**

## The rule

Every new `/api` resource route adds assertions to
`scripts/verify-org-isolation.mjs` **before merge**, plus pass/leak coverage in
`scripts/mock-api-server.mjs`. No exceptions.

## Running it

In-sandbox (mock-and-run — no network, no real backend):

```sh
node scripts/verify-isolation-local.mjs
```

It boots a fixture mock of the API contract and runs the real gate against it:
once expecting green, then once per leak mode expecting red. **Both halves
matter** — a gate that stays green under a deliberate leak is not testing
anything.

The real gate runs on GitHub runners against the production deploy:
automatically on every successful production deployment
(`deployment_status` trigger) and via manual dispatch.

## Writing a new assertion

1. **Positive** — the owning org can read/write its own resource. This proves
   the negative assertion isn't vacuous. Skipping it is how a gate quietly
   stops testing anything.
2. **Negative** — a cross-org id returns **404 before any side effect**. Not
   403, and not after the write: the ownership miss must short-circuit ahead of
   any signing, insert, decrypt, or external call.
3. **Leak mode** — add a matching mode to `scripts/mock-api-server.mjs` that
   simulates the specific mistake (a dropped org filter, an unfiltered embed,
   a body-supplied org id) and register the expected failure in
   `scripts/verify-isolation-local.mjs`'s `EXPECTED_FAILS`.

Verify locally that the suite is **green in pass mode and red under every leak
mode** before you push.

## Gate fixtures

Expected per-org provider counts live in the workflow env block
(`EXPECTED_KANSAS_PROVIDERS` / `EXPECTED_SOUTHPARK_PROVIDERS`). **Adding or
removing a demo/UAT provider means updating those in the same PR** — otherwise
the count assertions go red as fixture drift, which reads exactly like a leak
and wastes a stop-ship investigation. The leak checks themselves are the
`*b`/`*c` variants.

Other fixtures are demo-org data referenced by env var (case ids, task ids,
facility ids, document ids). A gate assertion whose fixture env is unset is
**skipped** on prod — the in-sandbox mock run always sets them, so verify there.

## Guard invariants worth re-reading before you edit

- `authenticate()` resolves membership and returns a ctx already scoped to one
  org. There is **no path to a handler without a resolved ctx**.
- A multi-org caller omitting `x-org-id` is a loud **400** — never a silently
  guessed first membership.
- `authenticateUser()` is the JWT-only step (no org). Only `/api/me/*` and the
  shared-tier training routes run on it, because they must work _before_ the
  caller knows what org header to send, or carry no org at all.
- Writes set `org_id` **from the authenticated membership, never the body** —
  the body's org id is stripped.
- **Never call a SECURITY INVOKER RPC on `ctx.db`.** Under the service key,
  RLS, `auth.uid()` and `user_role()` all break at once. Bind the caller's JWT
  instead. There is a warning comment in `guard.ts`; heed it.
- List payloads use explicit narrowed column sets (e.g.
  `PROVIDER_LIST_COLUMNS`) — **never `select('*')`** in a list response.
