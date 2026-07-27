repo: sonny303/mintedpanel
branch: main

## Last sync
date: 2026-07-27T04:20:00Z

### Updated in this project
- Audited Payer Detail Overview against `docs/data-model/table-register.md`, `payer-field-usage-audit.md`, and `spike-2026-07-10-findings.md`, then **stripped the page to only fields with a real consumer** (business feedback: the payer catalog depth isn't paying off).
- **Removed:** Network & contracts table, Submission routing table, the whole Activity tab (communication log + catalog change history), `delegation_note`, and `avg_decision_days`.
- Payer Detail tabs are now **Overview · Cases · Templates**.
- Payer Setup readiness table trimmed to `Payer · State(s) · Kind · Template status`; drift banner and drafts strip removed. Handoff written to `design_handoff_payer_setup/`.

### Schema findings behind the strip
- **Only one org-writable field on this page.** The E4.2 governance PR made `payers.resolution_id_label`/`resolution_id_expected` the MINTED-CURATED GLOBAL FALLBACK tier; `org_payer_settings` (grain org × payer, `UNIQUE (org_id, payer_id)`) carries ONLY those two — "the one setting with a confirmed consumer" (the E4.0 approval step via the payerResolutionIdentifier seam: org setting → Minted global fallback → generic). The restored Edit button therefore only truly persists that field unless governance changes.
- **Contracting status is retired as user-facing (E6.0)** — no status-setting UI; execution/effective dates live on the case (`contract_executed_date`/`confirmed_effective_date`, set at Approved). The column stays readable for derived checks until E6.2 re-expresses it.
- **`org_payer_assignments` and `payer_network_targets` have ZERO rows** in the audited env, so a Network & contracts table renders empty in reality.
- **case ↔ contract is an invisible join** — no FK, matched by value (`spike-2026-07-10-findings.md`).
- **Submission routing = `mso_routing_rules`** (grain org × payer × state × specialty; no uniqueness/priority today — spike recommends `UNIQUE(org_id, payer_id, state, specialty)`). Consumed at **case creation** (`cases.ts`) to set `cases.mso_id` and the via-MSO chip — so it can't move into template steps; the template consumes the outcome via the live `mso.portalUrl` token. It is **org config, not a payer catalog fact**.
- `payers.portal_url` is **display-only** — its token is deliberately filtered out of the resolver; operational fills use `portals.form_url` + `portal_field_maps`.
- `merged_into_id` is **dormant**.
- The curated block (`delegation_note`, `avg_decision_days`, `caqh_pull_deadline_days`, `prior_auth_vendor`, `payer_billing_id`…) is **Class 2** — "hold — do not deepen UI until a consumer is committed."

### Case-close research 2026-07-27 (read: CaseStatusDialogs.tsx, payerResolutionIdentifier.ts)
- **Close-as evidence rules (E6.0 F6.0.2/F6.0.4)**: Approved requires effective date + the payer-labeled individual ID (`ready = effectiveDate && individualId`); group/billing ID optional; contract-executed date optional (lives on the case per E6.0). Denied requires a governed reason code, plus one-line context when "Other". Not Pursuing requires a note. Plain forward transitions take an optional note. "Correct status…" may move ANY direction, note required, appends to history.
- **ID label seam**: `resolveIdentifierConfig` = payers.resolution_id_label → generic "Payer-issued ID". **org_payer_settings override tier retired app-side 2026-07-20** (table dormant, no reader) — Payer Detail's "Your organization's settings" group was removed accordingly.
- **Storage**: individual ID → `enrollment_facts.payer_issued_id`; group ID → `payer_network_targets.payer_issued_id` (grain group × payer × state). EnrollmentsPanel already supports set/clear-later ("approval letters often arrive late") — evidence for our "Didn't receive" escape.
- **Two production limitations our ID-expectation columns replace**: the group/billing label is a fixed constant (`GROUP_PROVIDER_ID_LABEL`), and `resolutionIdExpected` has NO consumer — ApprovedDialog renders and requires the individual ID even when expected=false.
- **Approved divergences to flag in build**: our close dialog makes IDs skippable per payer expectations with a "Didn't receive" escape (product owner: required IDs would slow closes); production hard-requires the individual ID. Screen 5 gained Denied and Not Pursuing dialogs and the contract-executed field to match production's evidence rules.

### Case Detail redesign 2026-07-27 (read: cases.$id.tsx, CaseHeader.tsx)
- **Required documents removed entirely (product owner)**: documents are not a product capability — the E4.5 CaseRequiredDocuments surface (verified/missing per kind, audited downloads) is out of the design, not just relocated. If documents become a capability later, the task-scoped placement was the agreed home.
- **Duplicate tracking-ID warning dropped from the mock (product owner)**: every submission creates a new ID per provider, so a collision can only be a data-entry error — production's F4.0.2 sibling check stays as a backend guardrail, but the design shows the clean state.
- **Extension handoff deferred (product owner)**: the Work-in-portal launcher (E4.3 WorkInPortalButton) is removed from the case screen for now — extension work resumes after the payer/case designs are finalized. The seam stays documented here so it returns in one piece.
- Required documents render under the task that needs them (not a standalone card); Touchlog matches production's composer fields (7 touch types, outcome optional, follow-up carry-forward) with working add-touch/add-note.
- Built `6 - Case Detail.dc.html` grounded in the production route's composition: unified status control (E6.0 — single pill + legal-moves menu, close-as entries carry their evidence rules and reuse screen 5's dialogs), inline-editable tracking ID with the F4.0.2 duplicate-sibling warning, Work-in-portal extension handoff (E4.3), provenance line (template + version + run + reapply cycle), required-documents verification with audited downloads (E4.5 D3 interim), single list task view with the TaskDrawer pattern (wizard tab retired 2026-07-20), touches with status-bump-as-evidence (F6.0.3), case facts + key identifiers + unified status timeline.
- Deliberately not carried over: the two retained read-only pre-unification ledgers (legacy status_configs history + payer-pipeline history) — the unified timeline is the one history surface; flag if business still wants the old ledgers visible.

### Corrections applied 2026-07-26 (post-review realignment)
- **"Remove from network" collapsed into Archive.** With the seeded catalog removed, the payer list IS the org's network — dropping an org assignment and archiving produce the same user-visible outcome (leaves the list, reversible, nothing deleted, no new cases). One action ("Archive") on the Manage tab; the header button and the org_payer_assignments unsubscribe framing are retired with the catalog.
- **Payer lifecycle designed**: Archive… and Merge… on Payer Detail (archive blocked while open cases exist; merge moves templates/IDs/cases to a chosen survivor and keeps the old name as an alias — needs backend: archive flag + merge operation). Payer Setup gained a Show-archived toggle with Reactivate.
- **Template versioning lite**: v-chip + History drawer in the Template Editor; publish captures an optional one-line change note; restore copies an old version forward as new. Cases in flight keep their version. Reduces production's versioning ceremony to one optional field.
- **RESOLVED: the default-template card on Payer Setup is the intended place users define/edit it at any point** (product owner). Edit-only is correct; no create path needed.
- **Sequence**: wrap the payer section → case detail is the immediate next stop → then the Minted extension (same product owner).
- **Catalog removed from Payer Setup entirely** — product owner: the seeded catalog "is ruining product trust." Page is now a single view (no tabs); `+ Add payers` → **`+ Set up payer`** (manual payer creation, per journeys A1 — needs the payer-create API-enabler epic; in-app payer creation does not exist today). Deleted the catalog fixture, membership KPIs, alias search, `+N more` state disclosure, and the segmented-control machinery.
- **Devin's PR #235** (`payer-setup-page-build-handoff.md` + `design-reference/payer-setup/`) is being deleted; this project's design reference is canonical again.
- **RESOLVED: templates are scoped payer + group, never org-tier.** The product owner confirmed templates are set up by payer and narrowed by group (the Template Editor's match key); Devin's D2 "org override" framing is retired. `hasTemplate = sopPublished` stands. Also per the product owner: "readiness" was deflated — Payer Setup's composite Ready-for-business KPI became All payers, and Payer Detail's readiness badge became a plain next-step strip.
- **RESOLVED: the default template is editable.** The product owner needs to edit it on the fly and wants no role security at day 0 — `fallback_sop_locked` (Devin's A7) stays out of the design. Scorecard gained its entry point: a View scorecard link on Payer Detail.

### Two independent status machines — do NOT merge them
- **`src/lib/caseStatus.ts`** — the INTERNAL 8-value `case_status` (Not Started, In Progress, Submitted, In Review, Action Required, Approved, Denied, Not Pursuing). Used on `Cases - Improved.dc.html`.
- **`src/lib/payerPipeline.ts`** — the EXTERNAL payer-side 9-state machine (Not Started, Assigned, Drafting, Submitted, In Review, Action Required, Approved, Denied, Out-of-Network), with its own forward-edge map and terminal set (Approved / Denied / OON). Its header comment states it is "wholly independent of the internal status_configs/credentialing_status_id machine (A3 decoupling)", and `PayerPipelineBadge.tsx` keeps it "VISUALLY DISTINCT from the internal credentialing status pill everywhere a case appears — the two are never merged into one label." Tones: not_started gray · assigned/drafting blue · submitted/in_review teal · action_required amber · approved green · denied red · oon neutral. `PIPELINE_STATE_MIRROR` maps `case_status.in_progress ↔ pipeline drafting`.
- Payer Detail's Cases tab shows **Payer pipeline stage** (the external machine); the Cases page shows **Case Status** (the internal one). Two different columns by design.

### Still undesigned
- Template Editor odds and ends: Duplicate ("(copy)"), dirty tracking + `DiscardConfirmDialog`, `blastAck`. (Versioning shipped as versioning-lite; archive shipped on Payer Detail's Manage tab; the scorecard now has its entry point.)
- The Minted extension surfaces — deliberately deferred; all extension copy has been swept out of screens 1–6.

### Known divergences (intentional, user-approved)
- Terminology unified to "Template"; production mixes "SOP" and "Template".
- Payer Setup is a single view (no tabs); production is Catalog / SOPs. The seeded catalog is gone.
- Payer Detail is tabbed (Overview · Enrollments · Cases · Templates · Scorecard · Manage) with an editable Identity card; production `PayerDetailContent` is a flat read-only section list.
- Template Editor: 3 steps, tier derived from the group match key, portal register/capture/map/prove inline on the online-form step.
- "Configure credentialing scope" removed at the user's request.

## Screen map
| Screen (project file) | Built from (repo) |
| --- | --- |
| 1 - Payer Setup.dc.html | `payerReadinessFunnel.ts`, `PayerReadinessFunnel.tsx`, `PayerAdminTabs.tsx`, `TemplatesList.tsx`, `admin.payer-admin.catalog.tsx` |
| 2 - Add or Edit Payer.dc.html | `payers` (E1.6 identity), `org_payer_settings` (E4.2) — **group/provider ID expectations need new columns** |
| 3 - Payer Detail.dc.html | `PayerDetailContent.tsx`, `admin.payer-admin.catalog_.$payerId.tsx`, `pickTemplate.ts`, `table-register.md`, `payer-field-usage-audit.md` — **contacts need a new `payer_contacts` table** |
| 4 - Template Editor.dc.html | `TemplateWizard.tsx`, `executionTypes.ts`, `FormStepPanel.tsx`, `formDrift.ts`, `mockFillProfile.ts`, `testRunResults.ts`, `pickTemplate.ts` |
| 5 - Case Close and IDs.dc.html | `CaseStatusDialogs.tsx`, `payerResolutionIdentifier.ts`, `enrollment_facts.payer_issued_id`, `payer_network_targets.payer_issued_id`, `payerPipeline.ts` — **depends on the ID-expectation columns above** |
| 6 - Case Detail.dc.html | `cases.$id.tsx`, `CaseHeader.tsx`, `CaseStatusControl.tsx`, `CaseTouchesPanel.tsx`, `CaseStatusHistoryPanel.tsx`, `caseStatus.ts` |
| Index - All Screens.dc.html | inventory of all six screens and their states, with the open questions grouped by order of attack |
| Index - Journeys.dc.html | `src/routes/admin.payer-admin.*`, `admin.payers*`, `payer-directory.tsx`, `groups.$groupId.payer-network.tsx` |

*Cases and Provider Detail shipped earlier and are out of scope; their frozen bundle is `design_handoff_cases/`. `design_handoff_payer_setup/` predates this rename and is stale — regenerate before re-sending.*
