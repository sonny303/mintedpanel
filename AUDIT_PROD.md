# Minted Panel — Production Audit & MVP Readiness (2026-07-02)

Auditor lens: credentialing manager of a medium multi-state practice, plus code review for the PM / eng lead making the go/no-go call. Tested against the **dev Supabase project `fkvuhfsqcmujywzgczmc`** with the **real KFP org data** (Kansas Fitness Physio: 6 providers, 41 cases, 164 tasks, 9 SOP templates).

## How this was tested (read before quoting numbers)

- **Database-side verification ran directly against the live dev project** (RLS policies, grants, advisors, data forensics, edge functions, API logs). All data-integrity findings below are confirmed in the real database.
- **Test login created and verified in the dev project**: `test@minted.com` / `Test@123!` (admin on the KFP org). Use it for your own re-verification.
- **App-side E2E ran in a sandboxed cloud container whose egress policy blocks `fkvuhfsqcmujywzgczmc.supabase.co:443`** (the proxy denies CONNECT; reported here rather than worked around). To still exercise the real UI, the app was driven with Playwright against the local dev server with Supabase emulated locally — **seeded with a full snapshot of the real KFP data** and PostgREST/GoTrue semantics including the project's actual RLS behavior (e.g. no DELETE policies ⇒ deletes silently no-op). A flat **120 ms round-trip latency** was applied to every Supabase request, which matches or slightly undercuts real-world Supabase latency from the US to us-east-2.
- Timings below are therefore "well-provisioned user" numbers; request counts are exact. On the real backend, each step's time ≈ `UI time + (request count on critical path × real RTT)`.
- The last 100 requests in the project's live API logs (a real user session from today, 19:38–19:59 UTC) were all HTTP 200 — no server-side failures; the traffic pattern (notes fetched 14×, cases 12×, contracts 11× in 21 min for one user) confirms the chatty-client findings below.

Screenshots referenced below live in `audit/screenshots/`.

---

## Part 1 — Core workflow, timed

RTT = 120 ms emulated. "reqs" = Supabase round trips made during the step.

| Step | Time | Supabase reqs | Verdict |
|---|---|---|---|
| Open /login (warm) | 1.2 s | 0 | OK |
| Login submit → app settled | 0.24 s | 1 (+2 deferred) | **Bug: lands on marketing page, not /cases** (race between `navigate({to:'/'})` and the auth store's session update; the `/` `beforeLoad` redirect sees a null session) |
| /providers list load | 1.9 s | 10–13 | OK speed; heavy request count for one table view |
| Open Add Provider form | 0.3 s | 0 | OK |
| Fill 5-step form + submit | 2.7 s total, save itself 0.32 s | 2 (insert + audit) | Save is fast — **but licenses & facility selections are silently discarded** (see Blocker 2) |
| New provider visible in list | immediately on nav (cache invalidated) | 10 | OK — no manual refresh needed |
| Provider detail load | 1.8–1.9 s | 14–15 | Works; 15 round trips for one page is the waterfall problem |
| New Case modal open | 0.2 s | 2 | OK |
| Create 1 case (payer+state) → case page | 1.8–2.2 s | 11 | Case created, 5 tasks spawned — **all 5 tasks have 0 SOP steps and no due dates** (see Blocker 1) |
| Task drawer open (first) | 0.88 s | 5 | OK-ish; subsequent opens 0.09–0.13 s (2 reqs) — good caching |
| Mark task complete | 0.9–1.1 s | 7 each | Works, optimistic-feeling with toast + undo. 7 round trips per checkbox is the pattern to fix later |
| Refresh page → state persisted | 2.4 s | 9 | **Persistence confirmed**: "3 of 5 completed" after reload; 3/3 completions in DB |

Other Part 1 checks:
- No UI freezes or janky scrolling at desktop 1440×900. No unhandled page errors during the happy path.
- No manual refresh needed anywhere in the core workflow — TanStack Query invalidation works (recent "stale tasks" fixes appear effective).
- **Console errors: yes, recurring.** Three Lovable-only asset URLs 404 on every landing-page render (`/__l5e/assets-v1/...` for `mpc-logo.png`, `provider-hero.png`, `relay.png`). These images only resolve on Lovable hosting.
- **Failed API calls: none** in the happy path against the emulator; live API logs from today's real session show 100/100 HTTP 200.
- Duplicate-case gate works and is visible in the modal (row shows "Duplicate case exists", button becomes "Create 0 cases").

### The two workflow-killing results (with evidence)

**1. Auto-spawned tasks are empty.** The newest real case in the dev DB (Walter Beeson / Aetna / KS, created 2026-07-01) has 4 auto-generated tasks, **all with `sop_content: []` and `due_date: null`**, while every case created 2026-06-30 or earlier has fully populated steps. Reproduced live in this audit: creating Walter Beeson / UnitedHealthcare / KS spawned 5 tasks, all empty (screenshot `13-task-drawer.png` — drawer says "No SOP steps defined for this task", every due date "TBD").
Root cause (`src/components/cases/NewCaseModal.tsx:101-141`): the modal's inline resolver reads `def.sopStepTemplates[].step`, `def.dayOffset`, `s.dataFieldTokens`, but the templates stored in `sop_templates.task_definitions` (and produced by the admin template editor) use `steps[].label/detail/data_fields` and `due_offset_days`. Nothing matches ⇒ empty steps, null due dates. The canonical resolver `src/lib/sopResolver.ts` (a "protected file" per AGENTS.md) matches the stored shape and is **dead code — imported nowhere**.

**2. Add Provider silently loses data.** The 5-step form collects licenses (step 3) and facility assignments (step 4), but `toInput()` in `src/routes/providers.new.tsx:27-58` drops both; only the provider row is inserted (verified: 2 requests — provider insert + audit — and 0 `state_licenses` / `provider_facility_assignments` rows). Consequence captured in `09a-new-case-no-license.png`: the brand-new provider's New Case modal shows "**No active licenses**" and "**Create 0 cases**" — the provider you just added cannot enter the core workflow.

---

## Part 2 — Behavioral consistency across surfaces

| Surface | Result |
|---|---|
| **Admin / Payers** | Save shows toast ("Payer updated"), list updates. **Empty-name save is silently blocked**: dialog stays open, no inline error, no toast — user can't tell why Save "did nothing". Validation exists but is mute. |
| **Admin / Settings (Group & Locations)** | Org, groups, facilities panels render; saves toast; errors toast (13 toast/onError sites across settings panels). Members panel is **view-only** — there is no invite/add-member flow anywhere in the product. |
| **Admin / Templates** | List + editor render fine. Editor offers 100+ data-field tokens (from `get_sop_field_tokens` RPC, incl. `facility.street` etc.) — but the case-creation resolver only maps ~12 tokens, so many tokens the editor happily inserts resolve to blank at spawn time (same pipeline as Blocker 1). |
| **Admin / Statuses, MSO Routing** | Render and edit fine. |
| **Admin / Audit Log** | Loads 50 rows fast, real entries ("who did what when"), append-only verified at policy level (no UPDATE/DELETE policies on `audit_log`, `touches`, `status_history`). |
| **Cases list** | Filters work (payer filter 41→5; compound with Stalled → 1). Sort works both directions. Column picker + persisted prefs UI present — **but prefs silently never persist against the real DB** because `user_table_prefs` doesn't exist (see Blocker 5). Summary strip counts by fuzzy label matching (`label.includes('progress')…`) — fragile against custom status labels. **"Stalled" counts never-touched cases as stalled**, so a case created 5 minutes ago already shows as Stalled — misleading KPI. |
| **Case detail** | Consistent and complete: provider header, credentialing pill, group-contract pill (verified accurate against `contracts` — Medicare KS shows "In-Network" which matches the DB), tasks panel with sequential lock, touch log, notes, status history with author names. This is the strongest page in the app. |
| **Provider detail** | Cases table renders, row click navigates to the case. **Licenses card contradicts the rest of the app**: Walter Beeson shows "No licenses on file" while he has 2 `state_licenses` rows and the New Case modal happily uses them. The card reads legacy `providers.license_*` columns (`providers.$id.index.tsx:553-587`), not `state_licenses`. Three inconsistent license pathways in total (see Blocker 4). |
| **Reports** | All 4 tabs (Summary, Contracts, Enrollment Matrix, Roster) render with data, no blank screens, URL-driven tab state. Charts render. |
| **Tasks queue** | Renders with filters/sort consistent with cases list. |

**Overall consistency:** the read surfaces feel like one product (same pills, tables, empty states, skeletons — `EmptyState`, `TableSkeletonRows`, `StatusPill` reused everywhere). The inconsistency is in the *data layer behind* the surfaces: licenses have three sources of truth, and the SOP pipeline has two resolvers that disagree.

### Empty / error / mobile probes

- **Empty org data**: Cases page shows "No cases yet" (verified with an emptied seed); filtered-empty shows "No cases match these filters" + Clear. Tasks/Reports render empty without errors. Good.
- **Supabase unreachable at login**: form shows "**Invalid email or password**" for a network failure — wrong and misleading (screenshot `p2-offline-login` state captured in run log).
- **Supabase dies mid-session**: navigating to /providers renders a **bare white page with "Loading..." forever** (`p2-offline-mid-session.png`). No error, no retry, a hard freeze — the root auth gate never resolves. This is exactly the failure mode the checklist worried about.
- **Mobile 375 px**: no horizontal scroll (good), dialogs fit, but the **sidebar does not collapse** — it permanently consumes ~220 px of a 375 px screen (`p2-mobile-cases.png`), leaving a ~155 px content column. Desktop-only is the honest label.
- **Auth guard**: unauthenticated hits to `/cases`, `/providers`, `/admin/payers`, `/reports` all redirect to `/login` (no blank screens). RLS is the real enforcement underneath — correct model.

---

## Part 3 — Production code quality

**Must-fix checklist results**

- `npm run build`: **passes clean** (13.6 s, zero errors, nitro/Cloudflare output).
- Console errors in normal use: **yes** — the three Lovable asset 404s (above).
- Unhandled promise rejections: **yes, one that matters.** In `NewCaseModal.handleSave`, only `createCase.mutateAsync` is inside try/catch; `createTasksForCase(...)` and the `qc.fetchQuery` for routing rules are not — if task insert fails after the case insert, the rejection is unhandled and `submitting` never resets: **modal freezes on "Creating…" and a case exists with no tasks** (non-atomic, client-orchestrated writes; also no transactionality across case + status_history + audit + tasks).
- Hardcoded IDs/test data: no hardcoded org/entity IDs in app code. `externalClient.ts` hardcodes the Supabase URL + publishable key (documented as intentional until deploy-time env wiring; `.env` + `client.ts` point at a different, abandoned project — see exit plan). Test residue in the real DB: provider "Walter Beeson" with license "0000TEST" (×2 — the duplication bug), payer "Pre-Credentialing Setup" doubles as a workflow hack.
- Auth guard: **works** (redirects verified). Client-side only, but RLS backs it.
- Data scoping: **all services filter by `org_id`** via `requireActiveOrg()` (verified across all 15 service files; 2 lookup queries rely on RLS alone for scoping, which holds).
- Sensitive data: `ssn_last4` only (schema + UI enforce); no full SSNs, no service-role keys in the client bundle; publishable keys only. OK.
- **RLS/grants**: every public table has RLS with org-scoped quals (good) — **but every table GRANTs ALL, including DELETE and TRUNCATE, to `anon`** (verified via `information_schema.role_table_grants`). RLS does not govern TRUNCATE. PostgREST doesn't expose TRUNCATE, so it's not directly exploitable today, but it contradicts SCHEMA.md and is a defense-in-depth failure. Supabase advisors also flag: `get_sop_field_tokens` and `rls_auto_enable` executable by `anon` as SECURITY DEFINER; leaked-password protection disabled; `profiles` RLS initplan + duplicate-permissive-policy warnings; ~45 unindexed FKs including hot paths (`tasks.case_id`, `credential_cases.org_id`, `touches.case_id`).
- **Missing table**: `user_table_prefs` is queried by shipped code (`as any`, twice) but **does not exist in the dev DB** — every list page fires a failing read, and every sort/column change fires a failing write; both errors are swallowed (`.catch(() => undefined)`), so users just lose their preferences silently on every reload.

**Should-fix checklist results**

- Mobile: covered above — sidebar doesn't collapse; otherwise no horizontal scroll, dialogs fit.
- Empty states: good everywhere tested.
- Error states: freeze on dead backend (above); cases list has a proper "Failed to load cases + Retry" row, but the global auth gate fails before pages get a chance.
- Toast errors: consistent on mutations (settings panels, task drawer, case status) — except the silent payer-name validation and the swallowed table-prefs errors.
- **No DELETE anywhere**: there is no way to delete a mistaken payer/provider/case/license through the app or the API (no DELETE policies at all). For a real customer this means test junk accumulates forever — and it's the direct cause of the license-duplication bug (delete-then-reinsert silently deletes 0).
- Query hygiene: core hooks (`cases`, `tasks`, `providers`, `contracts`, `touches`) have **no `staleTime`** (0 ⇒ refetch on every mount/focus) while lookups/admin use 5 min. QueryClient has no global retry/backoff/error config. Real-session logs corroborate: notes fetched 14× in 21 minutes by one user.
- Accessibility: provider form labels are not associated with inputs (`FormField.tsx` renders `<label>` without `htmlFor`) — `getByLabel` fails on every field; screen readers get nothing. Login form does it correctly, so the pattern exists in-repo.
- Fonts: render-blocking Google Fonts stylesheet from `fonts.googleapis.com` — on a restricted/hospital network the first paint hangs until it times out. Self-host or `media="print"` swap.
- Webhook task interaction: `email-to-touch` inserts tasks with default `sort_order` 0 ⇒ the emailed "Review payer response" task jumps to the top of the case checklist and the sequential-lock UI **locks every other task** behind it.

**Lovable footprints (for the exit)**

- `src/integrations/supabase/client.ts` — auto-generated dead client pointed at an **abandoned** Supabase project; `.env` carries that project's keys; the real client hardcodes credentials instead of using the env vars.
- `src/assets/*.asset.json` — Lovable asset-pipeline stubs; images 404 outside Lovable (`/__l5e/assets-v1/...`).
- `__root.tsx` og:image/twitter:image → a `lovable.app` preview URL.
- `src/lib/lovable-error-reporting.ts` wired into the root error boundary; `.lovable/` dir; `@lovable.dev/vite-tanstack-config` wraps the entire Vite config (dev tagger, sandbox detection, error loggers); `bunfig.toml` pins Lovable's private npm mirror (installs 403 outside Lovable); `vercel.json` present while the build outputs a Cloudflare worker — deployment story is unresolved.
- Architecture violations of its own AGENTS.md: Supabase called directly from a component (`NewCaseModal.tsx`) and from a route (`admin.templates.$id.tsx`); dead "protected" `sopResolver.ts`; mock-free but duplicated resolver logic.
- SCHEMA.md drift: says `sop_templates.is_archived` (column is `archived`), claims scoped grants (they're GRANT ALL incl. anon), says email-to-touch is "planned" (it's deployed and live, v3).

---

## Part 4 — MVP feature checklist

See `MVP_STATUS.csv` for the grid. Summary: 8 Built (1 of them broken by regression), 2 Partial, 3 Missing. The two Missing that matter for customer #2: **bulk provider upload** (CSV export exists, no import — onboarding a 30-provider group is 30 manual 5-step forms) and **user management** (no invite flow; adding customer #2's staff requires SQL).

## Part 5 — Lovable exit assessment

Ranked by risk-to-correctness (what actually bites), not by size:

1. **Data layer: case-creation pipeline** (highest risk, smallest fix). Client-orchestrated, non-atomic, duplicated resolver with a live regression. Fix = align the resolver to the stored template shape (or finally use `sopResolver.ts`), move case+tasks+history+audit into one Postgres RPC. ~1–2 days in Lovable/Cursor. **This is a 1-day fix, not a 2-week rewrite.**
2. **Database layer**: add `user_table_prefs` migration, DELETE policies (or explicit soft-delete), fix grants (revoke anon ALL), converge licenses to `state_licenses` as the single source, add hot-path indexes. ~1–2 days.
3. **Services + hooks**: already well-factored (components → hooks → services → Supabase is real, with 2 exceptions). Needs staleTime/retry defaults, error normalization, and the two stragglers moved into services. ~2–3 days.
4. **Routes/auth**: TanStack file routes are idiomatic; guard works. Fix the login landing race. ~0.5 day.
5. **Components**: consistent shadcn usage, one hotspot (NewCaseModal). A11y label pass on forms. ~2–3 days.

Nothing here justifies a ground-up rewrite. The framework choices (TanStack Router/Query, Zustand, services layer, RLS-first) are the ones a permanent team would keep.

## Part 6 — Verdict

- **Is the code production-ready?** **No** — because the product's core promise (SOP-driven task spawn) is broken in the current build, new-provider onboarding loses data, and a dead backend freezes the app. But the distance to "yes" is short: these are days, not months.
- **Can customer #2 use this?** **After fixes.** Blockers 1–5 are non-negotiable before a second org touches it; add bulk import + user invites to survive onboarding without engineering babysitting.
- **Can you exit Lovable?** **Not yet — after the fix batch.** Exit mechanics themselves are small (assets, env-based client, fonts, registry, error-reporting shim ≈ 1–2 days); the reason to stay in Lovable ~2 more weeks is to land the correctness fixes where the iteration loop already exists.
- **Minimum viable rewrite before hand-off:** (1) case-creation + SOP resolution as a single server-side RPC; (2) license data model convergence on `state_licenses` (form save, edit upsert, detail card); (3) app bootstrap/error shell (env-driven Supabase client, offline error state instead of freeze, login redirect race).
- **Weeks until you can stop touching Lovable:** **~2–3 weeks** — week 1: blockers 1–7; week 2: exit mechanics + bulk import + invites; optional week 3: buffer for customer #2 onboarding polish.
