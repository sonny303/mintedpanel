# M6 Handoff — session resume notes

Date: 2026-07-04. Written so any new Claude Code session (or human) can pick up
exactly where the last session stopped. Everything M0–M5.5 is merged to `main`
(PRs #1–#10) and deployed via Vercel. Go-live target: **ASAP** (per SS).

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
- **Branch `claude/m6-cutover`** exists at `main` (d6393a9), no commits yet.

## M6 remaining scope (spec v0.9 essentials)

1. Delete legacy route components unreachable from the final nav. Known
   candidates from prior audit (re-verify before deleting):
   - `src/routes/tasks.index.tsx` — Tasks LIST page, removed from nav (A2).
     NOTE: `/tasks/$id` task detail may still be linked (TaskDrawer,
     admin.audit) — verify separately; only the list page was A2'd.
   - `src/components/layout/TopBar.tsx` — retired from the layout at M1.
   - Check `src/routes/welcome.tsx` reachability (invite-email entry — keep
     if referenced by the invite flow in MembersPanel / edge function).
2. Remove the `SHOW_HOME_NAV` / `SHOW_LAUNCHES_NAV` flags in
   `src/components/layout/Sidebar.tsx` (nav is final).
3. Dead-component + unused-dep sweep (grep for zero importers; respect
   config-only deps: vite/nitro/lightningcss/tailwind/eslint/prettier/vitest,
   `@fontsource/*` used via CSS `@import` in `src/styles.css`).
4. Full route smoke pass on preview; every deletion listed in the PR.
5. NOT in M6: Supabase client consolidation (`externalClient` stays), schema changes.

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
