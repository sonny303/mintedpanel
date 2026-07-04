# FIX_PROMPTS — one Claude Code prompt per blocker (audit v3, 2026-07-04)

Each prompt is branch + PR ready. Standing rule from the fence slip: prompts that
touch **services, hooks, or schema** carry a `DO NOT EXECUTE — reference only`
header and route to MCP review. Everything else is UI-layer and executable.
All prompts assume the repo conventions in AGENTS.md/CLAUDE.md (named exports,
no `any`, `npx tsc --noEmit` + `npm test` + `npm run lint` before push).

---

## FIX 1 — Engine: Approved without an effective date must be "awaiting effective", never Complete (B1)

> Branch: `claude/fix-approved-null-effective`
>
> In `src/lib/actionState.ts`, rule 3 currently classifies `awaiting_effective` only when `statusLabel === "Approved"` AND a non-null effective date is strictly in the future. Per the v3 spec, an Approved case with **no** effective date (confirmed and expected both null) must also classify as `awaiting_effective` — never `complete` — because the effective date still needs to be chased. Change rule 3 to: if `statusLabel === "Approved"` and (`effective == null` OR `effective` is in the future) → `awaiting_effective`. Approved with a **passed** effective date continues to fall through to its bucket (complete). Do not touch rules 1–2 or the stalled/on-track logic.
>
> Update `src/lib/actionState.test.ts`: add cases for Approved+null-eff (→ awaiting_effective), Approved+future-eff (unchanged), Approved+past-eff (→ complete), and Approved+null-eff with an overdue open task (→ needs_action, rule 1 still wins). Keep all 55 existing tests passing (adjust any that asserted the old null-eff behavior).
>
> Note the blast radius: this single function drives /home, /providers, /cases, and the chips in `workView.ts`. On live KFP data exactly one case changes class (Pollard/Medicare: complete → awaiting_effective), so expect chips to go from 32/10/22/0 to 33/10/22/1. State that expectation in the PR body.
>
> Scope: `src/lib/actionState.ts`, `src/lib/actionState.test.ts` only. Do not modify `workView.ts`, services, hooks, or any route.

*(Optional follow-up in the same PR if product agrees: count `Approved` with a passed effective date into the in-network numerators on `providers.index.tsx`/`cases.index.tsx` so the bars agree with /progress "Billing now". If product does not decide, leave the bars alone.)*

## FIX 2 — Error states: no more false all-clear on Home; add error branches to Progress and Reports-Contracts (B2)

> Branch: `claude/fix-false-allclear-error-states`
>
> 1. `src/routes/home.tsx`: derive `const failed = casesQ.isError || providersQ.isError || statusConfigsQ.isError || tasksQ.isError || lastTouchQ.isError || followUpsQ.isError || locationsQ.isError || contractsQ.isError || payersQ.isError;` and render an error card **before** the `allClear` check — the page must never say "You're caught up." or "<section> — clear" when any of its queries errored. Use the same visual pattern as providers.index's error card, but add a real `<Button onClick={() => refetch all}>Retry</Button>` (call each query's `refetch()`).
> 2. `src/routes/progress.tsx`: same pattern (`providersQ/casesQ/payersQ/statusConfigsQ/followUpsQ`), error card + Retry instead of rendering "0 of 0" silently.
> 3. `src/components/reports/ContractMatrixTab.tsx` (the default Reports tab): add the error + Retry branch matching `SummaryTab.tsx:242`'s existing pattern.
> 4. `src/routes/launches.index.tsx:57`: include `casesQ.isError` (and `providersQ.isError`, `assignmentsQ.isError`) in `failed`.
> 5. Upgrade the text-only error states in `providers.index.tsx`, `cases.index.tsx`, `launches.index.tsx` to include a Retry button that calls the queries' `refetch()` — keep the copy.
>
> UI layer only — no services, hooks, or schema. Verify by blocking the Supabase host in devtools (or a Playwright route returning 500) and loading /home: it must show the error card, not "caught up".

## FIX 3 — SOP template matcher: state-null templates must match (B3)

> Branch: `claude/fix-template-state-null-fallback`
>
> `pickTemplate` is duplicated module-locally in `src/components/cases/NewCaseModal.tsx` and `src/components/launches/CreateCasesDialog.tsx` (kept in sync by convention — update BOTH identically). Current logic requires `t.state === state` in both passes, so templates with `state = null` (live: "Medicare Enrollment", "Update CAQH", "New Provider Credentialing Onboarding") never match and Medicare/Pre-Cred cases are created with zero SOP tasks.
>
> Change the matcher precedence to: (1) exact `payerId + state + (groupId or null-group)`, (2) `payerId + state`, (3) `payerId + state IS NULL + (groupId or null-group)`, (4) `payerId + state IS NULL`. Archived templates stay excluded.
>
> Do NOT modify `src/lib/sopResolver.ts` (protected file) — the resolver already handles the template shape; only the pickers change. Add/extend a unit test if a testable pure helper is extracted; otherwise verify by creating a Medicare case in the preview and confirming the task payload is non-empty (3 tasks from "Medicare Enrollment").
>
> PR body must note: pre-cred/Medicare cases created since the launch pivot may be missing their SOP tasks; list affected case ids for manual backfill (do not write a migration).

## FIX 4 — Gate the Create Cases dialog behind canWrite (B4)

> Branch: `claude/fix-createcases-billing-gate`
>
> 1. `src/routes/launches.$id.tsx`: the dialog render at ~line 287 is `{casesOpen && !assignmentsQ.isLoading && !providersQ.isLoading ? <CreateCasesDialog .../> : null}` — add `canWrite &&` (the component already computes `const canWrite = useCanWrite()`), so the `?createCases=true` deep link is inert for read-only roles.
> 2. `src/components/launches/CreateCasesDialog.tsx`: add an internal guard — `const canWrite = useCanWrite(); if (!canWrite) return null;` (defense in depth; the dialog must not rely on its trigger being hidden).
> 3. Same defense-in-depth line in `LaunchEditModal.tsx` and `AssignProviderDialog.tsx`.
>
> UI layer only. Verify as the billing user (`sowmya@fitness.fit`): `/launches/<id>?createCases=true` renders the launch detail with no dialog.

## FIX 5 — Make the provider create/edit route guards real (B5)

> Branch: `claude/fix-provider-route-guards`
>
> `src/routes/providers.new.tsx` and `src/routes/providers.$id.edit.tsx` guard in `beforeLoad` by reading `useAuthStore.getState()` synchronously — on a direct URL load memberships haven't loaded yet, `role` is `null`, and the deny-list (`role === "billing"`) passes, so billing users get the full form.
>
> Fix both routes the same way:
> 1. Keep the `beforeLoad` as a fast-path, but flip it to an **allow-list**: redirect unless the role is `admin` or `specialist` — except when memberships are still empty/unloaded (can't decide yet).
> 2. Add the authoritative check in the component: `const role = useRole(); const memberships = useAuthStore((s) => s.memberships);` — once memberships are loaded, if `!canWrite(role)` (import from `@/lib/permissions`), `navigate({ to: "/providers", replace: true })` in an effect and render null meanwhile.
>
> Routes are UI layer — do not touch `src/lib/auth-store.ts` or any service. Verify as billing: hard-load `/providers/new` and `/providers/<id>/edit` → both land on `/providers`; as admin both still work.

## FIX 6 — Put Client Progress in the nav (B6) ⚠️ touches a protected file

> Branch: `claude/fix-progress-nav`
>
> **`src/components/layout/Sidebar.tsx` is a protected file (AGENTS.md) — this prompt is the explicit instruction to modify it, limited to one nav entry.**
>
> Add `{ label: "Progress", to: "/progress", icon: <appropriate lucide icon, 20px> }` to `mainNav` after Reports. Match the existing item shape exactly; change nothing else in the file. If product prefers Progress restricted to admins, place it in `adminNav` instead — ask before merging, default to `mainNav` (read-only page, billing-safe, verified).
>
> Verify: /progress reachable in one click from anywhere; active state highlights; billing user sees it and the page renders read-only.

## FIX 7 — DO NOT EXECUTE, reference only (schema/infra → MCP review): revoke anon on `rls_auto_enable`, enable leaked-password protection (B7)

> ```sql
> -- via MCP apply_migration + matching repo migration file
> revoke execute on function public.rls_auto_enable() from anon;
> revoke execute on function public.rls_auto_enable() from authenticated;
> ```
> Plus (dashboard/auth config, not SQL): enable "Leaked password protection" in Supabase Auth settings.
> Re-run `get_advisors(security)` afterward; the two WARNs must clear. The remaining SECURITY DEFINER warnings (`user_role`, `user_org_ids`, `claim_invites`, `get_sop_field_tokens`) are by-design RLS helpers — leave them.

## FIX 8 — Delete the dead tablePrefs service; leave the table (B8)

> Branch: `claude/fix-remove-dead-tableprefs`
>
> `src/services/tablePrefs.ts` has zero importers since M6 removed the Tasks list. Delete the file. Do NOT drop or alter the `user_table_prefs` table (additive-only rule) — instead add one line to CLAUDE.md's "Known warts": "`user_table_prefs` is dead schema (its only consumer, the Tasks list, was deleted at M6); drop via a sanctioned migration when convenient." Run `npx tsc --noEmit` to prove nothing referenced it.

---

### Fast-follow prompts (not blockers — bundle at will)

**FF-A (layering):** move the direct Supabase calls in `routes/admin.templates.$id.tsx` (rpc `get_sop_field_tokens`), `routes/welcome.tsx` (`claim_invites` — reuse `services/invites.ts:claimInvites`), `components/settings/MembersPanel.tsx` (`functions.invoke("invite-member")`), and `components/cases/NewCaseModal.tsx` (state_licenses / provider_facility_assignments / contracts reads) behind services + hooks. No behavior change; keep query keys org-scoped.

**FF-B (docs):** update AGENTS.md's Supabase-client rule — `externalClient.ts` now reads `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` from env (`.env.example` documents them); the "currently hardcodes" sentence is stale. Keep the "never import client.ts" rule.

**FF-C — DO NOT EXECUTE, reference only (data, MCP review):** reconcile Beeson's location links (cases → West Central vs assignments → KC Racquet/Olathe from the pivot migration); consider setting Douek/Medicare and Pollard/Medicare to In-Network with real effective dates so the in-network bars carry signal.
