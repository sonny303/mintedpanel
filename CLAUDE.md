# CLAUDE.md — Minted Panel system map

Orientation for AI coding sessions. The **binding rules** (protected files,
data rules, style rules, anti-patterns) live in `AGENTS.md` — read that first;
this file adds the system map and operational knowledge those rules assume.
`ARCHITECTURE.md` and `SCHEMA.md` are the deeper references for layering and
tables.

## Branch policy (PM decision 2026-07-21): work on `main`

The redesign staging model is RETIRED. The long-lived `redesign` branch was
promoted to `main` in #231 and is no longer used: **branch off `main`, target
every PR at `main`** (`gh pr create --base main`). Everything below that says
"branch off `redesign` / PR targets `redesign`" now reads `main` — the rest of
the workflow (one epic per PR, gates, Devin review-and-merge, never
self-merge) is unchanged.

## Redesign program (historical staging model)

The product redesign was built epic-by-epic on the long-lived `redesign`
branch. If you are implementing a redesign epic:

- Epics live at `docs/redesign/EX.X-<slug>.md` (e.g. `E0.0-app-shell.md`).
  **An epic merged to `main` is an approved epic — build it.** The
  `reviewed: true` frontmatter gate was RETIRED 2026-08-07: it was an
  out-of-band boolean that silently cost a build session to discover, drifted
  from `status` (E4.4 shipped at `status: draft, reviewed: true`), and
  duplicated what the PR state already says. Existing epics keep whatever
  frontmatter they carry; nothing reads it.
- **Every build session opens with a ≤60-minute spike** (`BUILD-PROMPT.md`):
  probe the epic's schema claims against `supabase/migrations/` + the live DB
  (read the CHECK constraints, not just column lists), grep the named modules
  for real signatures and org-scoping, run `npm run lint:epics`, and write the
  findings into the PR body as `## Enablers`. This REPLACES the standalone
  review session for ordinary epics — three prose-review rounds on E6.9 still
  left four blockers, and all four were "the code contradicts the epic," which
  is what the first hour of building finds anyway.
- **A dedicated review session** (`docs/redesign/REVIEW-HANDOFF.md`) is now
  reserved for epics crossing a trust boundary — auth, RLS/tenant isolation,
  PHI, public/anon surfaces, money, or a global cross-org write tier — or when
  the PM asks. Only such a session may edit the one epic file under review; a
  **build session still never edits epic files or `CLARIFICATIONS_NEEDED.md`**.
- **Technical enablers live in the build PR, not the epic.** Epics through E6.9
  carry a `## 5. Technical Considerations & Enablers` section from the older
  workflow — history, not a template to copy. New epics stay short: one PR's
  worth of scope (>~8 features, >1 repo, or a PR map ⇒ split it) and they
  **link to code by path rather than paraphrasing it**, since paraphrase is
  what drifts.
- **`npm run lint:epics`** (`scripts/check-epic-hygiene.mjs`) machine-checks
  what reading kept missing: TS ids cited by epics/e2e specs are registered in
  `seed-universe.md`, epic frontmatter is well-formed, and every table a
  migration creates has a `table-register.md` row (its first run caught
  `provider_field_verifications` missing one). It CANNOT detect two
  workstreams meaning different things by the same id — that is what
  `node scripts/check-epic-hygiene.mjs --next` prevents, by making id
  allocation one command instead of eyeballing the end of the table.
- Read `docs/redesign/README.md` (workflow + merge gate) and
  `docs/redesign/uiux-component-guide.md` (component selection + build
  requirements) before writing code. AGENTS.md rules still bind; epics with
  shell changes explicitly authorize touching `src/components/layout/*` via
  their section 5.
- One epic per PR, branch off `main`, PR targets `main`, titled
  `EX.X: <title>` and referencing the epic file. Every numbered FR must be
  traceable in the diff.
- **Open the PR yourself as your final step — do not wait for the user.** When
  the gates pass, push the branch and run `gh pr create --base redesign --head
<branch> --title "EX.X: <title>"` with a body mapping each FR/TE to the diff.
  The reviewer automation (Devin) fires automatically on the new PR; you never
  need a human to create or kick off the review. If review comments come back,
  push fixes to the SAME branch (do not open a new PR) — the automation
  re-reviews on each push. Never self-merge.
- Devin reviews each PR against the epic and the gates (`npm run lint`,
  `npm run test`, `npx tsc --noEmit`, e2e where covered) and merges it into
  `redesign` when fully aligned; otherwise it leaves review comments naming
  the unmet FR/enabler — remediate and push to the same branch.

### Stage 0 built so far

- **E0.0 — App Shell & Navigation IA.** The Credentialing Manager workspace
  frame. New internal-only column `organizations.lifecycle_state`
  (`prospect|active|inactive`, default `active`; migration
  `20260708120000_org_lifecycle_state.sql`, repo + hosted) — read-only, NEVER
  rendered as a status label. The **Portfolio** is the cross-org home at
  `/portfolio` (authenticated redirects land there, not `/home`): chrome-decoupled
  `src/components/portfolio/PortfolioContent.tsx` (zero `src/components/layout/*`
  imports) fed by `usePortfolio` → `src/services/portfolio.ts` (`listPortfolioOrgs`,
  cross-org, no `requireActiveOrg` — RLS scopes it) → pure `src/lib/portfolio.ts`
  (`splitPortfolio`: active→"In motion", prospect→"Prospects", inactive excluded;
  tested). Journey nav (`src/components/layout/Sidebar.tsx`, rewritten per TE-6):
  Portfolio above the org context, then org-scoped Get started / Scope / Work /
  Outcomes — no admin items. Those four are **reserved leaf routes**
  (`get-started|scope|work|outcomes`) rendering the shared
  `src/components/empty/NotYetAvailable.tsx`. Org switch clears view state via
  `<Outlet key={activeOrgId}>` in `__root.tsx` (TE-4) + the existing
  `setActiveOrg → removeQueries`. First-run (zero orgs) reuses `NoOrgScreen`
  (restyled) → `create_organization` (E0.1 hand-off). Existing flat routes
  (home/providers/cases/admin.*) stay URL-reachable but are dropped from the nav.
- **E0.1 — Create Organization Shell + party-model foundation.** The
  **canonical E0.3 §5 party schema** landed here (owner must be stored from day
  one): `parties` (no `org_id` — cross-org; RLS via assignment-membership OR
  `created_by`), `party_role_types` (governed role list — active owner/
  customer_escalation_contact/sales_rep, reserved billing_contact/
  contracting_signer/credentialing_contact), `party_role_assignments`
  (org-scoped, `UNIQUE NULLS NOT DISTINCT`, inactive-role reject trigger) —
  migration `20260709120000_party_model_foundation.sql`. **`create_organization`
  v2** (`20260709120100`, additive 3-arg overload, legacy 1-arg kept): hard-block
  duplicate normalized name, required owner name+email, `lifecycle_state
= 'prospect'`, owner party + `owner` assignment. Frontend: `createOrganization`
  service takes `{name, ownerName, ownerEmail}`; shared `useOrgCreateForm` +
  `OrgCreateFields` (owner fields + `src/lib/contactValidation.ts` email
  format/typo nudge) drive BOTH intake surfaces (`NoOrgScreen`,
  `CreateOrganizationModal` — the latter shared by `CreateOrgPanel` + Portfolio
  empty state). Post-create lands on the new org's `/get-started`
  (`useCreateOrganization`), which now renders a guided next-step ("Add
  facilities or providers" → `/scope`) with NO portfolio-return prompt (F0.1.5).
  Additive seed `supabase/seed-redesign.sql` (11-org universe + owners, natural-
  key idempotent, NOT the legacy `seed.sql`; never seed prod). E0.2 extends the
  RPC/form/seed with Zeb + customer contacts; E0.3 adds the manage-parties
  surface + TS-9–11.
- **E0.2 — Org CRM Contact Fields (Customer & Sales Rep).** No schema change —
  the canonical `parties` table (phone/address columns) + the
  `customer_escalation_contact`/`sales_rep` roles already shipped in E0.1.
  **`create_organization` v3** (`20260709130000`, additive 5-arg overload;
  legacy 1-/3-arg kept, unambiguous since the 5-arg requires the customer arg):
  customer-escalation contact required, sales rep defaulted to **Zeb Loewenstine**
  when omitted (**that default is GONE** — see the 2026-08-07 hotfix below; the
  sales rep is optional and omitting it creates no party); both stored as parties
  with their roles via SECURITY-DEFINER
  helpers `assert_contact_valid`/`insert_contact_party` (client-revoked).
  Frontend: `ContactInput` type + `src/lib/contacts.ts` (`DEFAULT_SALES_REP` Zeb,
  `EMPTY_CONTACT`, `PARTY_ROLE_LABELS`, `partyToContactInput`) + `contactErrors`
  in `contactValidation.ts` (tested). `createOrganization({...customer, salesRep})`
  → snake_case jsonb. Shared `ContactFields` (name/email/phone/split address)
  drives the create form (`OrgCreateFields`/`useOrgCreateForm` now carry customer
  - Zeb-prefilled sales rep) and the edit dialog. Display+edit surface
    `OrgContactsSection` (owner read-only, customer/sales editable) on
    `/get-started`, fed by `src/services/parties.ts` (`listOrgContacts`,
    `updateParty` — browser RLS, audited) → `src/hooks/useParties.ts`
    (`useOrgContacts`/`useUpdateParty`, invalidate on edit). No contact delete in
    E0.2 (so "can't remove the only sales rep" holds trivially; delete arrives in
    E0.3). Seed `seed-redesign.sql` extended: Zeb (one party, `sales_rep` on all 11
    orgs) + per-org customer contacts.
- **E0.3 — Full Party Model (manage-parties surface).** No schema change (the
  canonical `parties`/`party_role_types`/`party_role_assignments` shipped in
  E0.1). Adds the browser CRUD + role management on top: `src/services/parties.ts`
  gained `listOrgParties` (grouped via pure `src/lib/parties.ts` `groupOrgParties`
  — one party, many roles, tested), `listVisibleParties` (cross-org reuse pool,
  F0.3.4 — **DELETED 2026-08-07 with D8**), `listPartyRoleTypes` (governed list), `createParty`, `assignRole`
  (trigger rejects reserved), `unassignRole`/`removePartyFromOrg` (both USED TO
  block removing the org's **only** sales rep, F0.2.2 — guard REMOVED by the
  2026-08-07 hotfix below; TD-4: the party RECORD is
  retained — a browser client can't verify "no assignments anywhere" under
  org-scoped RLS, and the FK cascades). Hooks in `useParties.ts`
  (`useOrgParties`/`usePartyRoleTypes`/`useVisibleParties`/`useCreateParty`/
  `useAssignRole`/`useUnassignRole`/`useRemovePartyFromOrg`, shared invalidator).
  **`src/components/org/PartiesManager.tsx`** replaces the E0.2 `OrgContactsSection`
  on `/get-started`: party list with role chips (removable), Add person / Add
  existing (reuse) dialogs, edit dialog (shared `ContactFields`), remove-confirm,
  and a role picker (`party_role_types` — active selectable, reserved
  visible-disabled, F0.3.5; **the Add-existing dialog is gone and no role is
  reserved any more, 2026-08-07**). Seed adds TS-10 (Zeb also `owner` on Point Place
  alongside the seeded owner). RLS write/read paths verified live under the
  `authenticated` role.
- **E0.4 — First-Run & Next-Action Landing.** No schema change (E0.0's
  `organizations.lifecycle_state` + the existing `created_at` are the only
  inputs). Deterministic landing resolver `src/lib/landing.ts` (`resolveLanding`
  → `first-run | workspace | portfolio`; the shared pure `selectActiveOrgId`
  picks the valid non-inactive last-active org, else the most recently created
  **live** org, else null — tested in `landing.test.ts`), consuming the E0.0
  `listPortfolioOrgs` source (now also selecting `created_at`; `PortfolioOrg`
  gained `createdAt`). Applied at the two authenticated entry points via
  `useLandingRedirect` (`src/hooks/useLandingRedirect.ts`): post-login
  (`login.tsx`) and the `/` root redirect (`index.tsx` `beforeLoad`, client-nav
  only — a hard-load of `/` still renders marketing, unchanged). Reloading a
  specific workspace URL preserves context via the persisted store and never
  re-resolves (F0.4.1 supersedes E0.0's flat `/portfolio` default). **Store
  change (TE-2):** `MembershipEntry` carries `lifecycleState`/`createdAt` (the
  memberships query embeds `organizations(name, lifecycle_state, created_at)`)
  and the boot-time active-org validation is now lifecycle-aware via the same
  `selectActiveOrgId` (was "fall back to first membership"). **Portfolio
  all-inactive fallback (F0.4.2 / TE-3):** `splitPortfolio` also returns the
  `inactive` bucket + an `allInactive` flag; `PortfolioContent` renders an
  "Inactive" group heading (the same grouping mechanism as In motion/Prospects —
  **no per-org status label**, E0.0 F0.0.2 preserved) + a create-org CTA ONLY
  when the metric buckets are empty and inactive > 0 (else inactive stays
  excluded and the zero-org "No organizations yet" card shows). **Onboarding
  banner (F0.4.3 / TE-4):** `src/components/org/OnboardingBanner.tsx` (disabled
  "Begin onboarding" Stage-1 CTA, composed from card + button) at the top of
  `/get-started`. Playwright `e2e/portfolio-inactive-fallback.spec.ts` covers
  TS-12 (the all-inactive dark path, TD-4) via the mock harness. Zero-org
  first-run still lands on `NoOrgScreen` (E0.0 TE-7); Portfolio itself is
  otherwise unchanged and stays one click away in the nav.
- **E0.5 — Secure One-Time Org Data Capture Link (+ inbound leads).** The FIRST
  redesign surfaces that cross the trust boundary (unauthenticated external
  writes). Two additive migrations (repo + hosted, no pgcrypto — token = two
  `gen_random_uuid()`s, hash = core `sha256`): `20260709140000_party_capture_links.sql`
  (`party_capture_links` — `state active|used|expired|revoked`, partial unique
  `(org_id) WHERE state='active'` = single-active-link invariant, only the token
  HASH stored; member-SELECT RLS, all writes via RPC) + the three capture RPCs;
  `20260709140100_inbound_leads.sql` (`inbound_leads` — public "contact us" leads,
  NOT org-scoped, `status new|converted|dismissed`, shared authenticated
  SELECT/UPDATE triage queue) + `submit_inbound_lead`. **Outbound (BD-1 token
  link, NO login; BD-2 copy-able email, no send infra):** `create_capture_link`
  (authenticated, writer-member check, resolves/provisions the recipient party,
  revokes-then-issues → re-issue semantics, returns the raw token ONCE),
  `validate_capture_token` + `submit_capture` (both `anon` SECURITY DEFINER,
  hash-validated, touch only the authorized party/org, lazy expiry; submit reuses
  E0.2 `assert_contact_valid` for completeness and flips the link to `used`).
  Frontend: `src/services/captureLinks.ts` (dual — operator issue/read + anon
  validate/submit) → `src/hooks/useCaptureLinks.ts`; pure `src/lib/captureEmail.ts`
  (+test, F0.5.4 copy) ; **public `/capture/$token`** route (renders outside the
  shell — `__root` `isChromelessRoute`) with the active form + used/expired/
  revoked/invalid lockdowns; operator `CaptureLinkPanel` on `/get-started`
  (party picker or new email, copy-able link+email). **Inbound (F0.5.5/TE-7):**
  `src/services/inboundLeads.ts` (`submitInboundLead` anon; `listInboundLeads`/
  `convertInboundLead`→`create_organization` prospect/`dismissInboundLead`) →
  `useInboundLeads.ts`; **public `/contact`** route (honeypot + required-field
  validation) → triaged lead; operator `InboundLeadsPanel` on `/get-started`
  (Convert/Dismiss, renders only when leads await). Seed adds two demo leads;
  capture links are token-ephemeral so TS-7/TS-13 run through the mock e2e
  (`e2e/capture-link.spec.ts`, `e2e/contact-inbound.spec.ts`). `types.ts` gained
  the two tables (hand-added, MCP regen flaked — normalize on next regen). The
  /api org-isolation gate does NOT cover these (browser-RLS + anon-RPC surface,
  not an /api resource); isolation is enforced in the RPC bodies (touch only the
  token's party/org) + RLS.
- **E0.6 — Reporting Center & Portfolio Dashboard (CLOSES Stage 0).** Also did
  the E0.0 sidebar supersession in-place (PM decision). **Segmented nav (TE-2,
  `src/components/layout/Sidebar.tsx` rewritten):** TOP cross-org (Home → `/`
  landing resolver, Reporting Center; reserved Setup/Config → Payer Setup/SOP,
  reserved Cases/Tasks) / BOTTOM org-scoped (active-org header IS the switcher,
  Account Detail → `/get-started`; reserved Facilities/Providers). Portfolio is
  no longer a top-level nav item. Reserved items route to the **single shared
  `/soon?title=` route** (`src/routes/soon.tsx` → `NotYetAvailable`, retargeted
  to the Reporting Center). No active org → bottom shows a "select an
  organization" prompt. **Reporting Center (TE-1):** cross-org `/reporting`
  (registry index from `src/lib/reports.ts` `REPORTS` — one entry today, add a
  report = one entry + route, F0.6.6) + `/reporting/portfolio` report. Bare
  `/portfolio` is now a **redirect** to `/reporting/portfolio` (TD-1, old links
  live). The **E0.4 landing fallback retargets** to `/reporting/portfolio`
  (`useLandingRedirect` + `index.tsx` beforeLoad). **Portfolio report (TE-4,
  `src/components/reporting/PortfolioReport.tsx`):** reuses `PortfolioContent`
  verbatim (metrics + In motion/Prospects) + pure `stateBreakdown`
  (`src/lib/portfolio.ts`, +tests; NC/SC/CO/TX/WI/OR order, inactive excluded,
  Unknown bucket) + all-orgs list (incl. inactive under a group heading, name +
  state — **no per-org status label**) + `ShareReportPanel`. Per-org **state is
  derived** from the org's customer-escalation-contact party's address state
  (fallback owner; sales-rep Zeb excluded — cross-org, always NC), TD-5, via
  `src/services/reporting.ts` `listPortfolioOrgStates` (cross-org, RLS-scoped) →
  `usePortfolioOrgStates`. **Read-only share (TE-5/TE-6):** migration
  `20260709150000_report_shares.sql` (`report_shares` — `scope full|single_org`,
  `state active|revoked|expired`, 30-day expiry, token HASH only, created_by RLS)
  - `create_report_share`/`revoke_report_share` (authenticated) +
    `validate_report_share` (`anon`, **no anon write** — the scope filter is
    enforced server-side so a single-org share never leaks other orgs).
    `src/services/reportShares.ts` → `src/hooks/useReporting.ts`; public
    **`/share/$token`** route (chromeless via `__root` `isShareRoute`) renders
    `PortfolioContent` with the server-scoped orgs — **`PortfolioContent` gained
    optional `orgs`/`readOnly` props** (default = the unchanged authenticated
    path). e2e `e2e/reporting-center.spec.ts` + `e2e/report-share.spec.ts` (full vs
    single-org scope, revoked/expired lockdowns). `types.ts` `report_shares`
    hand-added (MCP regen flaked). **Stage 0 is complete after this merges — do NOT
    merge `redesign` → `main` (PM's explicit call).**
- **E0.7 — Stage 0 Hardening (PR #77).** Public-surface hardening only, no
  feature change: uniform invalid/expired responses across the anon RPC
  lockdowns, GRANT lockdown + the re-runnable audit
  `scripts/verify-stage0-rls-grants.sql` (empty result set = pass; run via MCP
  `execute_sql`), types regen, regression e2e (`e2e/abuse-probe.spec.ts`,
  `e2e/onboarding-regression.spec.ts`), and migration
  `20260710120000_stage0_grant_hardening.sql`. Deferred the BD-1 rate limiter
  and BD-2 a11y pass to E0.8.
- **E0.8 — Standalone Onboarding Shell & Stage 0 Hardening Close-out.**
  **Onboarding shell (TE-1..4):** the org switcher's Add organization item now
  navigates to the standalone authenticated **`/onboarding`** page (the modal is
  no longer the entry point; `CreateOrganizationModal` remains for its other
  callers). Split layout: left = the SHARED `useOrgCreateForm` + `OrgCreateFields`
  intake form (post-create still navigates to the new org's `/get-started`);
  right = persistent side panel with the two journeys for the ACTIVE org —
  **Share onboarding link** (popup, recipient name+email required, NO party
  dropdown; same `create_capture_link` re-issue semantics; CTA labeled "Share
  onboarding link") and **Begin onboarding** (→ **`/onboarding/wizard`**, a
  single page with sections: live org-details summary + `NotYetAvailable`
  placeholders for CSV/facilities/providers). **Terminology (F0.8.2/F0.8.3):**
  intake labels are now "Authorized contact" (was owner) / "Organization
  contact" (was customer escalation contact) / a separate "Organization address"
  section; the sales rep field is GONE from the form (Zeb default applied
  server-side, managed in People Enroll). Display-side the same relabels apply
  (`AccountDetailSummary`, wizard) — the party model / role keys are unchanged.
  **Account Detail (F0.8.6):** `/get-started` header is "Account Detail" and
  renders the read-only `src/components/org/AccountDetailSummary.tsx`;
  `CaptureLinkPanel` + `OnboardingBanner` are no longer rendered there
  (components kept). `PartiesManager` heading is now **"People Enroll"**.
  **Branding (F0.8.7):** sidebar TOP carries the Minted Panel logo + name above
  the "Workspace" label; the BOTTOM org segment is labeled "Org space";
  `/capture/:token` gained a branded footer. **Rate limiting (F0.8.8 / TE-8,
  migration `20260710130000_public_rpc_rate_limiting.sql`, repo + hosted):**
  `public_rpc_attempts` (RLS on, NO policies) + SECURITY DEFINER helpers
  `check_rpc_throttle` / `mark_rpc_attempt_valid` — **NO anon/authenticated
  EXECUTE on the helpers** (the four public RPCs are SECURITY DEFINER so inner
  calls run as owner; an anon-callable mark-valid would whitewash failed probes
  — caught in review, revoked repo + hosted, asserted by the grants audit). The
  four anon RPCs are redefined with the check prepended: validations 20
  failed/15 min per hashed source IP (successful lookups marked valid),
  `submit_inbound_lead` 5 total/60 min; throttled = the same generic
  invalid/fake-success response (no oracle). **A11y (F0.8.9):** scoped pass on
  `/capture/:token`, `/contact`, `/share/:token` — `aria-describedby` +
  `aria-live` error wiring in `ContactFields`/contact form, `role="alert"` on
  submit errors, form/main landmarks. e2e: `e2e/onboarding-shell.spec.ts`
  (TS-17..20) + a TS-16 throttle probe in `abuse-probe.spec.ts`;
  `onboarding-regression.spec.ts` rewritten for the `/onboarding` entry point.
- **E0.10 — Data-Model Integrity Hardening (PR #82).** Five additive
  migrations (repo + hosted, `20260710140000`–`180000`): FK indexes on the
  TE-4 pinned nine columns; per-column `CHECK (col IS NOT NULL)` under the
  unique invariants (`contracts.group_id/payer_id`, `pfa.provider_id/
facility_id`, `state_licenses.provider_id`); `^[A-Z]{2}$` state-format
  checks on the TE-2 scalar set (wildcard fields `mso_routing_rules.state` /
  `sop_templates.state` excluded — `'All'` is valid there); structural
  constraints (`tasks_owner_check`, partial unique
  `uq_provider_facility_assignments_one_primary`, `status_configs
UNIQUE (org_id, track, label)`); all fourteen CHECKs VALIDATEd (BD-1/BD-2
  audits returned zero offending rows; live values were already clean
  two-letter codes). **Service boundary:** `src/lib/stateCode.ts`
  (`normalizeStateCode`/`normalizeOptionalStateCode` — trim+uppercase before
  writing any constrained state column; NEVER applied to the wildcard
  writers) and `src/lib/dbErrors.ts` (`translateDbError`, 23505/23514/23502 →
  domain messages by constraint name, unknown errors pass through) wired into
  contracts/cases/providers/tasks/statusConfigs/launches/orgSettings. No
  constraint on `mso_routing_rules` (PM-deferred). Table-register rows updated.
- **E0.9 — Design System Conformance & Stage 0 Tech-Debt Consolidation.**
  The PM design handoff lives at `docs/redesign/design-system/`
  (lint/format-ignored — never edit the bundle). `src/styles/tokens.css` is
  now the BYTE-IDENTICAL drop-in from `design-system/targets/` (it is in
  `.prettierignore` to keep parity) — warm neutrals, `#1B4D3E`/`#163F33`,
  fixed `--mp-*-tint`/`--mp-*-ink` status pairs (no `color-mix`),
  `--mp-radius-control` 4px / `--mp-radius-sm` 6px, `--mp-shadow-sm: none`.
  UI font is **Geist** (`@fontsource/geist`; Instrument Sans/Inter fully
  removed, incl. `public/fonts` assets + `__root` preloads). Controls are
  shadowless; cards 6px; global focus = 2px soft primary ring
  (`rgba(27,77,62,.18)`). **Both StatusPills** render 4px borderless
  tint+ink pairs — the shared map is `statusToneClasses` in
  `src/components/StatusPill.tsx`; the triage pill maps its DB hex through
  `hexToStatusColor` (color-mix is gone). `triage/FilterCards` →
  **`triage/SummaryChips`**. **Sidebar IA v2** (supersedes E0.6 nav + E0.8
  "Org space"): Workspace (Home, My Cases — the E2.3 queue's authorized
  entry —, Cases + open-case count chip from the
  cached `useCases`/`useStatusConfigs` — no polling) / Payers (Payer
  Management → `/admin/payers`) / Reporting Center; org zone = contained
  switcher tile (ORGANIZATION eyebrow), lifecycle-grouped menu (headings
  only, never per-org status labels), search above 10 orgs, footer Add
  organization (→ `/onboarding`) + View all organizations (→
  `/reporting/portfolio`); nav focus uses a white-alpha ring; user menu has
  Settings → `/admin/settings`. **Governance:** `DESIGN-DEBT.md` +
  `TECH-DEBT.md` (31-row Stage 0 TD consolidation) at the repo root —
  unspecced components must be stock shadcn, token-styled, and logged
  (AGENTS.md rule). e2e: `sidebar-ia.spec.ts` (TS-22) +
  `legacy-routes.spec.ts` (TS-23 — every legacy route renders or redirects;
  `/portfolio`→`/reporting/portfolio`, `/progress`→`/client-progress`,
  `/admin/sops`→`/admin/templates` pinned).

### Stage 1 built so far

- **E1.0 — Wizard Scope-Section Framework.** `/onboarding/wizard` is the Stage 1
  front door: the E0.8 `NotYetAvailable` placeholders are replaced by the R1
  section framework. The ordered registry + pure progress contract live in
  `src/lib/onboardingProgress.ts` (tested): 4 active sections (Org details /
  Provider Group / Facilities / Providers) + 3 disabled R3 previews
  (Assignments / Payer Network / Scope Review, "Coming next"). Status is
  DERIVED at render time — org details from org name + owner/customer parties
  (reusing `contactErrors`/`isValidEmail` via `partyToContactInput`, never a
  second email rule), the other three from row presence (binary by design
  until E1.1–E1.3 define partial-record shapes) — never stored wizard flags.
  `getNextIncompleteSection` drives the single "Next: …" CTA
  (`NextActionCard`), which IS the resume mechanism (survives org switch, no
  per-user last-section storage; scroll + heading focus via
  `sectionHeadingId`, no route/Zustand state). Composition hook
  `src/hooks/useOnboardingWizard.ts` feeds the route from the EXISTING hooks
  (`useOrgContacts`/`useProviderGroups`/`useFacilities`/`useProviders` — same
  org-scoped caches, so outside edits flip chips; failed reads render inline
  retriable errors and never count as "Not started"; providers stay on the
  PHI-narrowed list projection). Section UI in `src/components/onboarding/`
  (`WizardSectionCard`, `PreviewSectionCard`, `NextActionCard`,
  `SectionStatusPill`, `OrgDetailsBody`, `sectionBodies`); the route holds the
  `SECTION_BODIES` mount registry E1.1–E1.3 swap their forms into. Shell debt
  (F1.0.4): the Sidebar now imports the approved white layered-jack mark from
  `src/assets/logo-white.png` (copied from the design-system reference assets;
  the old `minted-mark.png.asset.json` remains only on the light-surface
  landing/login/privacy pages, out of TE-8 scope); rail white-alpha values
  were audited against `Sidebar Nav.dc.html` and already conformed — no
  contrast change shipped. e2e: `e2e/onboarding-wizard.spec.ts` (TS-25–28 +
  logo/rail sweep). No migration, no schema change, no new deps.
- **E1.1 — Provider Group / Business Entity.** No schema change — every field
  already existed on `provider_groups` (baseline). The wizard's Provider Group
  section is now the real entity surface: `ProviderGroupSection` (active-group
  list, edit, soft delete via `isActive:false` — never a row delete, dual-path
  exit "Next: Facilities" + "Add another group" per the PM's no-gate decision)
  - `ProviderGroupForm` (legal name; TIN required 9-digit shown `XX-XXXXXXX`
    stored bare digits; Type 2 NPI 10-digit format-only; operating-states
    multi-select ≥1; billing/correspondence/credentialing address+contact blocks,
    billing required, same-as-billing live-mirror quick-fills). The pure
    block-shaped mapping + validators live in `src/lib/providerGroup.ts`
    (tested) — ONE fold point to the flat columns (the table-register sprawl
    target), so the post-R1 `group_addresses`/`group_contacts` normalization
    repoints one boundary. Writes ride the EXISTING `orgSettings` service path
    (`createProviderGroup`/`updateProviderGroup` — `credentialingState` now
    normalized like the other two); `ProviderGroupInput` + the protected
    `ProviderGroup` type were additively widened to the baseline columns.
    Progress: `resolveProviderGroupStatus` = ≥1 ACTIVE group (the sanctioned
    E1.1 resolver broadening; soft-deleted groups don't count). Account Detail
    gained the read-only `src/components/org/GroupSummaryCard.tsx` (shared
    `useProviderGroups()` cache, no edit affordances). `US_STATES` was promoted
    to `src/lib/usStates.ts` (`components/settings/shared.ts` re-exports);
    `StatesMultiSelect` (DropdownMenuCheckboxItem composition) is logged in
    `DESIGN-DEBT.md`. e2e: `e2e/provider-group.spec.ts` (TS-29/TS-30 +
    soft-delete regression). Legacy admin `GroupsPanel` untouched (reconcile
    later — known debt).

- **E1.2 — Facilities / Locations.** No schema change — the CAQH
  practice-location fields all existed on `facilities`. The wizard's
  Facilities section is now real CRUD: `FacilitySection` (active list with
  group name, city/state, hours summary, resolved contact; edit; soft delete
  `isActive:false`; zero-group orgs are pointed back to the Provider Group
  section) + `FacilityForm` (name/group required — picker offers ACTIVE
  groups but still renders an existing link to a soft-deleted one; address +
  state + ZIP required; CAQH extras optional: county, appointment phone,
  accepting-new-patients switch, `TagListInput` language lists, ADA
  select+notes). **Locked hours contract** lives ONLY in
  `src/lib/facilityHours.ts` (tested): per-day jsonb
  `{mon:{status,open,close}}`, open/close present only when open, 24h
  storage/12h display, `applyWeekdayDefault` quick-fill (M–F range, weekend
  closed), close>open validation, `hoursSummary`; `HoursEditor` renders the
  draft via native time inputs. **Contact inheritance is display-only**
  (`src/lib/facilityContact.ts`, tested): facility-own wins, else the
  group's first non-empty block in the LOCKED precedence credentialing →
  correspondence → billing — rendered as "Inherited from group", facility
  columns stay null (never copied); `hasReachableContact` is the
  minimum-to-save rule. Progress: `resolveActiveRowsStatus` (shared with
  E1.1's group resolver) = ≥1 active facility. `Facility` type +
  `FacilityInput` additively widened (incl. `AdaCompliance`;
  `Facility.hours` typed via the lib). Account Detail gained the read-only
  `FacilitySummaryCard`. e2e: `e2e/facilities-wizard.spec.ts` (TS-31/TS-32 +
  close>open block). Legacy `launches` columns
  (`status_id`/`effective_date`/`reference_only`) untouched by the wizard
  payload.

- **E1.3 — Provider Roster.** TWO additive migrations (repo + hosted):
  `20260712120000_provider_group_assignments.sql` (the M:N provider↔group
  join, mirroring the `provider_facility_assignments` template — org-scoped
  RLS, grants, `UNIQUE (provider_id, group_id)`, FK indexes, partial unique
  ONE `is_primary` per provider; constraint probes ran rollback-wrapped on
  hosted) and `20260712120100_state_license_psv.sql` (PSV trail on
  `state_licenses`: `verified_status unverified|verified|failed` CHECK +
  `verified_at`/`verified_by`/`verification_source_url`). `types.ts`
  regenerated; table register updated. **`providers.group_id` is a FROZEN
  legacy mirror** of the primary assignment — no new readers; all new group
  reads go through `provider_group_assignments`
  (`listProviderGroupAssignments` → `useProviderGroupAssignments`). Pure rule
  modules (tested): `src/lib/groupAssignments.ts` (≥1 assignment, exactly one
  primary, `planAssignmentSync` demote→delete→promote→insert order so the
  partial unique never trips) and `src/lib/licensePsv.ts`
  (`resolvePsvColumns` — verify/fail REQUIRES the board URL, stamps
  verified_at/by service-side, **expiration edit resets to unverified**).
  `createProviderWithDetails`/`updateProviderWithLicenses` gained
  `groupAssignments` + PSV threading; `LicenseInput` carries
  `verifiedStatus`/`verificationSourceUrl`. Wizard section:
  `ProviderRosterSection` (non-terminated list — name/NPI/groups/license
  states + soonest expiry/CAQH date; terminate via the existing
  `terminateProvider`, never a row delete) + `ProviderRosterForm` (CAQH
  baseline: required name/NPI/≥1 group with one primary; SSN LAST-4 only,
  maxLength-guarded; no status picker; licenses via `LicenseListEditor` +
  `licenseDraft.ts`). Progress stays ROW-PRESENCE per the epic TE-8 (not
  active-filtered like groups/facilities). Roster summaries read the narrow
  `listOrgStateLicenses` projection (`useOrgStateLicenses`) — the provider
  list projection stays PHI-safe. Account Detail gained `RosterSummaryCard`.
  Seed: TS-35 L3 fixture (Brooke Ostrander on Outer Banks, primary
  assignment, verified-NC + unverified-SC licenses) appended to
  `seed-redesign.sql`. e2e: `e2e/provider-roster.spec.ts` (TS-33/34/35).

- **E1.4 — Provider–Facility Assignment.** The FIRST R3 preview to activate:
  "assignments" moved from preview to ACTIVE in the wizard registry
  (`ActiveSectionKey` gained it; `NextActionCard`'s all-complete handoff now
  names the first remaining preview dynamically). NO column migration —
  `start_date`/`is_primary` existed on `provider_facility_assignments`
  (epic-body claim corrected by its TE-1). Three additive migrations
  (repo + hosted): `20260712150000` `CHECK (start_date IS NOT NULL) NOT
VALID` (validate later, after legacy-null remediation through this UI),
  `20260712150100` **`set_primary_assignment` RPC** (SECURITY DEFINER,
  pinned search_path, writer-membership + ownership checks, atomic
  demote+promote — two PostgREST calls are NOT atomic under the one-primary
  partial unique), `20260712150200` audit CHECK widened with `'DELETE'`
  (assignment removal is a hard delete by R3 decision, audited). ONE write
  path now: `src/services/providerAssignments.ts`
  (`listOrgAssignments`/`insertAssignmentRows`/`setAssignments` diff sync —
  updates→deletes→inserts-as-nonprimary→RPC swap —/`setPrimaryAssignment`);
  the legacy writers (`createProviderWithDetails`,
  `launches.assignProviderToFacility`) route through `insertAssignmentRows`.
  Pure rules in `src/lib/assignmentScope.ts` (tested):
  `facilitiesForProviderGroups` (group-scoped picker — ungrouped/inactive
  facilities never offered), `validateAssignmentDrafts` (start date required;
  exactly one primary when non-empty ⇒ removing the primary forces a
  re-pick), `planFacilityAssignmentSync`. Progress:
  `resolveAssignmentsStatus` = every non-terminated provider has ≥1
  assignment (in_progress is reachable here). UI:
  `AssignmentSection` (unassigned-first list, chips with start date +
  primary star, one-click Make primary via RPC) + `AssignmentEditor`
  (checkbox picker + per-location `DatePicker`). **Date-picker enabler
  (TE-6):** stock-shadcn `ui/calendar` + `ui/popover` vendored (registry
  unreachable in-sandbox) + `react-day-picker@9` / `@radix-ui/react-popover`
  deps + shared `src/components/DatePicker.tsx` (modal popover — non-modal
  portals are pointer-locked inside dialogs) — all logged in DESIGN-DEBT.md.
  `FacilityAssignment.startDate` added additively; `practice_frequency`
  stays untouched/unwritten. e2e: `e2e/assignments-wizard.spec.ts`
  (TS-39/TS-40); TS-25/28/33 fixtures updated for the activated section.

- **E1.6 prep — payer reference dataset (data only, no epic code).** PM
  direction 2026-07-12: build the Stedi-equivalent identity data ourselves
  instead of the F1.6.2 API sync. `docs/redesign/data/payer-catalog/` holds
  five CSVs + README: `state_payer_rankings.csv` (top-10 medical payers × all
  50 states, 491 rows — dental/vision/PDP/supplemental excluded; share
  sources labeled, nulls over invented numbers, thin markets not padded),
  `payers.csv` (270 canonical entities in the E1.6 TE-2 shape — aliases,
  states[], kind, canonical `payer_slug`; the clearinghouse-payer-ID column
  is retained in the CSV but **ignored** per the 2026-07-12 PM decision —
  not used by the work, no planned future use),
  `mso_delegations.csv` (delegation vs UM-only — **UM-only rows must never
  become MSO credentialing routing rules**), `medicare_macs.csv` +
  `state_medicaid_programs.csv` (the universal implicit payers). E1.6 itself
  was unblocked 2026-07-12 ([e1.6] resolved — Stedi withdrawn); F1.6.2 seeds
  from this dataset (quarterly manual refresh per the README), deduping on
  the unique `payers.payer_slug` column — not `stedi_payer_id`, which was
  dropped from the epic.
- **E1.6 — Global Payer Catalog (Commercial).** Built on the reference
  dataset per the FINAL [e1.6] shape: Stedi withdrawn AND clearinghouse payer
  IDs dropped entirely — **`payers.payer_slug` (canonical dataset key, partial
  UNIQUE where not null) is the identity + sync dedupe key**; the CSV's
  clearinghouse-ID column is ignored. THREE additive migrations (repo +
  hosted, `20260712180000`–`180200`): TE-2 identity columns on `payers`
  (`payer_kind` CHECK w/ six kinds default `commercial`, `status
active|merged|retired`, `aliases text[]`, `states text[]`, `payer_slug` +
  unique index `uq_payers_payer_slug`, dormant
  `prerequisite_payer_id`/`merged_into_id`, `cms_hios_id`, `last_synced_at`);
  TE-3 `payer_catalog_changes` (append-only diff log — authenticated
  shared-queue SELECT like `inbound_leads`, NO authenticated writes; grants
  enforce diff-fact immutability); the two RPCs — **`list_global_payers`**
  (SECURITY DEFINER read: the P2 RLS disjunction only shows ASSIGNED global
  rows to an org and TE-1 forbids touching it, so the browse-everything
  directory reads through this instead of a policy change) and
  **`review_payer_catalog_change`** (accept applies to an IDENTITY-FIELD
  whitelist — name/aliases/states/cms_hios_id/status, never the slug or
  curated fields — + stamps reviewed_by/at; reject records; double-review
  rejected; probes ran rollback-wrapped on hosted). **Seed pipeline
  (F1.6.2):** `scripts/payer-catalog-sync.mjs` (plain-JS, node-runnable;
  typed via `payer-catalog-sync.d.mts`; unit-tested from
  `src/lib/payerCatalogSync.test.ts`) parses `payers.csv` → plans
  inserts/diffs (`planCatalogSync`: match by `payer_slug`; name-match
  fallback ONLY to backfill slugless legacy rows; changed fields become diff
  rows, NEVER overwrites; disappeared payers reported only) → emits
  idempotent SQL (`ON CONFLICT (payer_slug)`). **All 270 entities are seeded
  on hosted with slugs**; live TS-37 re-plan = 0 inserts / 0 diffs.
  (**RETIRED by E6.7 PR 2** — the script, its `.d.mts`, and
  `payerCatalogSync.test.ts` are deleted and the dataset README is frozen;
  this paragraph is history.)
  **App layer:** `Payer` type widened additively (`PayerKind`, catalog
  fields optional incl. `payerSlug`) + `PayerCatalogChange`; cross-org keys
  `payerCatalog()`/`payerCatalogChanges()`; `src/services/payerCatalog.ts`
  (RPC-bound reads, review via RPC — the diff row IS the audit trail; no
  org-scoped writeAudit by design) → `src/hooks/usePayerCatalog.ts`; pure
  `src/lib/payerDirectory.ts` (`filterDirectoryRows` name+alias search,
  state/kind filters, `DEFAULT_DIRECTORY_KIND = commercial`; tested).
  **`/payer-directory` route** (hand-rolled table showing the catalog key
  (slug), kind/status pills via the legacy `StatusPill`, review panel
  `PayerCatalogChangesPanel` renders only when unreviewed diffs await) —
  **no Sidebar entry** (layout/* not §5-authorized; TD-32 in TECH-DEBT.md).
  Seed-redesign gained the six-state global fixtures + a TS-38 rename diff.
  e2e `e2e/payer-directory.spec.ts` (TS-36/TS-38). E1.5 and E1.8 are now
  unblocked.

- **E1.5 — Payer Network Attachment.** ONE additive migration (repo + hosted,
  `20260712190000_payer_network_targets.sql`): **`payer_network_targets`** —
  the group×payer×state attachment grain under the org-level "we work with
  this payer" intent, DISTINCT from the `org_payer_assignments` subscription
  layer (locked [stage-1b] split; org_id denormalized on purpose for RLS).
  `UNIQUE (group_id, payer_id, state)`, `status active|archived` CHECK,
  `^[A-Z]{2}$` state CHECK, FK cover indexes; RLS = member SELECT / admin
  writes with STRICTER WITH CHECKs (group must belong to the org AND an
  `org_payer_assignments` row must exist — a multi-org admin can't cross
  tenants or attach outside the curated shortlist). Probes ran
  rollback-wrapped on hosted; types regenerated; table-register row added.
  **Pure module `src/lib/payerExpansion.ts`** (tested): `expandTargets`
  (active groups × states-with-≥1-active-facility ∩ payer `states[]`),
  `reviewExpansion` (annotates vs existing targets; archived rows
  PRE-UNCHECKED), `planAttachmentSave` (unchecked excluded; archived+checked
  → restore, never a duplicate insert; active rows never rewritten),
  `newExpansionRows` (TE-7 derived "new expansion available" — never a
  stored flag). **Service `src/services/payerNetworkTargets.ts`** (audited
  `payer_network_target` entity type; archive/restore are STATUS FLIPS —
  never DELETE, TE-5) → `src/hooks/usePayerNetworkTargets.ts`
  (`queryKeys.payerNetworkTargets(orgId)`). **Wizard:** `payer_network`
  moved preview→ACTIVE (`resolvePayerNetworkStatus` = ≥1 active target;
  Scope Review is now the only preview); `useOnboardingWizard` gained
  payers/payerAssignments/payerNetworkTargets. UI in
  `src/components/payers/`: `PayerNetworkSection` (attached list with
  target chips, per-target + payer-level archive, archived view w/ one-click
  Restore + Re-attach, TE-7 review affordance, curated-shortlist empty
  state) + `AttachPayerDialog` (picker = `listPayers` ∩
  `org_payer_assignments` — never the full catalog; F1.5.4 prerequisite
  note informational only; expansion review = `ui/table` + checkboxes,
  facility-count reasons, empty-expansion explainer). NO seed change
  (seed-universe pins TS-41/42 as L1 on the TS-36 fixtures). e2e
  `e2e/payer-network.spec.ts` (TS-41/41b/42); `onboarding-wizard.spec.ts`
  TS-25/28 updated for the activated section. E2.x case generation reads
  `status='active'` rows; E1.8 readiness evaluates against them.

- **E1.8 — Enrollment Readiness (CLOSES Stage 1 / R3).** NO schema change —
  a pure derivation over R1–R3 data (TE-4 confirmed the existing
  `provider_documents_doc_type_check` already carries w9/coi/voided_check).
  **Pure evaluator `src/lib/enrollmentReadiness.ts`** (+21-case test suite;
  deliberately NOT `launchReadiness.ts`, which stays location-launch):
  rows at the E2.x case-key grain (provider×group×payer×state) from ACTIVE
  `payer_network_targets` × the group's roster; provider checklist (license
  present/unexpired/PSV-verified per target state — verified row preferred
  over stale duplicates; CAQH ID; CAQH attested ≤ `CAQH_CURRENT_DAYS` 120,
  boundary-tested 119/120/121; NPI; demographics PRESENCE; malpractice end
  date) + group checklist computed ONCE per (group, state) and fanned out
  (TE-7 — the check objects are shared by identity): state facility, W-9,
  COI (insurance policy end date OR current coi doc), voided check. All
  date math date-only vs a passed-in `today` (never a clock read in the
  lib). `readinessForCaseKey` is the DOCUMENTED E2.0 soft-warn interface
  (nothing calls it to gate anything in R3); `filterReadinessRows` backs
  the F1.8.1 filters. **PHI boundary (TE-9):** `src/services/
enrollmentReadiness.ts` reads DOB/ssn_last4/home-address columns ONLY to
  reduce them to presence booleans in the service — values never enter the
  cache or render. That service is the FIRST app consumer of the dormant
  `provider_documents` (group rows, doc_type ∩ w9/coi/voided_check) and
  second of `group_insurance_policies` — read-only, no documents surface
  (PM [e1.8] Option 3: doc/COI/voided red items soft-link to Account
  Detail; checks with a wizard editor deep-link their section via
  `openSection`). Hook `src/hooks/useEnrollmentReadiness.ts` (3 new
  org-scoped keys + the existing wizard caches; `localTodayIso`).
  **Wizard:** `scope_review` moved preview→ACTIVE — ALL seven sections are
  now live; `PreviewSectionKey` is `never` (machinery kept for future
  stages) and `NextActionCard`'s all-complete state stands alone ("Case
  generation arrives in the next stage"). `resolveScopeReviewStatus` =
  not_started (0 rows) / in_progress (gaps) / complete (all ready) —
  informational chip; readiness itself is ADVISORY and never disables
  anything, and NO tasks are auto-created from gaps.
  `src/components/onboarding/ScopeReviewSection.tsx`: `ui/table` matrix
  (Ready = `--mp-ok-*` badge, gaps = `--mp-danger-*`), per-row
  `ui/collapsible` drill-in (tbody-as-Root pattern) with provider/group
  checklists + fix-here links, group/payer/state/gap-type `ui/select`
  filters, "x of y ready". e2e `e2e/scope-review.spec.ts` (TS-43 PSV flip
  re-derives with ZERO writes recorded; TS-44 group state gap + stale CAQH
  advisory, no disabled controls, no task writes); `onboarding-wizard`
  TS-25/28 updated (no "Coming next" anywhere; all-complete requires a
  fully-ready matrix). No seed change (TS-43/44 are derived views per
  seed-universe).

### Stage 2 built so far

- **E1.7b — SOP-as-Data: Versioned SOP Authoring (Model A).** Migration
  `20260713120000_sop_template_versions.sql` (repo + hosted): immutable
  `sop_template_versions` (no `org_id` — SELECT scopes through the parent's
  visibility disjunct; authenticated has SELECT ONLY),
  `sop_templates.current_version`, `tasks.sop_template_id`/`sop_version`
  (nullable + both-or-neither CHECK + composite FK — DDL only, E2.2 writes
  them), version-1 backfill, and an AFTER INSERT trigger
  (`sop_template_seed_version`) so EVERY insert path (wizard create,
  Duplicate, service-role seeds) yields its version-1 row — the invariant
  "every head has a version row for `current_version`" is true by
  construction. **Publish is the `publish_sop_template_version` RPC**
  (SECURITY DEFINER, ADMIN-only for org rows — NOT writer; global rows
  service-role-only; optimistic concurrency `WHERE current_version =
p_expected_version`; the RAISE prefix `sop_version_conflict` is the wire
  contract `src/services/templates.ts` maps to `SopVersionConflictError`;
  the RPC writes the audit row — the service must NOT also `writeAudit`).
  **TE-5 save split:** wizard content (name + task definitions) goes through
  Publish (change-note dialog, friendly conflict toast); match-key edits
  (payer/state/specialty/group) stay on the plain audited head update, no
  version bump. Version history + read-only per-version view:
  `TemplateVersionHistory.tsx` + shared `TemplatePreviewTasks.tsx` (also the
  wizard Review step). **Step-shape extension** (authorized protected edits):
  `SOPStepType` += `fax|phone|mail`; optional `expectedTurnaroundDays`/
  `followUpEveryDays`/`requiredArtifacts` on `SOPStep` + definition steps;
  `sopResolver.ts` carries all three verbatim (portalKey precedent) and
  `buildTokenMap` gained catalog aliases (`license.licenseNumber`,
  `facility.street/city/state/zip`); token-less attachment names belong in
  `requiredArtifacts` (a `dataFields` entry without a resolvable token is
  filtered at resolution). `resolvableTokenKeys()` (sopResolver) +
  `filterAuthoringTokens` (`src/lib/sopAuthoringTokens.ts`) constrain the
  wizard's token picker to resolver-resolvable tokens (picker ⊆ map, tested);
  the full catalog stays for mapping review / extension profile fill.
  **Global fallback SOP** (`[r4]` Q4): `sop_templates_select` gained a third
  disjunct `(org_id IS NULL AND payer_id IS NULL)` — payerless global SOPs
  visible to ALL orgs (PM-confirmed); exactly one seeded (fixed UUID
  `00000000-0000-4000-a000-00000000e17b`, mirrored as
  `FALLBACK_SOP_TEMPLATE_ID`); `pickTemplate` gained the third tier (exact →
  payer+state → fallback via the `isFallbackTemplate` shape check), so
  NewCaseModal / launch CreateCasesDialog / starterCases now resolve the
  generic checklist for no-SOP payers (PM-confirmed live-before-E2.x).
  `getTemplate` reads own-org OR global (fallback opens read-only — the
  wizard renders any global row read-only even for admins). Templates list
  labels the fallback. CaseWizard renders fax/phone/mail as plain steps
  (label/detail/fields + turnaround/cadence/artifact metadata, no portal
  affordances). e2e `e2e/sop-versioning.spec.ts` (TS-45/46/47 slices; its
  mock harness applies generic `eq.` filters — this repo's supabase-js
  `maybeSingle` fetches arrays with `Accept: */*` and errors client-side on

  > 1 rows, so fixture handlers MUST honor filters).

  **F1.7b.5 amendment — structured draft-email recipients (2026-07-16, NO
  migration, TE-18).** A `draft_email` step now versions structured **To** +
  optional **CC** recipients with its subject/body (BCC/auto-send out of scope).
  Additive types (`types/index.ts`): the discriminated authored
  `SOPEmailRecipient` (`{source:'literal',address}` | `{source:'token',token}`)
  and the resolved `ResolvedSOPEmailRecipient` (token keeps `token` + resolved
  `address|null`) + `ResolvedSOPEmailTemplate`; `SOPStep.emailTemplate` is now
  the RESOLVED carrier while `SOPTaskDefinition.steps[].emailTemplate` stays the
  AUTHORED `SOPEmailTemplate` (which gained optional `to`/`cc`). `sopResolver.ts`
  (authorized additive edit) gained **`emailValuedTokenKeys()`** — the closed
  recipient-token set = `{provider.email}` only, a STRICT subset of
  `resolvableTokenKeys()` (payer.\* has no resolver value and is never a
  recipient) — and resolves recipients alongside subject/body: a literal is
  carried verbatim, a token is looked up in `buildTokenMap`, and an empty
  `provider.email` becomes `address:null` — an explicit fill-before-send gap,
  never dropped and never blocking generation (AQ1). Authoring carry-chain:
  `editableTemplate` round-trips `to`/`cc` (written only for `draft_email`,
  blank rows dropped, source-faithful) via `EditableRecipient` +
  `newEditableRecipient`; `TemplateTaskRow` renders a To (≥1) / optional CC
  editor — each row a "Recipient source" select → literal-address input
  (`isValidEmail`) or an email-valued token select; the Review step chips each
  recipient (`TemplatePreviewTasks`). `sopPublishLint` requires ≥1 valid To per
  draft-email step (validates SOURCE, not value — an authored `provider.email`
  is valid pre-generation; legacy immutable versions are never re-linted).
  `gmailCompose.planGmailHandoff` now takes `to`/`cc` (comma-joined params; the
  over-long-URL fallback keeps recipients + subject and drops only the body to
  the clipboard); `CaseWizard`'s `DraftEmailStep` renders resolved To/CC with
  provenance ("Email address" / the token) + the amber gap and threads resolved
  addresses into the hand-off. Human-in-loop only: no BCC, no auto-send (pinned
  by a code-level assertion in `gmailCompose.test.ts`), and NO `/api` projection
  change — resolved To/CC ride `tasks.sop_content` for a future extension
  consumer, but extension email execution stays deferred to E4.3 (TE-20). e2e
  `e2e/sop-email-recipients.spec.ts` (authoring→Review→publish payload; resolve
  →Gmail to/cc + the unresolved gap).

- **E2.0 — Case Generation Preview & Exclusions.** ONE additive migration
  (repo + hosted, `20260713130000_case_generation_exclusions.sql`):
  **`case_generation_exclusions`** — persistent reasoned exclusions at the
  4-part case grain (provider × group × payer × state); reason CHECK
  (`already_credentialed|panel_closed|not_pursuing|other`, `other` requires a
  note), partial `UNIQUE ... WHERE status='active'`, **restore = void
  (`status`/`voided_by`/`voided_at`), never DELETE — no DELETE grant**; RLS
  member SELECT / ADMIN-only writes ([r4-review] Q2) with same-org
  provider+group WITH CHECKs. **Pure module `src/lib/generationPreview.ts`**
  (+18-case suite): candidate = active `payer_network_targets` × un-ended
  group membership **further filtered to providers with ≥1
  `provider_facility_assignments` row at a facility of the group**
  (presence-based, the [r4-review] Q1 candidacy — a strict subset of the E1.8
  readiness universe, so every candidate joins a readiness row);
  existing-case matching is the TE-6 two-branch rule (NULL-group case covers
  all groups at its 3-part key — every pre-E2.1 row; group-stamped covers its
  exact 4-part key); dispositions `proposed|existing|excluded` with
  human-readable derivation reasons; suppression is status-linked and derived
  live (`existingCaseIndicator`: non-complete bucket → "already exists — in
  progress", complete bucket → "already exists — {label}" + reapply flag; the
  reapply LINK is E2.1 scope). **E1.8 evaluator gained an OPTIONAL
  `contracts` input** (TE-8, the delegated Q3a decision): a per-target
  `group_contract` check (pass = label canonicalizes to `CONTRACTED_LABEL`)
  appended only when the input is passed — every existing caller is
  bit-for-bit unchanged; only the E2.0 preview passes it. Service layer:
  `src/services/caseGenerationExclusions.ts` (list/create/void, audited —
  audit payloads carry ids + reason, NEVER the note) +
  `src/services/generationPreview.ts` (the two narrow projections:
  `credential_cases` `id/provider_id/payer_id/state/credentialing_status_id`
  — `groupId` mapped null until E2.1 adds the column — and `contracts`
  keys + `contracting_status_id`, labels resolved against the status_configs
  cache in the hook). Composition hook `src/hooks/useGenerationPreview.ts`
  (+ exclusions CRUD hooks; keys `caseGenerationExclusions` /
  `generationCaseRows` / `generationContractRows`): ONE
  `evaluateEnrollmentReadiness` pass joined to preview rows by the 4-part key
  (TE-9 — never `readinessForCaseKey` per row; missing key renders neutral
  "No readiness data", never green). UI `src/components/generation/`
  (`GenerationPreviewContent` — checklist table, checked-by-default,
  grayed non-selectable existing rows, collapsible Excluded section with
  one-click Restore; `ExclusionReasonDialog` — uncheck prompts reason,
  cancel = stays checked) on the **`/generation` route** (no Sidebar entry —
  layout/* not §5-authorized), entered via a "Generate applications" button
  on the Scope Review wizard section. Nothing is stored at preview time
  (TE-11): delta runs are recomputation; NOTHING is created from the preview
  (confirm & create is E2.1). Non-admins get disabled checkboxes and no
  Restore. `CaseGenerationExclusion` type added; e2e
  `e2e/generation-preview.spec.ts` (TS-48/TS-49; its handler WRITES THROUGH
  exclusion POST/PATCH into the fixtures so the invalidate-and-refetch loop
  runs for real).

- **E2.1 — Case Creation & the 4-Part Case Key.** THREE additive migrations
  (repo + hosted, `20260713150000`–`150200`). **THE key migration
  (`150000`, F2.1.1):** safety-net backfill of NULL-group cases in the TE-1
  deterministic order — facility→group, sole `provider_group_assignments`
  row, `is_primary` row, else NULL (a no-op on hosted: 61/61 rows already
  grouped; rule mirrored + tested in `src/lib/caseKeyBackfill.ts`) — then the
  constraint swap: `credential_cases_provider_id_payer_id_state_key` dropped,
  **`credential_cases_provider_group_payer_state_key UNIQUE NULLS NOT
DISTINCT (provider_id, group_id, payer_id, state)`** added (PG 17.6;
  provider_id kept leading for FK index coverage; coexistence + both
  duplicate rejections probed rollback-wrapped on hosted). `dbErrors.ts`
  learned the new fragment (TE-4) and 23505 now returns a typed
  `UniqueViolationError` the confirm loop classifies on. **`150100` (TE-2):**
  `case_generation_runs` (who/when/counts; member SELECT / WRITER insert /
  IMMUTABLE by omission — no UPDATE/DELETE policy or grant) +
  `credential_cases.generation_run_id` FK + partial cover index. The run row
  is inserted BEFORE the loop (created cases FK it), so its stored counts are
  the confirm-time plan; ACTUAL outcomes go in the run's audit row AND — since
  E2.4 — the immutable `case_generation_run_rows` disposition child rows,
  which supersede both at read time (its TE-1). **`150200` (TE-3 + E2.2 stamp
  transport):** `create_case_with_tasks` reissued with `generation_run_id` on
  the case insert and per-task `sop_template_id`/`sop_version` threading
  (`CaseTaskPayload` carries them optionally; every SOP-resolving surface
  populates them since E2.2). **Confirm & create (F2.1.2):** writer-gated button on `/generation` →
  `useConfirmGeneration` resolves tasks per proposed row via the SAME
  `pickTemplate`/`resolveTemplate` tier (facility null, NO MSO routing — not
  in the TE-7 trace) → `src/services/generationConfirm.ts` loop (per-row RPC
  transactions; `UniqueViolationError` → skipped_existing — a concurrent
  duplicate degrades to a skip; partial failure reports failed rows and stays
  on the preview) with plan/summary logic pure in
  `src/lib/generationConfirm.ts` (+tests); run insert isolated in
  `src/services/caseGenerationRuns.ts` (the ONE counts boundary — repointed
  by E2.4: run-history counts derive from the disposition child rows at read
  time). Full success landed on `/cases?runId=<id>` until E2.3: confirm
  now lands on **`/work?run=<id>`** (F2.3.2); the `/cases?runId=` filter
  stays URL-reachable (validateSearch + banner + clear — old links live).
  `listGenerationCaseRows` now selects the real `group_id` (TE-6 two-branch
  match live for post-E2.1 rows). **Reapply (F2.1.3):** `existingCaseIndicator`
  now flags DENIED (bucket 'ours', canonicalLabel-matched) as reapply →
  grayed preview row links "reapply from the case" → case detail renders
  `ReapplyCaseAction` (Denied only, writers): Denied → **In Progress**
  ([r4-review] Q6) via the existing `updateCaseStatus` (status_history +
  audit) then `appendCaseTasks` (new in `cases.ts` — RPC-shaped task inserts
  appended AFTER existing sortOrders, audited "on reapplication"); never a
  second case. NB `updateCaseStatus` metadata keys become UPDATE columns —
  reapply passes `{}`. **Manual one-off (F2.1.4):**
  `src/components/cases/ManualCaseModal.tsx` from "New case" on `/cases`
  (writers): provider → groups from un-ended `provider_group_assignments`,
  payer = FULL org-visible catalog (deliberately not targets-filtered), state
  from `US_STATES`; pre-check blocks on the TE-5 two-branch key match with a
  link to the case; `generationRunId` unset (run-less); DB constraint stays
  the backstop. **F2.1.5 (negative):** NO prerequisite-payer logic anywhere —
  pinned by a code-level unit assertion over the generation pipeline modules
  (`generationConfirm.test.ts` greps comment-stripped sources). Docs retired
  to the live 4-part rule: AGENTS.md data rule, table-register (¶, row, grain
  rule + `case_generation_runs` row), SCHEMA.md. e2e
  `e2e/case-creation.spec.ts` (TS-50 ×2 incl. the 23505 race, TS-51, TS-52;
  its harness write-throughs the RPC — enforcing NULLS-NOT-DISTINCT
  uniqueness — runs/tasks/status_history/case-PATCH, and synthesizes
  PostgREST embeds for case-detail reads **on the array path too**: this
  repo's supabase-js `maybeSingle`/`single` fetch arrays with `Accept: */*`).

- **E2.2 — SOP Resolution & Version Stamping at Generation.** NO migration and
  no table-register change (TE-8: the stamp columns landed in E1.7b, the RPC
  transport in E2.1). **Every SOP-resolving creation surface now stamps its
  tasks** with `(sop_template_id, sop_version)` via the pure
  `src/lib/sopStamp.ts` (+tests): `templateStamp`/`stampTasks` implement the
  TE-2 contract — the stamp is the head-row snapshot the resolver consumed
  (`listTemplates` returns `current_version` with the content in one
  statement), NEVER a re-read that could race a publish; a missing/invalid
  `currentVersion` yields NULL/NULL (both-or-neither), never a guessed
  version. Six call sites: `useConfirmGeneration` (generation confirm),
  `NewCaseModal`, launch `CreateCasesDialog`, `providers.new.tsx` starter
  cases, `ManualCaseModal` (the pre-R4 surfaces stamp too, PM Q2), and
  `ReapplyCaseAction` (F2.2.3 — the appended cycle restamps at the CURRENT
  `pickTemplate` selection, so a payer SOP authored since the original
  generation beats the fallback; the prior cycle's tasks/stamps untouched).
  Non-SOP task writers (follow-up, termination) legitimately stay NULL/NULL.
  `Task` gained `sopTemplateId`/`sopVersion` (sanctioned additive protected
  edit, TE-5); `TASK_LIST_COLUMNS` carries both columns (id columns only —
  the TE-7 chip data path over the already-loaded tasks cache). **Case
  surface (TE-7):** `src/components/cases/CaseSopProvenance.tsx` on case
  detail — one "Generated from <name> v<N>" line per distinct stamped pair
  (`distinctStampPairs`), name read from the IMMUTABLE
  `sop_template_versions` row (a head rename never rewrites history), opening
  `TemplateVersionHistoryDialog` (new additive `initialViewing` prop) on that
  version; fallback-stamped pairs carry the neutral "Generic SOP" pill
  (structural `isFallbackTemplate` identity); an unresolvable stamp renders
  neutral "version unavailable"; legacy NULL tasks render unchanged.
  **"Using generic SOP" chip (F2.2.2):** the /cases work view's filter cards
  moved to the URL-driven `?chip=` idiom
  (`?chip=needs|inprog|awaiting|generic`, no param = all — deep-linkable like
  /providers) and gained the fifth chip: open cases with a fallback-stamped
  task (`fallbackTemplateIds`/`caseIdsUsingGenericSop` — derived from stamps,
  never stored). Service round-trip pinned in
  `src/services/cases.stamp.test.ts`; e2e `e2e/sop-stamping.spec.ts` (TS-53
  publish straddle incl. immutable-name provenance, TS-54 fallback → chip →
  later payer SOP → reapply restamp).

- **E2.3 — Next-Best-Action Queue (Post-Generation Landing).** NO migration,
  no table-register change — a fully DERIVED, read-only surface (TE-10:
  nothing stored, nothing written, no audit rows). **Pure module
  `src/lib/nextBestActions.ts`** (+23-case suite; the module docstring IS the
  documented tie order): ONE entry per open case (open = `action_bucket` not
  'complete', status-less counts as open — TE-3), ranked by the earliest
  applicable TE-1 deadline signal: provider start (`providers.start_date`;
  the earliest FUTURE `pfa.start_date` stands in ONLY where that is null;
  past start dates are history and never rank), location launch
  (`facilities.effective_date` >= today, rank-if-present, reachable via
  `case.facility_id` ∪ the provider's assignments), earliest OPEN-task due
  date (overdue still ranks), the latest touchpoint's explicit
  `next_follow_up_date`, and SOP cadence (min `followUpEveryDays` across ALL
  the case's tasks' steps — completed included, that's when cadence starts
  mattering; clock = last touchpoint else case `created_at`; notes/system
  events never reset it). Ties: date → source order → case `created_at` →
  case id; no-signal entries rank after all dated work (the queue is total).
  Recredentialing = the named TE-1 gap, joins when R9 models it. Action
  precedence: readiness gap (ONE `evaluateEnrollmentReadiness` pass incl. the
  E2.0 contracts input, joined by 4-part key; legacy NULL-group cases never
  match) → "touch due" when a follow-up/cadence date has ARRIVED (<= today,
  so logging a touch re-derives it away — F2.3.3) → lowest-sort_order open
  task → honest "review" fallback. **Service
  `src/services/nextBestActions.ts`:** two narrow reads — providers
  (id/name/start_date, the clientProgress PHI pattern) and tasks
  (`sop_content` reduced to `cadenceDays` at the boundary; the jsonb never
  enters the cache); their keys ride the domain prefixes
  (`["tasks"|"providers", orgId, "queue-projection"]`, the useLastTouchDates
  idiom) so every existing invalidation re-derives the queue.
  `caseGenerationRuns.ts` gained the `getGenerationRun` read (banner). Hook
  `src/hooks/useNextBestActions.ts` composes ~16 org caches (the
  useGenerationPreview pattern). **UI:** the reserved `/work` leaf is ACTIVE
  — PageHeader "My Cases", `?run=<uuid>` search (URL-state, shareable;
  clearing = param removal) rendering
  `src/components/work/NextBestActionQueue.tsx` (row-card list, destructive
  tint ONLY on overdue pills, batch banner composed from card tokens + the
  tabs batch/all toggle — DESIGN-DEBT row; empty state links `/generation`).
  **Sidebar gained "My Cases"** → `/work` (the epic's ONE authorized shell
  edit, TE-8; label per [r4-review] Q9). Generation confirm now lands on
  `/work?run=<id>` — F2.3.2 supersedes the E2.1 interim `/cases?runId=`
  landing, which stays URL-reachable. e2e
  `e2e/next-best-action-queue.spec.ts` (TS-55, TS-56 — logs a real touch
  through the case-detail flow and pins the spine read-only; its harness
  honors `order=` since the latest-touchpoint read depends on it);
  `legacy-routes` moved `/work` to the rendering set; `sidebar-ia` pins the
  new entry; `case-creation` TS-50 asserts the new landing.

- **E2.4 — Generation Traceability & Audit (CLOSES R4).** ONE additive
  migration (repo + hosted, `20260713170000_case_generation_run_rows.sql`):
  **`case_generation_run_rows`** — the immutable per-candidate disposition
  ledger, one row per 4-part key per run (`UNIQUE (run_id, provider, group,
payer, state)`), disposition CHECK (`created|skipped_existing|excluded|
failed`; created requires `case_id`, excluded/failed require `reason`),
  INSERT-only by policy shape AND grant floor (TE-2 — no UPDATE/DELETE
  anywhere; probes ran rollback-wrapped on hosted); writer INSERT carries
  same-org run/provider/group WITH CHECKs; `case_id` links created AND
  blocking cases (SET NULL), `exclusion_id` SET NULL + the `reason` snapshot
  (never the note, no PHI — TE-8) so run detail degrades, never dangles.
  Types regenerated; table-register row added (ledger layer). **Confirm loop
  writes (TE-2/TE-11 additive edits to `generationConfirm.ts`):**
  skipped_existing (blocking `case_id`) + excluded (exclusion link + reason
  label) rows recorded right after the run insert; created/failed rows as
  each RPC resolves via `recordGenerationRunRows`
  (`caseGenerationRuns.ts`) — a mid-batch crash leaves an honestly short
  record ("run ended early" in detail; no mutable run status). **Counts
  derive from the child rows at read time** (`src/lib/generationRuns.ts`
  `deriveRunCounts` — zero rows falls back to the stored plan, FLAGGED
  "plan counts"; + `runRecordStatus`, `caseOrigin`, `deriveTaskCycles` —
  tolerates a missing `createdAt`; all tested). **Run history (F2.4.1,
  [r4-review] Q10 — NO nav item):** "Run history" action on `/generation` →
  **`/generation/runs`** list + **`/generation/runs/$runId`** detail
  (`generation_.runs*` route files — the `admin.payers_` un-nesting idiom;
  `RunHistoryContent`/`RunDetailContent` in `src/components/generation/`);
  detail lists every row's disposition + confirm-time reason, created/
  blocking rows link the case, excluded rows render the exclusion's reason +
  current state (still excluded / since restored). Reads:
  `src/services/generationRuns.ts` (runs + actor names via profiles, one
  run's rows, ONE org-wide dispositions projection for list counts) →
  `src/hooks/useGenerationRuns.ts` (keys `generationRuns`/
  `generationRunRows`; the confirm mutation invalidates both prefixes).
  **Case provenance (F2.4.2):** `CaseProvenancePanel` on case detail
  EXTENDS (composes) the E2.2 `CaseSopProvenance` — run deep link or the
  distinct "Created manually by X" origin (NULL run id) + actor/date
  (`getCase` now resolves `created_by` in its existing profiles fetch →
  `CaseDetail.createdByName`), plus the DERIVED reapply-cycle line (task
  creation clusters + version stamps, TE-6 — never stored). **Audit spine
  (F2.4.3): zero new writes** — verified coverage: run confirm (E2.1
  `writeAudit`), per-case/task CREATE (inside the RPC), exclusion
  add/restore (E2.0 service), reapply (STATUS_CHANGE + task CREATEs); no
  double-writing. e2e `e2e/generation-traceability.spec.ts` (TS-57
  mixed-disposition run over TS-48/50-style states, no new baseline
  fixtures: disposition rows asserted at the wire, INSERT-only pinned,
  derived counts, links both ways, manual-vs-run origin, audit rows for
  confirm/create/exclude — its RPC emulation synthesizes the RPC's own
  audit rows).

### Stage 3 built so far

- **E3.0 — Bulk Roster Import: Intake, File Gate & Async Processing.** ONE
  additive migration (repo + hosted, `20260713180000_import_runs_rows_staging.sql`):
  **`import_runs`** (durable run header — `source internal|onboarding`, `state
uploading|scanning|ready_for_review|committed|failed|cancelled`, counts,
  `error_report` jsonb; a WORKING table: member SELECT, ADMIN-only
  INSERT/UPDATE, no DELETE grant) + **`import_rows`** (one row per parsed
  source line, `UNIQUE (run_id, line)` = the idempotent resume key,
  `raw`/`mapped` jsonb PII under org RLS; ADMIN INSERT/DELETE — rows are
  PURGED on commit/cancel, TE-7) + the batched **`stage_import_rows` RPC**
  (SECURITY DEFINER, admin-checked, `ON CONFLICT DO NOTHING` + recomputes run
  counts in one round trip). **NOTHING writes to live provider/group/facility
  tables** — staged runs end `ready_for_review` for E3.1's preview/commit.
  **Pure core `src/lib/rosterImport.ts`** (+37-case suite): the canonical
  20-column template header list (the SINGLE source for the downloadable
  template AND the exact front gate — includes `provider_middle_initial`,
  `caqh_id`, `license_issue_date`, `ssn_last4`, `date_of_birth` per PM
  sign-off), `checkRosterHeaders` (order-insensitive exact match, BOM/case/
  space-tolerant via the shared `normalizeHeader`, trailing-blank-tolerant;
  missing/extra/renamed/duplicate named in the reject), `checkRosterFile`
  (.csv + the PM-confirmed 10 MB ceiling, client-side), `scanRosterRecord`
  (required five-part-dedupe inputs, TIN/NPI/state/date/middle-initial
  formats, ONE error per row in deterministic order), **the TE-6 SSN guard**
  (dashed `NNN-NN-NNNN` anywhere or bare 9-digit outside `group_tin` →
  blocked-row error, cell REDACTED from `raw` before persistence, reason
  never echoes the value, never truncates to a last-4; `ssn_last4` itself is
  4-digit-validated with a non-echoing error), `chunkRows`
  (`STAGE_CHUNK_SIZE` 500), error-report assembly (`collectRowErrors`/
  `errorReportCsvRows` — row/column/reason). REUSES the Epic 2c
  `csvImport.ts` parser core (TE-1: `parseCsv`/`coerceDate`), NOT its
  forgiving by-name mapper. **Service `src/services/importRuns.ts`**
  (create/markScanning/stage-RPC/complete/fail/cancel + list/get; lifecycle
  audited per TE-10; cancel purges import_rows FIRST) → hook
  **`src/hooks/useImportRuns.ts`**: the TE-3 async mechanism is a
  MODULE-LEVEL detached scan loop (`driveRosterScan` — scan+stage in 500-row
  chunks, awaits between batches keep the UI free), so in-app navigation
  never aborts it; progress lives on the run row (polled at 1.2s while
  in-flight) — "leave and return" just re-reads the run (F3.0.4). A run stuck
  in `scanning` with no live driver in this tab (`isScanDrivenHere`) renders
  an INTERRUPTED state with Cancel — never a silent hang. **UI
  `src/components/import/`**: `RosterUploader` (the ONE pipeline both
  surfaces render — template download, file checks, front gate, columns +
  sample-rows preview, start; variant `internal` shows raw error detail,
  `streamlined` keeps errors to count + download and keeps a
  ready-for-review/failed run visible on return), `RosterDropZone` (dnd +
  picker fallback; DESIGN-DEBT row), `ImportRunPanel` (state pills via the
  legacy StatusPill, div-composed progress bar — DESIGN-DEBT row, error
  report download from the run's `error_report` so it survives the purge),
  `ImportRunList` (internal run history). **Surfaces (F3.0.1, role-gated v1
  per [r5-review]):** `/admin/import` REBUILT in place as the internal
  power tool (TE-8 — the Epic 2c three-file direct-commit importer is GONE;
  `src/services/importCommit.ts` deleted; the URL still renders for TS-23;
  `useIsAdmin` backstop) and the STREAMLINED org-rep uploader inside the
  wizard's Provider Roster section (`BulkRosterUploadCard` in
  `ProviderRosterSection` — admin-gated, also offered in the zero-group
  branch since the CSV carries group columns). Types: `ImportRun`/
  `ImportRunSource`/`ImportRunState`/`ImportRunErrorEntry`; keys
  `importRuns`/`importRun`. e2e `e2e/roster-import.spec.ts` (TS-58/59/60 —
  its harness write-throughs the stage RPC honoring the (run_id, line)
  resume key + recomputing counts, and uses configurable delays to hold the
  Uploading/Scanning states open; TS-60 pins zero live-table writes and the
  row/column/reason report download). NB the e2e "leave mid-scan" nav must
  wait for the destination heading to COMMIT before `goBack()` — a popstate
  during a pending TanStack transition never unmounts the source route.

- **E3.1 — Import Preview, Dedupe, Conflict Review & Staged Commit.** Turns
  E3.0's `ready_for_review` runs into live data behind one confirmation gate.
  TWO additive migrations (repo + hosted): `20260713190000_provider_verification_state.sql`
  (**`providers.verification_state`** `text NOT NULL DEFAULT 'verified'` CHECK
  `verified|pending_verification` — TE-1; the R5 staging fence, NOT a widening
  of `status` and NOT `reference_only`; `verified` default preserves every
  existing row; partial index on the pending set) and
  `20260713191000_commit_import_run.sql` (**`commit_import_run(p_run_id, p_plan
jsonb)`** — the ONE transactional staged-commit RPC + additive
  `import_runs.committed_at`/`created_provider_ids`/`updated_provider_ids`).
  **TE-2 — the single fence (highest-leverage):** both E1.8 readiness AND E2.0
  generation candidacy consume ONE provider read — `listProviderReadinessFacts`
  (`enrollmentReadiness.ts`) — so a lone
  `.neq("verification_state","pending_verification")` there (beside the existing
  `.neq("status","terminated")`) fences BOTH surfaces; both drop absent
  providers by presence, so neither locked model changed. `useProviders` (the
  roster projection) is deliberately NOT fenced — staged rows show with a
  Pending Verification pill. Verify recomputes from live reads, so it lifts with
  no re-import. **Pure `src/lib/importDedupe.ts`** (+34-case suite): five-part
  dedupe (name+NPI+TIN+group+facility; TIN/group are the same entity — group
  resolved by TIN then name) folding per provider — full match → skip "already
  exists"; name+NPI under a new group/facility → UPDATE proposing assignments
  (never a 2nd record); missing NPI → blocked manual-review (E3.0 already makes
  npi a required scan field, so these arrive as scan errors in the error report
  — the branch is defensive); per-field conflict diff (name/NPI/license/specialty,
  existing = default, explicit pick required, unresolved blocks ONLY its row);
  `summarizeImportPreview` (exact reconciliation with staged rows);
  `buildCommitPlan` (the RPC wire shape, unresolved → blocked_entries);
  `planBatchAssignment` (gap-fill, explicit-row-wins, idempotent). **Service**
  `importRuns.ts` gained `listStagedImportRows`, `commitImportRun` (RPC — the
  service does NOT `writeAudit`; the RPC owns audit rows), `applyBatchAssignment`
  (both assignment uniques backstop idempotency — TE-7 corrected: the pfa
  `(provider_id, facility_id)` unique ALREADY EXISTS, no new index); `providers.ts`
  gained `verifyProviders` (writer, audited, state-filtered so replays are
  no-ops). **Hooks** (`useImportRuns.ts`): `useStagedImportRows`,
  `useImportPreview` (the useGenerationPreview composition — one staged read +
  existing org caches → pure dedupe, nothing stored), `useCommitImportRun`
  (invalidates providers/assignments/licenses + the readiness-facts fence),
  `useApplyBatchAssignment`, `useProviderAssignmentsForRun`; `useProviders.ts`
  gained `useVerifyProviders`. `OrgLicenseSummaryRow` widened additively
  (id/licenseNumber/issueDate) so the license-conflict check rides the same
  cached read. **UI** `src/components/import/`: `ImportPreviewContent` (E2.0
  idiom — 3 metric cards + drill-down collapsibles + inline per-field
  `ConflictPicker` + finality-confirmed `Commit Changes` / `Cancel Import`;
  committed view shows the outcome + `BatchAssignPanel`) on the new
  **`/import/$runId`** route (admin-gated, reached from the E3.0 run panel's
  "Review & commit"); `BatchAssignPanel` (F3.1.5, DatePicker + group select +
  facility checkboxes). The wizard `ProviderRosterSection` gained the Pending
  Verification pill + single/bulk Verify. `Provider.verificationState` +
  `ProviderVerificationState` added; `PROVIDER_LIST_COLUMNS` carries
  `verification_state`. e2e `e2e/import-preview.spec.ts` (TS-61 dedupe +
  reconcile + nothing-live-before-commit; TS-62 conflict review + commit →
  pending pills + audit; TS-63 the fence — a pending provider is absent from
  `/generation` until verified on the roster, then appears with a readiness
  badge — + batch-assign idempotency; the harness write-throughs the
  `commit_import_run` RPC and honors `neq.` filters). Table-register `providers`
  row + `import_runs` row updated; SCHEMA.md updated; types regenerated.

- **E3.3 — Sectioned Intake Uniformity (per-section CSV upload beside every
  manual form).** A template/surface split, NOT a new pipeline: the ONE E3.0
  staging machine + E3.1 commit engine now serve three per-section uploads
  (Provider Group / Facilities / Providers) keyed by an additive discriminator.
  ONE additive migration (repo + hosted, `20260714120000_import_runs_entity_kind.sql`):
  **`import_runs.entity_kind`** (`provider_group|facility|provider|combined`,
  default `combined` so in-flight E3.0 runs stay valid with NO backfill, TE-1);
  `import_rows` unchanged. `ImportRun`/`CreateImportRunInput` gained `entityKind`;
  types regenerated. **Pure per-section descriptors `src/lib/importSections.ts`**
  (+tests): three `{ headers, required, scan }` descriptors derived from the
  manual forms (`ProviderGroupForm`/`FacilityForm`/`ProviderRosterForm`) — the
  SINGLE source shared by each template download AND its exact-header gate
  (F3.3.1). The E3.0 core is reused verbatim: `checkHeaders` (generalized from
  `checkRosterHeaders`), the file/10 MB checks, `STAGE_CHUNK_SIZE`,
  `collectRowErrors`/`errorReportCsvRows`, `previewRows`, and the **shared TE-6
  SSN sweep `sweepSsn`** (extracted from `scanRosterRecord`, `group_tin`
  bare-9-digit-exempt, dashed always rejected). **TE-3 non-scalar flat
  encoding:** multi-value scalars (`operating_states`, language lists) ride one
  `;`-delimited column (`encode/decodeDelimited`, `\;` escape); the group's
  three blocks flatten to prefixed columns (`billing_*`/`corr_*`/`cred_*`) with
  **blank corr/cred ⇒ inherit billing** at scan time; facility **hours are
  omitted** from the CSV (TECH-DEBT TD-33, PM Open Q1 default — set in the form
  after import); provider **licenses** ride one row per license (folded on
  commit, E3.1 grain). **`RosterUploader` is section-parameterized** (`entityKind`
  prop selects the descriptor, written onto the run; the resume/in-flight filter
  is entity-kind-scoped so a section only resumes its own runs, TE-4).
  `ImportRunList` gained an entity-kind label; `ImportRunPanel`/`RosterDropZone`
  unchanged. **TE-5 ladder** (`uploadLadderGate`): Facilities/Providers uploads
  require ≥1 provider group — the wizard sections render a DISABLED drop zone +
  pointer via shared `src/components/onboarding/SectionUploadCard.tsx` (admin-
  gated). The three wizard section bodies (`ProviderGroupSection`/
  `FacilitySection`/`ProviderRosterSection`) render the manual form BESIDE the
  upload card; the old provider-only `BulkRosterUploadCard` is retired. **TE-7
  combined retirement:** `/admin/import` now shows the same three per-section
  uploads (no combined); a legacy combined file (detected by
  `looksLikeCombinedTemplate` = provider identity + facility columns together)
  is rejected with `COMBINED_TEMPLATE_RETIRED_MESSAGE` naming the three
  replacements. The E3.0 `ROSTER_TEMPLATE_HEADERS`/`scanRosterRecord`/
  `checkRosterHeaders` are kept (they back the combined-signature detection + the
  E3.0 test suite); in-flight `combined` runs stay reviewable through
  `ImportPreviewContent`. **TE-8 commit fan-out by `entity_kind`:** provider →
  E3.1's `commit_import_run` RPC verbatim; **provider_group → `createProviderGroup`
  (dedupe grain = TIN), facility → `createFacility` (grain = group + name +
  address)** via `commitSectionImportRun` (`importRuns.ts`) — a thin per-kind
  branch, NOT a second engine. The two grains are added to the pure
  `importDedupe.ts` (`dedupeGroupRows`/`dedupeFacilityRows`, +tests). The
  group/facility commit is a browser create-service loop (no new RPC), then flip
  run→committed (`WHERE state='ready_for_review'`) + purge `import_rows`; not
  single-transaction, but a mid-loop failure leaves the run resumable (skip-on-
  match dedupe). `/import/$runId` branches on `entityKind`: provider/combined →
  `ImportPreviewContent`; group/facility → the simpler `SectionImportPreview`
  (create/skip/blocked, no conflict review). **TE-9 fence:** the capture surface
  (`capture.$token.tsx`/`captureLinks.ts`) is UNCHANGED — zero upload/group/
  facility/provider capability (guard/test only). e2e: `roster-import.spec.ts`
  retargeted to the provider per-section upload (TS-58/59/60);
  `sectioned-intake.spec.ts` (TS-65 three sections manual+upload + templates
  match; TS-66 facilities blocked→proceeds→real facility commit→chip; TS-67
  combined rejected + three uploads + in-flight combined run reviewable; TS-68
  capture fence + converted org lands in the wizard). No new table, no new deps.

### Stage 4 built so far

- **E4.0 — Payer Pipeline: External State Machine, Tracking IDs & Structured
  Resolution.** Every credentialing case now carries a SECOND, parallel state —
  where the PAYER is — wholly decoupled from the internal
  `credentialing_status_id`/`status_configs` machine (A3; that machine is
  untouched). **Schema (repo + hosted, five migrations `20260715120000`–`120500`):**
  `credential_cases.payer_pipeline_state text NOT NULL DEFAULT 'not_started'`
  CHECK 9-value (`not_started|assigned|drafting|submitted|in_review|
action_required|approved|denied|oon`); the append-only **`payer_pipeline_history`**
  (dedicated sibling of `status_history`, which can't hold the payer enum — no
  UPDATE/DELETE policy/grant, member SELECT for ALL roles incl. billing, writer
  INSERT); **`denial_reason_codes`** (governed vocabulary, `org_id NULL` = global,
  six seeded defaults, admin-only writes — the E4.2 CRUD is NOT built here); and
  the two Approved-resolution IDs `payer_individual_provider_id` (Type 1) +
  `payer_group_provider_id` (Type 2/Tax-ID) via `20260715120500` (ChatPRD round-3
  split — the earlier single `payer_provider_id` from `120100` is now DORMANT,
  kept per the additive rule). Tracking ID reuses `payer_reference_id`; effective
  date reuses `confirmed_effective_date` (no new columns — TE-3/TE-6). **Transitions
  ONLY via `advance_payer_pipeline`** (SECURITY-INVOKER RPC, atomic: a rejected
  edge writes ZERO history + no partial state; edge map mirrored in SQL from the
  pure `src/lib/payerPipeline.ts`; enforces reason-code rules, admin-only
  corrections/post-terminal/approval-reversal-clear, and optimistic concurrency
  `p_expected_state`). Reapply after Denied is a NORMAL Denied→Drafting forward
  edge (`[r4-review]` Q6), not a correction. **Services/hooks:** `cases.ts`
  (`advancePayerPipeline` + typed `PipelineTransitionError`, `listDenialReasonCodes`,
  `setPayerReference` audit now carries the prior value, `getCase` embeds the
  attributed pipeline timeline), `useCases.ts` (`useAdvancePayerPipeline`/
  `useDenialReasonCodes`), `useTasks.ts` (`useCreateFollowUpTask` — the RFI→task
  bridge), `useTablePrefs.ts` (revives `tablePrefs.ts` for the toggleable list
  column). **UI (`src/components/cases/pipeline/*`):** `PayerPipelineBadge`
  (status-semantic `StatusPill`, kept distinct from the internal pill on case
  detail/list/queue — TE-7), `PayerPipelineControl` (badge + last-updated
  attribution + legal-edges-only transition menu + all dialogs: transition,
  approval [effective date required + two IDs via the `payerResolutionIdentifier.ts`
  resolver seam E4.2 plugs into], denial [reason required, "Other" context],
  OON, admin correction, RFI→task bridge), `PayerPipelineHistoryPanel` (read-only
  timeline), `TrackingIdField` (header, copyable, inline audited edit + duplicate
  warning). Case list (`/cases`) gained the pipeline badge column, a
  default-hidden toggleable Tracking ID column (via `user_table_prefs`), and a
  free-text search matching the tracking ID; the E2.3 `/work` queue renders the
  badge. **TE-7:** `handleCaseContext` (`/api/cases/:id/context`) now returns
  `payerPipelineState` (read-only, no new endpoint). Seeds: TS-69–72 on Dillon
  Sports Medicine (`seed-redesign.sql`, fixed UUIDs `d4110000-…`). Tests:
  `payerPipeline.test.ts` (edges/terminal/reapply), `cases.pipeline.di.test.ts`
  (RPC param threading + error mapping). The RPC's transactional
  zero-history-on-failure + admin gate were verified via a live rolled-back
  simulation (a JS fake can't prove PG transactionality). No new deps.

- **E4.2 — Payer & SOP Admin Module.** A role-gated `/admin/payer-admin` route
  subtree (parent + `.index` tabs + `.forms.$payerId`) consolidating payer +
  SOP configuration; module-local components in `src/components/payer-admin/`.
  **The import boundary is machine-enforced both ways** (TE-15) by
  `src/components/payer-admin/moduleBoundary.test.ts` (Rule A: no non-admin code
  imports the module; Rule B: the module imports specialist code only via
  lib/services/hooks/design-system). The **one authorized shell edit**: an
  admin-only "Payer & SOP Setup" nav entry in `Sidebar.tsx` (`useIsAdmin`).
  **Seven migrations** (`20260715140000`–`140600`, repo + hosted): `payers`
  `resolution_id_label`/`resolution_id_expected` (F4.2.1 seam, read via
  `payerResolutionIdentifier.ts` now); `next_best_action_configs` (TE-7 org
  queue ranking, `org_id` PK); `sop_template_drafts` (F4.2.1 save-as-draft);
  `tasks.execution_type` + `sop_templates`/`sop_template_versions`
  `required_profile_attributes` + the **publish RPC gained a 6th param**
  `p_required_profile_attributes` (drop-old-signature + recreate to avoid a
  PostgREST overload); `case_generation_runs.release_scope`;
  `fill_sessions.is_test` + `case_id` relaxed NULLABLE + `providers.is_test_provider`;
  and `create_case_with_tasks` now threads per-task `execution_type`.
  **Pure logic (all tested):** `executionTypes.ts` (the shared execution-type
  union — the single source), `profileGating.ts` (governed attribute keys +
  gate eval, TE-13), `payerReadiness.ts` (TE-4 projection), `queueSettings.ts`
  (labels + reorder over the `nextBestActions.ts` union/default/validator —
  NOT re-declared), `sopPublishLint.ts`, `releaseScope.ts` (TE-14 selection
  layer), `testProvider.ts` (the one exclusion predicate), `generationGating.ts`
  (annotates proposed rows on top of the locked preview), `testRunResults.ts`
  (F4.2.7 dry-run compute + parse). **Reused verbatim:** `mappingCoverage` from
  `payerScorecard.ts` (now exported) for form readiness (TE-16); execution-type
  stamping via `sopStamp.stampExecutionTypes` (sopResolver untouched — resolved
  tasks align to definitions by index). **Services/hooks:** `denialReasonCodes.ts`
  (F4.2.3 CRUD, reusing the E4.0 table), `queueRankingConfig.ts` now reads/writes
  `next_best_action_configs` (the E4.1 seam is live), `sopTemplateDrafts.ts`,
  `usePayerReadiness` (composes readiness + form coverage + blocked count),
  `useGenerationPreview(scope?)` gained gating + release-scope + provider→facility
  map + execution-type stamping, `useConfirmGeneration` takes `{rows, releaseScope,
providerFacilities}`, `tasks.createProviderOutreachTask` (F4.2.6), form-runner
  hooks in `useFormOnboarding.ts`. **Wizard extensions** (`TemplateWizard`/
  `TemplateTaskRow`/`editableTemplate`): per-task execution-type select,
  required-attributes checkboxes, save-as-draft + resume (`?draftId`), match-key
  prefill (`?payerId/state/groupId` from the "Needs SOP" link), minimum-content
  publish lint, global-tier blast-radius confirm, and accessible move up/down on
  tasks AND steps (drag kept). Generation preview (shared, not the module) gained
  the release cap + gated-rows-with-outreach UI + `?payerId` scope. `types.ts`
  additively widened (Payer/Provider/Task/SOP\*/CaseGenerationRun/FillSession +
  `SopTemplateDraft`/`FillSkippedField`). Reason codes reuse the E4.0 global-default
  model (no new table — a conflict where E4.0's shipped reality supersedes TE-5's
  is_system/per-org-seed, and it meets every F4.2.3 acceptance criterion). No new
  deps.

- **E4.2 — SOP Resolution Hardening (deterministic template selection).** Makes
  SOP selection order-independent and adds resolution provenance. ONE additive
  migration (`20260716120000_e42_sop_resolution_hardening.sql`, repo + hosted).
  **`src/lib/pickTemplate.ts` rewritten** to an EXPLICIT tier ranking (no more
  `Array.find` order dependence): org exact-group → org any-group → global-payer
  exact-group → global-payer any-group → generic fallback → null, with a
  deterministic within-tier tiebreak (createdAt, then id). "Any group" = a
  group-agnostic (null-group) template, so a template authored for a DIFFERENT
  group NEVER resolves (previously the payer+state tier leaked another group's
  SOP), and an org override always beats a global payer SOP. New pure
  `resolutionTier(template)` → `organization | global_payer | generic_fallback`
  (the `SopResolutionTier` union, exported + type-imported by `types/index.ts`).
  **Provenance stamping:** `sopStamp.templateProvenance` extends the E2.2 stamp
  with the tier; `stampTasks` now carries `sopResolutionTier` on every task, so
  the 6 SOP-resolving surfaces (NewCaseModal, ManualCaseModal, CreateCasesDialog,
  ReapplyCaseAction, `useConfirmGeneration`, `providers.new` starter cases) stamp
  it with ZERO call-site changes. Additive columns: `tasks.sop_resolution_tier`
  (nullable CHECK) + `create_case_with_tasks` threads it; `credential_cases`
  run rows gained `sop_template_id`/`sop_version`/`sop_resolution_tier` (a
  confirm-time SNAPSHOT — plain columns, no FK, like `reason`), written for
  `created` rows by `generationConfirm` from the SAME `pickTemplate` selection.
  `listGenerationRunRowsByTier` + pure `countRunRowsBy` (`generationRuns.ts`)
  make generic-fallback usage countable by run/payer/state/group/org
  (`generationRuns.di.test.ts`). **Authoring (`TemplateWizard`):** org SOPs now
  REQUIRE payer + state (the "Any payer"/"Any state" options are gone; the shared
  pure `src/lib/sopMatchKey.ts` `orgSopMatchKeyError` blocks unsupported saves);
  group stays optional ("Any group"); **specialty is no longer an editable match
  key** — preserved in storage + shown as legacy/non-routing metadata; each
  template shows its tier (Organization override / Global payer SOP / Generic
  fallback); Duplicate now creates an ARCHIVED copy (outside the active-uniqueness
  grain). **Uniqueness:** additive partial unique index
  `uq_sop_templates_active_org_match (org_id, payer_id, state, group_id) NULLS NOT
DISTINCT WHERE org_id IS NOT NULL AND payer_id IS NOT NULL AND state IS NOT NULL
AND archived = false` (live data verified duplicate-free first) + service-side
  validation in `templates.ts` — the required payer+state contract is enforced at
  the SERVICE boundary too (`assertActiveOrgMatchKeyComplete`, via the same pure
  `orgSopMatchKeyError`, on active creates AND update/restore destinations;
  archived rows exempt so legacy rows stay readable/archivable) plus destination-key
  uniqueness (`assertUniqueActiveMatch`, clear blocking error; `dbErrors.ts` maps
  the 23505 backstop). **Readiness (F4.2.2)
  unchanged in logic (Ready = payer-specific SOP resolves; fallback = Needs SOP)
  but `PayerDirectory` relabels the column "SOP coverage" (was "Readiness") and
  "Form coverage", keeping Blocked separate. **Fallback generation is explicit:**
  `useGenerationPreview` exposes `fallbackRowKeys`; `GenerationPreviewContent`
  labels fallback-resolving rows ("Generic fallback SOP") and shows a persistent
  pre-confirm warning (no hidden ack, never suppressed) — fallback generation is
  still permitted (no new hard block). Nine legacy demo templates with null
  payer/state stay untouched (outside the constrained grain). GUARDRAILS held:
  `sopResolver.ts` untouched, case uniqueness untouched, no specialty column on
  `credential_cases`/`payer_network_targets`, no specialty table, no data
  deleted/rewritten, no new deps. types regenerated.

- **E4.2 — Canonical Payer Governance.** Orgs SELECT canonical payer
  identities; they never create or rename them. TWO migrations (repo + hosted,
  `20260716190000`/`191000`, additive/grant-only): **`org_payer_settings`**
  (the org × payer configuration grain — `UNIQUE (org_id, payer_id)`, ONLY
  `resolution_id_label`/`resolution_id_expected`; member SELECT / ADMIN
  INSERT/UPDATE, NO delete; revoke-then-grant floor — hosted default
  privileges otherwise leave authenticated a DELETE grant) and **catalog
  review made PLATFORM-ONLY** (`payer_catalog_changes` authenticated
  SELECT policy dropped + ALL grants revoked; `review_payer_catalog_change`
  authenticated EXECUTE revoked + body reissued to reject org-user JWTs and
  ACCEPT service-role/direct-SQL callers — the E1.6 body required auth.uid()
  so service_role could never call it. **OPERATOR ORDERING NOTE (resolved
  2026-07-17, Option B):** #169's drop migration `20260716180000` was NEVER
  applied and is now retired (`.superseded`); the drop ships instead via
  `20260717221914_payer_dead_column_drop_superseding.sql`, which does NOT
  reissue `review_payer_catalog_change` — so this platform-only body stands
  and no re-apply of `20260716191000` is needed).
  **App:** `Payer.orgId` is honestly `string | null`; `payers.ts` has NO
  create (free-text "Add payer" is gone — `useCreatePayer` removed); `getPayer`
  reads own-org OR assigned-global (or-filter). **Since the 2026-07-18
  close-out `payers.ts` is fully READ-ONLY** — `updatePayer`/`PayerInput`/
  `GlobalPayerUpdateError`/`useUpdatePayer` deleted (their only reachable
  subject was a legacy org row; name/avg_decision_days are Minted-curated —
  avg decision still feeds the SummaryTab report). Admin → Payers is a
  READ-ONLY governance surface: "Browse payer catalog" CTA (→
  `/payer-directory`), starter toggle kept (org_payer_assignments
  fact, admin-only render), Scorecard link kept, NO edit modal.
  `PayerCatalogChangesPanel` DELETED (+ its hooks/service fns/query key) —
  the directory renders no review queue. **Resolution-ID config moved to the
  org grain:** `orgPayerSettings.ts` service (audited upsert on the unique
  key) → `useOrgPayerSettings.ts`; `PayerResolutionIdDialog` wrote the org
  setting, and `resolveIdentifierConfig` was the three-tier chain org setting
  → Minted global fallback (payers columns) → generic. **SUPERSEDED by the
  2026-07-20 resolution-ID re-scope:** the org tier is retired app-side
  (`org_payer_settings` dormant, service/hooks/dialog/section deleted) — the
  chain is now two-tier (Minted-curated payers columns → generic) and the
  ISSUED values live on `enrollment_facts.payer_issued_id` /
  `payer_network_targets.payer_issued_id` (see the post-E6 wave note). **Legacy cutover: CLOSED as superseded
  (2026-07-18).** The 18-row re-keying inventory in
  `docs/data-model/legacy-payer-cutover.md` never ran — the PM-approved
  pre-prod-cut data wipe (2026-07-17, AGENTS.md carve-out; pre-wipe data in
  the `mintedpanel-backup-july17` project) removed the demo orgs and every
  legacy payer/sentinel row with them (live-verified: 269 payers, all global).
  The legacy-payer deprecation change then deleted the machinery:
  `src/lib/payerCutover.ts` (+test) gone; `payerSetup.ts` lost
  `PayerSetupSource`/`migrate_legacy` (inclusion = active assignment only);
  `PayerSetupList` lost the Source pill / "Legacy — catalog migration
  required" state; `ManualCaseModal` lost the own-org inclusion shortcut; and
  migration **`20260718120000_payers_org_write_lockdown.sql`** (repo + hosted)
  dropped `payers_insert`/`payers_update` + revoked org INSERT/UPDATE grants,
  so an org-scoped payer row can never be minted again (payers is
  member-SELECT-only; catalog writes stay service-role). The `.or(own-org,
global)` READS stay — the shared-catalog pattern, own-org disjunct vestigial
  but keeps local seed fixtures readable (seeds still create org-scoped
  payers; they never run on hosted). The Pre-Cred sentinel WORKFLOW code
  (`PRE_CRED_PAYER_NAME` branches) is deliberately untouched — a product
  concept, currently unreachable (no creatable payer carries the name).
  Governance is machine-checked in `src/lib/payerGovernance.test.ts` (no
  catalog-review call paths, no payers INSERT/UPDATE, migration grant shape
  incl. the lockdown migration). Types
  for the new table were HAND-ADDED to `types.ts` (hosted still carries the
  un-applied #169 drop, so a full regen would resurrect dropped columns —
  regen only after the operator applies the superseding drop
  `20260717221914` (#169's `20260716180000` is retired, never applied)). e2e:
  `admin-payers.spec.ts` (new), `payer-directory.spec.ts` (TS-38 replaced by
  the governance no-review-surface test; stale TS-36 Portal assertion from
  #169 fixed), `payer-admin-module.spec.ts` (+F4.2.1 Configure-ID writes
  org_payer_settings, never payers). Platform catalog authoring UI is R7 —
  deliberately NOT built (no fake platform-admin from org `admin`).

- **E4.2 — Unified Payer Setup (§5 amendment TE-18–TE-21, e4-2d).** ONE
  administrative home called **"Payer Setup"** at `/admin/payer-admin` — no
  migration, presentation-layer consolidation only. **Sidebar (TE-18, the one
  authorized shell edit):** the two-item Payers section ("Payer Management" →
  `/admin/payers` + admin-only "Payer & SOP Setup") is replaced by a single
  ADMIN-ONLY "Payer Setup" entry rendered standalone (F0.9.3's 2+-item
  section-label rule); specialist/billing get NO Payers nav entry (TS-76 pin).
  **The workspace** presents five URL-driven tabs (`?tab=` — setup default |
  catalog | templates | forms | org-settings) composed over EXISTING feature
  components: **Setup** = the new per-PAYER funnel `PayerSetupList`
  (`src/components/payer-admin/`, superseding + deleting the payer × state
  `payer-admin/PayerDirectory.tsx`); **Catalog** = the shared
  `src/components/payers/PayerCatalogBrowser.tsx` (extracted from the
  `/payer-directory` route, which stays live with its NON-ADMIN browse);
  **SOP templates** = the shared `src/components/templates/TemplatesList.tsx`
  (extracted from `/admin/templates`, which stays live; the "New Template"
  button moved from PageHeader into the list toolbar); **Forms & portals** =
  the shared `src/components/portals/PortalsRegistry.tsx` (extracted from
  `/admin/portals`, which stays live and gained `?payerId=` — opens the Add
  dialog with that payer preselected, the funnel's "Register portal" target);
  **Organization settings** = payer-relevant org settings ONLY (PM decision):
  ReasonCodeManager + QueueSettingsPanel + the new
  `ResolutionIdSettingsSection` (per-payer effective label/source table over
  the e4-2c `PayerResolutionIdDialog`; never the general /admin/settings
  panels). The tab composition lives in the ROUTE file — `moduleBoundary`
  Rule B only constrains `components/payer-admin/*`, which still imports no
  specialist feature dir. **Setup funnel derivation:** pure
  `src/lib/payerSetup.ts` (+16-case suite) — `activeOrgPayers` (inclusion =
  ACTIVE `org_payer_assignments` subscription or active legacy org payer,
  NEVER targets, so a zero-target payer is visible; Pre-Cred sentinel
  excluded), separate dimensions per row (scope targets/states · SOP
  covered/total vs Needs-payer-SOP · form N/A / Unregistered / %-mapped +
  e4-3a unlinked count / dry-run status · blocker count · generation
  Ready/Warning("Generic fallback SOP would be used", blocker reasons)/
  Blocked(no scope) — never one collapsed badge), and ONE dominant
  `nextAction` in the locked priority order (configure scope → create SOP
  [prefilled matchKey link] → resolve blockers [payer-scoped /generation] →
  register portal [`/admin/portals?payerId=`] → capture/train
  [`/portals/$key/train`] → dry test [forms runner] → configure resolution ID
  [e4-2c dialog] → review generation); a zero-scope LEGACY payer gets
  "Find canonical payer" → Catalog tab instead (it can never satisfy the
  targets WITH CHECK). Reuses `mappingCoverage`/`isUnlinkedFieldMap`/
  readiness rows verbatim — no re-derived signals; dry runs read the F4.2.7
  `is_test` fills off the `useRecentFills` cache. Hook
  `src/hooks/usePayerSetup.ts` composes the existing caches. Each setup row
  expands (aria-expanded chevron) to the per-state readiness detail +
  starter toggle; source pills, scorecard link, and read-only identity
  posture are preserved from the old /admin/payers (its **route is now a
  redirect shell** → `/admin/payer-admin`, the /admin/sops precedent; the
  scorecard back-link re-points to the workspace;
  `payerGovernance.test.ts`'s route pin now checks the redirect target and
  the setup list's read-only posture). `FormOnboardingPanel` empty states
  gained direct actions (register-portal with payer context; roster link for
  the missing test provider). e2e: new `payer-setup-funnel.spec.ts` (funnel
  steps 1–11 incl. a gated-provider fixture and the visible fallback
  warning), `admin-payers.spec.ts` rewritten (redirect + governance
  affordances + specialist denial-with-catalog-pointer),
  `payer-admin-module.spec.ts` rewritten (five tabs, TE-20c keyboard
  traversal, Configure-ID via the org-settings tab), `sidebar-ia.spec.ts`
  TE-18 pins, `legacy-routes.spec.ts` moved /admin/payers to the redirect
  set.

- **E4.3 (Session 1) — Panel-side Workbench Contract.** The PANEL half of the
  extension-workbench handoff (the extension is Session 2 in
  `sonny303/minted-extension`). **No migration** (`user_table_prefs` already
  existed). **Read-only except the existing touch append + one user-scoped prefs
  upsert.** Four new/extended `/api` surfaces (all detailed in the Server API
  layer section): `GET/PUT /api/me/view-prefs` (quick-card layout, user-scoped
  on `authenticateUser`), `GET /api/next-best-action` (queue-top via the SAME
  pure reducer), the `?q=` case-search mode on `/api/cases`, and the E4.3 TE-2
  expansion of `GET /api/cases/:id/context` (identity header + open tasks with
  execution types + no-store + one READ audit). `POST /api/cases/:id/touches`
  gained a second `kind 'structured_touch'` (E4.1 typed touch from the
  extension: required `touch_type`, optional
  disposition/recipient/follow-up/tracking-id, `source 'extension'`, writer-only,
  one touch + one audit). The Q4 malpractice refinement landed in
  `providerProfile.ts` (no wire change). **New pure libs (tested):**
  `src/lib/quickCardCatalog.ts` (the CLOSED server-owned field allowlist +
  `validateQuickCardFields`), `src/lib/extensionHandoff.ts` (the locked
  `SET_ACTIVE_CASE` message builder + feature-detect + best-effort send),
  `src/lib/casePortals.ts` (`casePortalTargets`/`resolvePortalTargets` — a
  case's launchable portals from its open tasks' portal steps). **New services:**
  `src/services/extensionViewPrefs.ts` (server-only, user-scoped prefs),
  `src/services/nextBestAction.ts` (server-only queue assembly). **Browser
  "Work in portal" launcher (F4.3.1):** `WorkInPortalButton`
  (`src/components/cases/WorkInPortalButton.tsx`) on case detail
  (`cases.$id.tsx`, per resolvable portal) and the My Cases queue rows
  (`NextBestActionQueue.tsx`, via the new `useCasePortalKeys` hook +
  `listCasePortalKeys` service read) — sends the handoff, opens the portal tab
  regardless, toasts a non-blocking notice when the extension is absent. Gate:
  new `casesearch` leak mode + assertions 15/15b; mock-api-server gained the
  view-prefs, next-best-action, and `?q=` handlers. E2E for TS-100–103 is
  Session 2 (extension mock harness).

- **E4.4 — Sensitive Identifiers Vault: Zero-Trust Full SSN.** The FIRST place
  the system holds a decryptable secret. TWO additive migrations (repo file
  ONLY — **hosted apply is an OPERATOR task**, deliberately not applied by the
  build session since it carries a decrypt secret + needs the master-key GUC):
  `20260717120000_ssn_vault.sql` + `20260717120100_ssn_intake_links.sql`.
  **PM security decisions (2026-07-14, do not re-open):** server-only vault
  (option 1); Option A key management (in-DB pgcrypto, key from a server GUC);
  `store_ssn` ingress = specialist+admin; reveal admin-only. **Vault (TE-1/TE-2,
  `provider_ssn_vault`):** `ssn_ciphertext bytea` + `algo`/`key_version`
  (Option-B-ready), one row per provider; RLS on, `REVOKE ALL` from
  anon+authenticated, **NO client SELECT grant and NO service_role table grant**
  — the only access is the SECURITY DEFINER RPCs. Private `_ssn_vault_key`
  (reads `current_setting('app.settings.ssn_vault_key')`, fails closed) /
  `_ssn_encrypt` / `_ssn_decrypt` (`extensions.pgp_sym_*`) / `_ssn_digits`
  (9-digit normalize, never echoes the value) / `_ssn_vault_upsert` (the shared
  encrypt-and-set-`ssn_last4` write). **RPCs (TE-3/TE-4):** `store_ssn` (authed
  writer, mask + audit), `reveal_ssn` (admin + non-empty justification; decrypt
  once + immutable `READ` audit carrying who/when/provider/justification in
  `after`), `release_ssn_for_fill(provider, org, case)` (**service_role EXECUTE
  only** — the /api fill path; re-checks the active-fill context then decrypts;
  the /api handler writes the `READ` audit with the JWT actor since the
  service-role RPC has no `auth.uid()`), plus the intake trio. **`ssn_last4`
  stays the ONLY value any ordinary read/list/export/API returns; mask
  `***--1234`** (`src/lib/ssnMask.ts` `maskSsn`/`formatFullSsn`, +test) applied
  at the two render sites (provider IdentityCard, ProviderForm review). **App
  layer:** `src/services/ssnVault.ts` (browser: `storeSsn`/`revealSsn`/
  `getSsnIntakeLink`/`issueSsnIntakeLink`; anon: `validateSsnIntakeToken`/
  `submitSsnIntake`) + server-only `src/services/ssnRelease.ts` (the two-wall
  fill release, mirrors `caseContext.ts`) → `src/hooks/useSsnVault.ts` (reveal is
  a MUTATION so plaintext never enters the cache). **UI
  (`src/components/providers/`):** `SsnVaultField` on the provider Identity card
  (mask + role-gated menu: admin Reveal, writer Store/Send-link) composing
  `SsnRevealDialog` (justification + auto-rehide ~20s, value in local state only)
  / `SsnStoreDialog` (F4.4.4 internal modal, encrypt-on-save) /
  `SsnIntakeLinkDialog` (issue + copy-able link). **Ingress link (TE-4,
  E0.5 pattern):** `provider_ssn_intake_links` (hashed token, single active per
  provider, 72h, state machine, E0.8-throttled anon RPCs, uniform invalid
  responses) → public **`/ssn-intake/$token`** route (chromeless via `__root`
  `isSsnIntakeRoute`; write-only — never echoes the SSN). **Fill-only /api
  endpoint (F4.4.2):** `GET /api/providers/:id/ssn-release?caseId=` in
  `extensionRoutes.ts` (writer-only, caseId required, no-store, one `READ`
  audit) — wired in `api.ts` (matched before the generic `:id`); the extension
  consumes it later (no extension-repo change this session). **Gate:** new
  `ssnrelease` leak mode + assertion 16 (cross-org release → 404, safe on prod
  because the case-ownership miss short-circuits before any decrypt);
  mock-api-server + verify-isolation-local updated. Types hand-added to
  `types.ts` (regen unavailable — hosted migration not applied) + domain types
  in `types/index.ts`. Tests: `ssnMask.test.ts`, `ssnRelease.di.test.ts`,
  `extensionRoutes.test.ts` (release handler), e2e `e2e/ssn-vault.spec.ts`
  (TS-84 masking + no ordinary decrypt + direct-read-returns-nothing; TS-86
  admin-vs-non-admin reveal; TS-87 both ingress paths + lockdowns; a FAKE
  `900-55-6789` test value — never a real SSN). Out of scope: vaulting any other
  identifier, SSN in CSV/exports/reports (the E3.0 reject-never-truncate rule
  stands), any provider self-service beyond the intake link.

- **E4.5 — Document Storage: Provider & Group Documents with Expiration
  Tracking.** The dormant `provider_documents` table is ACTIVATED as immutable
  version metadata and the FIRST Supabase Storage bucket ships. TWO additive
  migrations (repo file ONLY — **hosted apply + bucket provisioning are an
  OPERATOR task**, see the PR body): `20260717150000_e45_provider_documents_activation.sql`
  (TE-1/5/9 — `document_family_id` NOT NULL volatile-default so legacy rows
  become their own single-row families, `version_number > 0`,
  `supersedes_document_id` self-FK + partial unique = ONE successor per row,
  `UNIQUE (org_id, document_family_id, version_number)` = the idempotent
  finalize key; doc_type CHECK += `cms_460`/`cv`; NOT VALID CHECK
  state_license|dea|coi require expiration_date; grants cut to SELECT+INSERT +
  delete policy dropped — replacement INSERTS, never updates/deletes, "current"
  = the family row with no successor, DERIVED) and
  `20260717150100_e45_document_storage_bucket.sql` (TE-2 — private
  `provider-documents` bucket, 25 MiB + PDF/PNG/JPEG backstop limits, path
  contract `org/{orgId}/{provider|group}/{ownerId}/{familyId}/{version}/{file}`,
  storage.objects policies validate the path org via
  `public.document_storage_org_id()`; member read / writer insert / NO
  update-delete; guarded on the storage schema for repo-only rebuilds).
  **Pure `src/lib/documents.ts`** (+38-case suite): THE shared kind metadata
  map (labels, D1 owner grains — coi is dual-grain, expiration-required,
  expiring-soon thresholds 90 license / 60 DEA / 30 else — a PM change is one
  edit, TE-6), MIME/size constants, `safeFileName`/`documentObjectPath`,
  `currentVersions` (runtime-defensive: a row with no family id acts as its
  own family — the migration's backfill semantic, so pre-E4.5 e2e fixtures
  stay valid), `classifyExpiration` (boundary-tested 30/60/90),
  `expiringCredentialRows`, `parseDocumentKind`/`requiredDocumentKinds` (TE-7
  — SOP `requiredArtifacts` entries that resolve to a MACHINE kind join the
  store; free-form artifact names never do), `caseDocumentStatus`,
  `currentGroupReadinessDocuments` (the ONE reducer both readiness services
  run their group-doc reads through), orphan-sweep halves. **Server boundary
  (TE-3/TE-4):** `src/services/documentStorage.ts` (server-only ctx —
  upload-intent validates owner/kind/file + resolves family/next-version +
  sweeps expired orphans in the family prefix (the bounded TE-4 maintenance
  job, on the natural retry path) + mints `createSignedUploadUrl`; finalize
  verifies the object at the SERVER-derived path (size/MIME) before the
  immutable insert, links supersedes = family head, replays idempotently
  incl. the 23505 race; download = org-scoped maybeSingle miss → 404 BEFORE
  any signing, then a 120s `createSignedUrl`) → `src/server/documentRoutes.ts`
  (writer gate on intent/finalize, member download incl. billing; no-store;
  ONE audit row per action — intent CREATE on the family, finalize CREATE,
  download READ; never contents/URLs/tokens; failed audit fails the request)
  wired in `api.ts` (`/api/documents/upload-intent|finalize|:id/download`).
  **These are the FIRST /api routes the browser app consumes** — the epic §5
  supersedes the no-frontend-consumer posture for exactly this narrow signing
  surface (a signed URL cannot be minted client-side); metadata LIST reads
  stay browser-RLS (`src/services/documents.ts` + `useDocuments.ts`, keys
  under the `["documents", orgId]` prefix; upload invalidates documents +
  readiness families; download is a MUTATION so short-lived URLs never sit in
  the cache). Upload bytes PUT browser→Storage direct (never through nitro).
  **UI (`src/components/documents/`):** `DocumentsPanel` (dense per-owner
  table — current versions, derived expiration pills, vN + history dialog,
  uploader names via the touchlog author idiom, writer Upload/Replace) on
  provider detail (below the grid) and per-group Collapsible in the wizard
  `ProviderGroupSection`; `UploadDocumentDialog` (kind select from the shared
  map per grain, required-expiration enforcement, MIME/size pre-flight);
  `CaseRequiredDocuments` on case detail (F4.5.3 — present/missing/expired
  derived LIVE from current provider+group versions vs the tasks'
  required kinds, one-click audited download, hidden when no kinds; advisory
  only, nothing copied onto the case); `ExpiringCredentialsTable` on the new
  **`/reporting/expiring-credentials`** report (REPORTS entry + route — the
  E0.6 add-a-report pattern; org-scoped inside the cross-org Center).
  **Readiness (TE-6):** `ReadinessCheck` gained optional `advisory` —
  group_coi passes WITH an amber "COI expires …" note when the LATEST
  covering end date sits inside the 30-day window (dateless COI suppresses
  it; never flips pass); both `enrollmentReadiness.ts` and
  `nextBestAction.ts` group-doc reads now reduce to CURRENT versions.
  **Gate:** `documentdownload` leak mode + assertion pair 17/17b (own
  download works / cross-org 404s before signing; soft-skipped on prod until
  the operator seeds + pins `KANSAS_DOCUMENT_ID`/`SOUTHPARK_DOCUMENT_ID`).
  Types hand-added to `types.ts` (regen unavailable — hosted migration not
  applied) + domain types (`DocumentKind`/`ProviderDocument`/…) in
  `types/index.ts`. Seed: TS-89 staggered-expiration fixtures on Dillon
  (CURRENT_DATE-relative; metadata-only — no storage objects). e2e
  `e2e/document-storage.spec.ts` (TS-88 two-grain upload + required
  expiration + re-upload versioning + org-scoped/signed wire; TS-89 sorted
  derived states + the readiness COI advisory; TS-90 case verification +
  short-lived download; its harness mocks /rest, the app's own
  /api/documents/* SAME-ORIGIN with a write-through, and /storage/v1 —
  generated non-PHI bytes only). D3 stays deferred: NO auto-attach, no
  extension-repo change — the download endpoint IS the future-auto-attach
  contract (TE-11: audited links only, never bucket credentials).

### Stage 6 (Simplification Wave) built so far

The E6 wave builds from `docs/redesign/BUILD-QUEUE.md` (the multi-session
lock) + `docs/redesign/DECISION-RECORD-2026-07-19-simplification.md`; E6
migrations are REPO-ONLY (hosted apply is an operator step listed in each PR
body; rollback-wrapped hosted probes via MCP are the dry-run). `docs/wiki/`
pages are updated in the same PR as the epic that changes them.

- **E6.0 — Unified case status (#199).** ONE canonical, code-owned 8-status
  `credential_cases.case_status` (`src/lib/caseStatus.ts` — list, spine
  edges, evidence-bump rules, legacy mapping; migrations `20260719120000`–
  `120200`): every transition through the `set_case_status` RPC (evidence
  rules, admin corrections, optimistic concurrency, append-only
  `case_status_history` with `reason_code_id` for denials) or the
  auto-transition triggers; the legacy `credentialing_status_id` /
  `payer_pipeline_state` survive as READ-ONLY dual-write mirrors (TD-35;
  `advance_payer_pipeline` dormant). **`src/lib/caseRollups.ts`** is the
  derived layer above cases: `groupPayerFulfillment` (Targeted → In
  Progress → Active, most-advanced-wins, Active = approved case OR
  enrollment fact), `providerCaseProgress`, `buildDenialRows` — E6.2/E6.4/
  E6.6 render them, nobody sets them.
- **E6.1 — Sidebar & surface restructure (#201).** Six-item sidebar (Cases ·
  Payer Setup · Reporting Center | Org Detail · Groups · Providers); Cases
  is the login landing with three pivots on ONE route (`/cases` — to-do
  default = the NBA queue, `?pivot=provider|payer`; legacy `chip/ids/runId`
  imply the payer pivot; `/work` redirects preserving `run`); `/org-detail`
  (slim container + members + the live Finish-setup banner); the 16-surface
  redirect table in `legacy-routes.spec.ts` (REDIRECTING_ROUTES +
  PARAM_PRESERVING — old links never dead-end); FixitDeck rides payer-admin
  `?tab=needs-attention`; queue default ranking = grouped tiers (overdue
  follow-ups → task dues → provider starts → rest). Interim dark surfaces
  are TD-36 with named restoring epics.
- **E6.2 — Groups & the Payer Network board.** The group gets the surface:
  `/groups` (A→Z list; single-group orgs auto-land the hub) →
  `/groups/$groupId` (layout + route-derived breadcrumb) → hub (editable
  group facts: name/TIN/operating states, admin, audited) + **Facilities**
  (state-grouped A→Z list treatment, search/filters, provider counts +
  zero-provider flag, go-live = plain `effective_date` on `FacilityForm` —
  NO location status machine; facility CRUD + CSV import live here) +
  **Payer Network** (the fulfillment board over `caseRollups` — derived
  pills, drill-down with per-state evidence + denial history from
  `case_status_history`, excluded rows w/ one-click Restore, the candidate
  buffer banner). **`enrollment_facts`** (migration `20260719150000`,
  repo-only): provider×group×payer×state, live = `expired_at IS NULL`
  (partial unique), expiry is a FLIP that re-opens the candidate; service
  `enrollmentFacts.ts` + hooks (capture UI is E6.4). **Buffer math
  `src/lib/generationBuffer.ts`** = the E6.3 contract: candidates =
  buildGenerationPreview proposed rows − live facts (`subtractLiveFacts`),
  cause = newest of join/attach/fact-expiry among candidates. **Group-basis
  attach** (`src/lib/groupPayerAttach.ts` + `GroupAttachPayerDialog`):
  eligibility = catalog ∩ GROUP OPERATING STATES (not facility states);
  `attachGroupPayer` creates the org enablement implicitly
  (addAssignment → targets, RLS order); `removeGroupPayer` archives the
  group's targets then the enablement iff no other group holds the payer
  (TS-122/124). **Payer-attach CSV** rides the E3.3 machine: entity_kind
  `payer_attach` (`20260719150100`), descriptor `contextScan` seam
  (`SectionScanContext` threaded through `useStartRosterScan`/
  `RosterUploader.scanContext`) stamps resolved ids at scan time;
  `commitPayerAttachImportRun` is idempotent skip-on-match;
  `/import/$runId` branches to `PayerAttachImportPreview`. Board reads
  compose in `usePayerNetworkBoard` (uses `useGenerationPreview` + facts +
  `listCaseDenialEntries` — key `["cases", orgId, "denial-entries"]` so
  set_case_status invalidations re-derive it). e2e: `groups-hub.spec.ts`,
  `payer-network-board.spec.ts`, `group-payer-attach.spec.ts`
  (TS-108/109/110/113/122/123/124). The E6.1 groups shell +
  GroupSummaryCard/FacilitySummaryCard were deleted; TD-39 (wizard/group
  duplicate intake doors), TD-40 (disabled Review & generate until E6.3).
- **E6.3 — Decoupled generation (the ONE door).** `/generation` is ALIVE
  again as the full-screen preview grid (supersedes the E6.1 interim
  redirect; legacy `?payerId/groupId` spellings still scope it), entered
  pre-filtered from the board banner (`?group=`), a payer row
  (`?group&payer&pivot=payer`), a facility row (`?group&facility`), and the
  provider record (`?provider=`); `/generation/runs*` restored. ONE additive
  migration (repo-only, `20260719160000_e63_run_row_dispositions.sql`,
  hosted probe rollback-verified): the run-row disposition CHECK gains
  `skipped` (skip-for-now) + `enrolled` (fact-covered), both
  reason-required — a confirm's immutable ledger now accounts for EVERY
  candidate. **Pure `src/lib/generationGrid.ts`** (+suite): `bucketGridRows`
  (candidate/enrolled/existing/excluded — facts overlay wins only over
  proposed), `filterGridRows` (scope), `groupGridRows` (pivots, key-stable
  selection), `reconcileGrid` (the sum-invariant confirm-bar line "Create 4
  · 1 excluded · 2 enrolled — 7 of 7 accounted for"), `splitGridSelection`.
  `GenerationGrid.tsx` replaces + deletes `GenerationPreviewContent.tsx`:
  pivot Tabs, per-group check-alls, skip-for-now = SELECTION state only
  (nothing stored, reappears checked), Exclude…/Undo = the E2.0 reasoned
  store, E4.2 release cap + gating + fallback warning ride unchanged;
  confirm threads `skippedRows`/`enrolledRows` through
  `useConfirmGeneration` → `generationConfirm.ts` records them as ledger
  rows (capped-out rows record as skipped); landing is **`/cases?run=`**.
  **F6.3.5 one door:** starter cases retired outright (`starterCases.ts` +
  test + PayerSetupList toggle deleted; `providers.new.tsx` creates ZERO
  cases; `org_payer_assignments.starter` dormant per the additive rule);
  launch `CreateCasesDialog` + `generateLaunchCases`/`useGenerateLaunchCases`
  deleted. **`src/lib/oneDoor.test.ts`** greps the comment-stripped src tree:
  createCase/`create_case_with_tasks`/useCreateCase callers ⊆ {cases.ts,
  generationConfirm.ts, useCases.ts, ManualCaseModal, NewCaseModal (E6.4
  retires), generated types} and pins the two retired creators dead. e2e
  `e2e/decoupled-generation.spec.ts` (TS-111 buckets/pivots/skip-vs-exclude/
  ledger/landing, TS-125 payer-scoped entry over a 4-provider roster, TS-126
  concurrent-duplicate safe skip + honest partial failure, TS-127
  provider-scoped entry); board/legacy-routes/funnel specs retargeted
  (`/generation*` back in RENDERING_ROUTES).
- **E6.4 — Providers area (the consolidated people record).** NO migration
  (facts shipped in E6.2). **Roster:** `/providers` rebuilt as the A→Z
  PHI-safe table (fixed last-name sort stated on screen; group/license-state/
  has-gaps filters) with ambient gap pills from pure
  `src/lib/providerGaps.ts` (+suite — reuses `CAQH_CURRENT_DAYS`, license
  expiry, and the E2.0 no-assignment-not-generatable rule; reference/
  terminated never gap; pills deep-link `#section` on the record); the old
  case-grouped work view is gone (casework = /cases). **Record:**
  `/providers/$id` is the one-page record — section jump-nav (Identity ·
  Groups & facilities · Licenses · Enrollments · Cases · Documents,
  hash-focusable), inline per-field editing via
  `src/components/providers/InlineField.tsx` (ONE audited `updateProvider`
  patch per field; DOB masked-at-rest/reveal-on-edit; SSN stays
  `SsnVaultField`), `GroupsFacilitiesPanel` (chips + "+ Add facility" over
  the EXISTING `setAssignments`/`set_primary_assignment` paths + the new
  NARROW `providers.ts setGroupAssignments` — planAssignmentSync order,
  group_id mirror; assignments are unreachable from every other record
  edit, killing the wipe defect), `EnrollmentsPanel` (fact capture +
  Expire; `ENROLLMENT_GUARD_TEXT` pins the no-prior-employer rule), the
  read-only Cases panel (E6.0 pills, prior denials from
  `useCaseDenialEntries` preserved beneath reapplied cycles, x-of-y header
  via `providerCaseProgress`), a licenses-only editor dialog
  (`updateProviderWithLicenses` with an EMPTY patch), and the E4.5
  `DocumentsPanel` (page wrapped in `TooltipProvider` — the panel's row
  tooltips need it; the rebuild initially dropped it and the router error
  boundary ate the page). **Retired:** `/providers/$id/edit` → redirect
  (legacy-routes row), `EditProviderForm` deleted, provider-detail
  `NewCaseModal` deleted (oneDoor.test.ts allowlist shrank — ManualCaseModal
  on /cases is the ONE escape hatch); wizard roster rows link "Open record"
  (create dialog stays; TD-41 notes the `/providers/new` duplicate create
  door). **CSV (F6.4.6):** the provider template gained one-row-per-
  relationship columns (`facility_name`, `enrollment_payer/state/
effective_date`) resolved to ids AT SCAN TIME via the E6.2
  `SectionScanContext` seam (`provider` member; unknown names = row errors
  naming the column); `looksLikeCombinedTemplate` re-keyed on
  `facility_street` so the extended template never trips the retired-
  combined rejection; `commitImportRun` snapshots staged rows pre-RPC then
  runs the idempotent `applyProviderRelationships` pass (dated facility
  upserts, non-primary group upserts under the unique, facts
  skip-on-live-match — never a case) returning the unified
  `relationships` summary; `providerImportReference` = the downloadable
  real-names reference sheet; the upload card renders on /providers
  (imports live with their data) AND the wizard section, both threading
  scanContext + reference. e2e `e2e/providers-area.spec.ts`
  (TS-112/113/129/130; TS-128's scan grain is pinned in
  `importSections.test.ts`); retargets: provider-roster TS-34/35 →
  record flows, roster-import + sectioned-intake header lists extended,
  unified-case-status record slice → the Cases panel, legacy-routes +
  `/providers/$id/edit` redirect row.
- **E6.5 — Payer Setup consolidation (Catalog | SOPs + global authoring).**
  ONE repo-only migration (`20260719170000_e65_global_authoring.sql`, hosted
  apply = operator step; all probes ran rollback-wrapped on hosted):
  **portals gained a GLOBAL tier** (`org_id` nullable + partial unique
  `uq_portals_global_key` + global SELECT disjunct + `proven_at` dry-run
  stamp), **`payers.delegation_note`** (curated fact, NO app writer), and
  FIVE SECURITY DEFINER RPCs — `author_global_sop` (create seeds v1 via the
  trigger; update = match-key/archive only; in-body NULLS-NOT-DISTINCT grain
  guard + payer+state required + fallback locked), `upsert_global_portal`
  (key immutable; URL change clears verified+proven), `set_global_portal_flags`,
  `train_global_field_map` (approve/manual/repropose on `org_id NULL` maps),
  and the reissued `publish_sop_template_version` (global branch open to
  authenticated — the INTERIM F6.5.6 posture, TD-42; anon rejected in-body
  via `auth.role()`, explicit grant floor closing the `20260715140300`
  default-grant hole). Global publishes/writes have NO audit rows
  (`audit_log.org_id` NOT NULL — version rows/timestamps are the trail).
  **Module (SUPERSEDED by the Payer & Cases program — see that entry; kept
  for the derivations, which are all still live):** `/admin/payer-admin/catalog`
  - `/admin/payer-admin/sops` were REAL segments here (index = redirect mapper
    for every legacy `?tab=`; org-settings → `/org-detail`; since E6.6 only
    ResolutionIdSettingsSection + PayerResolutionIdDialog remain under
    `components/settings/` — the reason-code and queue-ranking editors are
    deleted, F6.6.6). **Both segments are now redirect shells → the Slice G
    `setup` segment**, and the three components that composed them
    (`PayerReadinessFunnel`, `PayerCatalogBrowser`, `TemplatesList`) are
    DELETED. What survives is the derivation: **pure
    `src/lib/payerReadinessFunnel.ts` + `usePayerReadinessFunnel`** over
    `activeOrgPayers` (per-payer sopPublished/formState(none|registered|
    trained|proven)/driftCount + ONE next action author_sop→register_portal→
    train_mappings/repair_drift→run_dry_test→ready; no-online-form SOP =
    ready-with-note) — now consumed by Slice A's Payer Setup page and Slice C's
    Templates tab. Drift is a Payer Setup KPI card (the standalone repair
    banner is on the bundle's do-not-re-add list; `useFormDrift` is untouched);
    the delegation fact renders on Payer Detail. **In-editor form machinery
    (`src/components/templates/FormStepPanel.tsx`):** mounted under every
    online_form step (collapsed by default — the TemplateTaskRow memo/latency
    contract holds; ONE new primitive prop `isGlobalAuthoring`): register/pick
    portal (tier by template), inline trainer (broken-first; org rows via the
    audited RLS mutations + dictionary learning, global rows via the RPC),
    and the **mock-data dry run** — `src/lib/mockFillProfile.ts` (versioned
    synthetic token map, never PHI/provider reads; supersedes
    `resolveTestProviderTokens`, deleted) through `computeTestRun` →
    `recordTestFillFromApp` (`providerId` now nullable) → pass = zero
    unmatched → proven flip. **Wizard global authoring:** `TemplateWizard`
    gained `globalTier`; global rows are editable (fallback stays read-only —
    sop-versioning TS-47 narrowed), create/duplicate/match-key/archive route
    through `authorGlobalSop`, content publishes through the RPC (blast-radius
    ack), payer+state required for global keys. **Drift (F6.5.4):**
    `src/lib/formDrift.ts` (+suite) carries the E4.3a contract standalone
    (parseSkippedEntries/FIELD_NOT_FOUND_REASON/mapId-then-label join,
    latest-REAL-fill reduction, buildDriftByPortal, **repaired-since rule** —
    a map edited after the reporting fill drops out until the next real fill)
    → `useFormDrift` (2 caches) feeds the Sidebar badge (drift-only now),
    funnel column, and editor queue. **Retired outright:** FixitDeck/
    `useFixit`/`fixitQueue.ts`/`fixitFields`/`goodCatches`, `PayerSetupList`/
    `usePayerSetup` (payerSetup.ts slims to `activeOrgPayers`/
    `resolutionIdSource`), `FormOnboardingPanel` + its route (redirect), and
    the **MSO routing engine app-side** (`getMsoRoutingRule`/`useMsoRoutingRule`/
    msos service+hooks/keys + the case-detail callout; tables stay dormant —
    live-verified 0 rows; delegation renders from the catalog fact).
    Legacy redirects retargeted (fix-it/admin-portals/payer-directory/
    portals-train/mso-routing/admin-payers/admin-templates → the segments).
    e2e: NEW `e2e/payer-setup-module.spec.ts` (TS-114/131/132/133/134,
    stateful RPC write-through harness) supersedes `fix-it.spec.ts` +
    `payer-setup-funnel.spec.ts` (deleted); payer-admin-module/admin-payers/
    legacy-routes retargeted; template-typing-latency stays green.
    `payerGovernance.test.ts` re-anchored (funnel posture + delegation_note
    no-app-writer pin).
- **E6.6 — Reporting Center Organization & Touch Unification (CLOSES the E6
  wave).** NO migration — pure derivations + a presentation/verb
  consolidation. **Grouped index (F6.6.1):** `src/lib/reports.ts` gained
  `ReportGroup`/`REPORT_GROUPS`/`reportsInGroup` and per-report `group`;
  `reporting.index.tsx` renders the four groups (Performance: Portfolio ·
  Launches · Facilities Without Providers · Locations per Group /
  Credentialing: Denials · Expiring Credentials / Compliance: Audit Log /
  Intake: Inbound Leads with a new-lead count badge only when leads await).
  Leads triage moved OFF Org Detail entirely → `/reporting/leads`
  (`InboundLeadsPanel` gained `alwaysRender` for the honest empty state).
  **Launches report (F6.6.2, `/reporting/launches`):** pure
  `src/lib/launchReport.ts` (+suite) — DATE-ONLY (no location statuses):
  active non-reference facilities with a go-live in the future or ≤30 days
  past, grouped by group / date-sorted; open-case counts use the E2.3 union
  (case.facility_id ∪ the provider's assignments — generation cases carry no
  facility_id); at-risk = go-live within 30 days AND (open cases OR zero
  providers), rule text single-sourced (`LAUNCH_AT_RISK_RULE_TEXT`) and
  rendered inline. `/launches*` redirects here. The orphaned
  LaunchEditModal/AssignProviderDialog + `launchReadiness.ts` are deleted;
  launches service/hooks slimmed to `getLaunchLocation`/`useLaunchLocation`
  (providers.new `?locationId`) + `useLaunchLocations`;
  GroupFacilitiesContent repointed to `useProviderAssignments` (same key).
  **Denials report (F6.6.3, `/reporting/denials`):** caseRollups
  `buildDenialRows` FINALIZED to the epic contract — a row per case
  CARRYING a denial (`cycleState standing|reapplied` + `currentStatus`;
  reapplied cases stay visible), groupers genericized; display assembly +
  CSV in pure `src/lib/denialsReport.ts` (+suite; "Reapplied — now X"
  labels). The report joins useCases + useCaseDenialEntries +
  useDenialReasonCodes exactly like the provider record's Cases panel
  (parity by construction); provider-first default, payer pivot, CSV via
  csv.ts. The clientProgress chain (lib+test+service+hook+components) is
  DELETED; `/client-progress` + `/progress` redirect to the report.
  **Audit + counts (F6.6.4):** `admin.audit.tsx` content moved WHOLESALE to
  `src/components/reporting/AuditLogReport.tsx` (same filters/diff viewer;
  the admin gate moved WITH it — non-admins get an EmptyState and the fetch
  stays disabled) at `/reporting/audit-log`; `/admin/audit` is a redirect
  shell. Two counts reports over pure `src/lib/countsReports.ts` (+suite):
  `/reporting/facilities-without-providers` + `/reporting/locations-per-group`.
  **Add touch unification (F6.6.5):** the single-case structured form was
  EXTRACTED from CaseTouchesPanel into the shared
  `src/components/cases/AddTouchForm.tsx` (selector/string contract
  preserved — TS-105/TS-56 stay green; generalized `bumpTargets` → per-case
  F6.0.3 suggestions grouped by target status, single-case renders the
  exact legacy string). NEW `AddTouchDialog.tsx` = case checkbox list +
  the shared form: `bulkLogTouch` batch semantics (one touch per case +
  per-touch audit + batch summary), then one `set_case_status` per ACCEPTED
  bump with THAT case's touch as evidence (`expectedStatus` null); a failed
  bump never unwinds the touches. Entry points: the /cases toolbar's ONE
  "Add touch" (replacing "Log touch" + "Log payer call"; keeps the
  `?pivot=payer&ids=` landing) and the provider record's Cases panel.
  RETIRED: BatchTouchpointDialog + BulkLogTouchDialog +
  `communicationEvents.ts`/`useCommunicationEvents.ts` (write path only —
  getCase's "Part of {payer} call" batch display still reads
  `communication_event` directly). NB the /cases toolbar rename created a
  TanStack-transition trap: a test clicking "Add touch" right after a
  row-link navigation can hit the still-mounted source route's toolbar —
  wait for the destination content to COMMIT first (TS-56 carries the
  fix + comment). **Fixed defaults (F6.6.6):** ReasonCodeManager +
  QueueSettingsPanel and their whole chains deleted
  (useReasonCodes/denialReasonCodes.ts service/queueSettings.ts +
  queryKeys); the denial word-list IS the six seeded global codes
  (documented at `listDenialReasonCodes` in cases.ts — platform change =
  service-role SQL; every read path untouched); queue ranking runs the
  FIXED shipped order — the `rankingConfig` input/validator were REMOVED
  from `buildNextBestActions` and BOTH config reads dropped (browser
  useNextBestActions + server nextBestAction.ts — no /api wire change);
  `next_best_action_configs` is dormant (TD-44). Org Detail kept
  ResolutionIdSettingsSection only — until the 2026-07-20 re-scope removed it
  too (see the post-E6 wave note below). e2e: touch-log.spec.ts REWRITTEN
  (TS-115 multi-case + TS-137 suggestion rules, stateful RPC/touches
  write-through); reporting-center.spec.ts extended (four groups, badge,
  TS-135, TS-136 incl. CSV download, counts, audit relocation);
  legacy-routes rows moved (/admin/audit → REDIRECTING; launches/progress
  retargets); payer-admin-module TS-78/TS-91 flipped to negative pins;
  contact-inbound operator half → /reporting/leads.

### Post-E6 user-feedback wave (2026-07-20, PRs #217/#218/#221/#223/#224)

Live-usage handoffs recorded via the browser extension, shipped same-day:
form/UX fixes (#217: Operating-states wheel-scroll fix via an owned
non-passive listener, group-level malpractice moved onto the canonical
`group_insurance_policies` table, provider-form address/malpractice removal,
license-grid regrid; #218: capture-link card + invite UI removed from Org
Detail — backend kept; role chips label from live `party_role_types`).
**Catalog UX (#221 + the #223 follow-up):** "my network" verbs (Add to my
network / In my network), list slimmed to browse columns, in-place states
popover, "In my network" filter (auto-widens the kind filter), and the
read-only **payer detail drill-in `/admin/payer-admin/catalog/$payerId`**
(`PayerDetailContent` — identity incl. catalog key/avg decision/identifier
label, full states, the payer's SOPs + portals, network actions). Root cause
of the "Couldn't load payer readiness" 400 was HOSTED DRIFT — the operator
migrations `20260719170000`/`20260719190000` had never been applied; both are
now live and **hosted is fully in sync with the repo** (types.ts regen is
safe again). **#224 (three handoffs):** (1) the resolution-identifier
re-scope — migration `20260720230000` (repo + hosted) added
`payer_issued_id` to `enrollment_facts` (provider PIN, captured/edited on the
E6.4 EnrollmentsPanel with payer-labeled fields) and `payer_network_targets`
(group PIN per state, edited from the board's Group-IDs dialog); Org Detail's
Resolution identifiers table + the whole org_payer_settings app chain deleted
(`resolveIdentifierConfig(payer)` is two-tier; the label shows as a payer
fact on the catalog detail); (2) **`CsvImportPanel`**
(`src/components/import/`) — every CSV entry point (wizard sections,
/providers, group facilities, the board) renders the ONE collapsed-by-default
disclosure; (3) the case-detail List/Wizard tabs retired — `CaseWizard.tsx`
deleted, its step bodies extracted to `src/components/cases/StepDetails.tsx`
(`StepBody`) and rendered in the **TaskDrawer** under unlocked steps (the
F1.7b.5 Gmail hand-off + pdf filler live there now; the gmailCompose
no-auto-send pin greps StepDetails; `caseWizard.ts` keeps the token-highlight
helpers). e2e retargets ride each PR; sop-email-recipients' resolve test now
runs through the drawer. **Unified provider enrollment view (2026-07-21, no
migration):** the record's Enrollments panel now composes manual facts AND
APPROVED cases through pure `src/lib/providerEnrollments.ts`
(`buildProviderEnrollmentRows`, tested) — an approved case derives a
read-only "From case" row carrying the case's own
`confirmed_effective_date` and `payer_individual_provider_id` (payer-labeled
chip, "Open case" link, no Expire), so resolving a case updates the
enrollment picture by DERIVATION, never a dual write (facts stay
migration-capture; a status correction away from Approved re-derives the row
out; deliberately NO dedupe against a live fact on the same combo — its
Expire must stay reachable). In-flight cases stay the Cases panel's job.
`CASE_LIST_COLUMNS` gained `payer_individual_provider_id`; TS-113 extended
with the derived-row slice. **Provider-record UX handoff (2026-07-21, same
day, 7 issues):** (a) THE licenses save-failure root cause —
`updateProviderWithLicenses` with the record dialog's EMPTY patch issued
`.update({}).select().single()` on `providers`; real PostgREST matches ZERO
rows on an empty PATCH so `.single()` 406s ("Could not save licenses." on
every save; the e2e mock masked it by accepting empty PATCHes — the
provider-roster harness now mirrors the zero-row behavior and TS-35 pins
ZERO providers PATCHes during license saves). The service now SKIPS the
providers write when the payload is empty (`after = before`). (b) Licenses
UI rebuilt to the standard pattern: "+ Add license" + per-row Edit/Remove
(single-license dialog + remove-confirm; every write composes the FULL list
through the same audited sync; blank state-board URL accepted for
unverified — required only for verify/fail; `LicenseListEditor` remains the
wizard create-flow editor). (c) Identity is ONE master "Edit details" →
whole-form edit → "Save changes" committing a DIFF-ONLY audited
`updateProvider` patch (per-field `InlineField` pencils retired; component
DELETED; DOB stays masked-at-rest/reveal-in-edit; TS-112 pins the
one-changed-field patch). (d) Enrollments cleanup: live fact rows render
the standard "Active" pill ("Live" was vocabulary drift), the row Expire
button is REMOVED (service/hook `expireEnrollmentFact` kept, no UI caller),
and both enrollment add buttons say "+ Add enrollment" (the "+ Add" design).
**Org Detail consolidation (same day, Tasks A+B):** the Org Detail Profile
card is GONE (whole setter chain deleted — `ProfilePanel`/`useUserProfile`/
`userProfile` service; `{{user.name}}` still resolves from auth
user_metadata, NO in-app setter remains); `AccountDetailSummary` is
ORG-IDENTITY only (name + organization address — people are never restated
there); `PartiesManager` is headed **"People"** (was "People Enroll") and is
the ONE people surface: contacts with role chips — the governed labels now
read "Authorized contact"/"Organization contact" (migration
`20260721120000_party_role_label_terminology.sql`, repo + hosted;
`PARTY_ROLE_LABELS` fallback mirrors) — PLUS the **"Access" subgroup**
rendering `MembersPanel` INSIDE the section (member role dropdown/joined/
remove capability and admin-only rules bit-identical; the standalone
"Manage who has access" section + helper line are gone). **Scope Review
relocation (same day):** the wizard section is GONE — the readiness matrix
lives on the provider record as the **Readiness** section
(`src/components/providers/ProviderReadinessSection.tsx`, provider-scoped:
no Provider column, payer/state/gap filters, fix-here links anchor the
record's own sections, group-doc gaps still link /groups; same
`useEnrollmentReadiness` derivation, still advisory, nothing stored).
`onboardingProgress` dropped `scope_review` (6 active sections;
`resolveScopeReviewStatus` deleted; wizard completeness — and the
Finish-setup banner — no longer depend on readiness; the wizard hook no
longer composes `useEnrollmentReadiness`). **Terminology: the canonical
noun is CASE** — every generation entry reads "Generate cases" (record
header + Readiness CTA + board/facilities rows + /generation PageHeader +
runs back-link; "Generate applications"/"Review & generate" are gone). The
`/generation` URL itself deliberately stays (internal identifier; renaming
is pure churn — revisit only if product insists). e2e:
`scope-review.spec.ts` → **`provider-readiness.spec.ts`** (TS-43/44 on the
record); onboarding-wizard TS-25/28, import-preview TS-63, and
document-storage TS-89 retargeted.

- **Provider-detail redesign (2026-07-21, design handoff — supersedes the
  E6.4 single-scroll jump-nav).** `/providers/$id` is now **TABBED** (handoff
  issue 8: one section at a time, so no sticky nav overlaps content). Seven
  underline tabs on `@radix-ui/react-tabs` primitives (styled inline in
  `providers.$id.index.tsx`, NOT the pill-style shared `ui/tabs`): Provider
  Info · Groups & facilities · Licenses · Enrollments · Cases · Documents ·
  Internal Notes (Internal Notes is now a tab, was a bottom panel).
  `activeTab` is DERIVED from the URL hash via `HASH_TO_TAB`: the roster
  gap-pill deep-links (`#identity`/`#groups-facilities`/`#licenses`, TanStack
  `Link` hash) AND the Readiness fix-here `<a href="#x">` anchors (a native
  `hashchange` listener — the router does not observe those) both activate
  the right tab; `onTabChange` reflects the tab in the URL (`navigate` +
  `replace`). **Readiness lives INSIDE the Cases tab** (user ask —
  `#readiness` maps to `cases`): #229's `ProviderReadinessSection` is
  rendered verbatim in the Cases `TabsContent` under its own
  `RecordSectionCard id="readiness"`, so the specs that read `#readiness`
  (`provider-readiness`, `document-storage` TS-89, `import-preview` TS-63)
  now click the Cases tab first. **Header:** a **facility line** (Building2
  icon + the primary facility's name + address) REPLACES the routine status
  badge + the `providerCaseProgress` "x of y approved" meter (both removed as
  noise per the handoff; the header no longer reads `useCases`); Terminated /
  Pending verification / Reference edge pills are kept, NPI/CAQH/Taxonomy are
  mono, and the #229 "Generate cases" + Terminate actions stay. **Provider
  Info** is reorganized into three labeled sub-groups (Personal / Credentials
  & identifiers / Education & employment) and **home address + malpractice
  were removed from the edit form** (handoff decision, user-confirmed: home
  address is set at creation via `ProviderFormSections`; malpractice is
  managed at the group level via `InsurancePanel`/`group_insurance_policies`
  — both columns are untouched in the DB and still feed autofill/readiness).
  SSN (`SsnVaultField`) sits in the Personal group; the #228 ONE master
  "Edit details" → whole-form → "Save changes" diff-only patch is unchanged
  (now in the card header, pencil icon). **New shared primitives**
  `src/components/providers/RecordSectionCard.tsx`: `RecordSectionCard`
  ({id,title,action}, keeps `#{id}-heading` so deep-links still land) +
  `AddButton` (the ONE "+ Add" affordance — primary forest green, leading
  "+" glyph kept in the accessible name, whitespace-nowrap).
  `IdentitySection` / `LicensesSection` / `CasesSection` /
  `GroupsFacilitiesPanel` / `EnrollmentsPanel` each render their own
  `RecordSectionCard` with the section add in the header (`+ Add
group/facility/license/enrollment/touch` all via `AddButton`);
  `DocumentsPanel` + `CaseNotesPanel` keep their own self-carding (shared
  components, untouched). Add license stays a **Dialog** (the app has no
  Sheet primitive; the handoff's slide-over is presentational and the e2e
  pins `role=dialog "Add license"`). e2e: 7 provider-record specs gained
  tab-activation clicks (providers-area also renames the Identity heading →
  "Provider Info"); no migration, no new deps (`@radix-ui/react-tabs`
  already present).

- **Group malpractice coverage + onboarding/standalone parity (2026-07-29,
  user handoff).** Malpractice is a LIST beside the group, not fields on it.
  ONE additive migration (repo + hosted,
  `20260729120000_group_insurance_coverage_level.sql`):
  `group_insurance_policies.coverage_level` (`primary|secondary`, default
  `primary`, CHECK) + partial unique
  `uq_group_insurance_policies_one_primary (group_id, insurance_type) WHERE
coverage_level='primary'` — a group must carry a primary policy and may
  carry secondaries, which the four flat malpractice fields on
  `ProviderGroupForm` (post-E6 wave #217) could never express, so those
  fields are GONE: the group form is high-level metadata again.
  `InsurancePanel` moved `components/settings/` → **`components/groups/`** and
  is now the ONE coverage surface (coverage select + Primary/Secondary pill,
  labels wired to inputs via `#policy-*` ids, `translateDbError` on both
  writes so the one-primary 23505 reads as a sentence). It renders in BOTH
  places a group is worked: the wizard's `ProviderGroupSection` (per-group
  disclosure beside Documents — the two Collapsibles became plain
  aria-expanded buttons so only one opens at a time) and the standalone group
  hub. **Parity fix:** `GroupFactsCard`'s three-field dialog (name/TIN/states)
  is replaced by the SAME `ProviderGroupForm` the wizard uses — a group edited
  outside onboarding previously could not reach its NPI or its address +
  contact blocks (the card also now shows NPI + the credentialing-else-billing
  address). NB that also means the hub edit now enforces the wizard's billing
  address requirement on legacy groups. `providerProfile.pickPolicy` prefers
  the PRIMARY malpractice row before the newest-end-date rule (refines the
  E4.3 F4.3.5 Q4 tie-break; no wire change). The new column is a
  `get_sop_field_tokens()` token, classified as internal in
  `quickCardCatalog` (excluded from cards; ACKNOWLEDGED_TOKENS updated).
  **types.ts was hand-edited, not regenerated** — the MCP generator returned a
  snapshot missing `provider_field_verifications` (live on hosted since
  2026-07-28), so a full overwrite would have deleted real types; regen only
  after confirming that table appears. e2e: provider-group TS-29 retargeted
  (form carries no malpractice; the policy is written through the panel with
  `coverage_level 'primary'`; the hub opens the full form), groups-hub TS-108
  updated for the full-form dialog (its GROUP_A fixture gained a billing
  address).
- **Cases page redesign (2026-07-22, design handoff — PR #233 to `main`).**
  `/cases` (`src/routes/cases.index.tsx`) rebuilt as ONE surface with three
  VIEWS via a segmented control: **Flat** (default) · **By provider** · **By
  payer**. The E6.1 "to-do" pivot is retired **as a tab** but its ranking is
  not — Flat's DEFAULT sort IS the E2.3 deadline ranking (reused via
  `useNextBestActions`); a column header switches to that column's sort (Case
  Status = spine order via `CASE_STATUSES` index). By provider/By payer are
  grouped `GroupedList` cards, **collapsed by default** (new additive
  `defaultCollapsed` prop; existing callers unchanged) with subtitle +
  "X of Y approved" rollup + red "N needs action" pill (needs-action = open
  `ours`-bucket cases). **The orphaned `NextBestActionQueue` component (the old
  to-do pivot UI, whole `src/components/work/` dir) is DELETED** — the ranking
  lives on only as Flat's sort. **Case# (NEW):** migration
  `20260722120000_case_number.sql` (repo + hosted) adds a `case_number bigint
NOT NULL` column on `credential_cases` — a globally-sequential (ONE
  `credential_cases_case_number_seq` across ALL orgs, not per-org), immutable
  (BEFORE UPDATE trigger) number backfilled base-1001 in global `created_at`
  order, drawn by a column DEFAULT so `create_case_with_tasks`'s explicit
  column list is unchanged (no RPC change); shown `C-<n>` in mono and IS the
  row click-through (no separate Open affordance). `CredentialCase.caseNumber`
  and `CASE_LIST_COLUMNS` carry it. **KPI cards are DERIVED FILTERS, not
  statuses** (Total · In progress · Awaiting effective date [Approved w/o
  `confirmed_effective_date`] · Denied/appeal); selection rides `?chip`. Status
  vocabulary is ONLY the canonical `caseStatus`/`CaseStatusPill`. Pure view
  logic (KPI/filter/sort/group/paginate) in `src/lib/casesView.ts` (+tested).
  URL back-compat preserved: `?pivot`/`?chip` (legacy needs/generic→Total)/
  `?ids`/`?runId`/`?run` + the `/work` redirect. e2e: `cases-pivots.spec.ts`
  rebuilt; `next-best-action-queue.spec.ts` deleted with its component;
  `unified-case-status` TS-104 retargeted to Flat + the Case# link.

- **Payer & Cases UI program (2026-07-27/28) — the design bundle's six
  screens, seven slices, all merged: A #244 · B #245 · C #248 · D #242 ·
  E #246 · F #243 · G #249 (+ its follow-up).** The build handoff is
  `docs/redesign/payer-cases-ui-build-handoff.md` — its **§2 is the binding
  record** of the conflicts and their resolutions (§2.1: the design's
  "Didn't receive" escape beats #237's strict Approved rule, which is why
  E6.8 F6.8.3 exists; §2.7: the deliberate-removals list, **amended
  2026-07-28** — the next-step CTA was reinstated on screen 3, see below).
  **NO migration in any slice** — every write rides the E6.7/E6.8 RPCs
  (`create_payer`/`update_payer`/`archive_payer`/`reactivate_payer`/
  `merge_payer`/`set_case_status`), so the payers table lockdown and the
  RPC-only governance pin hold unchanged.
  - **Slice A — Payer Setup (screen 1), `/admin/payer-admin/setup`.** ONE
    list, no tabs: `payer-admin/PayerSetupPage.tsx` over pure
    `src/lib/payerSetupView.ts` (+tests) — the shared `activeOrgPayers`
    inclusion rule with archived rows opt-in behind "Show archived" (the
    E6.8 seam), FOUR KPI filter cards, search · State · Kind toolbar,
    pagination. Template/form/drift facts are CONSUMED from the E6.5
    readiness funnel rows, never re-derived.
  - **Slice B — Add / Edit Payer (screen 2).** `PayerNameStep` (name +
    `findPayerNearMatches`, duplicates surfaced BEFORE anything is written)
    → `PayerDetailsForm` + `PayerStatesField`. ID expectations hydrate
    through the SHARED `payerResolutionIdentifier.ts` resolvers — never a
    local default (the review fix: NULL columns resolve provider-EXPECTED).
  - **Slice D — Case Close & IDs (screen 5).** The close dialogs against
    E6.8's ack flags + **Awaiting ID**: pure `src/lib/payerIssuedIds.ts`
    `enrollmentIdBadge` — a payer that EXPECTS an ID whose case closed
    Approved with it still NULL reads "Awaiting ID", DERIVED at render,
    never stored; back-fill rides the existing set-later paths.
  - **Slice F — Template Editor (screen 4).** Five inline online-form modes
    (register · capture · map · repair · prove) + the derived context banner
    a readiness CTA deep-links into via `?intent=`
    (`src/lib/templateEditorIntent.ts` `TEMPLATE_EDITOR_INTENTS`). The
    banner describes a CONDITION, so it clears itself when the work is done.
  - **Slice E — Case Detail (screen 6).** Pure `src/lib/caseDetailView.ts`
    (task/step progress, `facilityAddressLine`, and the follow-up's
    `evidencedTransitionsByTouch`); `CaseDetailsPanel` · `CaseStatusControl`
    - `CaseStatusDialogs` · `CaseStatusHistoryPanel`. **The status-history
      timeline and the touchlog cross-link both ways:** a transition links its
      evidence touch (`#touch-<id>`) and that touch marks the transition back
      (`#status-<id>`), derived from the FULL history so filtering the
      touchlog never changes a row's marker. NB the Update-status menu's
      reapply runs `set_case_status` ONLY — **task regeneration lives in
      `ReapplyCaseAction`** (`appendCaseTasks`), and the copy on both paths is
      written to keep that distinction honest.
  - **Slice C — Payer Detail (screen 3), `/admin/payer-admin/setup/$payerId`.**
    TABBED (Overview · Enrollments · Cases · Templates · Scorecard · Manage)
    and identity is EDITABLE in place, reusing Slice B's `PayerDetailsForm`
    — never a second form. Pure `src/lib/payerDetailView.ts` reads EXISTING
    modules rather than re-deriving them (IDs → Slice D's `enrollmentIdBadge`;
    template readiness → the E6.5 funnel; case openness →
    `OPEN_CASE_STATUSES`). Archive/Merge live on the Manage tab over the E6.8
    RPCs. **Editable affordances gate on `canEdit` (admin AND status active)**,
    not bare `isAdmin` — `update_payer` raises `payer_not_editable` on a
    merged/retired row, so an admin must not be shown controls that can only
    error. The payer resolves from the GLOBAL catalog read
    (`list_global_payers`), not `getPayer`: the RLS or-filter can't see an
    UNASSIGNED global row and this page must render for a payer the org
    hasn't adopted yet.
  - **Slice G — route cleanup + program close-out.** The stale `catalog`
    segment (named for a tab Slice A superseded) is renamed **`setup`**;
    `/admin/payer-admin/catalog`, its `$payerId` child, and
    `/admin/payer-admin/sops` are **redirect shells** (the child
    re-validates and forwards `?tab=` and `?edit=1` — dropping either would
    silently break the folded scorecard/edit redirects), and eleven legacy
    sources repoint at the new segment. `admin.payer-admin.index.tsx` stays
    the `?tab=` mapper. **Deleted (render-orphaned, importers grepped to
    zero): `PayerReadinessFunnel`, `PayerCatalogBrowser`, `PayerAdminTabs`,
    `TemplatesList`** — `payerGovernance.test.ts`'s `readFileSync` pin was
    RE-ANCHORED off the funnel (it asserts the read-only governance posture,
    not that component). The pure `payerReadinessFunnel.ts` derivation
    SURVIVES — Slices A and C consume it. Case Detail gained the `C-<n>`
    case number (the /cases row click-through had no confirmation at the
    destination). **§2.7 amendment (PM-ratified 2026-07-28):** the
    next-step CTA is BACK on screen 3's Templates tab, because Slice F's
    shipped `?intent=` consumer would otherwise have no producer; §2.7's
    removal still stands for screen 1.

- **E6.7 PR 1 — Payer Manual Setup Enabler (backend only, zero rendered UI).**
  The PM is retiring the precanned catalog browse; this PR ships the write
  path the future "+ Set up payer" dialog calls. THREE additive migrations
  (repo + hosted, `20260727120000`–`120200`; behavior verified by
  rollback-wrapped hosted probes impersonating a live admin member).
  **`20260727120000` (F6.7.1/1a/1b):** payers gains the ID-expectation split
  (`group_id_label`/`group_id_expected` + `provider_id_label`/
  `provider_id_expected`; provider pair backfilled from the legacy
  `resolution_id_*` pair, which deprecates in place — STOP-WRITE), provenance
  (`created_by`/`source seed|sync|manual` — existing rows backfilled `sync` —
  /`updated_at`), a `source` CHECK (kind/status CHECKs already existed from
  E1.6 — re-asserted + VALIDATEd), and the dup backstop partial unique
  `uq_payers_global_normalized_name` on `lower(btrim(name)) WHERE org_id IS
NULL AND status <> 'merged'` (live data verified collision-free first).
  **`create_payer`/`update_payer`** are the ONLY payers write path (SECURITY
  DEFINER, authenticated, anon rejected in-body, writer-member of the caller
  org, audited under it; the 20260718120000 table lockdown STANDS): rows are
  GLOBAL (`org_id NULL`, PM decision), `states[]` required ≥1 `^[A-Z]{2}$`
  (attach/generation/CSV-scan all intersect it), in-body dup guard =
  normalized name+aliases vs every non-retired global row's name/aliases →
  `payer_duplicate` (merged match names its successor); create also upserts
  the caller org's `org_payer_assignments` row in the SAME transaction
  (creating = adding); update edits ACTIVE global rows only — status/merge
  stay platform-side. Shared SQL helpers `_payer_norm_name`/`_payer_norm_
states`/`_payer_norm_aliases`/`_payer_assert_name_available` (no client
  EXECUTE). **`set_case_status` reissued** (same signature): Approved now
  requires EXACTLY the expected IDs — individual when `provider_id_expected`
  (→ legacy → TRUE default), group when `group_id_expected` (→ FALSE) — new
  error `case_status_approved_needs_group_provider_id` (mapped in cases.ts).
  **`20260727120100` (F6.7.2):** `author_global_sop` +
  `publish_sop_template_version` reissued — the fallback SOP's blanket
  authenticated lock is GONE (content publishes like any global SOP);
  structural guards stay under the same `fallback_sop_locked` name (no
  archive, no payer/state/group, still the only payerless global row).
  **`20260727120200` (F6.7.2a):** `payer_contacts` child table (purpose grain
  CHECK credentialing|enrollment|escalation|general, email-or-phone CHECK,
  partial unique ONE default per (payer, purpose)); member SELECT via the
  restated parent-payer visibility disjunct; writes ONLY via the audited
  `upsert_payer_contact`/`delete_payer_contact` RPCs (in-RPC default swap;
  hard delete allowed — operational data). **Frontend seam (F6.7.3, no UI):**
  `payers.ts` gained `createPayer`/`updatePayer` (RPC-bound — still zero
  direct INSERT/UPDATE) + typed `PayerDuplicateError`; `payerContacts.ts` +
  `usePayerContacts.ts`; `useAdmin.ts` `useCreatePayer`/`useUpdatePayer`
  (invalidate payers/payer/assignments/catalog); pure
  `src/lib/payerNearMatch.ts` (`normalizePayerName` mirrors `_payer_norm_name`
  — keep in lockstep; `findPayerNearMatches` exact-name/exact-alias/partial +
  merged-successor surfacing; tested); `payerResolutionIdentifier.ts` chain is
  now provider pair → legacy pair → generic + the new
  `resolveGroupIdentifierConfig` (group default NOT expected). Types
  regenerated (hosted in sync); `Payer` widened + `PayerContact`/
  `PayerSource`/`PayerContactPurpose` added. `payerGovernance.test.ts`
  re-anchored: payer writes are RPC-ONLY at the service boundary, the enabler
  migration never re-grants table DML, payer_contacts is client-SELECT-only,
  and `delegation_note`'s single writer is the payers RPC seam.

- **E6.7 PR 2 — Catalog Sync Retirement (CLOSES E6.7; no migration, no
  schema change).** **F6.7.4:** the F1.6.2 seed pipeline is GONE —
  `scripts/payer-catalog-sync.mjs` + `payer-catalog-sync.d.mts` +
  `src/lib/payerCatalogSync.test.ts` deleted; the reference dataset
  `docs/redesign/data/payer-catalog/` is FROZEN (README banner — the
  quarterly refresh no longer runs; the CSVs stay as the 2026-07-12
  historical snapshot). Register/SCHEMA rows updated: `payers.payer_slug` +
  `last_synced_at` are deprecated in place (stop-write — manual rows already
  write them NULL; seeded values retained per the additive rule);
  `payer_catalog_changes` is DORMANT (its only diff writer was the sync;
  table + platform-only review RPC kept). New payers are manual-only via the
  PR 1 `create_payer`/`update_payer` RPCs. **F6.7.5:** stored
  `payers.avg_decision_days` lost its only writer with the sync, so the UI
  stopped rendering it — `PayerDetailContent` dropped the "Avg decision"
  fact and the reports `SummaryTab` dropped the Expected/Variance columns
  (its "Avg days to approval by payer" table + CSV are now purely the
  OBSERVED per-case computation). Column + `Payer.avgDecisionDays` stay
  (additive rule). TECH-DEBT gained TD-45 (derive decision-days = median
  created→approved from case outcomes) and TD-46 (admin merge UI when
  manual-payer duplicate volume justifies it).

- **E6.8 — Payer Lifecycle Enabler (backend only, zero rendered UI).** The
  backend the payer-and-cases design bundle needs beyond E6.7 (archive,
  merge, the Approved "Didn't receive" escape); THREE additive migrations
  (repo + hosted, `20260727150000`–`150200`; behavior verified by
  rollback-wrapped hosted probes impersonating a live admin member — one
  probe caught and fixed a real `text[] || literal` parse bug in the ack
  path). **F6.8.1 (`150000`):** `payers.archived_at timestamptz NULL` — the
  REVERSIBLE org-workflow archive flag (NOT the platform `status` domain;
  "remove from network" collapsed into Archive since the payer list IS the
  network) — set/cleared ONLY by the `archive_payer`/`reactivate_payer`
  SECURITY DEFINER RPCs (authenticated, anon rejected in-body,
  writer-member, audited; archive rejects `payer_archive_open_cases: <n>`
  while ANY org holds an open non-terminal case — open mirrors
  `OPEN_CASE_STATUSES`, count spans orgs since payers are global, nothing
  written on reject). Exclusion is CLIENT-side filtering on `archivedAt`
  (no RLS change; closed cases keep resolving names): `activeOrgPayers`
  gained the default archived exclusion + `{includeArchived}` (the slice-A
  Show-archived seam) + `archivedPayerIds`; `splitAttachPicker` and
  `validatePayerAttachRow` exclude/reject archived (the CSV check is
  inert until the board's scanContext mapping threads `archivedAt` — a
  slice-A one-liner, deliberately not a component edit here);
  `useGenerationPreview` drops targets of archived payers before
  buildGenerationPreview AND its readiness pass (targets untouched, so
  reactivate restores scope with zero writes). **F6.8.2 (`150100`):**
  `merge_payer(p_org_id, p_loser, p_survivor)` — ONE all-or-nothing
  transaction: re-points `sop_templates` (unique_violation →
  `payer_merge_template_conflict`), `payer_network_targets` (survivor wins
  collisions: restored active if the loser's was, inherits the group PIN;
  loser duplicates ARCHIVED in place — the non-partial unique blocks moving
  them), `enrollment_facts` (colliding live loser facts EXPIRED first, PIN
  inherited, then everything moves), OPEN `credential_cases` (pre-checked:
  a 4-part-key collision raises `payer_merge_case_conflict` listing C-<n>
  numbers, committing NOTHING; closed cases stay on the loser as history),
  and `org_payer_assignments` (fold active-wins + DELETE the loser's dupe —
  the one sanctioned delete); appends the loser's name to the survivor's
  `aliases[]` (normalized-dedupe) and marks the loser `merged` +
  `merged_into_id` (dropping it out of the normalized-name partial unique).
  payer_contacts/contracts/exclusions deliberately stay (epic trace); not
  undoable from the app. **F6.8.3 (`150200`):** `set_case_status` reissued
  AGAIN — 11-param signature DROPPED, 13-param created (the E4.2
  no-overload precedent) with `p_provider_id_missing_ack`/
  `p_group_id_missing_ack` (default false): at Approved each expected ID
  must be supplied OR explicitly acked missing (silence still raises the
  E6.7 errors — supersedes the E6.7 strict-require criterion per the
  handoff §2.1 PM-approved conflict resolution); an acked ID stays NULL
  (Awaiting ID = expected + approved + NULL id, derived — slice D renders
  it), the consumed ack rides the audit `after` payload + a "Didn't
  receive: …" line under the history note, back-fill = the existing
  set-later paths. **F6.8.4 seam (no components touched):** `payers.ts`
  `archivePayer`/`reactivatePayer`/`mergePayer` (+`MergePayerResult`
  counts receipt) + typed `PayerArchiveBlockedError` (openCaseCount) /
  `PayerMergeConflictError` (conflictingCases C-list) + the lifecycle
  guard messages (error map now longest-key-first like cases.ts);
  `SetCaseStatusInput` gained the two ack flags (threaded `?? false`);
  `useAdmin.ts` `useArchivePayer`/`useReactivatePayer`/`useMergePayer`
  (payers/payer/assignments/catalog + cases; merge also targets/facts/
  templates/audit-log). `Payer.archivedAt` added; types regenerated
  (hosted in sync — the diff was purely additive). Tests:
  `payers.lifecycle.di.test.ts`, ack threading in
  `cases.status.di.test.ts`, archived-exclusion cases in
  `payerSetup.test.ts`/`groupPayerAttach.test.ts`, and
  `payerGovernance.test.ts` gained the E6.8 grant-shape block (no payers
  DML re-grant, RPC grant floors, single set_case_status overload, merge
  stays inside the table trace). Seed: TS-139's manual "United Healthcare"
  global duplicate (variant spelling — slips the normalized-name guard
  exactly like a real manual dup). TS-138/139/140 run at the RPC/service
  layer (backend-only epic — no e2e).

### Hotfix 2026-08-07 — org intake no longer auto-creates a sales rep

Every org created since E0.8 carried a placeholder person ("Zeb Loewenstine",
`zeb@mintedpanel.example.test`) on its People list holding the Sales Rep role.
Two halves of E0.2 had drifted into a defect: the RPC substituted that identity
when `p_sales_rep` was omitted (FR-1), and E0.8 F0.8.2 then removed the sales-rep
field from the intake form — so the default fired on 100% of real org creations
and nobody could have entered anything else. ONE additive migration (repo +
hosted, `20260807120000_org_intake_no_default_sales_rep.sql`; behavior verified
by a rollback-wrapped hosted probe — omitted → owner+customer only, supplied →
all three roles, incomplete → still rejected):

- **`create_organization` 5-arg reissued** (CREATE OR REPLACE — same signature,
  1-/3-arg overloads untouched): the `v_zeb` constant is gone and the sales rep
  is genuinely optional. NULL / JSON null / `{}` ⇒ no party, no assignment;
  anything else is validated by the unchanged `assert_contact_valid` and stored
  exactly as before. Customer contact stays required.
- **Data cleanup in the same migration** (idempotent, no-op on a fresh
  rebuild): deletes `sales_rep` assignments whose party carries the placeholder
  email, then the now-orphaned party rows — so it also leaves the cross-org
  "Add existing person" pool (`listVisibleParties` sees parties via
  `created_by`, so dropping the assignment alone would not have). Live at apply
  time: one org (BEST Physical Therapy LLC); after: zero `sales_rep`
  assignments anywhere, zero placeholder parties.
- **App layer:** `DEFAULT_SALES_REP` deleted from `src/lib/contacts.ts`;
  `useOrgCreateForm` no longer holds sales-rep state (its `salesRep` /
  `patchSalesRep` / `salesErrors` returns are gone — no consumer had them since
  E0.8); `CreateOrganizationInput.salesRep` is optional and sends `null` when
  absent.
- **The F0.2.2 "can't remove the org's only sales rep" guard is REMOVED** from
  `unassignRole` / `removePartyFromOrg` (and `countOrgRole` with it). It was
  only coherent while intake guaranteed a sales rep existed; with the default
  gone it would have trapped the first sales rep anyone adds, and an org may
  legitimately have none. `e2e/parties-regression.spec.ts` was flipped to pin
  the removal SUCCEEDING (write-through DELETE handler, so the refetch really
  reflects it); `contactValidation.test.ts` uses a local full-contact fixture.
- `supabase/seed-redesign.sql` still seeds Zeb across the 11 demo orgs — it is a
  local fixture universe (never runs on hosted) and TS-9/TS-10 depend on it.

### 2026-08-07 — People contact roles + contact token families

Decision record: `docs/redesign/DECISION-RECORD-2026-08-07-people-contact-roles.md`
(PM decisions D1–D14). Activates the three reserved party roles and makes contact
fields resolvable as tokens for payer-form mapping. THREE additive migrations
(repo + hosted, applied as a PAIR — the schema half makes `parties.org_id` NOT
NULL and the RPC half is what stops every party-writing function 23502-ing;
the third is a post-review hardening follow-up and is repo-only until the operator
applies it):

- **`20260807130000_people_contact_roles.sql` (schema).** `party_role_types` →
  `is_active = true` for `billing_contact` / `contracting_signer` /
  `credentialing_contact` (the `reject_inactive_role_assignment` trigger stays —
  it just has nothing to reject today). `party_role_assignments` gained
  `is_default` + partial unique `uq_party_role_assignments_default (org_id,
role_key) WHERE is_default` (D1, the `payer_contacts` shape) and its
  `scope_type` CHECK was widened with `'group'` (D2 — schema only; the UI still
  writes `'org'`). `parties` gained `first_name`/`last_name` (D6, backfilled by a
  last-space split), `title`/`fax`/`phone_extension` (D3/D7), and **`org_id NOT
NULL`** (D8) — backfilled from the earliest assignment, else the creator's sole
  membership; the four RLS policies were rewritten onto plain org membership, so
  the `created_by` visibility disjunct is retired (kept as provenance). Live at
  apply time: 1 org, 2 parties, 0 shared — the backfill was a no-op and the
  guarded orphan DELETE deleted nothing.
- **`20260807130100_people_contact_role_rpcs.sql` (functions).** FIVE
  SECURITY DEFINER functions write `parties` and all are reissued to carry
  `org_id` + the split name: `insert_contact_party` (**new 3-arg overload**; the
  2-arg form is retained per the additive rule but can no longer satisfy the NOT
  NULL — do not call it), `create_organization` 5-arg AND 3-arg,
  `create_capture_link` (its existing-party check is now ORG-SCOPED, the other
  half of the cross-org identity problem), `submit_capture` (persists
  first/last/title/fax/extension — the capture form collects split names now, so
  without this they would be silently dropped), and `validate_capture_token`
  (additive `current` keys so the public form prefills them). Five behavioral
  probes ran rollback-wrapped on hosted: reserved role assignable, second default
  rejected, second NON-default holder allowed, group scope accepted, org-less
  party rejected.
- **`20260807150937_harden_party_role_tenant_integrity.sql` (follow-up,
  repo-only).** Stops with an explicit count if any pre-existing assignment
  disagrees with its party's org, then replaces the party-only FK with
  `(org_id, party_id) → parties(org_id, id)`, makes `parties.org_id` immutable
  for every DB role, and adds the same-org join to assignment INSERT/UPDATE RLS
  checks. It also adds authenticated-only SECURITY INVOKER
  `set_default_party_role`: validates + locks the target before atomically
  demoting/promoting, with named missing-target/authorization errors.

**Token families (D9–D13) — `billingContact.*` / `credentialingContact.*` /
`contractingSigner.*`.** CODE-OWNED, not in `get_sop_field_tokens()`: that RPC
derives from `information_schema.columns` and would emit `party.email`, which
cannot say WHOSE. The family is inherently ROLE × FIELD, so it is appended the
way `{{user.*}}` is (`src/server/userTokens.ts` precedent). Pure
`src/lib/orgContactTokens.ts` (+13-case suite) owns the key surface + resolution;
server-only `src/services/orgContacts.ts` reads the org's `is_default` holder per
role in ONE query; `handleProviderProfile` appends the tokens AND their
unresolved reasons. **Naming is effectively irreversible** (token keys join
`portal_field_maps` ↔ profile ↔ quick cards by literal string match) — flat
camelCase, matching `groupInsurance.*`. Fields: firstName, lastName, **fullName**
(a server-derived COMPOSITE — the `facility.address` precedent, so a one-box form
needs no mapping-time concatenation that `portal_field_maps.token` could not
express), title, email, phoneOffice, phoneExtension, phoneMobile, fax,
addressLine1/2, city, state, postalCode, country. Resolution is at PROFILE time
(D11 — the org is on the guard ctx, unlike case-scoped `payer.*`/`mso.*`); a role
with no default holder yields null tokens plus an honest reason, never a guess.
**Deliberately absent from `sopResolver.buildTokenMap`** (D12 — a token in a SOP
body is baked into `tasks.sop_content` at case creation and would go stale) and
from `emailValuedTokenKeys()` (D13 — a contact is a value you type into a form,
not someone the system emails; consequence: a `draft_email` step cannot address
the credentialing contact). Both are PINNED as negative assertions in
`orgContactTokens.test.ts`. The keys ARE offered on extension quick cards
(`CONTACT_TOKEN_FIELDS` in `quickCardCatalog.ts`, the `USER_TOKEN_FIELDS`
append pattern).

**App layer.** `src/lib/personName.ts` (`splitFullName`/`composeFullName`/
`personDisplayName`, +suite) mirrors the SQL split helpers — keep them in
lockstep. `Party` gained orgId/firstName/lastName/title/fax/phoneExtension;
`ContactInput` captures the name SPLIT with `name` now OPTIONAL (composed at
every service boundary); `OrgParty` gained `defaultRoleKeys`; `OrgContact` gained
`isDefault`. `parties.ts`: `createParty` writes `org_id` + the composed name,
`updateParty` recomposes `name` whenever either half is patched, `assignRole`
takes `{isDefault}` and defaults the FIRST holder of a role to true, new
`setDefaultRole` calls the atomic `set_default_party_role` RPC; a missing target
raises clearly and any failure rolls back without losing the prior default.
**`listVisibleParties` is DELETED** with the F0.3.4
cross-org reuse pool, and `PartiesManager`'s "Add existing" dialog with it —
adding the same human to a second org means entering them there. Role chips now
carry a "Used on forms" marker / "Use on forms" one-click promote.
`dbErrors.ts` maps both party uniques. `ContactFields` renders First/Last +
Title + Extension + Fax; `OrgCreateFields` splits the intake name.

**Seed.** `seed-redesign.sql` party inserts are org-scoped: owners and customer
contacts resolve their org in the same statement, and **Zeb is now one party PER
org** (11 rows) rather than one row assigned across all 11 — TS-10 (Zeb also
`owner` at Point Place) survives as a WITHIN-org multi-role fixture, added
non-default beside the seeded owner.

**Guardrail review (D14).** `quickCardCatalog.test.ts` stays — it is what makes
the deny-list safe. Two exclusions look wrong on inspection and are logged, not
fixed: `groupInsurance.coverageLevel` (malpractice sections DO ask primary vs
secondary) and `provider.terminatedDate` (termination forms DO ask for an end
date). Separately, the SOP authoring picker offers only the ~19 keys
`buildTokenMap` resolves against 132 in the catalog — real debt, and the fix is
widening the map, not removing the `resolvableTokenKeys()` gate.

e2e `e2e/people-contact-roles.spec.ts` (TS-141 roles assignable + first holder
defaults; TS-142 second holder non-default + demote-then-promote at the wire;
TS-143 split-name capture + composed `name` + no reuse door). Types regenerated
(hosted in sync; `provider_field_verifications` present, so the 2026-07-29
regen caveat is CLEARED).

### E6.9 — Form Setup Simplification (2026-08-07, cross-repo)

Epic `docs/redesign/E6.9-form-setup-unification.md` (PM decisions D1–D18).
Panel PR 1 = F6.9.1–F6.9.6; extension PR 2 = F6.9.7–F6.9.9 in
`sonny303/minted-extension` (branch `claude/e6-9-form-setup-pr-1-1s2g7t`).
**E6 wave rule applies: the three migrations are REPO-ONLY — hosted apply is
an operator step**; every behavioural claim below was proven by
rollback-wrapped hosted probes.

- **`20260807160000_e69_field_registry.sql`** — additive `display_label` /
  `section` / `sort_order` on `portal_field_maps`, the two PER-TIER partial
  unique indexes behind propose idempotency (`(portal_key, selector) WHERE
org_id IS NULL` and `(org_id, portal_key, selector) WHERE org_id IS NOT
NULL`), and a tier-partitioned `sort_order` backfill. `display_label` is the
  admin's name and NEVER overwrites the payer's captured `field_label`;
  `section` likewise never overwrites `form_section`. Live data was verified
  duplicate-free before the indexes were created.
- **`20260807160100_e69_shared_registry_rpcs.sql`** — the shared-tier write
  path: `propose_shared_field_map` (ON CONFLICT DO NOTHING + re-read, so a
  re-capture returns the existing row with its DECISION intact — that is what
  makes re-capture drift repair rather than a reset), `train_global_field_map`
  REISSUED with a 6th `p_hardcoded_value` param (the 5-arg form DROPPED, the
  E4.2 no-overload precedent; a non-hardcoded transition CLEARS the literal so
  a row can never keep a stale value behind a token), and
  `update_shared_field_registry` (batch presentation writer; jsonb `?` so a
  key present-with-null CLEARS while an absent key leaves the column alone).
- **`20260807170000_e69_datafields_to_registry.sql`** — DML only. Folds each
  online-form step's `dataFields` into shared registry rows, after a version
  SNAPSHOT of every affected template. Re-run safety is mechanical, not
  best-effort: the snapshot is guarded on the change NOTE (not
  `ON CONFLICT (template_id, version)` — the first run bumps
  `current_version`, so a second would compute an unused N+2 and the conflict
  clause would happily insert a duplicate), and each migrated row's selector
  is `md5(template, task index, step index, token)` so a re-run recomputes the
  same selector and the unique index turns the insert into a no-op. Three
  consecutive runs on live data: identical counts, every head still carrying a
  version row for its `current_version`.
- **Pure core `src/lib/fieldRegistry.ts`** (+23 cases) — `classifyFieldMap` is
  EXHAUSTIVE over `(status, source)` and fails closed. Order matters: `retired`
  → stale, explicit stale → stale, **`status === 'proposed'` → undecided
  BEFORE any source check** (capture's canonical shape is `proposed + manual`,
  and the old source-first filter dropped exactly those rows), then approved ×
  token/manual_partial (requires a token) / hardcoded (requires a non-empty
  literal) / manual (decided, human-fills — NOT mapped, NOT a gap). Also
  `displayNameOf`, `sectionNameOf` (admin section → captured heading → page →
  "Fields"), `groupRegistryRows`, `registryCoverage`, and the `manual:` manual
  selector helpers. `src/lib/tokenGroups.ts` owns the grouped token picker
  (`SopFieldToken`/`TokenGroup` were duplicated verbatim in two components).
- **`FieldRegistryList.tsx` replaces the E6.5 train QUEUE.** Every row stays
  visible, keeps its `sort_order` position (a decision never reorders the
  list), and stays editable: inline rename, the three decisions (token / fixed
  value / human fills this) plus Unmap, per-section "N of M mapped", and the
  payer's raw label kept underneath a rename as evidence. **Stale rows keep
  their controls** — staleness is information, not a lock; locking them would
  leave a drifted mapping visible and unfixable. `FormStepPanel` routes each
  decision by tier (shared → the RPCs, org → the existing RLS mutations; a
  fixed value on an org row is an explicit toast, never a silent DB failure)
  and gained the "Add field" affordance. On `online_form` steps the step's own
  Data-fields editor is hidden (fax/phone/mail keep theirs; `draft_email`
  never had one) — the stored JSON is retained on every step.
- **`/api` (F6.9.8 seam for the extension):** `POST /api/shared-field-maps`
  (propose, `org_id` always NULL), `GET /api/shared-field-maps?portal_key=`
  and `GET /api/shared-portals` — all three on `authenticateUser()`, since
  training names no org and the org-resolving guard 400s a multi-org caller
  that sends none. Their isolation property is GLOBAL ONLY (there is no org in
  scope to widen to): gate assertions **22 / 22b / 23** + the `sharedtier`
  leak mode. `GET /api/portals` also embeds the payer's display name.
- e2e `e2e/field-registry.spec.ts` (TS-144…TS-149);
  `payer-setup-module.spec.ts` TS-132/TS-134 retargeted off the retired queue.

## What this is

Minted Panel is a credentialing-operations SaaS for medical groups: providers,
payers, credentialing cases, tasks/SOPs, touches, contracts, MSO routing, and
location launches, all multi-tenant (`org_id` + RLS, roles admin/specialist/
billing). React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui, **TanStack
Start** (file-based routing on a nitro server, SSR-capable) + TanStack Query,
Zustand for auth/org state, Supabase (Postgres + GoTrue) for everything
server-side. The framework is TanStack Start, not a plain Vite SPA: `src/server.ts`
and `src/start.ts` are a real server runtime.

A slice of app server logic runs as `/api/*` routes in `src/server/` on the
nitro server, behind a shared org/role guard using the service-role client:
health + provider CRUD (Chunk 3 pilot, PR #19) and the seven extension-facing
endpoints (Chunk 4 — provider profile, portal field maps, fill events; R2
Workbench — open cases, submission touches; 2026-07-06 — org discovery
`/api/me/orgs`, plus facility awareness on the profile; P8 — case context). The
**bulk of data access is still browser → Supabase PostgREST under RLS**, and
**no frontend hook calls the API routes** — by locked decision (below), the
current app UI stays on direct Supabase + RLS; the API's consumer is the Chrome
extension. **The ONE sanctioned exception since E4.5:** the three
`/api/documents/*` signing endpoints (upload-intent/finalize/download) are
called by the browser documents service — a signed Storage URL can only be
minted server-side — while document metadata reads stay on RLS. See the
"Server API layer" section below and `docs/phase-0-audit.md` for the
framework/deploy detail.

## Running and verifying

- **Read `docs/VERIFY.md` first** — session bootstrap one-liner, the
  verification tier table (what to run for a given diff), measured costs, and
  the route→e2e-spec map for focused Playwright runs.
- `npm run dev` / `build` / `lint` / `test` (vitest) / `format`.
- Local `.env` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  (see `.env.example`). The hosted project is `fkvuhfsqcmujywzgczmc`
  ("openpanel", us-east-2).
- `npx tsc --noEmit` is the type gate; `vite build` does not typecheck.
- **Claude Code cloud sandboxes block egress to `*.supabase.co`** (403 at the
  gateway proxy). The app cannot reach the real backend from there. What works:
  - All database reads/DDL/data via the **Supabase MCP tools**
    (`execute_sql`, `apply_migration`, `generate_typescript_types`).
  - Browser verification via Playwright (`/opt/pw-browsers/chromium`) against
    `npm run dev`, with the Supabase HTTP layer mocked through
    `context.route("https://<ref>.supabase.co/**", handler)`: emulate
    `/auth/v1/token` (return a session for a fixture user), `/rest/v1/<table>`
    (parse `eq./in./is./order/limit` query params over fixture rows exported
    from the live DB with `json_agg`), `maybeSingle` (Accept
    `vnd.pgrst.object` → single object or 406 `PGRST116`), `Prefer:
return=representation` / `resolution=ignore-duplicates`, and the RPCs
    (`claim_invites` → 0, `create_case_with_tasks` → synthesize the case row +
    tasks). Assert on the recorded request payloads as well as the UI. This
    harness verified the entire launch pivot; rebuild it from this recipe when
    needed. Additions proven by the R1 go-live pass (2026-07-05): skip the
    login flow by seeding localStorage in `addInitScript` — the GoTrue session
    under `sb-<ref>-auth-token` plus zustand's `minted-panel-active-org` —
    and synthesize `profiles` + `memberships` rows for the fixture user
    (memberships embeds `organizations(name)`); fixture tables must also
    include empty `notes` and `user_table_prefs` or those queries 404. The
    repo's Playwright pin is newer than the sandbox browsers — launch with
    `executablePath: "/opt/pw-browsers/chromium"`. This rig rendered all 20
    routes as admin and billing for `docs/R1-GO-LIVE-FINDINGS.md`.
  - The **/api org-isolation gate** in-sandbox: `node
scripts/verify-isolation-local.mjs` (mock-and-run) boots a fixture mock of
    the API contract and runs `scripts/verify-org-isolation.mjs` against it —
    once expecting green, once per leak mode expecting red. The real gate runs
    on GitHub runners against the production deploy: automatically on every
    successful production deployment (`deployment_status` trigger) and via
    manual dispatch. A red gate run is stop-ship until a human reads it.

## Database: repo vs hosted — read this before schema work

`supabase/migrations/` is a **squashed baseline**
(`20260704210000_baseline_live_schema.sql`) dumped from the live DB and
verified to rebuild it exactly (fingerprint match; see
`docs/migration-baseline.md`), plus post-baseline migrations (first:
`20260705190000_audit_log_read_action_type.sql`, adding `READ` to the
`audit_log.action_type` check — applied to hosted the same day). The 15 old partial-mirror files are parked in
`supabase/migrations_archive/` (kept per the additive rule, outside the
migrations dir so the CLI ignores them). The baseline reflects the state after
all 23 hosted migrations. Consequences:

- The **live DB is still the source of truth.** The baseline is a snapshot; if
  the two ever diverge, regenerate a baseline from live rather than trusting the
  file. Check the live DB (MCP `list_migrations` / information_schema) before
  assuming a column/function's presence.
- `src/integrations/supabase/types.ts` is **generated from the live schema**.
  After any DDL, regenerate via MCP `generate_typescript_types`, overwrite the
  file, and run prettier on it. It is not hand-edited.
- New schema work (**repo-first**, full rule in `docs/migration-baseline.md`):
  add the change as a **new** file in `supabase/migrations/`
  (`YYYYMMDDHHMMSS_<slug>.sql`) — never edit the baseline or an archived file —
  **and** apply the identical SQL to hosted via MCP `apply_migration`. Guard
  statements that depend on hosted-only objects or elevated privileges
  (`to_regclass('public.launches')`, `ADD COLUMN IF NOT EXISTS`,
  `CREATE ... IF NOT EXISTS`, exception-guarded event triggers) so a repo-only
  rebuild still passes.
- Do **not** re-apply the baseline to the already-migrated hosted project (its
  objects exist); it is for fresh rebuilds — local stacks, new projects, CI.
- `supabase/seed.sql` is a local fixture with its own two org ids (different
  from the hosted demo orgs) and fixed UUIDs + `ON CONFLICT (id) DO NOTHING`.
- Hosted demo data: two orgs — "Kansas Fitness Physio" (the rich demo) and
  "South Park Physician Group".

### RPCs (hosted-only, not in repo migrations)

- `create_case_with_tasks(p_input jsonb, p_tasks jsonb)` — transactional case
  insert + initial `status_history` row + tasks + two `audit_log` rows;
  `created_by` from `auth.uid()`; default credentialing status = lowest
  `sort_order`. Returns the case as jsonb. **Since E2.1 it IS a repo migration
  too** (`20260713150200`, CREATE OR REPLACE): the case insert threads
  `p_input->>'generation_run_id'` and each `p_tasks` element may carry
  `sop_template_id`/`sop_version` (the E2.2 stamp transport — populated by
  every SOP-resolving creation surface since E2.2, NULL/NULL from non-SOP
  writers). NULL-safe for every pre-existing caller; signature
  and SECURITY INVOKER posture unchanged. NOT replay-idempotent — batch
  semantics are per-row transactionality + skip-on-23505 in the confirm loop.
- `advance_payer_pipeline(p_case_id, p_to_state, p_expected_state,
p_reason_code_id, p_justification, p_is_correction, p_effective_date,
p_individual_provider_id, p_group_provider_id) RETURNS jsonb` — **repo migration
  too** (E4.0 `20260715120400` + `20260715120500`). SECURITY INVOKER (caller RLS —
  billing is read-only automatically), the ONE atomic payer-pipeline transition:
  validate edge / reason-code / admin-gate / concurrency, then state change +
  append-only `payer_pipeline_history` + Approved enrollment writes-or-clears +
  in-RPC `audit_log`, all-or-nothing. Named RAISEs (`pipeline_invalid_transition`,
  `pipeline_state_conflict:<state>`, `pipeline_admin_only`,
  `pipeline_denied_needs_reason`, …) map to UI messages in `cases.ts`
  `PipelineTransitionError`. Edge map mirrored from `src/lib/payerPipeline.ts`.
- `create_organization(p_name text) RETURNS uuid` — **the exception to this
  section's "hosted-only" heading: it IS a repo migration**
  (`20260707140000_create_organization_rpc.sql`, repo + hosted). SECURITY
  DEFINER, EXECUTE granted to `authenticated`. Privileged BOOTSTRAP for
  self-serve org intake (Epic 2a): `organizations` has no INSERT policy and
  memberships/status_configs INSERT require pre-existing admin — a chicken/egg
  an org's first member can't satisfy under RLS. Inserts the org, adds the
  caller (`auth.uid()`) as an ADMIN membership, seeds the 22 canonical
  `status_configs` (credentialing 9 / contracting 6 / location 7), writes a
  CREATE audit row, returns the new org id. Any authenticated user may call it.
  Frontend path: `src/services/organizations.ts` → `src/hooks/useOrganizations.ts`
  (`useCreateOrganization` — on success refetches memberships, switches active
  org via the store's org-switch path, navigates Home); intake UI is the
  no-org bootstrap screen (`src/components/org/NoOrgScreen.tsx`, rendered by
  `__root.tsx` when `memberships.length === 0`) and Admin → Settings →
  Organization (`src/components/settings/CreateOrgPanel.tsx` →
  `src/components/org/CreateOrganizationModal.tsx`).
- `claim_invites()` — converts `pending_invites` for the caller's email into
  memberships.
- `archive_org_payer_assignment(p_org_id uuid, p_payer_id uuid) RETURNS jsonb` —
  **repo migration too** (E4.2 `20260715160000`). SECURITY INVOKER (caller RLS —
  admin-only writes are enforced by the existing `org_payer_assignments` /
  `payer_network_targets` policies, plus an explicit `user_role` admin guard that
  RAISEs `org_payer_assignment_admin_only`). The ONE atomic archive: flips the
  org's payer subscription to `archived` (+ `archived_at`) AND archives that
  payer's active `payer_network_targets` in the same transaction (two PostgREST
  UPDATEs are not atomic), never a DELETE. Returns
  `{ assignment, archived_target_count }`; `orgPayerAssignments.ts` maps the
  named RAISEs to friendly errors. Verified by a live rolled-back simulation
  (assignment archived, targets archived, rows preserved).
- `get_sop_field_tokens()` — the token **catalog**: `[{ table, token, column }]`
  for 132 tokens across 9 tables — which fields exist and where they live, not
  per-provider values. Client SOP templates use it as the closed token list;
  the server resolves actual values in `src/services/providerProfile.ts` for
  the profile endpoint.
- **Gotcha:** `supabase.rpc` must be called bound. Extracting the method
  (`const rpc = supabase.rpc as ...`) throws `Cannot read properties of
undefined (reading 'rest')` at call time. Use
  `supabase.rpc.bind(supabase)` (fixed everywhere in Jul 2026; keep it that
  way).

## Layering (enforced)

```
Component (src/routes/*, src/components/[module]/*)
  → hook (src/hooks/*, TanStack Query, keys in src/hooks/queryKeys.ts)
    → service (src/services/*, the ONLY Supabase callers)
      → supabase (src/integrations/supabase/externalClient.ts — the ONLY valid client import)
```

- Services: org-scope every query with `requireActiveOrg()` (`src/lib/audit.ts`),
  set `org_id` on inserts, write `audit_log` via `writeAudit` on mutations,
  convert snake↔camel at the boundary with `camelizeRow`/`snakeizeRow`
  (`src/lib/case.ts`).
- Hooks: one file per domain; all keys org-scoped via `queryKeys`; mutations
  invalidate by key prefix (e.g. `["facilities", orgId]` catches all variants).
- Auth/org: `src/lib/auth-store.ts` (Zustand, persisted `activeOrgId`).
  `useActiveOrgId()`, `useRole()`, `useCanWrite()`/`useIsAdmin()`
  (`src/lib/permissions.ts`). Switching org calls `queryClient.removeQueries()`.
- Domain types: `src/types/index.ts` (additive only). One interface per table.

### Server API layer (`src/server/*` — Chunk 3 pilot PR #19, Chunk 4 extension endpoints)

`/api` routes run on the nitro server. **No frontend hook consumes them** —
with ONE sanctioned E4.5 exception: the browser documents service calls the
three `/api/documents/*` signing endpoints (a signed Storage URL cannot be
minted client-side; metadata reads stay on RLS). Everything else stays
browser → Supabase. That is deliberate (locked decisions below): routes get
built only when a real consumer pulls them. The current surface:

- `GET /api/health` (public) · provider CRUD (`GET/POST /api/providers`,
  `GET/PATCH /api/providers/:id`) — Chunk 3.
- **`POST /api/documents/upload-intent` / `POST /api/documents/finalize` /
  `GET /api/documents/:id/download`** — the E4.5 document-storage signing
  boundary (`src/server/documentRoutes.ts` → `src/services/documentStorage.ts`,
  server-only ctx). Writers mint a short-lived signed upload target for a
  SERVER-generated org-bound object key, finalize verifies the object
  (path/size/MIME/owner/family/version) before the immutable metadata insert
  (idempotent on `(org, family, version)`), and any org member (billing too)
  gets a 120s signed download for one org-owned version — a cross-org id 404s
  BEFORE anything is signed (gate assertions 17/17b, `documentdownload` leak
  mode). All three: `Cache-Control: no-store` + one audit row per action
  (actor/document/owner/kind — never contents or URLs; a failed audit write
  fails the request). Consumers: the browser documents service today; the
  extension consumes the SAME download contract later (TE-11 — audited links
  only, never bucket credentials or object-list access; the D3
  future-auto-attach seam).
- `GET /api/me/orgs` — the caller's own memberships, `{ orgId, orgName, role }`
  rows derived from the JWT user id only (`src/services/orgMemberships.ts`).
  Runs on `authenticateUser` (the guard's JWT-only step, no org resolution):
  it is the org-discovery endpoint a multi-org caller needs BEFORE it can send
  `x-org-id`, so the guard's multi-org 400 deliberately doesn't apply. Zero
  memberships = empty list, not an error. Gate assertions 10/10b pin "own
  memberships only".
- `GET/PUT /api/me/view-prefs` — the caller's saved extension quick-card layout
  (E4.3 TE-15/TE-16, `src/services/extensionViewPrefs.ts`). USER-scoped like
  `/api/me/orgs` (runs on `authenticateUser`, no org guard — prefs follow the
  user across orgs), stored in `user_table_prefs` under
  `page_key 'extension.quickCards'` keyed by the JWT-verified user id (never a
  client-supplied id — that scoping IS the isolation under the service-role
  client). **SCHEMA-DERIVED since 2026-07-28** (supersedes the TE-16 hand-written
  allowlist): GET returns `{ fields: string[] | null, catalog: QuickCardField[] }`
  — the saved layout (null = nothing saved; the envelope's `data` is never null
  so the extension never treats it as an error) PLUS the selectable fields, so
  the picker and the PUT validator read one source in one round trip. PUT accepts
  `{ fields: string[] }` validated to a deduplicated, ORDERED array of keys drawn
  from that same derived catalog; a duplicate, non-string, or out-of-catalog key
  is a 422. The **32-field cap is gone** (the picker groups by section, so length
  stopped mattering; the closed key set already bounds the body).
  `getQuickCardCatalog` (`extensionViewPrefs.ts`) calls **the same
  `get_sop_field_tokens()` the profile endpoint resolves values from**, then the
  pure `buildQuickCardCatalog` (`src/lib/quickCardCatalog.ts`) applies TWO
  exclusion rules: case-scoped tables (payers/msos/contracts — never resolve on a
  profile) and eleven named internal/audit tokens (`provider.launchId`,
  `verificationState`, `isTestProvider`, `referenceOnly`, `terminatedDate`,
  `facility.referenceOnly`/`statusId`, the `license.verified*` PSV trail,
  `groupInsurance.notes`). **75 offered keys → 117.** The old hand-list had made
  the group's ENTIRE correspondence block, `provider.home{Street,City,Zip}`, and
  facility `email`/`hours`/`effectiveDate` unreachable on a card even though the
  profile resolved them. `provider.ssnLast4` is now OFFERED (product decision);
  the FULL SSN stays structurally unreachable — it lives in `provider_ssn_vault`,
  which `get_sop_field_tokens()` does not sweep, so no token can name it.
  **`get_sop_field_tokens()` is NOT curated** — it reads
  `information_schema.columns` over nine tables and drops only keys/FKs/status
  columns, so any new column on the six card-eligible tables becomes a token
  automatically. `quickCardCatalog.test.ts` is what makes a deny-list safe here:
  it reconstructs the RPC's output from the checked-in `types.ts` (verified
  byte-identical to the live 126 non-case-scoped tokens) and diffs it against a
  pinned `ACKNOWLEDGED_TOKENS` snapshot — a new column fails the suite BY NAME
  until someone classifies it. Do not delete that test to make a build pass.
  Not a PHI read/write (field KEYS + schema metadata, no values) — no audit row.
  NB the extension still ships a stale verbatim mirror of the old 75-key list in
  `src/shared/quickCards.ts`; it must be deleted and the picker driven from the
  served `catalog` (extension-repo work, not done here).
- `GET /api/next-best-action` — the extension's log-and-advance queue-top read
  (E4.3 F4.3.4/TE-6, `src/services/nextBestAction.ts`). A guarded, org-scoped
  read that ASSEMBLES the same ~17 org caches the browser My Cases queue
  composes and calls the SAME pure reducer (`buildNextBestActions` +
  `evaluateEnrollmentReadiness` + `resolveQueueRankingConfig`) under the org's
  F4.2.5 ranking config — NO ranking logic is duplicated here. Returns
  `{ item }` where `item` is the single queue TOP (case pointer + display
  label/reason + deadline + payer-pipeline state + `deepLink '/cases/:id'`) or
  `null` for an honest "queue clear". Read-only, nothing persisted (the E2.3
  queue is fully derived); billing may read. The readiness-facts read reduces
  DOB/SSN/home-address to booleans in the service — values never emitted, so
  no PHI leaves the endpoint and no audit row is written.
- `GET /api/providers/:id/profile?state=XX&facilityId=<uuid>` — the fill
  engine's payload: the provider row + every catalog token resolved to a value
  server-side (`src/services/providerProfile.ts`). Deterministic source-row
  picking: `?state` selects the state license; a SOLE group-insurance policy is
  used as-is, and a MULTI-policy group resolves deterministically to the
  malpractice policy (`insurance_type 'professional_liability'`) with the newest
  `policy_end_date`, else honestly unresolved (E4.3 F4.3.5 Q4, PM decision
  2026-07-17 — a service-internal refinement, no wire change);
  `payers`/`msos`/`contracts` tokens are case-scoped and always
  come back `null` + listed in `unresolved` with a reason. Facility awareness
  (2026-07-06): the response carries `facilities: [{ id, name }]` (the
  provider's org-scoped facility set via provider_facility_assignments) and
  `selected_facility_id`; `?facilityId` must be in that set (cross-org or
  unassigned → 404 "Facility not found for this provider", gate assertion 11);
  no param + sole facility auto-selects; no param + several →
  facility._/assignment._ tokens come back null with
  `meta.needs_facility: true` — the server NEVER guesses (the old
  primary-assignment heuristic is deliberately gone; `assignment.*` follows
  the same selection because the assignment is the link row). The snake_case
  keys (`selected_facility_id`, `needs_facility`) are the locked wire
  contract, like the touches body. The `{{user.*}}` token family (`user.name` from
  user_metadata full_name/name, `user.email` from the JWT claim — no schema
  backing) is appended by the route via `src/server/userTokens.ts`. NB there
  is NO in-app setter for user_metadata full_name anymore — the Org Detail
  Profile section and its whole chain (`ProfilePanel` →
  `useUserProfile` → `src/services/userProfile.ts`) were removed by user
  request 2026-07-21 (already-set names persist; `profiles.full_name`, which
  the sidebar/store display reads, is separate and unaffected);
  empty-resolution notes surface in the envelope's `meta.notes`. **The most
  PHI-dense response in the system** (SSN last-4, DOB, home address, unmasked
  by design): `Cache-Control: no-store`, never log the body. Every successful
  profile read writes one `audit_log` row (`action_type 'READ'`, actor,
  provider, route — never the body or token values; a failed audit write
  fails the request) — R2 locked decision 4, 2026-07-05, superseding the
  same-day rely-on-fill_sessions decision (both recorded in
  `docs/minted-panel-release-plan.md`).
- `POST /api/portal-field-maps` — **propose-only** field-map write (2026-07-28).
  The extension reports a field the fill engine met that nothing maps. The row is
  ALWAYS written `status 'proposed'`, `source 'manual'`, `token null`, under the
  CALLER'S org — never global (`org_id NULL` rows are platform catalog entries),
  whatever the body says. Approving stays a human act in the E6.5 SOP-editor
  trainer: a client that could write `approved` with a token would silently
  redirect what autofills into a payer form. Blast radius worth knowing: the
  extension fills proposed AND approved maps (only `retired` is skipped), so the
  row IS live — but with no token it fills nothing; it just surfaces in the
  trainer queue and `mappingCoverage`. Idempotent on `(portal_key, selector)` —
  the dedupe lookup spans GLOBAL rows too (the shared catalog is authoritative
  for portal truths), so a covered selector returns the existing row (200) and a
  first sighting 201. `portal_key`/`field_label` fold through
  `normalizePortalKey`/`normalizeFieldLabel` at the write boundary, so a proposal
  joins the `field_dictionary`'s learned suggestions. Writer roles only; audited
  on create only. `proposeFieldMap` in `src/services/portalFieldMaps.ts`.
- `GET /api/portals[?portal_key=...]` — the DB-driven payer-portal registry
  (2026-07-28), so portal identity stops being a hardcoded list in the extension
  bundle. Own-org rows + GLOBAL registry rows (the E6.5 tier), the shared-catalog
  read pattern; `?portal_key` folds through `normalizePortalKey`. Read-only, not
  PHI — no audit row, no role gate (billing may read), mirroring the field-maps
  route it pairs with. `listPortalsForApi` in `src/services/portals.ts` (a server
  ctx path beside the browser path, the `portalFieldMaps.ts` dual-surface idiom).
- `POST /api/providers/:id/caqh-attestation` — record a CAQH re-attestation
  (2026-07-28). The column + its 120-day freshness rule shipped in E1.8; only the
  write was missing, so a coordinator who re-attested in the CAQH portal had to
  reopen the webapp or leave every readiness row red on a stale date. Body
  `{ attested_on?: "YYYY-MM-DD" }` defaulting to today; a FUTURE date is a 422 (an
  attestation records what already happened, and accepting one would silently
  extend the E1.8 window past what a payer honours). Writes through the existing
  `updateProvider` DI path, so org scoping / the cross-tenant org strip / the
  UPDATE audit row all come from there. The response is deliberately NARROW —
  `{ id, caqhLastAttestedDate, currentThroughDays }` (the last imported from
  `enrollmentReadiness.CAQH_CURRENT_DAYS`, so the extension never hardcodes a
  second window) — never the PHI-dense row PATCH returns; pinned by a test.
  Writer roles only; cross-org id 404s before any write.
- `GET /api/portal-field-maps?portal_key=...` — shared catalog: `org_id NULL`
  rows (global, selectors are portal truths) + the caller's org overrides
  (`src/services/portalFieldMaps.ts`).
- **Token format contract (2026-07-05 fields_filled=0 incident):** the
  canonical token key is the BARE catalog form (`provider.firstName`);
  `portal_field_maps.token` rows are human-pasted and may carry the braced
  SOP-template form (`{{provider.firstName}}`). The SERVER owns normalization
  (`src/lib/tokenFormat.ts` `normalizeTokenKey`), applied at the read boundary
  in `portalFieldMaps.ts` and to catalog entries in `providerProfile.ts`, so
  both endpoints emit bare keys and the extension's field-map → profile-token
  join is a literal string match. The extension never strips braces. The
  cross-endpoint join is pinned by `src/server/profileFieldMapJoin.test.ts`.
- `POST /api/fill-events` — writes `fill_sessions`; the client-generated `id`
  (UUID) is the idempotency key AND the row PK — replays return the stored row
  (200) instead of inserting (201). case/provider/task ownership is validated
  against the resolved org **before any write**; `org_id`/`performed_by` come
  from the guard ctx, never the body. Optional `taskId` marks the task
  completed (org-checked, audited). Writer roles only (billing → 403).
  (`src/services/fillSessions.ts`)
- `GET /api/cases?providerId=<uuid>` OR `?q=<text>` — TWO additive modes on one
  org-scoped route (`providerId` takes precedence when both are present; neither
  is a 422). **`?providerId=`** is the popup's case dropdown (R2): the
  provider's OPEN cases, `{ id, payerName, state, status, submittedDate,
payerReferenceId, latestNote, lastSubmittedAt, portalTasks }`. **`?q=`** is the
  E4.3 TE-11 case-search half of the extension's unified standalone search
  (`searchOrgCases`, same file): org-scoped, matching payer name / provider name
  / `payer_reference_id` (tracking id) as a case-insensitive substring in
  memory over the org's own cases, capped at 50, returning ids + display fields
  ONLY (`{ id, providerId, providerName, payerName, state, status,
payerReferenceId, payerPipelineState }` — never beyond the list projections). A
  blank `q` returns `[]` (never a full-table dump). Gate assertions **15** (own
  search works) + **15b** (never returns a cross-org case/provider id, red under
  the new `casesearch` leak mode). Open =
  credentialing status not in the `action_bucket 'complete'` bucket — derived
  from `status_configs`, never from labels; status-less cases count as open.
  Cross-org providerId → 404. The PR C fields are derived from ONE org-scoped
  touchlog read over the open case ids: `payerReferenceId` (case column, Story 5
  prefill), `latestNote {text,author,at}` (newest `entry_type='note'`,
  author-resolved via `profiles`, Story 11), `lastSubmittedAt` (newest
  `outcome='submitted'` touch, Story 10 dup guard — keyed off the submission
  touchpoint, NOT text-matching the system_event). **`portalTasks` (Phase 4,
  SOP↔portal link)** = `{ taskId, title, portalKey, status }[]` from ONE more
  org-scoped read over the open case ids (`tasks`): each non-completed task
  contributes one entry per DISTINCT `portalKey` among its `sop_content` steps
  (keys normalized bare/lowercase), so the extension matches the page's
  portal_key to a task and passes its `task_id` on the submission touch — the
  Story 7 close-out that had no task source until now. Isolation: the tasks read
  is org-scoped from ctx, and portalTasks rides the same provider-ownership 404;
  gate assertions **8c** (own portalTasks reference only own-org tasks) + **8d**
  (cross-org request never leaks a South Park task id via portalTasks, red under
  the `cases` leak mode). (`src/services/providerCases.ts`)
- `POST /api/cases/:id/touches` — the "Mark submitted" business log. **Status is
  moved by the DATABASE, not this route (corrected 2026-07-28).** The E6.0
  trigger `trg_case_status_on_touch` fires AFTER INSERT on every touchpoint and,
  for the exact shape this endpoint writes (`source 'extension'` + `outcome
'submitted'`), calls `_apply_case_status_auto(case, 'submitted', touch.id)` —
  same transaction, this touch as evidence, no opt-in. `bump_status: true`
  therefore does not perform a transition; it only asks the route to READ the
  case back and report what the trigger did (`meta.status_bump` /
  `status_bump_reason`, `data` stays exactly the touch). It stays in the wire
  contract so an older panel still gets its confirmation line, and is still a
  422 on `structured_touch`. **The first cut called `set_case_status` here and
  could never succeed:** that RPC opens with `IF p_to_status = v_from THEN RAISE
case_status_invalid_transition`, and the trigger had already made
  `from = 'submitted'` — so every real submission returned applied:false with
  "not in a status that can move to Submitted" on a submission that had worked.
  The unit fake speaks PostgREST and has no triggers, which is why it passed
  while the feature was 100% broken; the suite now pins that NO RPC is issued.
  When the case sits past Submitted the trigger deliberately no-ops ("set by a
  person stands") and the honest report is applied:false. `ctx.asUser()` was
  added for that doomed call and has been REMOVED with it — but the trap it
  documented is real and is now a warning comment in `guard.ts`: never call a
  SECURITY INVOKER RPC on `ctx.db`, because RLS, `user_role()` and `auth.uid()`
  all break at once under the service key. R2 core:
  ONE append-only anchor touchpoint (`touch_type 'portal'`, `outcome
'submitted'`, `source 'extension'`, text "Application submitted via <portal
  label>"); `idempotency_id` is its PK (same replay semantics as fill-events).
  **Snake_case body keys per the locked R2 contract** (`kind:
'portal_submission'`, `portal_key`, `fill_session_id?`, `note?`,
  `idempotency_id`) — unlike fill-events' camelCase. **PR C write-back** (all
  optional, snake_case): `payer_reference_id` overwrites the case's latest-wins
  ref (Story 5); `wip_note` → a `note` entry (Story 6); every submit also writes
  a `system_event` "Form submitted to {payer}"; `task_id` (org-validated) marks
  the SOP task done + writes a `task_update` entry (Story 7, close-decision (c));
  `pdf_filename` → a second system_event. Case, fill-session, AND task ownership
  are all checked before ANY write (task_id is gate assertion 13); org + user
  from ctx. Replays short-circuit at the anchor and re-run no side effects. Never
  a status change. Portal label derived from `portal_key` (no server-side portal
  catalog — labels live in the extension). (`src/services/submissionTouches.ts`)
- `GET /api/cases/:id/context` — the Workbench pulls this after case selection
  so the panel has everything it needs without leaving the portal tab (P8, Epic
  3d; **expanded by E4.3 TE-2**). Returns `{ referenceNumbers, payerPipelineState,
provider, payer, state, selectedFacility, openTasks, latestNote, latestTouch }`
  for the ONE org-owned case; a cross-org or nonexistent id → 404 (case
  ownership `maybeSingle` miss, mirrors the other case handlers).
  `referenceNumbers` = `credential_cases.payer_reference_id` as a 0/1-element
  array (latest-wins column, not touch history); **`provider`/`payer`** =
  `{ id, name }` display identity via FK embeds (the panel's identity header —
  the F4.3.1 guard); **`state`** = the case's state; **`openTasks`** =
  `{ id, title, status, executionType, sortOrder, dueDate }[]` — the case's
  non-completed SOP tasks WITH their E4.2 execution types (null → `manual`),
  from ONE org-scoped read ordered by sort_order (the E4.2 F4.2.1 workbench
  tee-up; task-state writes stay in the webapp for R6);
  `selectedFacility {id,name,street,suite,city,state,zip}` from the case's
  explicit `facility_id` only (org-scoped, never the provider's set);
  `latestNote {content,createdAt,authorName}` = newest touchlog
  `entry_type='note'` (author-resolved via `profiles`);
  `latestTouch {touchDate,touchType,outcome,note}` = newest
  `entry_type='touchpoint'`. Note + touch come from ONE org-scoped touchlog read
  — it reads the touchlog spine, NOT the dormant `notes` table (case notes moved
  there in Story 1). **PHI discipline (E4.3 TE-2, changed from the P8 posture):**
  `Cache-Control: no-store`, never log the body, and exactly ONE `READ` audit row
  per successful read (a failed audit write fails the request; 404s are not
  reads). Read-only (billing may read). No migration. Gate assertion 14/14b
  (Kansas reads own context; cross-org South Park case context → 404) + a
  `casecontext` leak mode. (`src/services/caseContext.ts`)

Layer mechanics:

- **Entry:** this TanStack Start version ships **no** file-based server-route API
  (`createServerFileRoute` is absent), so `src/server.ts` (the nitro fetch entry)
  intercepts the whole **`/api` prefix** and delegates to `src/server/api.ts`
  before SSR (unknown `/api/*` paths are a JSON 404, not SSR). Keep the
  `src/server.ts` check and `isApiRequest` in `api.ts` in sync.
- **CORS (`src/server/cors.ts`):** env allowlist `API_CORS_ORIGINS`
  (comma-separated exact origins; must include `chrome-extension://<id>` once
  the extension id exists). Default empty = no CORS headers ever. OPTIONS
  preflights are answered 204 for all of `/api/*` (an Authorization header
  always triggers one); allow-headers are `authorization, content-type,
x-org-id`.
- **Guard (`src/server/guard.ts`) — every data route runs through it.** The
  service-role client **bypasses RLS**, so tenant isolation is enforced in code:
  `authenticate()` verifies the JWT (`supabase.auth.getClaims`), resolves the
  caller's membership (`org_id` + role, disambiguated by an `x-org-id`
  header / `?orgId=` — REQUIRED for multi-org callers: omitting it is a loud
  400, never a silently guessed first membership), and returns an
  `AuthContext` already scoped to that org with a `writeAudit` closure. There is no path to a handler without a resolved
  ctx. `isWriter(ctx)` = admin|specialist (billing is read-only), mirroring the
  RLS write policies; handlers turn a false into a 403. `authenticateUser()`
  is the JWT-only first step (verify token, no membership query), split out
  2026-07-06 for `/api/me/orgs` — the ONLY route on it; every other data route
  stays on the full `authenticate()`.
- **Service reuse via DI, browser callers unchanged.** `src/services/providers.ts`
  gained a `ProviderServiceCtx` (`{ db, orgId, writeAudit }`); its functions take
  an **optional** ctx defaulting to `browserCtx()` (the RLS anon client +
  `requireActiveOrg()`). Server routes inject a service-role ctx; the browser path
  is untouched. No query logic is duplicated between layers. New server routes
  should follow the same pattern — thread a ctx, never a second copy of the query.
- **PHI + writes:** the list route returns an explicit **narrowed** column set
  (`PROVIDER_LIST_COLUMNS` — no `ssn_last4`, `date_of_birth`, or home-address
  columns (street/city/zip); `home_state` is deliberately included for
  routing/display, not an address); never `select('*')` in a list payload.
  Writes set `org_id` from the authenticated membership (**never the request
  body** — it's stripped) and audit through the service layer. `PATCH
/api/providers/:id` mirrors the GET handler's not-found detection: a
  cross-org or nonexistent id is a 404 (never the 500 the raw `.single()`
  would raise), pinned by gate assertion 12.
- **Envelope:** `src/server/envelope.ts` — every response is `{ data, error, meta }`
  via `ok(data, meta?, status?)` / `fail(status, message)`; list meta carries
  `{ total, page, pageSize }`; `meta.notes` (string[]) carries non-fatal
  resolution notes (currently only empty `{{user.*}}` tokens);
  `meta.needs_facility` (profile route only) flags an ambiguous facility set.
- **Server-only, do not import client-side:** `src/server/serviceClient.ts` (the
  service-role + auth clients) and everything it pulls. Vite's `**/server/**`
  import-protection blocks a browser bundle from importing it. `api.ts`
  lazy-imports `providerRoutes` so `/api/health` stays free of the Supabase graph.
- **Tests:** handler + service-DI suites use a query-shape fake (supabase-js speaks
  PostgREST, not raw Postgres, so a CI-Postgres integration test isn't feasible) —
  `src/server/*.test.ts`, `src/services/*.di.test.ts`.
- **Env:** `src/server/env.ts` resolves `SUPABASE_URL ?? VITE_SUPABASE_URL` etc.
  and `SUPABASE_SERVICE_ROLE_KEY` (server-only, no `VITE_` prefix; set on Vercel
  Prod + Preview). `API_CORS_ORIGINS` is read directly in `cors.ts`.
- **The gate is the wall.** The service key bypasses RLS on API paths; guard.ts
  is the only isolation enforcement there. Every new resource route adds
  assertions to `scripts/verify-org-isolation.mjs` before merge, plus pass/leak
  coverage in `scripts/mock-api-server.mjs`. Gate fixtures: the one South
  Park-scoped `portal_field_maps` row (id in the workflow env block, seeded via
  MCP 2026-07-05) keeps the field-maps assertion non-vacuous,
  `SOUTHPARK_FACILITY_ID` (Casa Bonita Clinic, existing demo data) is the
  must-404 `?facilityId` of assertion 11, and `KANSAS_CASE_ID` +
  `SOUTHPARK_TASK_ID` (both demo data) drive assertion 13 (a Kansas touch POST
  naming a cross-org task_id → 404 before any write; the gate skips 13 if either
  env is unset, but the in-sandbox mock run always sets them). The expected
  per-org provider counts also live in that env block
  (`EXPECTED_KANSAS_PROVIDERS`/`EXPECTED_SOUTHPARK_PROVIDERS`) — adding or
  removing a demo/UAT provider means updating the count there, or assertions
  1/2 go red as fixture drift (not a leak; the leak checks are 1b/2b/2c/3).

### Locked decisions (2026-07-04, mirrored from the release plan)

1. **Three products, one backend.** API core, Chrome extension, and a future
   workflow UI are separate products. The current app UI keeps running on
   direct Supabase + RLS. Do not migrate current screens to the API.
2. **Consumer-pulled API surface.** Routes get built only when a real consumer
   pulls them. The extension pulls seven (profile, field maps, fill events,
   open cases, submission touches, org discovery, case context). Other
   cases/tasks/payers routes wait for their consumer.
3. **R1 exit criteria revised.** "Zero direct Supabase calls in frontend" and
   RLS lockout deferred to the workflow-UI product. Dual data paths accepted
   deliberately: current UI guarded by RLS, API guarded by guard.ts + the gate.
4. **The gate is the wall.** Red gate = stop-ship.
5. **Server misconfig returns 500, never 401** (PR #24).
6. **Portal field maps are a shared catalog.** `org_id NULL` = global, org rows
   = overrides. The endpoint contract reflects this.

### Locked decisions (R2 Workbench, 2026-07-05)

1. **Case selection in the popup is REQUIRED.** No case, no fill
   (extension-side; the panel serves the dropdown via GET /api/cases).
2. **Fill event = machine log, submission touch = business log.** The
   extension logs "submitted" as an append-only touch only after the human
   submits the portal form. Never a status change from the extension (v1).
3. **Profile endpoint reads are audited** — one `READ` audit row per read,
   never the body. Supersedes the same-day rely-on-fill_sessions decision.
4. **`{{user.name}}`/`{{user.email}}` resolve from auth/JWT metadata.** No
   schema change.
5. **The extension never submits portal forms. Unchanged, forever.**

## Workbench epic (2026-07-28) — Phases 1-6, both repos

The `docs/redesign/design-reference/workbench/` package (doc 08's S1.1-S6.4),
built across `mintedpanel` and `sonny303/minted-extension` in one session per
the E4.3 both-repos-attached rule. Panel-side highlights:

- **Schema-derived quick-card catalog** (S2.1) — see the view-prefs bullet in
  the Server API layer. 75 hand-listed keys -> 117 derived; the drift test in
  `quickCardCatalog.test.ts` is what makes the deny-list safe.
- **New /api surfaces:** `GET /api/portals` (S3.2 registry),
  `POST /api/portal-field-maps` (S5.1 propose-only, S5.3 learned suggestion),
  `PATCH /api/tasks/:id/steps` (S4.3 — the ONE task-state write),
  `POST /api/providers/:id/caqh-attestation` (S6.2), the `bump_status` status
  REPORT on the touches POST (S4.4 — the DB trigger does the transition), and a
  ranked `items` list on `/api/next-best-action` (S3.3). Gate assertions 18-21 +
  `portals`/`taskstep` leak modes; 16 modes.
- **SECURITY INVOKER RPCs on /api** — never call one on `ctx.db`: under the
  service key RLS, `auth.uid()` and `user_role()` all break at once. Bind the
  caller's JWT (`getAuthClient(getBearerToken(request))`) instead. A
  `ctx.asUser()` helper was added for the S4.4 bump and removed with it when
  that call turned out to be unreachable (see the touches bullet); the warning
  lives in `guard.ts`. No current route needs such a client.
- **The `portals` registry is now a DEPLOY PREREQUISITE, not just config.**
  S3.2 deleted the extension's bundled `PORTALS` list, so recognition is
  `matchPortalByUrl(url, rowsFromGetApiPortals)` — over an empty table that
  returns null for every page, which is indistinguishable from "not a portal":
  Fill disabled, capture hidden, and the panel telling you to open the form you
  are already looking at. The table had **0 rows** in production. Seeded
  2026-07-28 (service-role, the sanctioned catalog channel): ONE global
  (`org_id NULL`) row `bcbs_ks_enrollment` — "BCBS KS network enrollment",
  payer `Blue Cross and Blue Shield of Kansas`, `form_url` exactly the
  manifest's content-script match
  (`…/facelets/allUsers/form/NetworkEnrollmentForm.faces`), `is_verified false`
  until a real fill proves it. Global because all 24 of that key's
  `portal_field_maps` are global. Registering a portal for a NEW payer is a
  registry row (E6.5 register-portal UI / `upsert_global_portal`) — but note
  the extension manifest is still pinned to `provider.bcbsks.com`, so a second
  portal would be recognized and then dead-end at the content-script pre-flight
  until the manifest moves to `chrome.scripting.registerContentScripts`.
- **Shared pure modules** so the two products can't disagree:
  `sopStepCompletion.ts` (S4.3 ordering + rollup, shared with the webapp task
  drawer), `labelLearning.ts` (S5.3 suggestion + payer-count evidence),
  `fieldVerification.ts` (S6.1 freshness — window IS `CAQH_CURRENT_DAYS`),
  `referenceProvenance.ts` (S4.5), and `formDrift.ts`'s S6.4 additions
  (`lastWorkingAt`, `fragileMapIds`, `buildDriftReport`). **`lastWorkingAt` is
  INFERRED and has to be:** `fill_sessions.fields_filled` is an int4 COUNT and
  nothing records WHICH selectors succeeded, so a mapping counts as having
  worked in a fill when the fill is real (non-dry-run) on its portal, landed
  ≥1 field, ran at or after the mapping's `createdAt`, and did NOT report it
  not-found in `fields_skipped`. That makes it a floor on staleness, not a
  precise last-success time — a mapping on a page the fill never reached reads
  as "worked". The first cut read `fields_filled` as an array of labels, which
  silently made it always null (and `fragileMapIds` always empty); the tests
  encoded the same wrong shape, which is why it shipped green.
- **`attestedOnFor`** (extension `src/shared/caqh.ts`) — the CAQH attestation
  date comes from the ROSTER ROW (`caqhLastAttestedDate`, carried by
  `PROVIDER_LIST_COLUMNS`), never a panel-local variable. The first cut held one
  assigned only after a successful attestation POST, so the panel read "Never
  attested" for everyone, the S6.2 de-emphasis never fired, and the value
  outlived a provider switch. **S6.3's exception strip is UNFINISHED** —
  `findCaqhGaps` + `PULL_CAQH_FIELD` + the rendering all exist, but nothing
  populates `caqhGapRows`, because doing so means reading VALUES off the CAQH
  page and the S5.2 capture scan is deliberately shape-only (labels/selectors,
  never values — a PHI boundary). Documented in-code as a known gap.
- **`provider_field_verifications`** (S6.1, migrations `20260728120000` +
  `20260728160041`) — per-field verification stamps, one narrow table not N
  columns. **APPLIED TO HOSTED 2026-07-28**, so types regen is safe again.
  The follow-up migration fixes a real cross-tenant hole worth remembering:
  `exists (select 1 from providers p where p.id = provider_id and p.org_id =
org_id)` inside a policy is a TAUTOLOGY — the unqualified `org_id` binds to
  the innermost scope (`providers.org_id`), so Postgres stores it as
  `p.org_id = p.org_id`. A live rollback-wrapped probe caught it: a real admin
  in org A stamped a provider from org B. Every shape check passed. Use the
  scalar form `(select p.org_id from providers p where p.id = provider_id) =
org_id`, where the comparison happens in the outer scope and cannot be
  captured. A sweep of all other RLS policies for `x.y = x.y` found none.

Extension-side (in `sonny303/minted-extension`, branch
`claude/workbench-full-rebuild`): icons + header/avatar (S1.x), the searchable
grouped field picker and grouped details card (S2.2/S2.3), registry-driven
portal recognition and the tab-aware case list (S3.2/S3.4), the pickup queue
(S3.3), the offer card + duplicate guard (S4.1/S4.2), the Progress tab
(S4.3), capture (S5.2/S5.4), and the CAQH push/pull surfaces (S6.2/S6.3).
**The fill now uses ONLY `approved` field maps** (S5.1's invariant, which was
false while proposed rows also filled).

## Domain model in one breath

`organizations` ← `memberships` (user+role) · `provider_groups` ·
`facilities` (a.k.a. **locations**; launches live here — see below) ·
`providers` (PHI-minimized: `ssn_last4` only) · `provider_facility_assignments`
(provider↔location, unique `(provider_id, facility_id)`) · `state_licenses` ·
`payers` (+ sentinel payer **"Pre-Credentialing Setup"**, matched by name) ·
`msos` + `mso_routing_rules` (DORMANT since E6.5 — the routing engine is
deleted app-side; delegation is the curated `payers.delegation_note` fact) · `credential_cases`
(**`UNIQUE NULLS NOT DISTINCT (provider_id, group_id, payer_id, state)`**
since E2.1 — the 4-part case key; legacy NULL-group rows keep the 3-part rule
because NULL = NULL, see AGENTS.md; credentialing status only;
`facility_id` links a case to its location; `generation_run_id` NULL = manual/
pre-E2.1) · `case_generation_runs` (immutable batch record, E2.1) ·
`case_generation_run_rows` (immutable per-candidate disposition ledger, E2.4) ·
`contracts` (group+payer+state,
contracting status lives here, never on cases) · `tasks` (SOP checklists,
seeded from `sop_templates` via `src/lib/sopResolver.ts` — closed token list) ·
`status_configs` (tracks below) · append-only: `touches`, `status_history`,
`audit_log`.

### Global payer/SOP catalog (P2, 2026-07-07 — reverses locked decision #1 for payers/SOPs)

`payers` and `sop_templates` are now dual: **`org_id` is nullable**, and a
NULL row is a **global-catalog** definition (platform-managed via the
service-role client, never by org users). An org sees a global payer only via a
row in **`org_payer_assignments`** (`org_id, payer_id, starter`, unique
`(org_id, payer_id)`); a global SOP is visible when the org is assigned the
SOP's `payer_id`. SELECT policy = `(org_id IN user_org_ids()) OR (org_id IS NULL
AND assigned)`; the own-org disjunct is unchanged and writes stay own-org-only,
so this was **additive and inert for existing data** (zero global rows at apply
time). `listPayers`/`listTemplates` read `.or(org_id.eq.<org>,org_id.is.null)`
(the `portal_field_maps` shared-catalog pattern). Migration
`20260707060000_global_catalog_org_assignment.sql` (repo + hosted). **Catalog
isolation is a BROWSER-RLS concern — the /api org-isolation gate does not cover
it** (payers/SOPs aren't an /api resource); it is verified directly by
`scripts/verify-catalog-rls.sql` (rolled-back simulation: global visible only to
the assigned org, no cross-org leak, org users can't forge a global row —
confirmed on prod 2026-07-07). Converting existing org payers to global rows is
a separate, human-supervised step. Assignment reads + the starter flag ship in
**P4**: `src/services/orgPayerAssignments.ts` (`listAssignments`/`setStarter`,
admin-only UPDATE, audited) + `src/hooks/useOrgPayerAssignments.ts`; Admin >
Payers renders a "Starter" toggle only for assigned global payers.
**E4.2 hardening (canonical payer selection, 2026-07-15):** the subscription is
now a first-class, reversible, history-safe lifecycle — `org_payer_assignments`
gained `status (active|archived)` + `archived_at` (migration `20260715160000`,
repo + hosted; additive, all rows `active`, verified inert on live 0-row data).
`orgPayerAssignments.ts` gained `addAssignment` (idempotent add/reactivate),
`reactivateAssignment` (status flip ONLY — **never recreates targets**; archived
scope stays for the existing restore/review flow), and `archiveAssignment` (via
the transactional **`archive_org_payer_assignment(p_org_id, p_payer_id)` RPC**,
SECURITY INVOKER + admin-guarded, which ALSO archives the payer's active
`payer_network_targets` in one transaction — never DELETE, the assignment row is
preserved so the targets' RLS WITH CHECK still passes) + hooks
(`useAddAssignment`/`useArchiveAssignment`/`useReactivateAssignment`, invalidating
the assignment/payer/catalog/target families the readiness + generation-preview
surfaces compose). The **`/payer-directory` route is the org-admin self-service
entry**: per active catalog payer it shows Add to organization / Added to
organization (+ "Configure credentialing scope" → the wizard Payer Network
section via the new `/onboarding/wizard?section=` deep-link) / Reactivate /
Remove; retired/merged payers can't be newly added (canonical successor named);
non-admins browse read-only. Pure branch logic in `src/lib/payerCatalogActions.ts`
(`catalogAction`/`payerSetupEmptyState`/`isActiveAssignment`, tested). Downstream
empty states are now actionable: `PayerNetworkSection` → "Browse payer catalog";
Payer Setup (`payer-admin/PayerDirectory`) distinguishes no-payers-added vs
payers-but-no-scope; `ScopeReviewSection`'s "Go to Payer Network" scrolls +
moves focus + temporarily highlights via the enhanced `openSection`
(reduced-motion aware). `AttachPayerDialog` stays target-creation-only over
active subscriptions. Missing-catalog-payer intake is a reported follow-up
(TECH-DEBT TD-34) — no free-text payer creation. On provider
create, `src/routes/providers.new.tsx` auto-attaches cases for the org's
assigned+starter payers via the pure `src/lib/starterCases.ts` derivation →
`createCase`/`create_case_with_tasks` (opens at the provider's `home_state`,
skips payers with no home-state license, skips existing combos; `facility: null`
so `{{facility.*}}` resolve empty — the launch `CreateCasesDialog` stays the
facility-linked path). **Inert until a global payer is assigned+flagged starter**
(zero assignments today). The formerly-duplicated `pickTemplate` is now centralized
in `src/lib/pickTemplate.ts` (every SOP-resolving surface imports it). Since
**E4.2 SOP resolution hardening** it is an explicit, order-independent tier
ranking (org exact-group → org any-group → global-payer exact-group →
global-payer any-group → generic fallback → null) with a deterministic
within-tier tiebreak — a group-agnostic (null-group) template is the "any group"
tier and NEVER outranks an exact-group match, and array order is not
load-bearing (see the Stage 4 E4.2 SOP Resolution Hardening entry).

### Reference-only data (Epic 2e, P6 PR2, 2026-07-07)

`providers` and `facilities` carry `reference_only boolean NOT NULL DEFAULT
false` (migration `20260707150000_reference_only_flag.sql`, repo + hosted;
additive, all existing rows `false`). A reference-only row is migrated/onboard-
existing data that exists to be **referenced, not worked**, so it is SKIPPED by
the work surfaces: the action engine / Home queues (`src/routes/home.tsx` drops
reference providers' cases from the action queue and reference locations from
"Launches at risk") and the Fix-it queue (`buildFixitQueue` in
`src/lib/fixitQueue.ts` filters reference providers before the gap pass — so no
`provider_gap` card). It stays VISIBLE in the work views with a neutral
"Reference" chip (`StatusPill status="neutral"` from the legacy
`src/components/StatusPill.tsx`): the providers work view
(`providers.index.tsx`) lists reference providers in a separate "Reference"
section, out of the chip counts/filters/badges; the launches list + detail
render the chip and suppress the go-live nudge. `reference_only` rides in
`PROVIDER_LIST_COLUMNS`; facilities load it via `select("*")`. Domain types:
`Provider.referenceOnly` / `Facility.referenceOnly`. The CSV onboarding import
(below) is the first writer that sets the flag true (via its default-on toggle);
outside that path the flag stays false.

### CSV onboarding packages (Epic 2c, P6 PR3, 2026-07-07 — SUPERSEDED by E3.0)

**The direct-commit wizard is GONE (E3.0 TE-8, 2026-07-13):** `/admin/import`
is now the staged roster importer (see "Stage 3 built so far") and
`src/services/importCommit.ts` was deleted — there is no live-table CSV write
path anymore. What SURVIVES from Epic 2c is the pure core below (the parser +
coercions are E3.0's TE-1 foundation; `parseImportPackage` keeps its tests).
Historical shape of the retired wizard, for context:

Admin-only wizard at **`/admin/import`** that onboarded a
three-file CSV package — `facilities.csv`, `providers.csv`,
`provider_facility_assignments.csv` — into the org. **Deterministic app logic,
no LLM/AI ingestion; no schema change** (`reference_only` already existed).

- **Pure core `src/lib/csvImport.ts` (+ `.test.ts`, 28 cases):**
  hand-rolled RFC4180-ish parser (quoted fields, embedded commas/newlines, `""`
  escape, CRLF/LF; records carry the 1-based source line) — **no CSV dep added**.
  `parseImportPackage(pkg)` returns `{ facilities, providers, assignments,
errors }`. Errors are line-numbered `{ file, line, column, message }`
  (required-field-missing, bad date, bad npi/ssn/state format, duplicate id,
  unknown provider/facility referenced by an assignment). Coercion helpers
  `coerceDate` (ISO / M/D/YYYY / YYYY/M/D → ISO), `coerceBool`,
  `coerceStringArray` (the `license_states` shorthand → extra state-only
  licenses). Header sets are normalized (case/space-insensitive): facilities
  `ref,name,group_name,street,city,state,zip`; providers
  `ref,first_name,last_name,credentials,email,phone,npi,caqh_id,specialty,
taxonomy_code,dea_number,date_of_birth,ssn_last4,start_date,home_*,is_new_grad,
group_name,license_state,license_number,license_type,license_issue_date,
license_expiration_date,license_states`; assignments
  `provider_ref,facility_ref,is_primary`. A row's identity `keys` (facility:
  ref+name; provider: ref+npi+email) is how an assignment resolves its
  `provider_ref`/`facility_ref` to a real created id — done deterministically
  by lowercased key match; `group_name` resolves to an existing group id.
- **Commit path (RETIRED):** `src/services/importCommit.ts` wrote through the
  existing create services (`createFacility`, `createProviderWithDetails`,
  `assignProviderToFacility`) with a best-effort `CommitSummary` — deleted in
  E3.0; E3.1's staged commit replaces the job. `ProviderInput`/`FacilityInput`
  keep the optional `referenceOnly?: boolean` they gained here (rides
  `snakeizeRow → reference_only`; omitted → DB default false).
- **Route `src/routes/admin.import.tsx` (REBUILT):** now the E3.0 internal
  staged importer — see "Stage 3 built so far". The old three-file
  Parse→toggle→Commit page is gone; the URL still renders (TS-23).

### Statuses pattern

`status_configs` rows per org with `track ∈ {credentialing, contracting,
location}`, `label`, `color` (hex), `sort_order`, `required_fields`,
`action_bucket` (`ours|waiting_payer|waiting_provider|complete` — drives the
Home action engine, `src/lib/actionState.ts`).

**The canonical status set is code-owned (Epic 6 finale, P11, 2026-07-07):**
`src/lib/canonicalStatuses.ts` holds all 22 canonical rows as typed data
(`CANONICAL_STATUSES` per track: credentialing 9 / contracting 6 / location 7 —
`ALL_CANONICAL_STATUSES` flat; `ActionBucket`/`ACTION_BUCKETS` closed set). This
**mirrors the `create_organization` RPC seed by hand** (the RPC is SQL and can't
import TS, so keep the two consistent — the mirror is asserted well-formed in
`canonicalStatuses.test.ts`). No migration/relabel shipped: both live demo orgs
already carry exactly this set (zero divergence). Because the set is code-owned,
**Admin > Statuses (`src/routes/admin.statuses.tsx`) is now READ-MOSTLY** — one
`TrackSection` per track with drag-to-reorder + recolor (and required-fields
editing) via `updateStatusConfig`; the **add-status / delete / label-edit UI was
removed** (create/edit-label is gone; new-org seeding uses the RPC, not the UI).
The `createStatusConfig` service + `useCreateStatusConfig` hook stay defined but
have no UI caller.

**Semantics are matched by label** across the app ("In-Network", "Live",
"Pre-Credentialing Setup") — the codebase idiom, not ids. The shared label
constants (`PRE_CRED_PAYER_NAME` + all 17 status labels: `NOT_STARTED_LABEL`,
`IN_NETWORK_LABEL`, `OON_LABEL`, `IN_PROGRESS_LABEL`, `WAITING_ON_PROVIDER_LABEL`,
`SUBMITTED_LABEL`, `APPROVED_LABEL`, `DENIED_LABEL`, `NOT_REQUIRED_LABEL`,
`CONTRACTED_LABEL`, `PROSPECT_LABEL`, `PLANNED_LABEL`, `INTERVIEWING_LABEL`,
`PENDING_FULFILLMENT_LABEL`, `READY_FOR_LAUNCH_LABEL`, `LIVE_LABEL`,
`INACTIVE_LABEL`) live in one place — `src/lib/statusLabels.ts`; import from
there, never re-hardcode a label literal (a one-char drift silently breaks
by-label matching). This is the single edit point for statuses-to-code work.
The pure by-label matchers (`actionState.ts`, `clientProgress.ts`,
`launchLocations.ts`, `launchReadiness.ts`) route the incoming label through
`canonicalLabel(label)` before comparing, applying `STATUS_LABEL_COMPAT`
(`canonicalStatuses.ts`) — the **single place to reconcile a divergent org's
label → canonical**. `STATUS_LABEL_COMPAT` is EMPTY today (orgs already match),
so `canonicalLabel` is a no-op identity; the day an imported org ships a
non-canonical label, one entry there fixes matching everywhere at once.

Status pills (E0.9 design-system conformance): both implementations render
4px borderless pills from the fixed `--mp-*-tint`/`--mp-*-ink` token pairs —
the shared tone map is `statusToneClasses` in `src/components/StatusPill.tsx`.
`src/components/triage/StatusPill.tsx` takes the raw hex from
`status_configs.color` and maps it through `hexToStatusColor` to a tone (the
old color-mix tinting is gone) — use it for DB-driven statuses. The legacy
`src/components/StatusPill.tsx` is for semantic one-offs and carries the
`neutral`/`brand`/`violet` variants; admin payers/audit/mso-routing and the
settings panels render through it. Don't hand-roll pill spans; neutral _tag_
chips (group name, via-MSO, Archived) are the deliberate exception.

## Launches = locations (launch PRD v2.1, built Jul 2026)

**A launch is not an entity — it's a `facilities` row in a pre-active
location-track status.** The Launches page is a filtered view of locations.

- Schema: `facilities.status_id` (FK → location-track `status_configs`),
  `facilities.effective_date` (date; month-only dates stored as the 1st).
  Seeded per org: Prospect(10) → Planned(20) → Interviewing(30) → Pending
  Fulfillment(40) → Ready for Launch(50) → Live(60), plus Inactive(70).
- Cases link to a location through the **existing**
  `credential_cases.facility_id` — the PRD's `cases.location_id` maps onto it;
  do not add a second FK.
- Provider-on-launch = `provider_facility_assignments`.
- **Legacy, do not use:** the hosted `launches` table and
  `providers.launch_id`. Their data was folded into facilities/pfa by
  migration `20260704041301_*` (launch_location_pivot). They remain in the DB
  per the additive rule but nothing reads or writes them.
- Pure page logic + tests: `src/lib/launchLocations.ts` —
  `splitLaunchSections` (Recently Launched = Live + effective date within
  `RECENTLY_LAUNCHED_DAYS = 30`, future dates tolerated; Pipeline = pre-Live
  sorted date asc, no-date last; Inactive and status-null rows never appear),
  `launchDateDisplay` ("Target Mmm D, YYYY" for Planned/Interviewing, "Starts"
  for Pending Fulfillment/Ready for Launch/Live, nothing for Prospect),
  `isNewStateLaunch` (no other Live location in group+state; status-null
  locations count as live), `needsGoLiveNudge`, `transitionWarnings`
  (Ready for Launch w/o provider, Live w/ zero cases — warn, never block).
- Feature surface: `src/routes/launches.index.tsx` (sections, counts, row
  kebab: Edit launch / Assign provider / Create cases, New Launch modal),
  `src/routes/launches.$id.tsx` (detail; `?createCases=true` auto-opens case
  creation), `src/components/launches/` (`LaunchEditModal`,
  `AssignProviderDialog`, `CreateCasesDialog`), service
  `src/services/launches.ts`, hooks `src/hooks/useLaunches.ts` (list shares
  the `facilities` cache key; assignments under `facility-assignments`).
- Case kickoff: checklist of active payers ordered pre-cred → direct →
  MSO-routed (by MSO name) → no-routing; pre-checks payers with routing and no
  existing case for (provider, state); existing combos disabled ("Case
  exists"); each created case carries `facility_id = location.id` and goes
  through `createCase` → `create_case_with_tasks` (SOP tasks + audit included).
- New-provider-from-launch: `/providers/new?locationId=<facilityId>` prefills
  group + facility checkbox; on save `createProviderWithDetails` writes the
  assignment and the page navigates back to the launch.
- Home's "Launches at risk" queue and Reports > Contracts matrix also read
  locations (label match on "Pending Fulfillment"/"Ready for Launch").

## Case creation flow (manual + launch)

(E6.3/E6.4 made generation confirm the ONE door — `ManualCaseModal` is the
escape hatch; `NewCaseModal`/`CreateCasesDialog` are deleted, and E6.5
deleted the MSO routing lookup outright.) The historical flow: both modals
resolved the MSO routing rule per payer/state/specialty, picked a SOP template
(the shared `src/lib/pickTemplate.ts` — the **E4.2-hardened deterministic
ranking**: org exact-group → org any-group → global-payer exact-group →
global-payer any-group → generic fallback → null; order-independent, and
another group/payer/state never resolves), resolve tokens via
`resolveTemplate(template, provider, group, facility, {mso}, licenseNumber)`,
stamp the resolved tasks with the template's `(id, currentVersion,
resolutionTier)` via `stampTasks` (E2.2 + E4.2 — the stamp now also carries
`sopResolutionTier`), then `createCase(input, tasks)`. Duplicate combos are
pre-filtered client-side; the DB unique constraint is the backstop.

## SOP template authoring — Admin > Templates wizard (2026-07-07)

Templates are authored org-level at **`/admin/templates`** (nav label
"Templates", FileText icon), NOT per-case. The list
(`src/routes/admin.templates.index.tsx`) shows one row per `sop_templates` row
(match key Payer/State/Specialty/Group, task count, last updated; archived
hidden by default). **`+ New Template`** (admin-only) opens a **4-step wizard**
(`src/components/templates/TemplateWizard.tsx`: Basics → Tasks → Steps & fields
→ Review) at `/admin/templates/new`; a row click opens the same wizard pre-filled
at `/admin/templates/$id`. Save is ONE write (`createTemplate`/`updateTemplate`
in `src/services/templates.ts`, audited) on the final step; unsaved-changes
guarded via `useBlocker`. The wizard writes the SAME `task_definitions` jsonb
shape the old editor did (converters in
`src/components/templates/editableTemplate.ts` — `toEditable`/`fromEditable`;
data-field tokens stay BARE for the resolver, `step_type`/`email_template`
preserved), so `sopResolver.ts` + case auto-generation are untouched. Token
picker pulls the live catalog from `get_sop_field_tokens()` via `useTokenCatalog`.
Admin-only edit; specialists get a read-only wizard; the whole Admin nav group is
already hidden from billing. **Retired:** the old single-page editor at
`/admin/sops/$id` (and the `TokenHelpPanel` component it used) is gone;
`/admin/sops` + `/admin/sops/$id` are now redirect shells → `/admin/templates`
(param-preserving), mirroring the earlier `/admin/templates`→`/admin/sops`
redirects which were flipped back. Reused: `TemplateTaskRow`,
`DiscardConfirmDialog`, and the `useSops`/`useSop`/`useCreateSop`/`useUpdateSop`
hooks (`useAdmin.ts`). **Render contract (measured INP hotfix, 2026-07-17):**
`TemplateTaskRow` is `React.memo` and every handler the wizard passes it is a
`useCallback` — keep BOTH, or typing in any Step 3 field re-renders every task
card again (measured 264–296ms p50 per keystroke on a 10-task template, prod
build @ 4x CPU throttle; ~50ms with the bailout). Pinned by
`TemplateTaskRow.test.ts` (memo) + `e2e/template-typing-latency.spec.ts`
(latency budget + toast never blocks the primary action).

## SOP step ↔ portal linking (2026-07-08, no migration)

An `online_form` SOP step can carry an optional **`portalKey`** (bare/normalized
text) that links it to a `portals`-registry row, so the same portal identity
threads authoring → generated task → extension fill → task close-out. **Zero
migration** — `portalKey` rides the existing `task_definitions` / `sop_content`
jsonb; every pre-existing step lacks it and degrades gracefully. `portal_key`
(text), not a portals row id, is the join key by design: `sop_templates` can be
global (`org_id NULL`) while `portals` are org-scoped, and it's already the
cross-system idiom (`portal_field_maps`, `fill_sessions`, the touches contract).

- **Data shape:** `SOPStep.portalKey?` + `SOPTaskDefinition.steps[].portalKey?`
  (both additive in `types/index.ts`). `sopResolver.ts` copies it through
  **verbatim, never interpolated** (it's an identifier). `editableTemplate.ts`
  `toEditable`/`fromEditable` carry it, writing it **only for online_form steps**
  and folding to the stored form via `normalizePortalKey` (`src/lib/tokenFormat.ts`
  — trim + lowercase, does NOT slugify punctuation, blank→null; tested).
- **Authoring:** the Template wizard's `TemplateTaskRow` renders a **Portal
  select** on online_form steps (payer-filtered by default, "Show all portals"
  toggle, empty-registry amber note → `/admin/portals`, soft "won't be linked"
  nudge — never required). The Review step chips each online_form step
  linked/unlinked. Wizard threads `portals` (`usePortals()`) + `templatePayerId`
  as props. **One portal per task** (E1.7b hotfix): the extension closes exactly
  one task per portal submission, so a task whose `online_form` steps carry two
  different normalized portal keys is ambiguous — the offending task card shows
  an amber warning and every content-writing save (`handleSaveClick` +
  `handleDuplicate` via `portalConflictBlocked`) is blocked with a toast before
  any mutation. The pure detector is `portalKeyConflicts` / `taskPortalKeys` in
  `editableTemplate.ts` (tested). `createPortal` (`src/services/portals.ts`) also
  folds `portal_key` through `normalizePortalKey` at the write boundary, so a
  hand-typed mixed-case/whitespace key can't silently miss the step↔portal join.
- **Generated task views:** `src/components/portals/PortalStepLink.tsx` resolves a
  step's `portalKey` against `usePortals()` and shows portal name + "Open portal"
  (`formUrl`, `target=_blank`) + verification pill; unresolved key → neutral
  "not set up in this org" note. Rendered in `TaskDrawer` (via StepDetails since 2026-07-20; CaseWizard before that)
  (`OnlineFormStep`), and `/tasks/$id`. The verification pill is the shared
  `src/components/portals/PortalVerificationPill.tsx` (`portalVerification()`
  helper) — Admin > Portals `StatusCell` now delegates to it (was duplicated).
- **Admin > Portals** shows **"Referenced by N SOP steps"** per portal
  (`src/lib/portalReferences.ts` `countStepsByPortalKey`, excludes archived;
  tested). **Portal-key editing is not exposed in the UI** — a rename would
  orphan every SOP link the same way a URL change clears verification, so it's
  deliberately left non-editable (only name/payer/url on create, url on edit).
- **Close-out loop (extension side):** `GET /api/cases?providerId=` rows carry
  `portalTasks` (see the server API section) so the extension can match the
  page's `portal_key` to a case's open tasks and pass the `task_id` on
  `POST /api/cases/:id/touches` — the already-built Story 7 close-out that was
  idle for want of a task source.

## Touchlog — single case-activity spine (Stories 1–3, 8; 2026-07-07)

`touches` is now THE touchlog: `entry_type ∈ {touchpoint, note, system_event,
task_update}` (migration `20260707120000`). Only touchpoints carry
`touch_type`/`outcome` (both nullable now; a shape CHECK enforces them present
for touchpoints). New columns `task_id` (FK → tasks) and `communication_event_id`
(FK → communication_event, Story 8). Channel widened with `mail`; the outcome
CHECK now allows the Story 3 taxonomy ∪ legacy codes.

- **The three note stores collapsed into the touchlog.** The old `notes` table's
  case/task rows were migrated to `note` entries (`20260707120100`, backup
  `notes_pre_touchlog_backup`) and the `notes` table is now **dormant for
  case/task** — the app reads/writes those through `touches`. Provider notes
  still use `notes` (`useNotes("provider")` / `CaseNotesPanel` on the provider
  page — do NOT repoint those). Per the additive rule the table is kept, not
  dropped.
- **Service/hooks:** `src/services/touches.ts` — `logNote`, `getTaskTouchlog`,
  `logTouch` (sets entry_type); stalled/follow-up reads are scoped to
  `entry_type='touchpoint'`. `useLogNote`/`useTaskTouchlog` in `useTouches.ts`.
  `getCase` derives the case Notes list AND batch summaries from the touches
  embed (no second query for notes).
- **Taxonomy (Story 3):** `src/lib/touchOutcomes.ts` (+test) is the channel →
  outcomes source of truth (Phone maps to touch_type `call`). Edit the taxonomy
  there; `TouchOutcome` in `types/index.ts` is the closed union the DB CHECK
  mirrors. "Got reference number" prompts to write `payer_reference_id`.
- **UI:** `CaseTouchesPanel` is the unified timeline (all entry types, Add
  touch/Add note); `TaskDrawer` + `/tasks/$id` render the `task_id` slice;
  `credential_cases.payer_reference_id` (latest-wins) has an inline editor on
  case detail.
- **Story 8 batch touchpoint:** `communication_event` parent (payer + channel +
  occurred_at) + child touchpoints (`communication_event_id` set). Service
  `communicationEvents.ts` (`logBatchTouchpoint`, `getCasesForPayer`), hook
  `useCommunicationEvents.ts`, `BatchTouchpointDialog` launched from the Cases
  work-list ("Log payer call", writer-gated). Timeline shows "Part of {payer}
  {channel} call, N cases". `types.ts` carries a **hand-added**
  `communication_event` block (MCP `generate_typescript_types` was unavailable) —
  normalize on the next regen.
- **Extension write-back + safeguards (Stories 4–7, 9–11) are BUILT** (PR C
  server bridge + PR D extension, 2026-07-07; full trail in
  `docs/touchlog-feature-plan.md`). PR C needed **no migration** — every column
  already existed. `submissionTouches.ts` now layers optional write-back on the
  same `POST /api/cases/:id/touches`: `payer_reference_id` overwrites the case's
  latest-wins ref (Story 5, audited); `wip_note` → a `note` entry, task-linked
  when `task_id` given (Story 6); every submit writes a `system_event` "Form
  submitted to {payer}", and an explicit `task_id` is org-validated, marked done,
  and recorded as a `task_update` entry (Story 7, **close-decision (c)**: the
  extension passes the task_id — `fill_sessions` has no `task_id` column, so the
  fill-session route was rejected); optional `pdf_filename` → a second
  system_event. `providerCases.ts` `GET /api/cases` rows gained `payerReferenceId`
  (prefill), author-resolved `latestNote` (Story 11), and `lastSubmittedAt` (the
  latest `outcome 'submitted'` touchpoint, Story 10 dup guard). Isolation gate
  **assertion 13** (cross-org `task_id` → 404 before any write) + a `tasks` leak
  mode cover the new write; the workflow env carries `KANSAS_CASE_ID` +
  `SOUTHPARK_TASK_ID` fixtures (optional — the gate skips 13 if unset). Every
  write stays org-scoped from ctx.

### Structured touches & follow-up cadence (E4.1, R6, 2026-07-15)

Migration `20260715130000_structured_touches.sql` (repo + hosted): `touch_type`
widened to the **seven fixed types** `{call, email, portal, fax, caqh_update,
provider_outreach, internal_sync}` (legacy `mail` kept, no backfill); `outcome`
gains the optional **disposition** set `{successful, attempted, no_response,
error, other}`; the touchpoint-shape CHECK loosened so `outcome` may be NULL on
a typed touch; additive columns `clears_follow_up`, `recipient_name`,
`recipient_contact`, `corrects_touch_id` (self-FK). `touches` stays append-only —
corrections are appends, never edits.

- **Pure logic (tested):** `src/lib/touchTypes.ts` (7-type metadata + labels +
  `touchTypeDirection` payer-facing/internal, F4.1.1); `src/lib/touchDispositions.ts`
  (5 dispositions, Other needs context, labels folded into `touchOutcomes`);
  `src/lib/followUps.ts` `resolveActiveFollowUp` (**carry-forward reducer**,
  F4.1.2 — latest-first by `(touch_date, created_at, id)` DESC; a date-less touch
  carries the prior follow-up forward, only `clears_follow_up` ends it);
  `src/lib/touchesExport.ts` (Compliance CSV); `src/lib/actionBridge.ts`
  (`runTransitionWithTouch`/`retryTouchOnly` — F4.1.8 sequencing).
- **Service/hooks:** `touches.ts` — `logTouch` takes the structured `TouchInput`
  (optional outcome, `clearsFollowUp`, recipient, explicit `source`);
  `correctTouch` (org+case-validated append); `bulkLogTouch` (org-bounded ids,
  one touch + one `TOUCH_LOGGED` audit **per touch** + a batch summary, F4.1.7).
  `getLatestTouchFollowUps` now runs the carry-forward reducer (feeds Home +
  the E2.3 queue). `useTouches.ts` adds `useCorrectTouch`/`useBulkLogTouch`.
- **F4.1.3 — E2.3 queue:** `buildNextBestActions` (`src/lib/nextBestActions.ts`)
  extended: the `follow_up` signal uses the carry-forward reducer with the TE-2
  tie-break; overdue follow-ups
  rank first and get a "Follow-up overdue" reason. (The E4.2 F4.2.5 org
  ranking-config seam that once rode here was REMOVED by E6.6 F6.6.6 — the
  shipped order is fixed; `next_best_action_configs` is dormant, TD-44.)
- **F4.1.8 — Action Bridge:** every generic pipeline transition dialog
  (`PipelineDialogs.tsx` `TransitionConfirmDialog`, incl. Action Required/RFI)
  gains an off-by-default `PipelineTouchSection`; `PayerPipelineControl.confirmTransition`
  sequences `advancePayerPipeline` → (on success) `logTouch` via
  `runTransitionWithTouch` — no touch on a failed transition, touch-only retry
  after a successful one. `advance_payer_pipeline`/`payer_pipeline_history`
  untouched. (The terminal-close/correction dialogs reuse the same section +
  orchestrator when needed — mechanical follow-up.)
- **UI:** `CaseTouchesPanel` rebuilt (structured entry form, type pill +
  disposition + recipient rows, correction pair, timeline filters,
  last-payer-communication, CSV export); `BulkLogTouchDialog` from the Cases
  work-view links to `/cases?ids=…` (new `ids` search param). Seeds:
  `supabase/seed-redesign.sql` E4.1 touches on the Dillon cases (TS-73..75).

## Owner-facing view (RETIRED to the Denials report, E6.6)

- The Client Progress owner view is GONE: E6.6 F6.6.3 replaced its story
  with the Reporting Center Denials report, and the whole chain
  (`src/lib/clientProgress.ts` + test, `src/services/clientProgress.ts`,
  `src/hooks/useClientProgress.ts`, `src/components/client-progress/`) was
  deleted. `/client-progress` and `/progress` are redirect shells →
  `/reporting/denials` (both URLs had been shared with owners out-of-band —
  they never dead-end).

## Cleanup surfaces (Fix-it queue / Mapping review / Portals admin, built 2026-07-06 — SUPERSEDED by E6.5)

**E6.5 (2026-07-19) retired all three surfaces**: drift repair, mapping
training, and portal registration live inside the SOP editor's
`FormStepPanel`; the Sidebar badge is drift-only (`useFormDrift` →
`src/lib/formDrift.ts`); `/fix-it`, `/portals/$key/train`, and
`/admin/portals` are redirects. `useMappingReview`'s mutations +
`mappingConfidence`'s suggestion logic survive as the trainer's plumbing.
Historical shape below, for context:

Three connected browser surfaces where users **find and kick off** fill-coverage
cleanup — the Chrome extension is where they _do_ the fills. Product law
(locked): **no timers / speed mechanics / streaks anywhere**; corrections are
celebrated as "good catches", never penalized; the Fix-it deck is ordered by
**soonest blocked fill, never by ease**.

- **Schema (migration `20260706120000_cleanup_surfaces_schema.sql`, applied
  hosted + repo):** new `portals` (org-scoped payer-portal registry, unique
  `(org_id, portal_key)`) and `field_dictionary` (org-scoped
  `label_normalized → token` memory, unique `(org_id, label_normalized)`,
  status `suggested|confirmed|rejected`) tables — RLS mirrors `payers` (member
  SELECT, writer INSERT/UPDATE). `portal_field_maps` gained
  `field_label/form_section/confidence`. **Browser RLS on
  `portal_field_maps`/`fill_sessions` already existed** (member+global SELECT,
  writer INSERT/UPDATE on own-org rows) and is reused — the app now reads/writes
  these tables directly under RLS, so both files became **dual** (server ctx
  path + browser readers/mutations), like `providers.ts`; their `*.di.test.ts`
  now `vi.mock` `externalClient`.
- **Surface 1 — Fix-it queue** (`/fix-it` + a Home section + a writer-only
  sidebar entry with live count): impact-ordered deck of **four** card types
  (provider data gap / dictionary confirm / train-this-form / **broken mapping**
  — the E4.3a form-drift repair card). Pure derivation in
  `src/lib/fixitQueue.ts` (+tests) from existing caches; editable-gap fields
  whitelisted in `src/lib/fixitFields.ts` (scoped to `PROVIDER_LIST_COLUMNS` so
  the list projection never reads `undefined` and false-flags a gap). Weekly
  "good catch" counter in `src/lib/goodCatches.ts` (client-local, `typeof
window` guarded). Hook `src/hooks/useFixit.ts` (`useFixitQueue` derives the
  queue; save/skip/dictionary mutations). Skip → `createFollowUpTask`
  (`services/tasks.ts`).
  - **Broken-mapping / form-drift (E4.3a, reimplemented from main `e068f1a`, NOT
    cherry-picked).** The latest REAL fill per portal (`useRecentFills`, dry-run
    `is_test` fills EXCLUDED — they never touch the live DOM, so they can't carry
    drift and must not mask a real fill's signal) is parsed defensively in
    `fixitQueue.ts` (`parseSkippedEntries`, `FIELD_NOT_FOUND_REASON = "field not
found on this page"` — the extension's exact wording from
    `minted-extension` `content/fillEngine.ts`). Only a `kind:"skipped"` entry
    with that reason is drift; the E4.2 dry-run `{selector,label,reason:
unmapped|empty_token}` shape shares the column but never matches. Each not-found
    entry joins a live (non-retired) map by reported `mapId` first, then the
    report-label compat join (`reportLabelOf`) for older telemetry; a
    reported-but-stale id raises no card. One consolidated `broken_mapping` card
    per portal, split into own-org rows (`BrokenOrgRow`, actionable) and global
    (`globalCount`, read-only). `useSendBrokenToTraining` re-proposes ONLY the
    org rows via `reproposeFieldMap` (RLS blocks global writes), invalidates
    `portalFieldMaps`+`lastFills`, and the card opens `/portals/$key/train`.
    e2e `e2e/fix-it.spec.ts`.
- **Surface 2 — Mapping review** (`/portals/$portalKey/train`): card-by-card
  training. High-confidence fields batch into one confirm screen; the rest go
  one at a time (Approve/Edit/Manual, keys A/E/M, U undo). Confidence + batch
  split in `src/lib/mappingConfidence.ts` (+tests); dictionary learns on each
  approval (`services/fieldDictionary.ts` `upsertDictionaryEntry`); token picker
  over the closed catalog (`services/tokenCatalog.ts` = `get_sop_field_tokens` +
  the `user.*` family). Training mutations live in `portalFieldMaps.ts`
  (`approveFieldMap`/`markFieldMapManual`/`reproposeFieldMap`/
  `batchApproveFieldMaps` — tokens normalized to bare form at the write
  boundary). Hook `src/hooks/useMappingReview.ts`. **The deck is seeded once
  into local reducer state** so persisting a decision never re-splits it
  mid-flow; caches invalidate on finish/exit. Completing a pass calls
  `markPortalVerified`. **Only OWN-ORG proposed rows are trainable** — RLS
  blocks org writes to global (`org_id NULL`) rows, so the deck excludes them
  (`partitionTrainableMaps` in `mappingConfidence.ts`). A global row is the
  platform's shared catalog and belongs in `approved`; a global row left in
  `proposed` is a seeding state only the platform can finish (promote via MCP,
  the sanctioned `portal_field_maps` channel — that's how the 24
  `bcbs_ks_enrollment` global rows were fixed 2026-07-08). When a portal's only
  unapproved rows are global, the train page says so honestly ("managed
  centrally") instead of the misleading "fully trained" it showed before. NB:
  the extension fills `proposed` AND `approved` maps in v0 (only `retired` is
  skipped) — approval status gates the training UX, not what autofills.
- **Surface 3 — Portals admin** (`/admin/portals`, under the Admin nav group):
  registry table — inline URL edit (`updatePortalUrl` clears verification +
  stamps `url_changed_at` → "Needs re-verify" pill), mapped/proposed/**unlinked
  ("N no value")** counts (from `portal_field_maps`; the "no value" flag +
  the field-dialog "needs value" state derive from the pure
  `src/lib/portalMappingHealth.ts` `isUnlinkedFieldMap` — a non-retired map with
  a live selector but no token/hardcoded/manual source, so it fills blank every
  time; E4.3a), verification status, last fill result (latest
  `fill_sessions` row per `portal_key`), view-fields dialog, Train action.
  Service `src/services/portals.ts`, hook `src/hooks/usePortals.ts` (also serves
  the field-map + last-fill readers Surfaces 1–2 reuse). Query keys added under
  `queryKeys` (`portals`, `portalFieldMaps`, `lastFills`, `fieldDictionary`,
  `tokenCatalog`, `fixit`). Domain types `Portal`, `FieldDictionaryEntry` +
  `PortalFieldMap.{fieldLabel,formSection,confidence}` in `src/types/index.ts`.
- **Shared label normalizer:** `src/lib/tokenFormat.ts` `normalizeFieldLabel`
  (lowercase, collapse whitespace, strip trailing `:`/`*`) is the
  `field_dictionary.label_normalized` key.

## UI conventions worth knowing

- Create/edit modals: mount-when-editing pattern (`{modal ? <Modal .../> :
null}` with `<Dialog open onOpenChange={(o) => !o && onClose()}>`), nullable
  entity prop switches create/edit, `"__none__"` sentinel for empty selects,
  footer `variant="outline"` Cancel + `bg-[#1B4D3E]` primary, amber note boxes
  `border-[#FDE68A] bg-[#FEF3C7] text-[#92400E]`, red error boxes
  `text-[#B91C1C] border-[#FCA5A5] bg-[#FEF2F2]`.
- Dates: `fmtDate`/`fmtDateTime` in `src/lib/format.ts` → "MMM d, yyyy"
  everywhere (PRD-locked; no month-only display).
- Toasts: `import { toast } from "sonner"`; `Toaster` mounted once in
  `__root.tsx`.
- Feature tables are hand-rolled `<table>` markup (see `admin.payers.tsx`);
  work-list pages use row-card lists, not tables. `PageHeader` on every route.
- The Providers work view's filter card is URL-driven
  (`/providers?chip=needs|inprog|awaiting`, no param = all) so other pages can
  deep-link a filtered view — Home's "View all" uses it. Home's section/row
  components live in `src/components/home/`.
- Design tokens `var(--mp-*)` on triage/launch surfaces; hex-token classes on
  admin surfaces. Follow whichever the file you're editing already uses.
- Public (no-session) routes are `/` (landing), `/login`, `/dev*`, and
  `/privacy` — the list lives in `__root.tsx` (`isPublicRoute` skips the login
  redirect; a separate check renders `/`, `/login`, `/privacy` outside
  `AppShell`). `/privacy` is the Chrome Web Store policy URL for the
  extension; its content mirrors `docs/privacy-policy.md` (edit the doc first,
  keep the page in sync). Entity/date/contact were filled 2026-07-05 (South
  Park Physician Group, surapurs@gmail.com); the policy is a business
  document — don't reword it without the owner.

## Known warts (pre-existing; don't "discover" them again)

- `PROVIDER_LIST_COLUMNS` (`src/services/providers.ts`) is a partial
  projection — list rows are typed `Provider` but omit unlisted columns (e.g.
  the legacy `launchId`). `specialty` and `email` were added Jul 2026 because
  the launch kickoff routes off the list projection; keep the projection and
  its consumers in mind before reading "missing" fields. `getProvider`
  selects `*`.
- Provider **edit** drops facility assignments (`providers.$id.edit.tsx`
  passes `facilityIds: []` and the update path never syncs them); assignments
  are effectively write-once at creation plus launch-flow inserts.
- `provider_facility_assignments.is_primary` is read (NewCaseModal facility
  default) but never written by the app.
- The generated Supabase scaffold is fully gone (Jul 2026): `auth-middleware.ts`
  and `client.server.ts` were deleted in the R1 verification lane; the dead
  `client.ts` and the `auth-attacher.ts` middleware `start.ts` registered were
  deleted in the consolidation pass (zero `createServerFn` call sites existed,
  and that client read `VITE_SUPABASE_PUBLISHABLE_KEY`, which is never set).
  `externalClient.ts` is the only Supabase client. If serverFns are ever
  introduced, attach auth against `externalClient.ts`.
- `beforeLoad` role guards (providers new/edit) read the zustand store,
  which is EMPTY during a hard-load beforeLoad (init() runs after route
  load) — they only guard client-side navigation. Any guarded route needs
  the render-time `useRole()` backstop those two files now carry.
- MSO routing matching is exact and case-sensitive (`'All'` is the only
  wildcard). Demo data was aligned Jul 2026: rules and providers both say
  `Physical Therapy` (rules previously said `PT` and never matched).
- `supabase/seed.sql` — the `sop_templates.task_definitions` were normalized
  to the canonical `{dueOffsetDays, steps:[{label, stepType, dataFields}]}`
  shape (P3, 2026-07-07) with `stepType: "online_form"` on each step plus one
  `draft_email` example, so a local rebuild now seeds tasks correctly. Still
  legacy: the pre-resolved `tasks` seed rows carry `sop_content` in the old
  `{steps:[{step, dataFieldTokens}]}` shape (not what `SOPStep` expects) — a
  separate, cosmetic-on-local-rebuild issue, out of P3 scope.
- NewCaseModal still passes `facility: null` into `resolveTemplate`, so
  `{{facility.*}}` tokens resolve empty there; the launch kickoff passes the
  location.
- `Touch.source` (`src/types/index.ts`) was widened to include `"email"`
  (2026-07-07, P0-e) ahead of the specced inbound-email→touch writer, but the
  live `touches_source_check` constraint still allows only
  `manual|email_webhook|extension`. No current path writes `"email"` (writers use
  `manual`/`extension`), so nothing breaks — but that webhook MUST ship a
  migration adding `'email'` to the constraint before it inserts, or the INSERT
  fails the CHECK. The type is ahead of the DB by design.

## Shared state ownership (parallel lanes)

When multiple Claude Code lanes run in parallel, these pieces of shared state
have exactly one owner at a time:

1. **`portal_field_maps` rows change via Supabase MCP only, never in code
   sessions.** Code (the extension's `portals.ts`) and the DB `url_pattern`
   change together — one actor, same day.
2. **CLAUDE.md is edited by at most one lane per day** — the last lane to
   close.
3. **Gate expected-count env values** (`EXPECTED_KANSAS_PROVIDERS` /
   `EXPECTED_SOUTHPARK_PROVIDERS` in the isolation-gate workflow env block)
   are owned by whichever lane changes demo-org data, in the same PR.

## Keep this file honest — session-end ritual

At the end of every Claude Code session that changes this repo, before the
final push:

1. Re-read this file and update anything the session made stale — new
   tables/columns/RPCs (and hosted-vs-repo drift), new services/hooks/routes,
   moved responsibilities, new conventions, new gotchas discovered while
   debugging, retired code paths.
2. Keep `SCHEMA.md` in step with applied migrations and regenerate
   `src/integrations/supabase/types.ts` after any DDL.
3. Do not duplicate `AGENTS.md` rules here; link concepts instead. If a rule
   changed, change it in `AGENTS.md`.
4. If nothing changed structurally, leave the file untouched — no churn.

A future session should be able to read `AGENTS.md` + this file and work
confidently without re-mapping the codebase.
