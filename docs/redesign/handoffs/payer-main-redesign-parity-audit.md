# Audit: Payer Workflow Parity — `main` vs `redesign`

> **Documentation-only audit. This PR changes no application code, migration, generated
> type, or schema.** It records findings for PM / business review. No behavior is
> implemented and no field is removed here. Nothing below is a decision — every
> "recommended action" is a proposal awaiting sign-off.
>
> **Governance posture:** this is the PM-approved audit gate in the payer/SOP
> hardening plan, not an epic implementation PR. It intentionally spans several
> reviewed epics to compare workflows and assign future ownership; no numbered
> feature is implemented, so the single-epic build traceability gate does not
> apply. Each future implementation remains a separate, single-owner PR.

## Provenance (fetched SHAs)

| Ref               | SHA                                        | Date       | Note                                                                                |
| ----------------- | ------------------------------------------ | ---------- | ----------------------------------------------------------------------------------- |
| `origin/main`     | `a1bf4bf7efcd3ca634e6b2732f96472f604f9e4d` | 2026-07-08 | last commit is an epic-file rename; feature work froze at the merge base +4 commits |
| `origin/redesign` | `371d2616d72ada391355e44101c49699de458709` | 2026-07-16 | active line, 296 commits ahead of the merge base (R0–R6-partial epic program)       |
| merge-base        | `6419816f75f7632d8edff378454408b1b237bfcb` | 2026-07-08 | `git merge-base origin/main origin/redesign`                                        |

`git log origin/redesign..origin/main` = **12 commits** (4 feature commits + merges + epic
renames). `git log origin/main..origin/redesign` = **296 commits**. Repo confirmed
non-shallow (`git rev-parse --is-shallow-repository` → `false`) before history use.

## What "parity" means here

`main` and `redesign` **diverged on 2026-07-08**. After that date `main` received only four
feature commits (all extension/API work, all 2026-07-08) and then froze; `redesign` ran the
entire epic program (Stages 0–4-partial). `redesign` is therefore not a fork that drifted —
it is a near-total **reimplementation** of the product, and `main` is the pre-redesign
product plus four un-ported extension patches.

**Route-inventory fact (`ls src/routes` diff):** every route file present in `main` is also
present in `redesign`; `redesign` adds 17 new route files. There are **zero main-only
routes.** The legacy flat surfaces (`home`, `providers.*`, `cases.*`, `admin.*`) still exist
in `redesign` (URL-reachable, dropped from nav per E0.0/E0.6/E0.9). So the parity risk is
**not** "a screen main had is gone" — it is:

1. **Un-ported main-only behavior** — the four post-divergence extension commits, none of
   which reached `redesign` (Part A §1).
2. **Grain / model shifts** where a redesign reimplementation changed how a workflow's data
   is keyed or owned (e.g. M:N group assignment, 4-part case key, payer catalog).

A workflow counts as **covered** only when a user can reach it, complete it, and the expected
downstream consumer receives the data — not when a route or file merely exists. Coverage is
asserted from concrete `route → hook → service → table → consumer` chains, never from route
existence or line counts.

## Method & evidence base

- Two working trees inspected side by side: `redesign` (`/home/user/mintedpanel`) and `main`
  (a `git worktree` at `origin/main`).
- Live schema + production-shaped data inventoried via the Supabase MCP against the hosted
  project `fkvuhfsqcmujywzgczmc` (the shared demo/dev DB — see the caveat in the field-usage
  audit; it carries **both** the legacy demo orgs _and_ the redesign 11-org seed universe, so
  it is not a real customer production database).
- The four candidate commits were read with `git show` and each behavior was checked for a
  redesign equivalent by grepping both trees.
- Epic intent (for classifying deferred vs regressed vs superseded) read from
  `docs/redesign/ROADMAP-STATUS.md`, `E1.5`, `E1.6`, `E1.8`, `E4.0`, `E4.2`, `E4.3`, and
  `docs/minted-panel-extension-build-spec-v1.1.md`.

Severity: **P0** = data loss / silent wrong data / isolation break; **P1** = a real
capability main shipped that redesign users cannot reach and the roadmap does not clearly own;
**P2** = polish, telemetry, or convenience gap with a defined roadmap home.

---

# Part A.1 — The four main-only commits (required candidates)

All four landed on `main` on 2026-07-08, after the divergence. Each was read in full and its
redesign equivalent grep-checked in both trees. **Cherry-picking is explicitly not
recommended** (the extension/API layer was reworked by the epic program); each row states
whether the behavior is still valid and how it should be reimplemented against current
redesign architecture.

### C1 — `862eb35` "Enforce one portal per task and normalize portal_key at create"

- **What it did (main):** added `portalKeyConflicts` to `editableTemplate.ts`, a per-task
  amber warning + save block in `TemplateWizard`/`TemplateTaskRow`, and folded `portal_key`
  through `normalizePortalKey` in `portals.ts` `createPortal`.
- **Redesign status: PRESENT — reimplemented, more complete.**
  `src/components/templates/editableTemplate.ts` carries `taskPortalKeys` (L104) **and**
  `portalKeyConflicts` (L126) — plus the save-block path (`portalConflictBlocked`,
  `handleSaveClick`/`handleDuplicate`) documented in CLAUDE.md's "One portal per task"
  section. `main`'s `editableTemplate.ts` has only `portalKeyConflicts` (L90).
  `createPortal` still normalizes `portal_key` in `src/services/portals.ts`.
- **Classification:** intentional replacement / already covered. **No action.**

### C2 — `e068f1a` "Fix-it loop: broken-mapping cards from fill telemetry + unlinked-mapping flags"

- **What it did (main):** extended `src/lib/fixitQueue.ts` to emit **broken-mapping cards
  derived from `fill_sessions` telemetry** (skipped/failed fields) plus **unlinked-mapping
  flags**, surfaced in `fix-it.tsx` and `admin.portals.tsx`.
- **Redesign status: ABSENT.** `src/lib/fixitQueue.ts` `FixitCardKind` union is only
  `"provider_gap" | "dictionary_confirm" | "train_form"` (L8) — there is **no** broken-mapping
  card and no `fill_sessions`-telemetry read in the fix-it derivation (grep of
  `telemetry|broken|unlinked|fill_session` in `fixitQueue.ts` → no hits).
- **Still valid? Partially superseded, partially a gap.** The redesign added an adjacent but
  different capability: E4.2 dry-run / `is_test` fill telemetry and the payer scorecard
  `firstPassRate` (`src/lib/payerScorecard.ts:112`) read `fill_sessions`; and E4.3 F4.3.3 /
  TE-4 (reviewed, **not yet built**) specs an **inline extension** "missing-mapping fix-it"
  action. **But** the specific _browser-side_ behavior of e068f1a — proactively surfacing
  _already-broken_ mappings in the Fix-it queue from historical fill telemetry, without the
  user re-encountering the field in the extension — has **no redesign home**. E4.3 F4.3.3 is
  reactive (fix at point-of-fill), not a telemetry-driven backlog.
- **Recommended action (proposal):** Decide whether telemetry-driven broken-mapping backlog
  cards belong in the redesign Fix-it queue or are intentionally replaced by the E4.3 inline
  flow + scorecard `firstPassRate`. If retained, reimplement as a **fourth `FixitCardKind`**
  derived from `fill_sessions.fields_skipped` (already a structured
  `{selector,label,reason}[]` per E4.2) — not a cherry-pick of the pre-E2.x `fixitQueue.ts`.
  **Owning epic:** E4.2 (Forms & portals) or E4.3 (extension). **Severity P2** (a data-quality
  convenience; the scorecard already surfaces fill health at the payer grain).

### C3 — `e661f70` "Carry facility address fields on the profile facilities list"

- **What it did (main):** widened the extension profile endpoint's `facilities[]` from
  `{id, name}` to `{id, name, street, suite, city, state, zip}` so the extension can render
  the selected location's practice address under its Location picker.
- **Redesign status: ABSENT.** `src/services/providerProfile.ts` `ProviderProfileFacility`
  is `{ id: string; name: string }` (L60-63) and the mapping emits only
  `id`/`name` (L323-324). Notably the profile SELECT **already fetches** the facility address
  columns (`street, city, state, zip, suite, county, …`, L123) — they are simply dropped from
  the payload projection. `main`'s `ProviderProfileFacility` carries the five address fields
  (L65-69).
- **Still valid? Yes, but re-scope to E4.3.** E4.3 (reviewed, not built) TE-2 re-homes
  facility awareness onto an **expanded `GET /api/cases/:id/context`** projection ("explicit
  columns for the selected case's … facility …") rather than the profile endpoint. So the
  _capability_ (extension shows the practice address) is on the roadmap, but the _mechanism_
  (address fields on `profile.facilities`) conflicts with the E4.3 direction.
- **Recommended action (proposal):** Do **not** re-add address fields to the profile
  `facilities[]`. Fold the requirement into **E4.3 TE-2** — surface the selected facility's
  address through the hardened case-context projection. **Owning epic:** E4.3.
  **Severity P2** (extension convenience; the never-guess facility-selection contract is
  intact in both trees).

### C4 — `4b71fc7` "Add user-scoped GET/PUT /api/me/view-prefs for extension detail-view field prefs"

- **What it did (main):** added `src/services/extensionViewPrefs.ts` and
  `GET/PUT /api/me/view-prefs` (user-scoped, backed by `user_table_prefs` under
  `page_key 'extension.providerDetails'`) so the extension remembers which provider fields to
  show in its detail view.
- **Redesign status: ABSENT.** `src/services/extensionViewPrefs.ts` does not exist; the
  redesign `src/server/extensionRoutes.ts` exposes `/me/orgs`, `/providers/:id/profile`,
  `/portal-field-maps`, `/cases`, `/cases/:id/context`, `/cases/:id/touches`, `/fill-events`
  — but **no `/me/view-prefs`** (grep → no hits). The backing `user_table_prefs` table exists
  and is used by the in-app pipeline Tracking-ID column toggle (E4.0), not by the extension.
- **Still valid? Unclear — no roadmap home.** Neither E4.3 nor
  `docs/minted-panel-extension-build-spec-v1.1.md` mentions saved detail-view field prefs
  (grep of both → no hits). The E4.3 read-only fill loop resolves tokens per fill step, not a
  user-curated field list.
- **Recommended action (proposal):** Treat as a **business decision required** — confirm with
  the PM whether the extension still needs a user-scoped detail-view field preference. If yes,
  reimplement on the current guard as a `authenticateUser`-scoped route (the `/me/orgs`
  precedent) reusing `user_table_prefs`; if no, it is dead legacy behavior that correctly did
  not survive the redesign. **Owning epic:** E4.3 (or explicitly dropped). **Severity P2.**

**Candidate summary:** C1 already covered; C2/C3/C4 are un-ported main-only behavior — none is
a P0/P1 data or isolation risk, all three are extension-layer conveniences whose roadmap home
is E4.2/E4.3 (reviewed, partially unbuilt). The clean read is that the redesign's extension
layer is **deliberately mid-migration** (E4.3 unbuilt), and these three patches are work to
fold into E4.3/E4.2, not regressions to hotfix.

---

# Part A.2 — The 17 business workflows

Legend for **Classification**: **IMP** redesign improvement / broader coverage · **REG** missing
redesign regression · **REP** intentional replacement / supersession · **DEF** deferred roadmap
work · **DEAD** dead legacy behavior · **BIZ** business decision required. Every row is asserted
from a `route → hook → service → table → consumer` chain (paths below), never route existence.

Structural baseline: `main` diverged 2026-07-08 and is a much thinner tree. Redesign-only
service files include `payerCatalog`, `payerNetworkTargets`, `generation*`, `caseGeneration*`,
`reporting`, `reports`, `enrollmentReadiness`, `inboundLeads`, `captureLinks`, `parties`,
`nextBestActions`, `denialReasonCodes`, `queueRankingConfig`, `sopTemplateDrafts`. Main-only
service files: `extensionViewPrefs.ts`, `importCommit.ts` (the latter deleted by E3.0 in
redesign). Redesign has 39 workflow e2e specs; main has 5 generic specs.

### WF1 — Public prospect/contact intake · role: anonymous

- **Entry/discoverability:** public `/contact` (chromeless). **Main path:** absent (no route, service, or `submit_inbound_lead` — grep negative). **Redesign path:** `routes/contact.tsx` → `services/inboundLeads.ts submitInboundLead` (L21) → `submit_inbound_lead` RPC (anon, honeypot). **Data source/write:** `inbound_leads` (RPC insert). **Downstream:** operator triage (WF2). **Loading/empty/error:** `role="alert"` submit error (L198), success confirmation state. **Authz/RLS:** anon; isolation in RPC body + rate limiter. **Tests:** `e2e/contact-inbound.spec.ts`, `abuse-probe.spec.ts`. **Classification: IMP** (net-new capability). **Severity —** (no regression).

### WF2 — Inbound lead triage + prospect-org conversion · role: authenticated operator

- **Entry:** `InboundLeadsPanel` on `/get-started` (renders only when leads await). **Main:** absent. **Redesign:** `useConvertInboundLead` → `services/inboundLeads.ts convertInboundLead` (L48) calls `create_organization` (3-arg) then flips `inbound_leads.status='converted'`. **Downstream:** new prospect org in switcher/Portfolio (memberships refetch). **Empty:** panel hidden when zero leads. **Authz:** authenticated cross-org shared queue (no `requireActiveOrg`); Stage-0 RLS. **Tests:** `contact-inbound.spec.ts`. **Classification: IMP.**

### WF3 — First-org & additional-org creation · role: any authenticated

- **Entry:** `/onboarding` (standalone), `NoOrgScreen`, `CreateOrganizationModal`, settings `CreateOrgPanel`. **Main path:** `NoOrgScreen`+`CreateOrganizationModal`; `createOrganization(name)` → **1-arg** `create_organization` (name only). **Redesign path:** `useOrgCreateForm` → `services/organizations.ts createOrganization` → **5-arg** `create_organization` (name + owner + customer-escalation contact + sales rep as parties). **Data/write:** `organizations` + `parties` + `party_role_assignments` + membership + `status_configs` seed (RPC). **Downstream:** lands on `/get-started`. **Authz:** SECURITY DEFINER bootstrap, any authenticated. **Tests:** `onboarding-shell/-wizard/-regression`, `org-contacts`, `parties-regression`. **Classification: IMP** (broader capture; legacy 1-arg overload retained). **Severity —.**

### WF4 — Initial landing & guided setup · role: authenticated

- **Main path:** `index.tsx`/`login.tsx` hard-redirect to `/portfolio`; **no wizard, no resolver**. **Redesign path:** `lib/landing.ts resolveLanding` + `useLandingRedirect` (→ `/get-started` first-run or `/reporting/portfolio`); guided `/onboarding/wizard` (`lib/onboardingProgress.ts`, `NextActionCard` single resume CTA). **Data source:** `listPortfolioOrgs` (+created_at), wizard reads existing org caches. **Loading/empty/error:** per-section `isLoading/isError/refetch`; failed reads never count as "not started". **Tests:** `landing-resolver`, `onboarding-wizard`; `landing.test.ts`, `onboardingProgress.test.ts`. **Classification: IMP.**

### WF5 — Facility setup · role: admin (wizard)

- **Main path:** `settings/FacilitiesPanel.tsx` + launches surface → `orgSettings.createFacility` → `facilities`. **Redesign path:** wizard `FacilitySection`/`FacilityForm`/`HoursEditor` + `lib/facilityHours.ts` + `lib/facilityContact.ts`; same `createFacility` service. **Downstream:** assignments, payer expansion, readiness. **Empty:** zero-group orgs pointed back to Provider Group. **Authz:** wizard admin-gated; RLS on `facilities`. **Tests:** `facilities-wizard.spec.ts`; `facilityHours/Contact.test.ts`. **Classification: REP** (richer wizard replaces settings panel; legacy panel retained). **Severity —.**

### WF6 — Provider-group setup · role: admin

- **Main path:** `settings/GroupsPanel.tsx` → `orgSettings.createProviderGroup` → `provider_groups`. **Redesign path:** wizard `ProviderGroupSection`/`ProviderGroupForm` + `lib/providerGroup.ts` (TIN/NPI validation, block-shaped mapping); same service; legacy `GroupsPanel` retained (known debt). **Downstream:** gates facilities/roster/payer-network; M:N assignments. **Tests:** `provider-group.spec.ts`; `providerGroup.test.ts`. **Classification: REP.**

### WF7 — Provider roster & current group assignment · role: admin

- **Main path:** single-group — `providers.group_id` (`providers.ts` projection/filter; `providers.$id.edit.tsx` passes `facilityIds:[]`). **Redesign path:** **M:N** `provider_group_assignments` (migration `20260712120000`) + `lib/groupAssignments.ts` (`planAssignmentSync`, one-primary invariant); `createProviderWithDetails`/`updateProviderWithLicenses` thread assignments; `providers.group_id` frozen mirror. **Downstream:** starter cases (`providers.new.tsx` → `deriveStarterCases`), readiness/generation. **Authz:** `useCanWrite`; RLS on join. **Tests:** `provider-roster.spec.ts`; `groupAssignments/assignmentScope.test.ts`. **Classification: REP** (grain change single-group → M:N). **Severity P2** — a redesign reader that still trusts `providers.group_id` as truth would be wrong; the register already marks it a frozen mirror (no action beyond vigilance).

### WF8 — Canonical payer discovery & org selection · role: admin (self-service), member (browse)

- **Main path:** **none** — only org-local `admin.payers.tsx` CRUD on `payers`; no global catalog. **Redesign path:** `/payer-directory` + `payer-admin/PayerDirectory` → `services/payerCatalog.ts` `listGlobalPayers` (`list_global_payers` RPC) + `orgPayerAssignments` add/reactivate/archive (`archive_org_payer_assignment` RPC); pure `lib/payerDirectory.ts`, `payerCatalogActions.ts`. **Data/write:** `payers` (global `org_id NULL`), `payer_catalog_changes`, `org_payer_assignments` (`status`). **Downstream:** feeds `AttachPayerDialog` (WF9), readiness, generation, starter cases. **Loading/empty/error:** `payer-directory.tsx:339` isError + Retry (L345). **Authz:** admin writes; SECURITY DEFINER catalog read. **Tests:** `payer-directory`, `payer-catalog-selection`; `payerDirectory/payerCatalogActions/payerCatalogSync.test.ts`. **Classification: IMP** (net-new catalog model). **Severity —.**

### WF9 — Payer scope / network targets · role: admin

- **Main path:** **wholly absent** — `payer_network_targets` grep across `main/src` → zero. **Redesign path:** wizard `PayerNetworkSection` + `AttachPayerDialog` + `lib/payerExpansion.ts` (`expandTargets`/`planAttachmentSave`) → `services/payerNetworkTargets.ts` on `payer_network_targets` (group×payer×state, archive = status flip). **Downstream:** **E2.x generation candidacy + E1.8 readiness both gate `status='active'`** (`generationPreview.ts:200`, `enrollmentReadiness.ts:359`). **Authz:** admin; RLS WITH CHECK requires group∈org + an `org_payer_assignments` row. **Tests:** `payer-network.spec.ts`; `payerExpansion.test.ts`. **Classification: IMP.**

### WF10 — Payer facts & org-specific config · role: admin

- **Both trees:** `admin.payers.tsx` authors/dispays the curated block (`avg_decision_days`, `caqh_pull_deadline_days`, `provider_type_path`, `prior_auth_vendor`, `payer_billing_id`, `portal_url`, provisional/retro ×4) via `payers.ts createPayer/updatePayer`. **Redesign-only:** `resolution_id_label`/`resolution_id_expected` (authored `PayerResolutionIdDialog.tsx:35`, consumed by the pipeline approval dialog `PipelineDialogs.tsx:92`) + the whole payer-admin module + `/payer-directory` display. **Downstream:** only `avg_decision_days` feeds a report (`SummaryTab.tsx:132`); the rest are display-only (see field-usage audit §1). **Classification: IMP** (redesign adds the resolution-ID config + directory display). See field-usage audit for the class-2 curated block.

### WF11 — SOP/template authoring, versioning, matching, readiness · role: admin

- **Main path:** `/admin/templates` wizard, but **flat 2-tier order-dependent `pickTemplate`** (`lib/pickTemplate.ts:19/24`, "order is load-bearing"); **no versioning** (`sop_template_versions`/`publish_sop_template_version`/`sopStamp`/`sopMatchKey` grep → zero). **Redesign path:** same wizard + **6-tier order-independent `pickTemplate`** (`candidateRank`), Model-A versioning (`publishTemplate`, `SopVersionConflictError`), `sopStamp`, `sopMatchKey`, `sopPublishLint`, draft autosave (`sopTemplateDrafts`). **Downstream:** `sopResolver` (unchanged), generation stamping, provenance, generic-SOP chip. **Tests:** `sop-versioning`, `sop-stamping`, `template-portal-integrity`; `sopStamp/sopMatchKey/pickTemplate.test.ts`. **Classification: IMP** (deterministic matching + versioning). **Severity —.**

### WF12 — Draft-email execution · role: specialist

- **Main path:** `SOPEmailTemplate {subject, body}` → `CaseWizard.tsx` →
  `lib/gmailCompose.ts planGmailHandoff`; no authored recipient source and no
  Gmail To/CC handoff. **Redesign path:** PR #166 implements reviewed E1.7b
  F1.7b.5 — authored `SOPEmailRecipient` values are literal addresses or the
  closed `provider.email` token; publish lint requires To; the resolver
  preserves source and represents an empty token as `address: null`;
  `CaseWizard` displays To/CC and passes resolved addresses to the human-reviewed
  Gmail compose link. BCC, auto-send, and extension email execution remain out
  of scope. **Tests:** `sop-email-recipients.spec.ts`; recipient cases in
  `sopResolver`, `sopPublishLint`, `editableTemplate`, and `gmailCompose` unit
  suites. **Classification: IMP** (redesign broader coverage). **Severity —.**

### WF13 — Portal registry, mapping, training, drift repair, dry run · role: specialist/admin

- **Registry/training — both trees:** `/admin/portals`, `services/portals.ts`, `portalFieldMaps.ts`, `/portals/$portalKey/train`, `lib/mappingConfidence.ts`. **Drift repair (broken-mapping from fill telemetry) — MAIN ONLY:** main `lib/fixitQueue.ts` `FixitCardKind` adds `"broken_mapping"` (L8) derived from `lastFills` `FIELD_NOT_FOUND_REASON` (L288–338), rendered in `fix-it.tsx`; **redesign has only 3 card kinds, no telemetry read** (this is candidate C2). **Dry run — REDESIGN ONLY:** `lib/testRunResults.ts`, `testProvider.ts`, `FormOnboardingPanel.tsx`, `admin.payer-admin.forms.$payerId.tsx`, `fill_sessions.is_test` (E4.2 F4.2.7) — absent in main. **Classification: mixed** — dry-run = **IMP**; broken-mapping drift repair = **REG** (C2, P2, owning epic E4.2/E4.3). **Severity P2.**

### WF14 — Manual case creation · role: admin/specialist (writer)

- **Main path:** `NewCaseModal` (provider detail) only; client-side duplicate pre-filter (`NewCaseModal.tsx:168`); **3-part case key**, no `dbErrors.ts`. **Redesign path:** `NewCaseModal` + **`ManualCaseModal` on `/cases`** (writer-gated), **4-part key** with `lib/dbErrors.ts` mapping both the new `..._provider_group_payer_state_key` and legacy 3-part constraint; `ReapplyCaseAction`. Both use `create_case_with_tasks`. **Downstream:** tasks, provenance, queue. **Authz:** `useCanWrite`/`useIsAdmin`. **Tests:** `case-creation.spec.ts`. **Classification: IMP/REP** (grain: 3-part → 4-part key). **Severity —.**

### WF15 — Generation preview, confirmation, provenance, run history · role: admin/writer

- **Main path:** **wholly absent** (`case_generation_runs`, `case_generation_run_rows`, `generation*` routes, `CaseProvenancePanel` grep → zero). **Redesign path:** `/generation` (`GenerationPreviewContent`, `useGenerationPreview` → `services/generationPreview.ts`), confirm (`generationConfirm.ts` inserts run then cases via RPC, audited), `/generation/runs[/$runId]`, `CaseProvenancePanel`/`CaseSopProvenance`. **Data/write:** `case_generation_runs` + `case_generation_run_rows` (immutable ledger). **Loading/empty/error:** `preview.isError` (L134); admin/writer gates. **Tests:** `generation-preview`, `generation-traceability`, `next-best-action-queue`; `generationPreview/Confirm/Runs/Gating.test.ts`. **Classification: IMP.** (Field-usage audit flags `release_scope` + run-row `sop_*` columns as write-only.)

### WF16 — Generated task execution + Gmail/extension handoff · role: specialist

- **Shared /api routes (both):** `/me/orgs`, `/providers/:id/profile`, `/portal-field-maps`, `/cases`, `/cases/:id/context`, `/cases/:id/touches`, `/fill-events`; `PortalStepLink`, `portalTasks`. **MAIN AHEAD (two items):** (a) `/api/me/view-prefs` + `services/extensionViewPrefs.ts` (candidate **C4**) — absent in redesign; (b) `ProviderProfileFacility` carries address fields `street/suite/city/state/zip` in main (`providerProfile.ts:60-70`) vs `{id,name}` in redesign (candidate **C3**). **Roadmap:** E4.3 (reviewed, **unbuilt**) re-homes facility awareness onto an expanded `GET /api/cases/:id/context` (TE-2) and hardens read-only fill; view-prefs has no roadmap mention. **Classification: REG/DEF** — C3 fold into E4.3 TE-2; C4 = **BIZ** (confirm need). **Severity P2.** ⚠ Note: the checked-in `CLAUDE.md` still describes main's facility-address + view-prefs behavior — the doc is ahead of the redesign tree here.

### WF17 — Reporting/readiness & payer scorecard · role: admin/billing

- **Payer scorecard — both trees:** `lib/payerScorecard.ts` (`mappingCoverage`, `firstPassRate`) → `admin.payers_.$id.scorecard.tsx`. **Redesign-only:** `/reporting` + `PortfolioReport` + `services/reporting.ts`/`reports.ts`; `enrollmentReadiness` (service+lib+hook, consumed by generation/onboarding/`profileGating`); `usePayerReadiness`. `avg_decision_days` variance report (`SummaryTab.tsx:132`) in both. `/client-progress` in both (admin/billing gate). **Tests:** `reporting-center`, `report-share`, `scope-review`; `enrollmentReadiness/payerReadiness/payerScorecard.test.ts`. **Classification: IMP.**

## Part A.3 — Severity roll-up & recommended actions

| #                 | Workflow                           | Classification | Severity | Recommended action (proposal)                                                                                                                  | Owning epic  |
| ----------------- | ---------------------------------- | -------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| C1                | one-portal-per-task                | REP (covered)  | —        | none                                                                                                                                           | E1.7b (done) |
| C2                | broken-mapping drift cards (WF13)  | REG (partial)  | P2       | reimplement as a 4th `FixitCardKind` from `fill_sessions.fields_skipped`, or confirm superseded by E4.3 inline fix-it + scorecard              | E4.2 / E4.3  |
| C3                | facility address on profile (WF16) | REG→DEF        | P2       | do NOT re-add to `profile.facilities`; fold into E4.3 TE-2 case-context projection                                                             | E4.3         |
| C4                | `/api/me/view-prefs` (WF16)        | BIZ            | P2       | PM confirm whether the extension still needs saved detail-view field prefs; if yes, `authenticateUser`-scoped route reusing `user_table_prefs` | E4.3 or drop |
| WF7               | single-group → M:N assignment      | REP            | P2       | ensure no redesign reader treats `providers.group_id` as truth (register: frozen mirror)                                                       | E1.3 (done)  |
| WF1,2,4,8,9,12,15 | net-new/broader capabilities       | IMP            | —        | none — redesign broadens coverage                                                                                                              | —            |

**No P0 and no P1 findings.** All parity gaps are P2 extension/convenience items whose roadmap
home is E4.2/E4.3 (reviewed; E4.3 unbuilt). The dominant finding is that redesign is a strict
superset of main's surface, with multiple net-new and richer workflows; structured draft-email
recipients are now one of those redesign-only improvements. The sole regressions are three
un-ported 2026-07-08 extension patches, none of which is a data-integrity or isolation risk.
**Stop here for PM / business review** before any reimplementation.
