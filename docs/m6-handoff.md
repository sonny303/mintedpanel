# M6 Handoff — session resume notes

Date: 2026-07-04 (updated after the M6 code pass). Everything M0–M5.5 is
merged to `main` (PRs #1–#10) and deployed via Vercel. Go-live target:
**ASAP** (per SS).

## Current state

- **Merged**: M0 Lovable exit · M0.5 reformat · M1 shell/tokens/primitives ·
  M2 providers work view + `src/lib/actionState.ts` engine (tested) ·
  M3 payer-grouped cases + `workView.ts` chip consistency · M4 launches
  (DDL + import done in prod via MCP; pipeline page, generate-cases flow,
  Reports contract matrix) · M5 Home queue at `/home` · M5.5 `/progress`
  owner view + `ownerWording.ts` (tested).
- **Prod DB (Supabase `fkvuhfsqcmujywzgczmc`)**: `launches` table + RLS live,
  10 launches imported (12-vs-10 row question still open with SS),
  4 director-providers linked, `providers.launch_id` live.

## M6 code scope — DONE (this branch)

1. Legacy routes deleted after re-verifying reachability:
   - `src/routes/tasks.index.tsx` (Tasks list, A2'd from nav) and
     `src/routes/tasks.tsx` (empty `<Outlet/>` layout — removing it makes
     bare `/tasks` hit the root not-found page instead of a blank shell).
     `/tasks/$id` detail KEPT (linked from TaskDrawer + admin.audit); its
     breadcrumb/back links now root at Cases instead of the deleted list.
   - `src/components/layout/TopBar.tsx` + the unused `topBarContent` prop
     in `AppShell.tsx`.
   - `src/routes/welcome.tsx` KEPT — invite-member edge function redirects
     to `/welcome`.
2. `SHOW_HOME_NAV` / `SHOW_LAUNCHES_NAV` flags removed from Sidebar (nav final).
3. Dead-code sweep (zero importers, verified individually):
   `src/components/landing/*` (14 files — landing page is inlined in
   `routes/index.tsx`), `src/components/shared/TableToolkit.tsx` +
   `QueryErrorRow.tsx`, `src/hooks/useTablePrefs.ts` (all three only served
   the deleted Tasks list), `src/hooks/use-mobile.tsx` (shadcn scaffold),
   `src/lib/config.server.ts` (template scaffold).
4. Unused-dep sweep: every runtime dep verified in use. `@tanstack/router-core`,
   `start-client-core`, `start-server-core` are not imported directly but KEPT —
   they pin singleton versions across the Start beta dep tree.
5. Verified: build ✓ · 34/34 tests ✓ · lint 0 errors (12 pre-existing
   warnings) · tsc ✓ · 20-route Playwright smoke ✓ (unauthed; protected
   routes redirect to /login, `/tasks` now 404s to the app not-found page).
6. NOT in M6 (unchanged): Supabase client consolidation (`externalClient`
   stays), schema changes.

Remaining before merge: authenticated smoke pass on the Vercel preview
(needs SS login), then merge + cancel Lovable (open item 5).

## MCP-side M6 (separate from code run)

Customer 2 data load per `minted-panel-customer-implementation-plan.md` —
**that doc is not in this repo; SS owes it**. Org "South Park Physician
Group" already exists in prod with 8 cases (may be partially loaded).

## Open SS items

1. Launches: confirm 10 rows is correct (spec said 12; screenshot showed 10).
2. Excel hard-switch date + archive the spreadsheet (M4 exit criterion 6).
3. Run the generate-cases flow once on a test provider on preview; then have
   Claude verify created cases/tasks/audit against SQL counts.
4. Customer 2: implementation plan doc + user invites.
5. After M6 merges + smoke pass: cancel the Lovable subscription.
6. Design-file placeholders still swappable when the design lands: type scale,
   shadows, login copy (`src/styles/tokens.css`), badge tone mappings.
