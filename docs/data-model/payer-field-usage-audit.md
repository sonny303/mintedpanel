# Payer Field-Usage Audit (schema, no schema change)

> **Documentation-only. This PR changes no schema, migration, generated type, or
> `docs/data-model/table-register.md`.** It classifies existing columns by how they are
> actually used, distinguishing **editable/displayed** from **consumed by a downstream
> workflow**. A field is not business-critical merely because it appears in a form. Nothing
> here is a retirement approval — every deprecation candidate is gated (see the Retirement
> Gate). Where evidence is thin the field is classified **unused/unverified**, not "unused."

Companion to `docs/redesign/handoffs/payer-main-redesign-parity-audit.md` (workflow parity).
Traced against `origin/redesign` @ `371d261`. Live schema + data inventoried via Supabase MCP
against hosted project `fkvuhfsqcmujywzgczmc`.

## Production-data caveat (read before using any count)

The hosted project `fkvuhfsqcmujywzgczmc` is a **shared demo/dev database**, not a customer
production system. It carries **both** the legacy demo orgs (Kansas Fitness Physio, South Park
Physician Group) **and** the redesign 11-org seed universe (Dillon Sports Medicine, Outer
Banks, …). Consequently:

- Counts below are **illustrative of shape, not customer reality.** The generation-run ledger,
  `org_payer_assignments`, and `payer_network_targets` have **zero rows** here because those
  redesign surfaces have not been exercised with data — that is a fixture fact, not proof the
  columns are dead.
- **Every retirement candidate's inventory query MUST be re-run against the real production
  database before any decision** (see the Retirement Gate). The queries in this document are
  the templates for that re-run.

## Classification vocabulary

Usage class (per the audit brief): **(1) actively used / business-critical** · **(2) written
but not consumed** · **(3) read but not authorable** · **(4) UI-only / derived** · **(5) legacy
compatibility** · **(6) operational metadata** · **(7) unused / unverified** · **(8) candidate
for deprecation only**.

Payer-fact ownership/grain: **G** global canonical fact · **O** organization payer setting ·
**N** group/state/network target · **K** contract term · **P** portal/form registry · **E**
case/enrollment outcome · **A** analytics-derived.

"Consumed by a downstream workflow" = a runtime resolver, generation/readiness engine, the
extension/API, or a report reads it — **not** merely a form input or a read-only display cell.

---

# 1. `payers` — the hypothesis-central table

Shared plumbing (applies to every column): domain type `src/types/index.ts` `Payer` (L477–511);
generated types `src/integrations/supabase/types.ts` (payers block L1810–1911; `list_global_payers`
return shape L3358–3381); service read `src/services/payers.ts` `listPayers`/`getPayer`
`.select("*")` (L31–47); cross-org catalog read `src/services/payerCatalog.ts` `listGlobalPayers`
via `list_global_payers` RPC (L18–23). **The browser write surface is `PayerInput`
(`src/services/payers.ts` L7–23) — identity/catalog columns are NOT in it**; they are written
only by `scripts/payer-catalog-sync.mjs` and the `review_payer_catalog_change` RPC.

Live column set confirmed via `information_schema` (25 columns). Production inventory (287 rows:
**269 global** `org_id IS NULL`, **18 org-scoped**):

| column                           | non-null rows (of 287) | authored-by-UI                      | displayed                               | downstream consumer (deciding evidence)                                                                                                                              | class          | grain                  |
| -------------------------------- | ---------------------- | ----------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------- |
| `name`                           | 287                    | ✅ admin.payers.tsx                 | ✅ everywhere                           | identity — every payer read                                                                                                                                          | 1              | G/O                    |
| `is_active`                      | 287                    | ✅                                  | ✅                                      | list filters, pickers                                                                                                                                                | 1              | O                      |
| **`avg_decision_days`**          | 8                      | ✅ admin.payers.tsx:400             | ✅ :165; payer-directory:182            | **✅ report** — `SummaryTab.tsx:132` expected-vs-actual decision-day variance                                                                                        | **1** (report) | G/A                    |
| `provisional_billing_allowed`    | 0                      | ✅ admin.payers.tsx:471             | ✅ :169                                 | ❌ none                                                                                                                                                              | **2**          | O                      |
| `provisional_billing_notes`      | 0                      | ✅ :486                             | ✅ :170                                 | ❌ none                                                                                                                                                              | **2**          | O                      |
| `retro_billing_allowed`          | 1                      | ✅ :478                             | ✅ :186                                 | ❌ none                                                                                                                                                              | **2**          | O                      |
| `retro_billing_window_days`      | 1                      | ✅ :494                             | ✅ :187                                 | ❌ none                                                                                                                                                              | **2**          | O                      |
| `caqh_pull_deadline_days`        | 1                      | ✅ :409                             | ✅ :195; payer-directory:185            | ❌ none — readiness uses the `CAQH_CURRENT_DAYS` **constant** in `enrollmentReadiness.ts`, not this column                                                           | **2**          | O                      |
| `provider_type_path`             | 8                      | ✅ :418                             | ✅ :198                                 | ❌ none                                                                                                                                                              | **2**          | O                      |
| `prior_auth_vendor`              | 1                      | ✅ :439                             | ✅ :201                                 | ❌ none                                                                                                                                                              | **2**          | O                      |
| `payer_billing_id`               | 2                      | ✅ :448                             | ✅ :204                                 | ❌ none                                                                                                                                                              | **2**          | O                      |
| `portal_url` (payers)            | 9                      | ✅ :456                             | ✅ :207; payer-directory:188            | ❌ none — the `payer.portalUrl` token is **deliberately filtered out** of the resolver (`sopAuthoringTokens.test.ts:54`; `sopResolver.ts` maps only `mso.portalUrl`) | **2**          | P→ see §Ownership      |
| `payer_kind`                     | 287 (NOT NULL)         | ❌ sync/seed                        | ✅ payer-directory:161                  | ✅ `payerDirectory.ts:30` kind filter                                                                                                                                | 1              | G                      |
| `status` (active/merged/retired) | 287 (NOT NULL)         | ❌ sync/RPC                         | ✅ payer-directory:94                   | ✅ `payerCatalogActions.ts:53` gates add/reactivate/unavailable                                                                                                      | 1              | G                      |
| `aliases` (text[])               | (global rows)          | ❌ sync                             | ✅ payer-directory:166                  | ✅ `payerDirectory.ts` alias search                                                                                                                                  | 1              | G                      |
| `states` (text[])                | (global rows)          | ❌ sync/seed                        | ✅ payer-directory:176                  | ✅ **`payerExpansion.ts expandTargets`** — network-target derivation + generation                                                                                    | 1              | G                      |
| `payer_slug`                     | 269                    | ❌ sync                             | ✅ payer-directory:179                  | ⚙️ sync identity/dedupe key (`payerCatalogSync.test.ts`)                                                                                                             | 6              | G                      |
| `last_synced_at`                 | 269                    | ❌ sync/RPC                         | ❌                                      | ❌ none                                                                                                                                                              | **6**          | G                      |
| `cms_hios_id`                    | **0**                  | ❌ (review RPC whitelist only)      | ❌                                      | ❌ none                                                                                                                                                              | **7**          | G                      |
| `prerequisite_payer_id`          | **0**                  | ❌                                  | ✅ AttachPayerDialog.tsx:72 (note only) | ❌ dormant — `generationConfirm.test.ts:101` pins **no** prerequisite branch                                                                                         | **7/8**        | G                      |
| `merged_into_id`                 | 0                      | ❌ sync                             | ✅ payer-directory:95                   | ✅ `payerCatalogActions.ts:55` successor resolution                                                                                                                  | 1              | G                      |
| `resolution_id_label`            | **0**                  | ✅ `PayerResolutionIdDialog.tsx:35` | ✅ (in dialog)                          | ✅ `payerResolutionIdentifier.ts:37` → `PipelineDialogs.tsx:92` approval dialog                                                                                      | 1              | **G⚠ (see Ownership)** |
| `resolution_id_expected`         | **0**                  | ✅ `PayerResolutionIdDialog.tsx:36` | ✅ (in dialog)                          | ✅ `payerResolutionIdentifier.ts:41` → `PipelineDialogs.tsx:92`                                                                                                      | 1              | **G⚠**                 |
| `org_id` (nullable)              | 18 non-null            | —                                   | —                                       | RLS discriminator (NULL = global catalog)                                                                                                                            | 1              | —                      |

## 1.1 Hypothesis verdicts (`payers`)

| Initial hypothesis                                                                                                                 | Verdict                                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `avg_decision_days` has a reporting consumer                                                                                       | **CONFIRMED**                                | `SummaryTab.tsx:132` reads `payer.avgDecisionDays` as the expected baseline and computes variance vs actual approval time; column header `:436`. Class 1.                                                                                                                                                                                                                                                                                                                                                                                                      |
| resolution ID fields have a payer-pipeline consumer but **wrong global ownership** for org-specific values                         | **CONFIRMED (consumer) + OWNERSHIP FLAGGED** | Consumer: `payerResolutionIdentifier.ts:37–43` → pipeline **Approval** dialog `PipelineDialogs.tsx:92`. Ownership: `resolution_id_label`/`resolution_id_expected` live on `payers`, whose 269/287 rows are **global** (`org_id NULL`) — a single label/expectation shared across all orgs. The **actual ID values** are correctly case-grained on `credential_cases` (`payer_individual_provider_id`/`payer_group_provider_id`, §5). If an org needs a payer-specific-but-org-varying label, the global grain is wrong → **business decision** (grain G vs O). |
| operational forms use `portals`/`portal_field_maps`, not `payers.portal_url`                                                       | **CONFIRMED**                                | The extension fill path resolves `portals.form_url` (`PortalStepLink.tsx:39`) and `portal_field_maps` selectors; `payers.portal_url`'s token is filtered out of the resolver (`sopAuthoringTokens.test.ts:54`). `payers.portal_url` is display-only. Even `msos.portal_url` (4 non-null) has a live resolver token; `payers.portal_url` (9 non-null) does not.                                                                                                                                                                                                 |
| provisional/retro settings, `provider_type_path`, `prior_auth_vendor`, `payer_billing_id` are authorable without runtime consumers | **CONFIRMED**                                | All six are authored + displayed in `admin.payers.tsx` only; grep shows **zero** runtime/report reads. Class 2. Production non-null: 0/1/1/8/1/2 respectively.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `caqh_pull_deadline_days` may be displayed but unenforced                                                                          | **CONFIRMED**                                | Displayed (`admin.payers.tsx:195`, `payer-directory.tsx:185`); nothing enforces it. Readiness uses a code constant, not this column. Class 2. Prod: 1 non-null.                                                                                                                                                                                                                                                                                                                                                                                                |
| `cms_hios_id` may be unused under `payer_slug` identity policy                                                                     | **CONFIRMED**                                | 0 non-null in data; only reachable via the review-RPC whitelist; no app read/display. `payer_slug` is the identity key (`uq_payers_payer_slug`). Class 7.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `last_synced_at` is sync metadata even if not user-facing                                                                          | **CONFIRMED**                                | Written by the sync script / review RPC, 269 non-null (all global rows), never read or displayed. Class 6 (operational metadata) — **not** a deprecation candidate; it is the sync-provenance record.                                                                                                                                                                                                                                                                                                                                                          |

## 1.2 The curated-credentialing block (the "class 2" cluster)

Nine columns — `provisional_billing_allowed`, `provisional_billing_notes`, `retro_billing_allowed`,
`retro_billing_window_days`, `caqh_pull_deadline_days`, `provider_type_path`, `prior_auth_vendor`,
`payer_billing_id`, `portal_url` — form a coherent group: **each is authored in `admin.payers.tsx`,
each is displayed there (and a few in `payer-directory`), and none has any downstream runtime or
report consumer.** They are "editable/displayed" but **not** "used by a downstream workflow." In the
demo/dev DB they are almost entirely null.

These are **not** retirement-approved (see the Gate). They are best read as **latent payer-fact
capacity** the redesign has not yet wired into a workflow — the R6+ roadmap (E4.0 pipeline, E4.2
payer admin) is the natural place a consumer would appear (e.g. `retro_billing_*` gating a billing
prompt, `provider_type_path` steering enrollment ID type). Recommended treatment: **class 2, hold**;
revisit at the E4.2/R8 reporting stage; do not author new UI depth into them until a consumer is
committed.

---

# 2. `payer_catalog_changes`

Domain type `PayerCatalogChange` (`types/index.ts:515–526`). READ `payerCatalog.ts:25–31`
`listCatalogChanges` → `usePayerCatalog`. Display/review UI `PayerCatalogChangesPanel.tsx`.

| column                                       | written by                                           | read/consumed                                       | class |
| -------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------- | ----- |
| `field`, `old_value`, `new_value`            | `payer-catalog-sync.mjs:223` (diff rows)             | `PayerCatalogChangesPanel.tsx:31–33` review display | 1     |
| `source`                                     | sync                                                 | `PayerCatalogChangesPanel.tsx:36`                   | 1     |
| `review_state`, `reviewed_by`, `reviewed_at` | `review_payer_catalog_change` RPC (`20260712180200`) | `:65` filter + Accept/Reject `:45/53`               | 1     |

Append-only audit/diff log. Class 1 (audit/history). Production: **0 rows** — inert on the demo DB
(no catalog change has been reviewed), but the sync pipeline and review flow are wired end-to-end
(`payerCatalogSync.test.ts`, `payer-directory.spec.ts`). Not a deprecation candidate.

---

# 3. `org_payer_assignments` — the catalog **subscription** layer (grain O)

Domain type `OrgPayerAssignment` (`types/index.ts:539–547`). Service `orgPayerAssignments.ts`.
Production: **0 rows** (assignment layer unexercised in the demo DB — inert, per CLAUDE.md).

| column                     | written by                                                                                                                 | consumed by                                                                                                                               | class |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `starter`                  | `setStarter` (`:156`) ← `admin.payers.tsx` StarterToggle (`:269`)                                                          | **✅ `starterCases.ts:42`** starter-pack auto-attach on provider create                                                                   | 1     |
| `status` (active/archived) | `addAssignment` (`:59`), `reactivateAssignment` (`:86`), `archiveAssignment` → `archive_org_payer_assignment` RPC (`:115`) | **✅ `payerCatalogActions.ts:10` `isActiveAssignment`** (directory add/reactivate control); `PayerNetworkSection.tsx:62` shortlist filter | 1     |
| `archived_at`              | archive RPC; cleared on reactivate (`:90`)                                                                                 | — internal lifecycle timestamp                                                                                                            | 6     |

Class 1 for the join + `starter`/`status`; `archived_at` is operational metadata (6). This is the
**subscription** grain (org → global payer), distinct from the network-target grain below.

---

# 4. `payer_network_targets` — the scope/attachment layer (grain N)

Domain type `PayerNetworkTarget` (`types/index.ts:549+`). Service `payerNetworkTargets.ts`.
Production: **0 rows** (E1.5 surface unexercised in demo DB).

| column                     | written by                                                                             | consumed by (genuine runtime)                                                                                                        | class |
| -------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `group_id`, `state`        | `attachPayerTargets` (`:32–38`)                                                        | **✅ generation candidacy** `generationPreview.ts:200` + **✅ readiness** `enrollmentReadiness.ts:359` (both key off group_id+state) | 1     |
| `status` (active/archived) | insert active; `archivePayerTargets` (`:74`), `setTargetStatus` (`:96`) — never DELETE | ✅ both engines gate `status === "active"`                                                                                           | 1     |

Class 1, business-critical. This is the highest-value payer-fact grain in the redesign: it is the
join E2.x generation and E1.8 readiness actually consume. Grain N (group×payer×state).

---

# 5. `credential_cases` — payer-outcome columns (grain E)

Two projections: narrow `CASE_LIST_COLUMNS` (`cases.ts:54`) and `getCase` `select("*")`
(`cases.ts:77`). Production: 65 cases, 5 with a moved pipeline state.

| column                                  | written by                                                                                     | consumed by                                                                                                              | class                         | grain |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ----- |
| `payer_pipeline_state`                  | **RPC only** `advance_payer_pipeline` (no direct JS update)                                    | badge (`cases.$id.tsx:195`, `cases.index.tsx:383`), queue `nextBestActions.ts:142`, caseContext TE-7 `caseContext.ts:79` | 1                             | E     |
| **`payer_provider_id`**                 | **nothing** (superseded by the split; first RPC version wrote it, dropped in `20260715120500`) | **nothing** — zero reads/writes in `src/` (only `types.ts`); **0 non-null in prod**                                      | **5 → 8**                     | E     |
| `payer_individual_provider_id` (Type 1) | `advancePayerPipeline` service `cases.ts:385` → RPC                                            | approval/correction dialogs `PipelineDialogs.tsx:243`; display `cases.$id.tsx:350`                                       | 1                             | E     |
| `payer_group_provider_id` (Type 2)      | `cases.ts:386` → RPC                                                                           | dialogs `:312`; display `cases.$id.tsx:353`                                                                              | 1                             | E     |
| `payer_reference_id` (tracking ID)      | `setPayerReference` `cases.ts:291` + extension write-back `submissionTouches.ts:241`           | tracking-ID field/editor, list search `cases.index.tsx:384`, caseContext `:79`                                           | 1                             | E     |
| `confirmed_effective_date`              | RPC on Approved (no direct JS write)                                                           | `actionState.ts:36` (effective = confirmed ?? expected), `RosterTab.tsx:147`                                             | 1                             | E     |
| `expected_effective_date`               | create `cases.ts:470`                                                                          | `actionState.ts`, displays                                                                                               | 1                             | E     |
| `generation_run_id`                     | `create_case_with_tasks` RPC / `generationConfirm.ts:124`                                      | `nextBestActions.ts`, `generationRuns.ts:100` provenance, `?runId=` filter                                               | 1                             | E     |
| `case_email_token`                      | **DB default only** (`baseline:74` `substr(md5(...))`)                                         | **display-only** `cases.$id.tsx:329`; **no inbound-email consumer built** (planned in SCHEMA.md:355)                     | **3/6**                       | E     |
| `specialty`                             | create `cases.ts:466`                                                                          | MSO-routing match at creation; **omitted from `CASE_LIST_COLUMNS`** (partial-projection wart)                            | 1 (legacy-metadata elsewhere) | E     |
| `mso_id`, `facility_id`, `assigned_to`  | create `cases.ts:467/465/468`                                                                  | via-MSO chip; launch/queue signals; coordinator reports `SummaryTab.tsx:151`                                             | 1                             | E     |

**`payer_provider_id` verdict:** the split (`payer_individual_provider_id` + `payer_group_provider_id`,
`20260715120500`) superseded it; **no live reader or writer, 0 non-null in production.** This is the
clearest deprecation candidate in the payer family — **class 8, gated** (§Retirement Gate). It exemplifies
the additive rule (kept, not dropped).

**`case_email_token` verdict:** DB-generated, display-only ("Forwarding ID"), and the inbound
email-to-touch webhook that would consume it (SCHEMA.md §"Inbound webhook") is **not built** in either
tree (no `src/server/**` handler names it). Class 3 (read/displayed but not authorable) + a **pending
consumer** — retain; it is the seam for the planned webhook, not dead.

---

# 6. `sop_templates`, `sop_template_versions`, and SOP task/step JSON

## 6.1 `sop_templates`

| column                               | authored                                                                                                     | consumed at runtime                                                                                                    | class                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `task_definitions` (jsonb)           | wizard                                                                                                       | `sopResolver.ts` (via `pickTemplate`→`resolveTemplate`)                                                                | 1                          |
| `payer_id`, `group_id`, `state`      | wizard `TemplateWizard.tsx:529`                                                                              | **the runtime match keys** `pickTemplate.ts:81–86`; uniqueness `templates.ts:73`                                       | 1                          |
| `current_version`                    | RPC/trigger/default                                                                                          | `sopStamp.ts:37` (stamp), wizard concurrency `TemplateWizard.tsx:664`, provenance                                      | 1                          |
| `is_archived` (`archived` col)       | wizard                                                                                                       | `pickTemplate.ts:63` excludes archived                                                                                 | 1                          |
| **`specialty`**                      | **no setter** — `TemplateWizard.tsx:275` destructures with no `setSpecialty`; written as pass-through `:531` | **NOT a match key** — `pickTemplate.ts:24–26` + `sopMatchKey.ts:5–7` explicitly exclude it; displayed read-only `:984` | **5** legacy compatibility |
| `required_profile_attributes` (head) | wizard `TemplateWizard.tsx:1004`                                                                             | **✅ generation gating** `generationGating.ts:45` → `profileGating.ts:94` → `useGenerationPreview.ts:228`              | 1                          |

**`specialty` verdict:** written (pass-through) + displayed, **never a runtime match key**. Confirmed
by explicit code comments and grep (no comparison in `pickTemplate`/`sopMatchKey`). This is intentional
per the E4.2 SOP-hardening decision ("specialty preserved as legacy/non-routing metadata"). Class 5 —
retained deliberately, **not** a deprecation candidate (the PM decision keeps it as legacy metadata).

## 6.2 `sop_template_versions`

Immutable version rows; readers only `templates.ts:188/218` → `CaseSopProvenance.tsx`,
`TemplateVersionHistory.tsx`.

| column                                                                               | written                            | read                                                                                                                                                       | class                          |
| ------------------------------------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `version`, `task_definitions`, `name`, `change_note`, `published_at`, `published_by` | publish RPC / trigger / backfill   | version history + provenance UI                                                                                                                            | 1                              |
| **`required_profile_attributes`** (version snapshot)                                 | publish RPC `20260715140300:81–83` | **NONE — write-only.** Gating reads the mutable **head**, not the version snapshot (`generationGating.ts:45`); `TemplateVersionHistory` does not render it | **2** written-but-not-consumed |

**`sop_template_versions.required_profile_attributes` verdict:** a per-publish snapshot with **no
reader** — the generation gate consumes the head template's copy instead. Class 2. Likely intentional
(immutability/future-proofing so an in-flight case's gate is reconstructable), but currently inert.
Prod: 0 set. **Note for the audit trail: this is written-but-not-consumed, not unused** — it is a
deliberate immutable snapshot; flag for a decision on whether a version-aware gate reader should exist.

## 6.3 SOP task/step JSON properties (inside `task_definitions` / `tasks.sop_content`)

| property                                       | authored                                               | resolved (`sopResolver.ts`)                                                                        | consumed                                                                                                            | class                   |
| ---------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `stepType`                                     | editableTemplate + wizard                              | `:109` default online_form                                                                         | `CaseWizard` per-type render; `editableTemplate.ts:108` portal-key filter                                           | 1                       |
| `dataFields` (`{label,token}`→`{label,value}`) | wizard, token-picker                                   | `:136–141` resolves + filters unresolved                                                           | `CaseWizard`, `TemplatePreviewTasks`, `/tasks/$id`                                                                  | 1                       |
| `portalKey`                                    | wizard (online_form only), `normalizePortalKey`        | `:127` verbatim                                                                                    | **`PortalStepLink.tsx` + extension `portalTasks` (`providerCases.ts:178`)**                                         | 1                       |
| `emailTemplate` (`{subject,body,to?,cc?}`)     | wizard (draft_email only); To required by publish lint | subject/body interpolated; literal/token recipients source-preserved; empty token → `address:null` | **Case Wizard resolved To/CC display + human-reviewed Gmail handoff**; versioned in existing JSONB, no migration    | 1                       |
| `followUpEveryDays`                            | wizard                                                 | `:131` verbatim                                                                                    | **✅ cadence** `nextBestActions.ts:59` `minStepCadence` → queue signal + reason `:466`                              | 1                       |
| `expectedTurnaroundDays`                       | wizard                                                 | `:130` verbatim                                                                                    | **display only** `TemplatePreviewTasks.tsx:56`, `CaseWizard.tsx:370`; **NOT** read by `nextBestActions`/`followUps` | 4 UI-only               |
| `requiredArtifacts` (string[])                 | wizard                                                 | `:132` verbatim                                                                                    | display only `CaseWizard.tsx:376`                                                                                   | 4 UI-only               |
| `executionType` (task-definition level)        | wizard `:1111`                                         | not in resolver (post-resolution stamp)                                                            | **`hasExtensionFillTask` (`executionTypes.ts:61`) → `payerReadiness.ts:14`** form-readiness                         | 1 (at definition grain) |

Snake-case variants (`step_type`, `data_fields`, `email_template`, `dataFieldTokens`) have **no live
`src/` reader** — the jsonb uses camelCase; `dataFieldTokens` is only the documented legacy seed shape.

---

# 7. `tasks` — stamp/execution columns

| column                            | written                                         | read at the **task grain**                                                                                                                                               | class                                              |
| --------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `sop_content`                     | createTasks / RPC                               | `nextBestActions` cadence, `providerCases` portalKey, task views                                                                                                         | 1                                                  |
| `sop_template_id` / `sop_version` | `sopStamp.stampTasks` (6 surfaces) → RPC        | `TASK_LIST_COLUMNS:140`; provenance `CaseProvenancePanel.tsx:58`; generic-SOP chip                                                                                       | 1                                                  |
| `is_auto_generated`               | createTasks (true/false)                        | in `TASK_LIST_COLUMNS` but **no UI branches on it**                                                                                                                      | 4/7 (defensive/legacy)                             |
| `due_date`                        | resolver/input                                  | **`nextBestActions.ts:312`** earliest-due signal + overdue; displays                                                                                                     | 1                                                  |
| `completed_date`                  | complete/reopen; extension close-out            | display `CaseTasksPanel.tsx:180`                                                                                                                                         | 1                                                  |
| **`execution_type`**              | stamped `sopStamp.stampExecutionTypes:74` → RPC | **NOT in `TASK_LIST_COLUMNS`; no task-grain reader/display** — runtime reads are at the **definition** level (`hasExtensionFillTask`)                                    | **2** written/stamped-but-not-read (at this grain) |
| **`sop_resolution_tier`**         | stamped `sopStamp.templateProvenance` → RPC     | **NOT in `TASK_LIST_COLUMNS`; no task-grain reader** — tier is displayed/counted at **run-row/template** level (`generationRuns.ts`, `GenerationPreviewContent.tsx:372`) | **2/6** provenance stamp, no task-grain reader     |

**`tasks.execution_type` and `tasks.sop_resolution_tier` verdict:** both are stamped on every
SOP-resolving surface but **neither is read back at the task-row grain** — their live readers operate at
the SOP-_definition_ level or the run-row/template level. In production, **0 tasks carry any stamp**
(no generation-confirmed tasks in the demo DB). These are **provenance columns provisioned ahead of
their consumers** (E4.3/E4.5/R7 per `types/index.ts:801–803`). Class 2/6 — retain (they are the
immutable record R6+ execution and reporting will read); **not** deprecation candidates. Flag: if
R7/R8 never grow a task-grain reader, revisit.

---

# 8. `case_generation_runs`, `case_generation_run_rows`, `fill_sessions`, `portals`, `portal_field_maps`

Production: `case_generation_runs` **0 rows**, `case_generation_run_rows` **0 rows**, `fill_sessions`
31 rows (0 `is_test`), `portals` 1 row.

| table.column                                                                                  | written                     | consumed                                                                                                                                                                                                              | class                                        |
| --------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `case_generation_runs.*_count`                                                                | confirm insert (plan)       | superseded at read by run-row derivation (`generationRuns.ts deriveRunCounts`)                                                                                                                                        | 3 (read but plan-only; child rows are truth) |
| `case_generation_runs.release_scope`                                                          | E4.2 confirm                | **0 non-null in prod**; TE-14 selection layer — verify reader in E4.2 run history                                                                                                                                     | 2/7 unverified                               |
| `case_generation_run_rows.disposition/reason/case_id/exclusion_id`                            | confirm loop                | run-detail UI (`RunDetailContent.tsx`), count derivation                                                                                                                                                              | 1                                            |
| `case_generation_run_rows.sop_template_id/sop_version/sop_resolution_tier`                    | E4.2 SOP-hardening snapshot | **write-only in practice** — only reader `listGenerationRunRowsByTier`/`countRunRowsBy` (`generationRuns.ts`) has **no app caller** (grep excl. tests → definitions only); provenance UI reads task stamps, not these | **2** (0 rows in prod)                       |
| `fill_sessions.fields_filled`                                                                 | extension                   | portals-admin last-fill (`admin.portals.tsx:77`), scorecard `firstPassRate` (`payerScorecard.ts`)                                                                                                                     | 1                                            |
| `fill_sessions.fields_skipped` (structured)                                                   | extension                   | test-runner (`testRunResults.ts`); **candidate source for the C2 broken-mapping card** (parity audit)                                                                                                                 | 1                                            |
| `fill_sessions.docs_attached`                                                                 | extension                   | **write-only** — no reader anywhere                                                                                                                                                                                   | 2                                            |
| `fill_sessions.performed_by`                                                                  | extension (ctx)             | **write-only** — no in-repo reader (audit body aside)                                                                                                                                                                 | 2/6                                          |
| `fill_sessions.fill_mode`                                                                     | extension                   | written + echoed + audited; **no in-repo logic consumer** (extension reads off-repo)                                                                                                                                  | 3/6                                          |
| `fill_sessions.is_test`                                                                       | E4.2 dry-run                | scorecard exclusion (`payerScorecard.ts:117`) + test-fill list filter                                                                                                                                                 | 1 (0 rows in prod)                           |
| `portals.form_url/is_verified/last_verified_at/url_changed_at`                                | portals admin               | `PortalStepLink`, verification pill, train flow                                                                                                                                                                       | 1                                            |
| `portal_field_maps.token/status/source`                                                       | training/MCP                | **extension fill engine + `/api/portal-field-maps`**; `status` also scorecard `mappingCoverage`                                                                                                                       | 1                                            |
| `portal_field_maps.selector/selector_fallbacks/map_type/hardcoded_value/transform/field_type` | training/MCP                | emitted to the extension via the server contract; **no in-repo consumer** (extension is off-repo)                                                                                                                     | 1 (ext) / 3 (in-repo)                        |
| `portal_field_maps.field_label/form_section/confidence`                                       | mapping capture             | Mapping-review UI only (`mappingConfidence.ts` `resolveConfidence`); **never in the server contract** — extension never receives them                                                                                 | 4 (UI/derived, training)                     |

---

# 9. Consolidated deprecation-candidate shortlist (ALL GATED — none approved)

| field                                                                                                                          | why a candidate                                                | production non-null | class | required next step                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------- | ----- | ------------------------------------------------------------------------------------------- |
| `credential_cases.payer_provider_id`                                                                                           | superseded by the Type1/Type2 split; **no live reader/writer** | **0 / 65**          | 8     | full Retirement Gate                                                                        |
| `payers.cms_hios_id`                                                                                                           | no app consumer; `payer_slug` is the identity policy           | **0 / 287**         | 7     | inventory + gate                                                                            |
| `payers.prerequisite_payer_id`                                                                                                 | dormant; generation pins no prerequisite branch                | **0 / 287**         | 7/8   | keep as dormant unless roadmap drops MA prerequisites entirely; gate                        |
| `sop_template_versions.required_profile_attributes`                                                                            | write-only snapshot, no reader                                 | 0 set               | 2     | decide version-aware-gate reader vs accept as immutable snapshot                            |
| `fill_sessions.docs_attached`                                                                                                  | written by extension, no reader                                | —                   | 2     | decide reader (E4.5 doc storage) vs hold                                                    |
| `payers` curated block (provisional/retro/caqh_pull_deadline/provider_type_path/prior_auth_vendor/payer_billing_id/portal_url) | authorable+displayed, **no downstream consumer**               | 0–9 / 287           | 2     | **hold** — latent capacity; do not deepen UI until a consumer is committed; revisit E4.2/R8 |

**Everything else marked class 2/6/7 above** (`tasks.execution_type`, `tasks.sop_resolution_tier`,
`case_generation_runs.release_scope`, `payers.last_synced_at`) is **written-ahead-of-consumer or
operational metadata — explicitly NOT a deprecation candidate**: they are provenance/sync records the
R6+ roadmap is expected to read. Per the brief, insufficient-evidence fields are **unused/unverified,
not unused.**

---

# 10. Retirement Gate (applies to every candidate in §9 — none is approved here)

**No column-removal recommendation in this document is approved.** For any candidate to proceed to
retirement, ALL of the following must be satisfied, in order:

1. **Named business-owner sign-off** (PM) that the field is truly out of scope for R6–R10 (the payer
   pipeline, payer/SOP admin, government-payer, and outcomes-reporting stages are the exact places a
   dormant payer/case field could gain a consumer).
2. **Production inventory** re-run against the **real customer database** (not the demo/dev project
   `fkvuhfsqcmujywzgczmc`): row count, null-rate, distinct-value cardinality, and a reference scan
   (RPC bodies, RLS `WITH CHECK`, generated types, seed/sync scripts, extension payloads, reports).
   Template query:
   ```sql
   -- per candidate column
   select count(*) total,
          count(<col>) non_null,
          count(distinct <col>) distinct_vals
   from <table>;
   -- plus: grep migrations for the column in any RPC/trigger/CHECK/GRANT before removal
   ```
3. **Historical / audit-impact review** — confirm no `audit_log`, `*_history`, or immutable ledger
   row references the column, and that removing it does not rewrite or orphan history (the additive
   rule forbids destroying historical records).
4. **Compatibility review across every surface**: RLS policies, SQL RPCs/functions/triggers,
   `/api/*` + extension payloads, reports/exports, `supabase/seed*.sql`, and
   `scripts/payer-catalog-sync.mjs`.
5. **Data backfill / archive plan** for any non-null production values (e.g. copy
   `payer_provider_id` into the split columns if any legacy value exists before removal).
6. **Deprecation period + observability** — stop-write first, watch for zero reads over an agreed
   window before any drop.
7. **`docs/data-model/table-register.md` updated** in the same PR that changes schema (this PR does
   **not** touch it, because this PR changes no schema).
8. **A separate, approved migration PR** performs the actual removal — never this documentation PR;
   migrations remain additive until that explicitly-approved change.
9. **Preservation of historical records** throughout (append-only ledgers, prior enrollment outcomes,
   and audit rows are never deleted).

A candidate that fails step 1 or 2 stays classified **unused/unverified (7)** and is **not** removed.
