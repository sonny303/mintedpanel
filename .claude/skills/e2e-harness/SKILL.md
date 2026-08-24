---
name: e2e-harness
description: Write or debug Playwright e2e specs for Minted Panel, including the Supabase HTTP mock harness used in cloud sandboxes. Use whenever creating or editing a file under e2e/, running `npx playwright test`, debugging a spec that hangs or fails to log in, or when a sandbox session needs browser verification against a mocked backend.
---

# E2E harness — Minted Panel

Cloud sandboxes **cannot reach `*.supabase.co`** (403 at the gateway proxy). The
app cannot talk to the real backend from there, so every browser verification
runs against `npm run dev` with the Supabase HTTP layer mocked.

## Bootstrap first

```sh
node scripts/bootstrap-session.mjs
```

Idempotent. Writes the dummy `.env` Playwright needs — **without it
`npx playwright test` silently burns the full 120s webServer timeout before
failing.** The host must be exactly `example.supabase.co`:

```
VITE_SUPABASE_URL=https://example.supabase.co
VITE_SUPABASE_ANON_KEY=dummy-anon-key
```

`externalClient.ts` sets no `storageKey`, so supabase-js derives the GoTrue
localStorage key from the URL ref as `sb-<ref>-auth-token`. Change the host and
every session-seeding spec breaks.

The repo's Playwright pin is newer than the sandbox browsers — launch with
`executablePath: "/opt/pw-browsers/chromium"`.

## Mock recipe

Intercept with `context.route("https://<ref>.supabase.co/**", handler)` and
emulate:

- **`/auth/v1/token`** — return a session for a fixture user.
- **`/rest/v1/<table>`** — parse `eq. / neq. / in. / is. / overlaps / order /
limit` query params over fixture rows. Honor filters properly; generic
  handlers that ignore them cause the failures below.
- **`maybeSingle` / `single`** — Accept `vnd.pgrst.object` → single object, or
  406 `PGRST116` on a miss.
- **`Prefer: return=representation`** and `resolution=ignore-duplicates`.
- **RPCs** — synthesize returns (`claim_invites` → 0,
  `create_case_with_tasks` → the case row + tasks, `set_case_status`, …).

Skip the login flow: seed `localStorage` in `addInitScript` with the GoTrue
session under `sb-<ref>-auth-token` plus zustand's `minted-panel-active-org`.
Synthesize `profiles` + `memberships` rows for the fixture user (memberships
embeds `organizations(name, lifecycle_state, created_at)`). Fixture tables must
also include empty `notes` and `user_table_prefs` or those queries 404.

Assert on **recorded request payloads** as well as the UI — that is what proves
a write really carried the fields you claim.

## Traps that have each cost a debugging session

- **`maybeSingle` fetches arrays.** This repo's supabase-js issues
  `Accept: */*` and errors client-side on >1 row, so fixture handlers **must**
  honor `eq.` filters. A handler returning all rows turns a passing feature
  into a client-side error. Synthesize PostgREST embeds on the **array path
  too**, not just the object path.
- **Empty PATCH.** Real PostgREST matches ZERO rows on `.update({})`, so
  `.select().single()` 406s. A mock that accepts empty PATCHes masks real
  breakage — mirror the zero-row behavior.
- **Unhandled RPC returning `0`.** If app code does `for (… of result)` during
  render, a non-array takes the whole page down through the router error
  boundary. Return the right shape or an empty array.
- **Navigation races.** After a row-link navigation, wait for the destination
  heading to **commit** before clicking a toolbar control or calling
  `goBack()` — a popstate during a pending TanStack transition never unmounts
  the source route, so you hit the still-mounted source toolbar.
- **Write-through handlers.** For flows that invalidate and refetch (exclusions,
  imports, status changes), the handler must write through into the fixtures or
  the refetch shows stale data and the assertion is meaningless.

## Route → spec map

`docs/VERIFY.md` carries the verification tier table, measured costs, and the
route→spec map for focused runs. Read it before running the whole suite.
