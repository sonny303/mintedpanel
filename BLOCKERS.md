# BLOCKERS — Minted Panel audit v3 (2026-07-04)

Sorted trust and security first (no merge gate exists anymore; everything below is
fix-forward against production). Repro'd on the deployed code (`30cbdd4`) with
live-DB data. "RLS backstop holds" means the database blocked the write — the
finding is the UI/trust surface, not data loss.

---

## B1 · TRUST — Approved with no effective date is classified **Complete**; "in-network" disagrees across surfaces

- **Spec:** awaiting-effective covers "approved with a future effective date; approved with a *null* effective date counts here too, never as complete."
- **Code:** `src/lib/actionState.ts:56-63` requires a non-null future date; the Approved status carries `action_bucket='complete'`, so Approved + null date falls through to Complete.
- **Live hit (today):** Pollard/Medicare — Approved, both effective dates NULL → sits in Complete. Nobody is prompted to chase the effective date; the provider may not actually be billable.
- **Coherence leak (same root):** `/providers` in-network bars count only the literal label "In-Network", while `/progress` counts Approved-with-passed-date as "Billing now". Douek reads **0 of 7 in-network** on /providers and **"Billing 1 of 6 insurers"** on /progress simultaneously (Douek/Medicare, Approved eff 2026-06-01).
- **Repro:** open /providers → Pollard group → Medicare row shows Complete-class treatment (absent from all chips); SQL: `select ... from credential_cases where provider Pollard, payer Medicare` → `confirmed_effective_date IS NULL AND expected_effective_date IS NULL`, status Approved.
- **Fix shape:** rule 3 in `actionState.ts` becomes: Approved + (future date **or no date**) → `awaiting_effective`; update `actionState.test.ts`. Optionally count Approved-with-passed-date into the in-network numerators. See FIX_PROMPTS #1.

## B2 · TRUST — Home (the landing page) shows a false all-clear when queries fail; Home/Progress/Reports-Contracts have no error state

- **Repro (verified with fault injection):**
  - cases query returns 500 → `/home` renders **"Needs your action — clear"** (screenshot `09a`).
  - cases + facilities fail → `/home` renders **"You're caught up."** (screenshot `09`).
  - `/progress` on 500 → renders header with zeros, no error indication (screenshot `10`).
  - Reports default tab (Contract matrix) has no error branch either.
- **Why it matters:** Home is the login landing page and S8's "did I miss anything" answer. A transient Supabase blip silently converts a 10-item workday into "caught up". With no legacy fallback, this is the single most dangerous trust failure in the app.
- **Also:** Providers/Cases/Launches error states are text-only ("Refresh to retry") with no retry control, and `launches.index.tsx:57` omits `casesQ.isError` from its `failed` flag.
- **Fix shape:** `isError` branches on `home.tsx`, `progress.tsx`, `ContractMatrixTab.tsx` with a retry button; include `casesQ.isError` in launches' `failed`. UI-only. See FIX_PROMPTS #2.

## B3 · TRUST/WORKFLOW — State-agnostic SOP templates never match: Medicare and Pre-Cred cases are created with **zero tasks**

- **Code:** `pickTemplate` (duplicated in `NewCaseModal.tsx` and `CreateCasesDialog.tsx`) requires `t.state === state` on both passes. Templates with `state = NULL` — live these are **"Medicare Enrollment" (3 tasks), "Update CAQH", "New Provider Credentialing Onboarding" (3 tasks)** — can never match any case state.
- **Live proof:** harness S6 generated cases for KC Racquet Club: the Cigna case seeded 4 tasks from "Cigna KS via ASH", the **Pre-Credentialing case seeded 0 tasks** (asserted on the actual `create_case_with_tasks` payload). Any new Medicare case does the same.
- **Why it matters:** the SOP checklist is the product's answer to "process lives in Excel/heads". It silently doesn't fire for exactly the payers with the most process. Existing pre-cred/Medicare tasks in the DB predate this (or were added manually) — new cases regress.
- **Fix shape:** template matcher falls back to state-null templates: exact `payer+state(+group)` → `payer+state` → `payer+NULL-state(+group)` → `payer+NULL-state`. Two module-local copies must stay in sync. See FIX_PROMPTS #3.

## B4 · SECURITY — `/launches/$id?createCases=true` opens the Create Cases write dialog for a **billing** (read-only) user

- **Repro (verified as `sowmya@fitness.fit`):** navigate to `/launches/ecaa7198-91f0-41f2-a864-4ed87e3d51f2?createCases=true` → full payer checklist renders with a live **"Create 2 cases"** button (screenshot `11`). Clicking it fires the RPC; the DB rejects with RLS 42501 and the user sees a raw "Case creation failed" toast.
- **Root:** `launches.$id.tsx:287` renders `CreateCasesDialog` gated only on loading state (the header buttons *are* `canWrite`-gated; the deep link bypasses them), and `CreateCasesDialog` has no internal permission check. The nav link to /launches is visible to all roles.
- **Impact:** no data written (RLS backstop, SECURITY INVOKER RPC verified) — but a read-only role is shown a functioning write UI. Defense-in-depth failure + guaranteed confusion/support ticket.
- **Fix shape:** gate the dialog render on `useCanWrite()` and add an internal guard to the dialog. See FIX_PROMPTS #4.

## B5 · SECURITY — `providers.new` / `providers.$id.edit` route guards are no-ops on direct URL load; billing gets the full Add Provider wizard

- **Repro (verified):** as billing, hard-load `/providers/new` → **no redirect**; the entire wizard renders (10 form controls; screenshot `12`). Same code path guards `/providers/$id/edit`.
- **Root:** `beforeLoad` reads `useAuthStore.getState()` **synchronously at route match**, before `loadMemberships()` resolves on a fresh page load → `role = null`; the guard is a deny-list (`role === "billing"`), and `null` passes. Guards work only for in-app navigation after the store is warm.
- **Impact:** submission is blocked by RLS (providers INSERT requires specialist/admin), so no data risk — but the "route-guarded" claim in the M-specs is false in the one case guards exist for (URL entry).
- **Fix shape:** switch to an allow-list rendered guard (redirect when `!canWrite` once memberships resolve) inside the two routes' components, or make `beforeLoad` await the auth store. See FIX_PROMPTS #5.

## B6 · WORKFLOW — `/progress` (Client Progress, M5.5) is orphaned: not in the sidebar, linked from nowhere

- **Repro:** grep `to="/progress"` → only the route file itself; Sidebar `mainNav` = Home/Providers/Cases/Launches/Reports. The page works (content verified, S7) but is reachable only by typing the URL.
- **Impact:** S7 ("show the practice owner where credentialing stands") fails as a workflow; the M5.5 deliverable is invisible to its user.
- **Fix shape:** one nav entry. **Note:** `src/components/layout/Sidebar.tsx` is a protected file per AGENTS.md — the fix prompt calls this out and requires explicit approval. See FIX_PROMPTS #6.

## B7 · SECURITY (DB hygiene) — `rls_auto_enable()` is SECURITY DEFINER and executable by `anon`; leaked-password protection disabled

- **Source:** Supabase security advisors (2026-07-04). `public.rls_auto_enable()` can be executed unauthenticated via `/rest/v1/rpc/rls_auto_enable`. Likely idempotent, but an anon-callable definer function that flips RLS settings is not acceptable hygiene. Auth "leaked password protection" (HaveIBeenPwned check) is off.
- **Fix shape:** `REVOKE EXECUTE ... FROM anon, authenticated;` + enable the auth setting. **Schema/infra change → MCP review, do not execute from a UI session.** See FIX_PROMPTS #7 (reference only).

## B8 · CODE — dead schema + dead service: `user_table_prefs` / `src/services/tablePrefs.ts`

- M6 deleted the Tasks list, the table's only consumer. Zero imports of `tablePrefs.ts` remain; the table holds 2 stale rows. Delete the service file now (code-only); the table stays per the additive rule (or is dropped later via sanctioned migration). See FIX_PROMPTS #8.

---

### Fast-follow (not blockers)
- **F1** Layering violations: `routes/admin.templates.$id.tsx`, `routes/welcome.tsx`, `components/settings/MembersPanel.tsx`, `components/cases/NewCaseModal.tsx` call Supabase directly — wrap in services/hooks.
- **F2** AGENTS.md staleness: `externalClient.ts` is env-based now, not hardcoded; update the Supabase-client rule text.
- **F3** Data hygiene: Beeson's cases sit on West Central while his assignments (pivot migration) are KC Racquet + Olathe — reconcile before demoing KC Racquet readiness; consider flipping Douek/Medicare and Pollard/Medicare from Approved to In-Network (with dates) so the in-network bars mean something.
- **F4** Anon/env naming: unify `VITE_SUPABASE_ANON_KEY` vs `SUPABASE_PUBLISHABLE_KEY` vs `SUPABASE_ANON_KEY` references.
- **F5** No stalled-only cut: stalled is folded into "In progress" (suffix + sort). Fine today (0 live stalled); revisit when the class is populated.
