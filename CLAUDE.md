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
  on hosted with slugs**; live TS-37 re-plan = 0 inserts / 0 diffs. Runbook
  in the script header; quarterly manual refresh per the dataset README.
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

`NewCaseModal` (provider detail) and `CreateCasesDialog` (launch) both:
resolve the MSO routing rule per payer/state/specialty, pick a SOP template
(the shared `src/lib/pickTemplate.ts`: exact payer+state+group, then
payer+state, then the E1.7b global fallback), resolve tokens via
`resolveTemplate(template, provider, group, facility, {mso}, licenseNumber)`,
stamp the resolved tasks with the template's `(id, currentVersion)` via
`stampTasks` (E2.2), then `createCase(input, tasks)`. Duplicate combos are
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
  tie-break; a new optional `rankingConfig` (E4.2 F4.2.5) input +
  `resolveQueueRankingConfig` (validated, atomic default fallback) rank overdue
  follow-ups first by default / by enabled-group order when configured; overdue
  gets a "Follow-up overdue" reason. Config read seam
  `src/services/queueRankingConfig.ts` + `src/hooks/useQueueRankingConfig.ts`
  (returns the shipped default until E4.2 F4.2.5 persists a row), wired through
  `useNextBestActions`.
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
