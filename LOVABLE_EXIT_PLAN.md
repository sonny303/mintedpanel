# Lovable Exit Plan — what to rewrite, in priority order

Goal: hand the codebase to a permanent eng team (or your own Cursor workflow) with nothing load-bearing still tied to Lovable, and with the correctness debt paid down while the Lovable iteration loop is still cheap.

**Bottom line: this is a keep-and-fix codebase, not a rewrite.** Routes (TanStack file-based, idiomatic), state (Zustand + TanStack Query with centralized keys), the services layer, and the RLS-first data model are all what a permanent team would build anyway. The debt is concentrated in one workflow (case creation), one data-model seam (licenses), and the Lovable scaffolding around the edges.

## Phase 1 — Correctness first, inside Lovable (week 1)

Do these while you still have the fast loop. All prompts are in `BLOCKERS.md`.

1. **SOP spawn pipeline** (Blocker 1) — delete the divergent inline resolver in `NewCaseModal`, use `lib/sopResolver.ts`, add dataFields support. *1 day. Highest value per hour in the codebase.*
2. **Provider create/edit data loss** (Blockers 2–4) — save licenses+facilities on create; diff-based license update + DELETE policies + unique index; LicensesCard reads `state_licenses`. *1–2 days.*
3. **Atomic case creation via Postgres RPC** (Blocker 6) — one transaction for case + status_history + audit + tasks; un-freezable modal. *1 day.*
4. **Bootstrap/error shell** (Blockers 7, 9) — init() failure path + offline error card + login redirect target. *0.5 day.*
5. **DB hygiene batch** (Blockers 5, 8) — `user_table_prefs` migration, grants hardening, hot-path FK indexes (`tasks.case_id`, `tasks.org_id`, `credential_cases.org_id`, `touches.case_id`, `audit_log.org_id + ts desc`). *0.5 day.*

Exit test for Phase 1: create provider → create case → tasks have steps and due dates → complete tasks → refresh → everything persisted; kill network → visible error, not a freeze.

## Phase 2 — Cut the Lovable umbilicals (week 2, ~1–2 days of it)

Ranked easiest-to-hardest; none are risky.

1. **Assets**: move the 3 landing images into `/public/images`, delete `src/assets/*.asset.json`, fix og:image (Blocker 10).
2. **Supabase client**: make `externalClient.ts` read `import.meta.env.VITE_SUPABASE_URL/KEY`, update `.env` to the real project (it currently holds the abandoned project's keys), delete `src/integrations/supabase/client.ts` + `client.server.ts` dead code, and rotate nothing (publishable keys only).
3. **Build config**: replace `@lovable.dev/vite-tanstack-config` with a plain Vite config (tanstackStart + react + tailwind + tsconfig paths — the wrapper's README comment already lists what it injects); drop `lovable-error-reporting.ts` from the root error boundary (put Sentry or nothing there); delete `.lovable/`.
4. **Package registry**: remove the Lovable npm mirror expectations (bun.lock resolves to `europe-west1-npm.pkg.dev` — regenerate the lockfile against registry.npmjs.org; installs currently 403 outside Lovable).
5. **Deployment decision**: the build outputs a Cloudflare worker (nitro) but `vercel.json` is in the repo — pick one target, delete the other, wire env vars there.
6. **Docs debt**: fix SCHEMA.md drift (column names, grants claim, email-to-touch is live) so the next engineer can trust it.

## Phase 3 — Product gaps for customer #2 (week 2–3)

Not Lovable-exit items, but they gate a second org:

1. **Bulk provider import** (CSV upload → providers + licenses + assignments, reusing the RPC pattern). The Roster tab already proves out CSV handling in the other direction.
2. **User invites** (Members panel is read-only; memberships have no INSERT path in-app). Simplest: admin enters email → Supabase invite → membership row on accept.
3. **Stalled-metric fix + staleTime pass** (S1, S2) so the case list KPIs are trustworthy and the app stops hammering PostgREST.
4. Keep the **email-to-touch** function (it's live, v3, secret-gated, and well-shaped) — just fix spawned-task `sort_order` (S3) and set `EMAIL_WEBHOOK_SECRET` per environment.

## Layer-by-layer verdict (Part 5 answers)

| Layer | State | Rewrite? |
|---|---|---|
| Routes | Idiomatic TanStack Router; guard works (client-side + RLS); nested routes correct (`parents render <Outlet/>`) | No. Fix login race only |
| Services + hooks | Clean separation, centralized query keys, 43 audit-write sites; gaps: 2 files call Supabase outside services, no staleTime/retry defaults, one missing table | No. ~3 days of fixes |
| Components | Consistent shadcn + shared primitives (StatusPill/EmptyState/skeletons); NewCaseModal is the one hotspot; form a11y pass needed | No. Rebuild 1 component |
| Database | RLS org-scoping solid and verified; grants too broad; no DELETE policies; 2 missing migrations (prefs table, indexes); append-only tables correctly locked | No. 1–2 days of migrations |

**Top blocker classification: 1-day fix in Cursor** (the SOP resolver alignment), not a 2-week rewrite. The 2–3 week horizon is the whole batch above, not any single item.
