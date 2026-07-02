# Lovable Prompts — run in this order to reach production-ready

Consolidated from `BLOCKERS.md` + `LOVABLE_EXIT_PLAN.md`. One prompt per Lovable run; verify each before moving on (verification step listed under each prompt). Phases A–D = production-ready. Phase E = customer #2 onboarding. Phase F = Lovable exit mechanics (do last).

---

## Phase A — Database first (2 prompts)

### A1. Create the missing `user_table_prefs` table

> The app reads/writes `public.user_table_prefs` (src/services/tablePrefs.ts, note the `as any` casts) but that table was never created — every list page fires failing requests and user table preferences never persist. Add a migration creating `user_table_prefs` (`id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users(id) on delete cascade`, `page_key text not null`, `prefs jsonb not null default '{}'`, `updated_at timestamptz not null default now()`, unique `(user_id, page_key)`), enable RLS with select/insert/update policies scoped to `user_id = auth.uid()`, grant select/insert/update to authenticated, then regenerate the Supabase types and remove the `as any` casts in tablePrefs.ts.

**Verify:** change columns/sort on /cases, reload — preferences persist; Network tab shows no failing `user_table_prefs` requests.

### A2. Security + data-integrity hardening migration

> Add a hardening migration with four parts. (1) Grants: revoke ALL on all tables in schema public from `anon`; grant back only SELECT/INSERT/UPDATE (no DELETE, no TRUNCATE, no TRIGGER, no REFERENCES) to `authenticated`; leave `service_role` untouched; revoke EXECUTE on `public.get_sop_field_tokens()` and `public.rls_auto_enable()` from `anon` (keep authenticated on the token function). (2) DELETE policies: add org-scoped DELETE RLS policies (`org_id in (select user_org_ids())` and `user_role(org_id) in ('specialist','admin')`) for `state_licenses`, `provider_facility_assignments`, and `notes` only — do NOT add DELETE to `touches`, `status_history`, or `audit_log` (append-only). (3) De-duplicate `state_licenses` (keep the oldest row of each `(provider_id, state, license_number)` set — there is a known duplicate: license 0000TEST) then add a unique index on `(provider_id, state, license_number)`. (4) Indexes on hot foreign keys: `tasks(case_id)`, `tasks(org_id)`, `credential_cases(org_id)`, `credential_cases(provider_id)`, `touches(case_id)`, `touches(org_id)`, `status_history(case_id)`, `audit_log(org_id, ts desc)`. Do not modify any existing RLS policies. Also enable leaked-password protection in Supabase Auth settings.

**Verify:** `select * from information_schema.role_table_grants where grantee='anon' and table_schema='public'` returns nothing; Walter Beeson has one 0000TEST license; app still loads all pages.

---

## Phase B — Core workflow correctness (4 prompts)

### B1. Fix the SOP task-spawn regression (top blocker)

> In NewCaseModal.tsx, task spawning is broken: `resolveRawTemplate` reads `def.sopStepTemplates`, `def.dayOffset` and `s.dataFieldTokens`, but SOP templates stored in `sop_templates.task_definitions` (after camelize) have `steps[{label, detail, dataFields[{label, token}]}]`, `dueOffsetDays`, `sortOrder`. Every new case spawns tasks with empty `sop_content` and null due dates — the newest real case (Beeson/Aetna/KS, created 2026-07-01) shows 4 tasks with `sop_content: []`. Fix by deleting the inline `RawStep`/`RawDef`/`resolveRawTemplate` code and resolving via the existing `resolveTemplate` in `src/lib/sopResolver.ts`, extended to also emit each step's `dataFields` (resolve each `data_fields[].token` through the token map and keep its `label`). Keep the existing SOPStep shape (`id`, `order`, `label`, `detail`, `isCompleted`, `completedAt`, `completedBy`) so TaskDrawer keeps working, and set task `dueDate` from `dueOffsetDays` relative to today. Do not change the database or the template editor. After the fix, creating a case for a payer/state with a template must produce tasks whose drawer shows the template's steps and due dates.

**Verify:** create a case (Walter Beeson + UnitedHealthcare + KS) → open each task → steps and due dates present.

### B2. Make Add Provider actually save licenses + facilities

> The Add Provider flow (/providers/new) collects license rows (step 3) and facility assignments (step 4) but never saves them — `toInput()` drops `form.licenses` and `form.facilityIds`, so new providers have no `state_licenses` or `provider_facility_assignments` rows and can't open cases (the New Case modal shows "No active licenses" / "Create 0 cases"). Fix: extend `src/services/providers.ts` with a `createProviderWithDetails` that, after `createProvider` succeeds, inserts the non-empty license rows into `state_licenses` (org_id from active org, provider_id from the created row, status 'active') and the selected facility ids into `provider_facility_assignments`, and writes one audit_log entry covering the create. Use it from the /providers/new route — do not call supabase from the component. If any secondary insert fails, surface a toast telling the user which part failed and leave the form open.

**Verify:** add a provider with a KS license + facility → New Case modal offers KS and enabled Create button; `state_licenses` row exists.

### B3. Fix license editing (duplication) and the Licenses card (wrong source)

> Two related license fixes. (1) In `src/services/providers.ts` `updateProviderWithLicenses`, replace the delete-then-reinsert pattern (which duplicated licenses when DELETE silently removed 0 rows under RLS): diff instead — update rows the user kept (match by id), insert new rows, delete removed ids explicitly, and verify the delete actually removed rows so a policy regression can't silently duplicate data again. (2) Provider detail's LicensesCard (src/routes/providers.$id.index.tsx) reads the legacy `providers.license_number/license_state/...` columns, so providers whose licenses live in `state_licenses` show "No licenses on file". Change LicensesCard to render from the provider's `state_licenses` rows (there is already a `useStateLicensesByProvider` hook) — a table of state, number, type, issue date, expiration, status, with expirations within 90 days highlighted amber and past dates red. Fall back to the legacy provider columns only when the provider has zero `state_licenses` rows, with a subtle "legacy record" hint. Do not remove the legacy columns.

**Verify:** edit a provider, save twice → license count unchanged; Walter Beeson's Licenses card shows his KS license.

### B4. Atomic case creation via RPC (no more stranded cases / frozen modal)

> Make case creation atomic and un-freezable. (1) Create a Postgres function `create_case_with_tasks(p_input jsonb, p_tasks jsonb)` (SECURITY INVOKER so RLS applies) that in one transaction inserts the credential_case, its initial status_history row, the audit_log row, and all task rows, returning the created case — then call it from `src/services/cases.ts` via `supabase.rpc` and have NewCaseModal resolve tasks first and pass them in. (2) In NewCaseModal.handleSave, wrap the entire per-payer loop body in try/catch so any failure marks that payer as skipped with its error message, and always reset `submitting` in a finally block. The modal must never be stuck on "Creating…".

**Verify:** create a multi-payer case batch → each case has tasks + history + audit in one shot; force a failure (e.g. duplicate) → toast, modal usable.

---

## Phase C — Bootstrap & error handling (1 prompt)

### C1. Offline resilience + honest login errors + correct login destination

> Three fixes to the app shell and login. (1) In src/lib/auth-store.ts, make `init()` resilient: wrap the body so any thrown/failed step still sets `initialized: true`, and record an `initError: string | null` in the store when memberships can't be loaded. In __root.tsx, when initialized with a session but memberships failed, render a centered error card ("Can't reach Minted Panel — check your connection") with a Retry button that calls init() again, instead of today's bare "Loading..." that hangs forever when Supabase is unreachable. (2) In login.tsx, distinguish errors: only show "Invalid email or password" for actual invalid-credential responses; for network/fetch failures show "Can't reach the server — check your connection and try again." (3) After successful sign-in, navigate to `/cases` instead of `/` — the current `navigate({to:'/'})` races the auth store's session update and strands logged-in users on the marketing landing page; also point the already-signed-in redirect on /login at `/cases`.

**Verify:** sign in → land on /cases. Sign in with wrong password → credential error. Block network → visible error card with Retry, not a frozen "Loading...".

---

## Phase D — Production polish (3 prompts)

### D1. Fix Lovable-only assets (console 404s + broken images outside Lovable)

> The three images referenced via src/assets asset stubs (mpc-logo.png, provider-hero.png, relay.png) resolve to /__l5e/assets-v1/... URLs that 404 outside Lovable hosting, producing console errors on every page view and broken landing images after export. Move the actual image files into /public/images/, update the landing components (LandingNav/HeroSection/etc.) to reference /images/... paths, delete the .asset.json stubs, and replace the og:image/twitter:image URLs in __root.tsx (currently a lovable.app preview URL) with a /images/og.png served from public.

**Verify:** zero console 404s on `/`; images render.

### D2. Query hygiene + trustworthy Stalled metric + webhook task ordering + payer validation

> Four small correctness/perf fixes. (1) Add `staleTime: 30_000` to the core query hooks (useCases, useCase, useTasks, useTask, useProviders, useProvider, useContracts, useTouches/useLastTouchDates) and set QueryClient defaults in src/router.tsx: `retry: 2`, `refetchOnWindowFocus: false` — today everything refetches on every mount/focus (live logs show notes fetched 14× in one 21-minute session). (2) In the cases list (cases.index.tsx), fix `isStalled`: a case with no touches should be stalled only when `created_at` is ≥14 days old — use days since `max(last touch date, case created_at)` ≥ 14, so a case created today no longer shows as Stalled. (3) In the `email-to-touch` edge function, insert the follow-up task with a `sort_order` of 1000 instead of the default 0 so it doesn't jump to the top of the case checklist and lock every template task behind the sequential-lock UI. (4) In the Add/Edit Payer dialog (admin.payers.tsx), saving with an empty name currently does nothing visibly — show an inline "Name is required" error under the field and keep the dialog open.

**Verify:** new case not Stalled; switching tabs doesn't refire every query; empty payer name shows inline error; email webhook task appears last in the checklist.

### D3. Form accessibility + self-hosted fonts

> Two polish fixes. (1) In src/components/providers/FormField.tsx, the `Field`/`FieldLabel` primitives render `<label>` elements not associated with their inputs — generate an id (React useId), put it on the child input via cloning or a render-prop, and set `htmlFor` on the label so screen readers and testing tools see labeled fields across the entire provider Add/Edit flow (login.tsx already does this correctly with Label htmlFor + Input id — match that behavior). (2) Replace the render-blocking Google Fonts stylesheet links in __root.tsx with self-hosted Inter (400/500/600/700) and Geist Mono (400/500) woff2 files under /public/fonts loaded via @font-face in src/styles.css with `font-display: swap` — on restricted networks the external stylesheet currently blocks first paint until it times out.

**Verify:** inspect a provider-form input — it has an id matched by the label's for-attribute; no requests to fonts.googleapis.com.

---

## Phase E — Customer #2 onboarding (2 prompts)

### E1. Team member invites (+ fix coordinator dropdowns)

> Adding a teammate currently requires SQL: the Members panel (src/components/settings/MembersPanel.tsx) is read-only and `memberships` has no in-app INSERT path. Build invites: an "Invite member" button (admin-only) on the Members panel opening a dialog for email + role (admin/specialist/billing); use supabase.auth.signInWithOtp or the invite flow available with the anon key to send the email, and create a `pending_invites` table (org_id, email, role, invited_by, created_at, unique (org_id, email)) with org-scoped RLS; on first login, a new SECURITY DEFINER function `claim_invites()` (called from auth-store init) converts matching pending_invites rows into memberships. Show pending invites in the panel with a revoke option (delete policy scoped to admins). Also fix `getCoordinators` in src/services/lookups.ts: it currently inner-joins profiles to credential_cases via assigned_to, so a teammate with no assigned case can never be picked as coordinator — list profiles of all org members via memberships instead. Write audit_log entries for invite and revoke.

**Verify:** invite a new email as specialist → appears as pending; coordinator dropdowns list all members including never-assigned ones.

### E2. Bulk provider CSV import

> Onboarding a 30-provider group is currently 30 manual 5-step forms. Add a "Bulk import" action on /providers (admin/specialist only): upload a CSV with a documented header row (first_name, last_name, credentials, npi, caqh_id, taxonomy_code, specialty, start_date, license_state, license_number, license_type, license_expiration, facility_name), show a preview table with per-row validation (NPI 10 digits, known facility names matched against the facilities table, duplicate NPI detection against existing providers), then import valid rows — creating providers, their state_licenses, and provider_facility_assignments through the services layer, plus one audit_log entry summarizing the import (count + provider ids). Reuse the CSV parsing conventions from src/lib/csv.ts. Provide a downloadable template CSV. Rows that fail stay listed with reasons; nothing partial per row (skip a row entirely on error).

**Verify:** import a 3-row CSV → 3 providers with licenses + assignments; bad NPI row rejected with reason; audit entry written.

---

## Phase F — Lovable exit mechanics (after the above is verified; 1 prompt + manual steps)

### F1. Env-driven Supabase client + dead-code removal

> Make the Supabase client deploy-configurable and remove dead integrations. Change src/integrations/supabase/externalClient.ts to read `import.meta.env.VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (falling back to the current hardcoded values if unset so Lovable preview keeps working), update .env to point at the real project fkvuhfsqcmujywzgczmc (it currently holds an abandoned project's URL/keys), and delete the unused auto-generated src/integrations/supabase/client.ts and client.server.ts (verify nothing imports them first). Update SCHEMA.md where it has drifted: `sop_templates.archived` (not is_archived), the email-to-touch webhook is deployed (not planned), and grants are now authenticated-only per the hardening migration.

**Manual steps outside Lovable (no prompt):** regenerate the lockfile against registry.npmjs.org (bun.lock currently pins Lovable's private npm mirror, installs 403 elsewhere); replace `@lovable.dev/vite-tanstack-config` with plain Vite config when you leave; remove `src/lib/lovable-error-reporting.ts` from the root error boundary (swap in Sentry or nothing); delete `.lovable/`; pick one deploy target (build outputs a Cloudflare worker via nitro, but vercel.json is also in the repo) and delete the other; set `EMAIL_WEBHOOK_SECRET` per environment.

---

## Acceptance test after Phase D (the "production ready" bar)

1. Log in as test@minted.com → land on /cases.
2. Add a provider with a license + facility → provider detail shows the license.
3. New case for that provider → tasks spawn **with steps and due dates**.
4. Complete 3 tasks, refresh → all persisted; no console errors anywhere.
5. Edit the provider twice → license count unchanged.
6. Kill the network → visible error + retry, not a freeze.
7. `anon` grants gone; prefs persist across reloads.
