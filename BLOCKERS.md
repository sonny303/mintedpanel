# BLOCKERS — must fix before customer #2

Numbered, with reproduction steps against the dev project (`fkvuhfsqcmujywzgczmc`, login `test@minted.com` / `Test@123!`) and a ready-to-paste **Lovable prompt** for each. Ordered by severity.

---

## 1. Auto-spawned SOP tasks are empty (core value prop broken)

**Repro:** Providers → Walter Beeson → New case → pick any payer with a KS template (e.g. UnitedHealthcare) → Create → open any task in the Tasks panel.
**Observed:** every spawned task shows "No SOP steps defined for this task", due date "TBD". DB: newest real case (Beeson/Aetna/KS, 2026-07-01) has 4 tasks with `sop_content: []`, `due_date: null`; all cases from 2026-06-30 and earlier have populated steps — this is a fresh regression.
**Cause:** `NewCaseModal.tsx` resolves templates with a shape that doesn't exist in the DB (`sopStepTemplates[].step`, `dayOffset`, `dataFieldTokens`) while stored `task_definitions` use `steps[].label/detail/data_fields[]` and `due_offset_days`. The canonical `src/lib/sopResolver.ts` is dead code.

**Lovable prompt:**
> In NewCaseModal.tsx, task spawning is broken: `resolveRawTemplate` reads `def.sopStepTemplates`, `def.dayOffset` and `s.dataFieldTokens`, but SOP templates stored in `sop_templates.task_definitions` (after camelize) have `steps[{label, detail, dataFields[{label, token}]}]`, `dueOffsetDays`, `sortOrder`. Every new case spawns tasks with empty `sop_content` and null due dates. Fix by deleting the inline `RawStep`/`RawDef`/`resolveRawTemplate` code and resolving via the existing `resolveTemplate` in `src/lib/sopResolver.ts`, extended to also emit each step's `dataFields` (resolve each `data_fields[].token` through the token map and keep its `label`). Keep the existing SOPStep shape (`id`, `order`, `label`, `detail`, `isCompleted`, `completedAt`, `completedBy`) so TaskDrawer keeps working, and set task `dueDate` from `dueOffsetDays` relative to today. Do not change the database or the template editor. After the fix, creating a case for a payer/state with a template must produce tasks whose drawer shows the template's steps and due dates.

---

## 2. Add Provider silently discards licenses and facility assignments

**Repro:** Providers → Add provider → fill steps 1–4 including a KS license and a facility → Create provider → open the new provider → New case.
**Observed:** save succeeds (only 2 API calls: provider insert + audit), but `state_licenses` and `provider_facility_assignments` get 0 rows. New Case modal shows "**No active licenses**" and "**Create 0 cases**" — the provider you just added is unusable. Screenshot: `audit/screenshots/09a-new-case-no-license.png`.
**Cause:** `providers.new.tsx` `toInput()` maps neither `form.licenses` nor `form.facilityIds`; `createProvider` only inserts the provider row.

**Lovable prompt:**
> The Add Provider flow (/providers/new) collects license rows (step 3) and facility assignments (step 4) but never saves them — `toInput()` drops `form.licenses` and `form.facilityIds`, so new providers have no `state_licenses` or `provider_facility_assignments` rows and can't open cases. Fix: after `createProvider` succeeds, insert the non-empty license rows into `state_licenses` (org_id from active org, provider_id from the created row, status 'active') and the selected facility ids into `provider_facility_assignments`, via the services layer (extend `src/services/providers.ts` with a `createProviderWithDetails` used by the route — do not call supabase from the component). Also write one audit_log entry covering the create. If any secondary insert fails, surface a toast telling the user which part failed and leave the form open.

---

## 3. Editing a provider duplicates all licenses (and deletes never work)

**Repro (already visible in prod data):** provider `c4ae2d9f` (Walter Beeson) has license "0000TEST" twice — once per edit-save. Edit any provider with licenses, save without changes → licenses double.
**Cause:** `updateProviderWithLicenses` deletes all `state_licenses` then re-inserts — but **no table in the schema has a DELETE RLS policy**, so PostgREST deletes 0 rows without error, then the insert adds a second copy. The same missing-DELETE gap means nothing (payers, cases, providers, licenses, notes) can ever be removed through the app.

**Lovable prompt:**
> Two related fixes. (1) Migration: add DELETE RLS policies (org-scoped, `user_role(org_id) in ('specialist','admin')`) for `state_licenses`, `provider_facility_assignments`, and `notes` — do NOT add DELETE to `touches`, `status_history`, or `audit_log` (append-only). (2) In `src/services/providers.ts` `updateProviderWithLicenses`, stop the delete-then-reinsert pattern: diff instead — update rows the user kept (match by id), insert new rows, delete removed ids explicitly, and verify the delete actually removed rows (select count after) so a policy regression can't silently duplicate data again. Add a uniqueness guard in the migration: `create unique index on state_licenses (provider_id, state, license_number)` after de-duplicating existing rows (keep the oldest of each duplicate set).

---

## 4. Licenses have three sources of truth; provider page lies

**Repro:** open Walter Beeson's provider page.
**Observed:** Licenses card says "**No licenses on file**" while the same provider has 2 `state_licenses` rows and the New Case modal uses them. Expirations shown on other providers come from legacy `providers.license_*` columns, not `state_licenses`.
**Cause:** `providers.$id.index.tsx` `LicensesCard` reads `provider.licenseNumber/licenseState/licenseExpirationDate` (legacy single-license columns); the Edit form writes `state_licenses`; the Add form writes neither.

**Lovable prompt:**
> Provider detail's LicensesCard (src/routes/providers.$id.index.tsx) reads the legacy `providers.license_number/license_state/license_issue_date/license_expiration_date` columns, so providers whose licenses live in the `state_licenses` table show "No licenses on file" (e.g. Walter Beeson). Change LicensesCard to render from the `state_licenses` rows for the provider (there is already a `useStateLicensesByProvider` hook) — a table of state, number, type, issue date, expiration, status, with expiration dates within 90 days highlighted amber and past dates red. Fall back to the legacy provider columns only when the provider has zero `state_licenses` rows, and in that case show a subtle "legacy record" hint. Do not remove the legacy columns.

---

## 5. Shipped code queries a table that doesn't exist (`user_table_prefs`)

**Repro:** open /cases with devtools Network tab against the real backend: a `user_table_prefs` GET fails on every list page; every sort/column change fires a failing upsert. Errors are swallowed (`.catch(() => undefined)`), so column/sort preferences silently reset on every reload.
**Cause:** `src/services/tablePrefs.ts` (note the `as any` casts — the generated types don't know the table either) shipped without its migration.

**Lovable prompt:**
> The app reads/writes `public.user_table_prefs` (src/services/tablePrefs.ts) but that table was never created — every list page fires failing requests and user table preferences never persist. Add a migration creating `user_table_prefs` (`id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users(id) on delete cascade`, `page_key text not null`, `prefs jsonb not null default '{}'`, `updated_at timestamptz not null default now()`, unique `(user_id, page_key)`), enable RLS with select/insert/update policies scoped to `user_id = auth.uid()`, grant to authenticated, then regenerate the Supabase types and remove the `as any` casts.

---

## 6. Case creation is non-atomic and can freeze the modal

**Repro:** any failure between the case insert and task insert (kill network mid-create, or an RLS denial) leaves a case with no tasks, no status history entry, or no audit row; the New Case modal's `handleSave` only try/catches `createCase` — a `createTasksForCase` failure is an unhandled rejection and `submitting` never resets (button stuck on "Creating…").
**Context:** creating 1 case = ~7 sequential client round trips (status lookup → case insert → status_history insert → audit insert → routing-rule fetch → tasks insert → tasks audit), repeated per selected payer.

**Lovable prompt:**
> Make case creation atomic and un-freezable. (1) Create a Postgres function `create_case_with_tasks(p_input jsonb, p_tasks jsonb)` (SECURITY INVOKER so RLS applies) that in one transaction inserts the credential_case, its initial status_history row, the audit_log row, and all task rows, returning the created case — then call it from `src/services/cases.ts` via `supabase.rpc` and have NewCaseModal resolve tasks first and pass them in. (2) In NewCaseModal.handleSave, wrap the entire per-payer loop body in try/catch so any failure marks that payer as skipped with its error message and always reset `submitting` in a finally block. The modal must never be stuck on "Creating…".

---

## 7. Dead backend = app freezes on "Loading..."; login blames the user's password

**Repro:** log in, then block network to Supabase (offline, VPN, outage) and navigate/full-reload → bare white page with "Loading..." forever (screenshot `audit/screenshots/p2-offline-mid-session.png`). At login, a network failure shows "**Invalid email or password**".
**Cause:** the root auth gate (`__root.tsx` + `auth-store.ts init/loadMemberships`) has no failure path; `login.tsx` maps every signIn error to the invalid-credentials message.

**Lovable prompt:**
> Two error-handling fixes. (1) In src/lib/auth-store.ts, make `init()` resilient: wrap the body so any thrown/failed step still sets `initialized: true`, and record an `initError: string | null` in the store when memberships can't be loaded. In __root.tsx, when initialized with a session but memberships failed, render a centered error card ("Can't reach Minted Panel — check your connection") with a Retry button that calls init() again, instead of the bare "Loading..." forever. (2) In login.tsx, distinguish errors: only show "Invalid email or password" when the auth error is invalid credentials; for network/fetch failures show "Can't reach the server — check your connection and try again."

---

## 8. Every table grants ALL (incl. DELETE + TRUNCATE) to `anon`

**Repro:** `select * from information_schema.role_table_grants where grantee='anon'` in the dev project — all 21 tables: `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`.
**Why it matters:** RLS quals protect rows for DML, but TRUNCATE is not subject to RLS; grants this broad contradict SCHEMA.md ("explicit GRANTs for authenticated and service_role") and remove defense-in-depth. Advisors also flag anon-executable SECURITY DEFINER functions and disabled leaked-password protection.

**Lovable prompt:**
> Add a hardening migration: revoke ALL on all tables in schema public from `anon`, then grant back only SELECT/INSERT/UPDATE (no DELETE, no TRUNCATE, no TRIGGER, no REFERENCES) to `authenticated` on the tables the app writes, keeping service_role untouched; revoke EXECUTE on `public.get_sop_field_tokens()` and `public.rls_auto_enable()` from `anon` (keep authenticated for the token function). Do not touch RLS policies. Also enable leaked-password protection in Supabase Auth settings.

---

## 9. Login lands on the marketing page instead of the app

**Repro:** log in from /login → you land on `/` (marketing landing) still showing "Book a demo"; you must know to click into the app. Race: `navigate({to:'/'})` runs before the auth store's session state is set, so the `/` beforeLoad redirect to /cases sees no session. Reproduced deterministically in this audit.

**Lovable prompt:**
> After successful sign-in on /login, users land on the public marketing page because `navigate({ to: '/' })` races the auth store's session update (the `/` route's beforeLoad checks `useAuthStore.getState().session` before onAuthStateChange has run). Fix login.tsx to navigate straight to `/cases` after a successful signIn instead of `/`, and keep the existing effect that redirects an already-signed-in visitor away from /login — pointing it at `/cases` too.

---

## 10. Landing-page images 404 outside Lovable (console errors in every session)

**Repro:** open `/` or check console on any load — three 404s for `/__l5e/assets-v1/.../mpc-logo.png`, `provider-hero.png`, `relay.png`. These are Lovable asset-pipeline URLs (`src/assets/*.asset.json`) that only resolve on Lovable hosting; og:image also points at a `lovable.app` preview URL.

**Lovable prompt:**
> The three images referenced via src/assets asset stubs (mpc-logo.png, provider-hero.png, relay.png) resolve to /__l5e/assets-v1/... URLs that 404 outside Lovable hosting, producing console errors on every page view and broken landing images after export. Move the actual image files into /public/images/, update the landing components (LandingNav/HeroSection/etc.) to reference /images/... paths, delete the .asset.json stubs, and replace the og:image/twitter:image URLs in __root.tsx with a /images/og.png served from public.

---

## Non-blocking but fix soon (should-fix)

- **S1. Stalled definition:** never-touched cases count as Stalled from minute zero; use `max(last touch, created_at)` ≥ 14 days. (Cases list `isStalled`.)
- **S2. Chatty queries:** add `staleTime` (≥30 s) to cases/tasks/providers/contracts/touches hooks and a QueryClient default (`retry: 2`, `refetchOnWindowFocus: false`); real logs show notes fetched 14× in one 21-minute session.
- **S3. Webhook task ordering:** `email-to-touch` inserts tasks with sort_order 0, which jumps to the top of the case checklist and locks all other tasks (sequential lock). Insert with `sort_order = 999 + count` or exclude non-template tasks from the lock chain.
- **S4. Silent payer validation:** empty-name Save in the Add Payer dialog does nothing visible — show inline "Name is required".
- **S5. Form accessibility:** provider form labels aren't associated with inputs (`FormField.tsx` has no htmlFor/id) — screen readers and testing tools see unlabeled fields.
- **S6. Google Fonts render-blocking:** self-host Inter/Geist Mono or load with `font-display: swap` + preload; restricted networks currently hang first paint.
- **S7. Coordinator dropdowns** only list users who already have an assigned case (`getCoordinators` inner-joins credential_cases) — you can't assign the first case to a new teammate; combined with view-only Members panel, team onboarding is SQL-only.
- **S8. No user invite flow** (Members panel is read-only) and **no bulk provider import** — both needed for customer #2 onboarding day.
