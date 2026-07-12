# CLAUDE.md — Minted Panel system map

Orientation for AI coding sessions. The **binding rules** (protected files,
data rules, style rules, anti-patterns) live in `AGENTS.md` — read that first;
this file adds the system map and operational knowledge those rules assume.
`ARCHITECTURE.md` and `SCHEMA.md` are the deeper references for layering and
tables.

## Redesign program (you are on the `redesign` branch)

The product redesign is built epic-by-epic on the long-lived `redesign` branch
and NEVER merges to `main` until the PM promotes a stage. If you are
implementing a redesign epic:

- Epics live at `docs/redesign/EX.X-<slug>.md` (e.g. `E0.0-app-shell.md`).
  Only build from epics whose frontmatter says `reviewed: true`. From R1
  onward the roles are: Devin authors the epic; a **dedicated Claude Code
  review session** independently reviews it per
  `docs/redesign/REVIEW-HANDOFF.md`, populating its
  `## 5. Technical Considerations & Enablers` section; the PM flips
  `reviewed: true`. A **build session** never edits epic files,
  `CLARIFICATIONS_NEEDED.md`, or their frontmatter — only a review session
  operating under REVIEW-HANDOFF.md may edit the one epic file under review.
- Read `docs/redesign/README.md` (workflow + merge gate) and
  `docs/redesign/uiux-component-guide.md` (component selection + build
  requirements) before writing code. AGENTS.md rules still bind; epics with
  shell changes explicitly authorize touching `src/components/layout/*` via
  their section 5.
- One epic per PR, branch off `redesign`, PR targets `redesign`, titled
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
  customer-escalation contact required, sales rep defaults to **Zeb Loewenstine**
  when omitted; both stored as parties with their roles via SECURITY-DEFINER
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
  F0.3.4), `listPartyRoleTypes` (governed list), `createParty`, `assignRole`
  (trigger rejects reserved), `unassignRole`/`removePartyFromOrg` (both block
  removing the org's **only** sales rep, F0.2.2; TD-4: the party RECORD is
  retained — a browser client can't verify "no assignments anywhere" under
  org-scoped RLS, and the FK cascades). Hooks in `useParties.ts`
  (`useOrgParties`/`usePartyRoleTypes`/`useVisibleParties`/`useCreateParty`/
  `useAssignRole`/`useUnassignRole`/`useRemovePartyFromOrg`, shared invalidator).
  **`src/components/org/PartiesManager.tsx`** replaces the E0.2 `OrgContactsSection`
  on `/get-started`: party list with role chips (removable), Add person / Add
  existing (reuse) dialogs, edit dialog (shared `ContactFields`), remove-confirm,
  and a role picker (`party_role_types` — active selectable, reserved
  visible-disabled, F0.3.5). Seed adds TS-10 (Zeb also `owner` on Point Place
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
  "Org space"): Workspace (Home, Cases + open-case count chip from the
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
extension. See the "Server API layer" section below and `docs/phase-0-audit.md`
for the framework/deploy detail.

## Running and verifying

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
  `sort_order`. Returns the case as jsonb.
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

`/api` routes run on the nitro server. **No frontend hook consumes them** — the
browser still talks straight to Supabase for everything. That is deliberate
(locked decisions below): routes get built only when a real consumer pulls
them. The current surface:

- `GET /api/health` (public) · provider CRUD (`GET/POST /api/providers`,
  `GET/PATCH /api/providers/:id`) — Chunk 3.
- `GET /api/me/orgs` — the caller's own memberships, `{ orgId, orgName, role }`
  rows derived from the JWT user id only (`src/services/orgMemberships.ts`).
  Runs on `authenticateUser` (the guard's JWT-only step, no org resolution):
  it is the org-discovery endpoint a multi-org caller needs BEFORE it can send
  `x-org-id`, so the guard's multi-org 400 deliberately doesn't apply. Zero
  memberships = empty list, not an error. Gate assertions 10/10b pin "own
  memberships only".
- `GET /api/providers/:id/profile?state=XX&facilityId=<uuid>` — the fill
  engine's payload: the provider row + every catalog token resolved to a value
  server-side (`src/services/providerProfile.ts`). Deterministic source-row
  picking: `?state` selects the state license; sole policy selects group
  insurance; `payers`/`msos`/`contracts` tokens are case-scoped and always
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
  backing) is appended by the route via `src/server/userTokens.ts`; users set
  their own full_name in Settings → Profile (`ProfilePanel` →
  `src/services/userProfile.ts`, `supabase.auth.updateUser` — separate from
  `profiles.full_name`, which the sidebar/store display reads);
  empty-resolution notes surface in the envelope's `meta.notes`. **The most
  PHI-dense response in the system** (SSN last-4, DOB, home address, unmasked
  by design): `Cache-Control: no-store`, never log the body. Every successful
  profile read writes one `audit_log` row (`action_type 'READ'`, actor,
  provider, route — never the body or token values; a failed audit write
  fails the request) — R2 locked decision 4, 2026-07-05, superseding the
  same-day rely-on-fill_sessions decision (both recorded in
  `docs/minted-panel-release-plan.md`).
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
- `GET /api/cases?providerId=<uuid>` — the popup's case dropdown (R2): the
  provider's OPEN cases, `{ id, payerName, state, status, submittedDate,
payerReferenceId, latestNote, lastSubmittedAt, portalTasks }`. Open =
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
- `POST /api/cases/:id/touches` — the "Mark submitted" business log. R2 core:
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
  so the filler sees the case's reference + latest note/touch without leaving
  the portal tab (P8, Epic 3d). Returns `{ referenceNumbers, latestNote,
latestTouch }` for the ONE org-owned case; a cross-org or nonexistent id → 404
  (case ownership `maybeSingle` miss, mirrors the other case handlers).
  `referenceNumbers` = `credential_cases.payer_reference_id` as a 0/1-element
  array (latest-wins column, not touch history); `latestNote {content,
createdAt, authorName}` = newest touchlog `entry_type='note'` (author-resolved
  via `profiles`); `latestTouch {touchDate, touchType, outcome, note}` = newest
  `entry_type='touchpoint'`. Note + touch come from ONE org-scoped touchlog read
  — it reads the touchlog spine, NOT the dormant `notes` table (case notes moved
  there in Story 1). PHI-minimal, read-only (billing may read), no audit. No
  migration. Gate assertion 14/14b (Kansas reads own context; cross-org South
  Park case context → 404) + a `casecontext` leak mode. (`src/services/caseContext.ts`)

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

## Domain model in one breath

`organizations` ← `memberships` (user+role) · `provider_groups` ·
`facilities` (a.k.a. **locations**; launches live here — see below) ·
`providers` (PHI-minimized: `ssn_last4` only) · `provider_facility_assignments`
(provider↔location, unique `(provider_id, facility_id)`) · `state_licenses` ·
`payers` (+ sentinel payer **"Pre-Credentialing Setup"**, matched by name) ·
`msos` + `mso_routing_rules` (payer+state+specialty → direct/mso; `'All'`
wildcards; scored client-side in `getMsoRoutingRule`) · `credential_cases`
(**unique `(provider_id, payer_id, state)`** — widens to include `group_id`
with the E2.x case-generation build, see AGENTS.md; credentialing status only;
`facility_id` links a case to its location) · `contracts` (group+payer+state,
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
Payers renders a "Starter" toggle only for assigned global payers. On provider
create, `src/routes/providers.new.tsx` auto-attaches cases for the org's
assigned+starter payers via the pure `src/lib/starterCases.ts` derivation →
`createCase`/`create_case_with_tasks` (opens at the provider's `home_state`,
skips payers with no home-state license, skips existing combos; `facility: null`
so `{{facility.*}}` resolve empty — the launch `CreateCasesDialog` stays the
facility-linked path). **Inert until a global payer is assigned+flagged starter**
(zero assignments today). The formerly-duplicated `pickTemplate` is now centralized
in `src/lib/pickTemplate.ts` (both `NewCaseModal` and `CreateCasesDialog` import
it; a null-group template counts as an "exact" match, so array order decides among
exact candidates).

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

### CSV onboarding packages (Epic 2c, P6 PR3, 2026-07-07)

Admin-only wizard at **`/admin/import`** (Admin nav → "Import") that onboards a
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
- **Commit `src/services/importCommit.ts`** `commitImport(parsed, {
referenceOnly, groups })` writes through the EXISTING services only —
  `createFacility` (orgSettings), `createProviderWithDetails`,
  `assignProviderToFacility` (launches) — so org_id/audit/RLS are inherited, no
  hand-rolled inserts. Best-effort per row with a `CommitSummary`
  (created/failed counts + failure list). `ProviderInput` and `FacilityInput`
  gained an optional `referenceOnly?: boolean` (rides `snakeizeRow →
reference_only`; omitted → DB default false, so browser callers are
  unchanged); the import passes the wizard toggle (**default on**).
- **Route `src/routes/admin.import.tsx`:** three file inputs → Parse (preview
  tables + distinct line-numbered errors list) → reference_only toggle → Commit
  (created/failed summary). Admin-gated by a render-time `useIsAdmin()`
  backstop. Invalidates providers/facilities/facility-assignments caches on
  success. Ships the feature only — **does not import demo data**, so the gate
  expected-counts are unchanged.

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

`NewCaseModal` (provider detail) and `CreateCasesDialog` (launch) both:
resolve the MSO routing rule per payer/state/specialty, pick a SOP template
(`pickTemplate`: exact payer+state+group, then payer+state — duplicated
module-locally in both, keep in sync), resolve tokens via
`resolveTemplate(template, provider, group, facility, {mso}, licenseNumber)`,
then `createCase(input, tasks)`. Duplicate `(provider, payer, state)` combos
are pre-filtered client-side; the DB unique constraint is the backstop.

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
hooks (`useAdmin.ts`).

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
  as props.
- **Generated task views:** `src/components/portals/PortalStepLink.tsx` resolves a
  step's `portalKey` against `usePortals()` and shows portal name + "Open portal"
  (`formUrl`, `target=_blank`) + verification pill; unresolved key → neutral
  "not set up in this org" note. Rendered in `TaskDrawer`, `CaseWizard`
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

## Owner-facing view (one, consolidated Jul 2026)

- `/client-progress` (Client Progress v1) is **the** owner view: nav entry
  "Client Progress", page + entry gated to **admin and billing** roles. One card per
  non-terminated provider; x-of-y in-network `ProgressBar` whose denominator
  is the org's active payer set (pre-cred sentinel excluded; a payer whose
  only case for the provider is "Not Required"/"OON" drops out); one line per
  payer-with-case showing a locked owner wording (In progress / Submitted /
  With payer / Approved / Active — mapped by label, unknown labels fall back
  to `action_bucket`) via `src/lib/clientProgress.ts` (tested). Multi-state
  payers are represented by their most advanced case. Read-only. Pieces:
  `src/routes/client-progress.tsx`, `src/components/client-progress/`,
  `src/hooks/useClientProgress.ts`, `src/services/clientProgress.ts` (own
  narrow projection because `PROVIDER_LIST_COLUMNS` lacks `start_date`).
- The older M5.5 owner view at `/progress` was folded into it: the route file
  remains only as a redirect to `/client-progress` (the URL had been shared
  with owners out-of-band), and `src/lib/ownerWording.ts` + its test were
  deleted with the page they served.

## Cleanup surfaces (Fix-it queue / Mapping review / Portals admin, built 2026-07-06)

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
  sidebar entry with live count): impact-ordered deck of three card types
  (provider data gap / dictionary confirm / train-this-form). Pure derivation in
  `src/lib/fixitQueue.ts` (+tests) from existing caches; editable-gap fields
  whitelisted in `src/lib/fixitFields.ts` (scoped to `PROVIDER_LIST_COLUMNS` so
  the list projection never reads `undefined` and false-flags a gap). Weekly
  "good catch" counter in `src/lib/goodCatches.ts` (client-local, `typeof
window` guarded). Hook `src/hooks/useFixit.ts` (`useFixitQueue` derives the
  queue; save/skip/dictionary mutations). Skip → `createFollowUpTask`
  (`services/tasks.ts`).
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
  stamps `url_changed_at` → "Needs re-verify" pill), mapped/proposed counts
  (from `portal_field_maps`), verification status, last fill result (latest
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
