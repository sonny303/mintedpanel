# Case types, SOP selection, and independent form configurations — focused first release

Updated: 2026-09-30  
Status: Implementation plan; this review changes documentation only.  
Products: Minted Panel and Minted Workbench extension.  
Decision: Support the same payer form through independently trained configurations selected by a typed SOP. Reuse the existing case, contract, SOP, portal, and mapping models.

## 1. Release outcome

An operator selects the appropriate business purpose and SOP. Its form step launches one exact configuration, even when another configuration uses the same URL. Training, filling, and testing all honor that selection.

```text
Group Contracts Matrix → Contract SOP → Aetna — New group contract
Provider case          → Enrollment SOP → Aetna — Add provider to existing contract
                                            ↓
                         Same Aetna URL; separate portal keys and mappings
```

The first release supports Contract and Enrollment execution. It reserves Recredentialing as a case type for SOP authoring/filtering; it does not claim to support recurring recredentialing cases or invent the payer process. The existing one-case-per-provider/group/payer/state constraint remains intact.

In the product, “Case type” describes the business purpose. It does not require every type to be stored in `credential_cases`: Contract work remains owned by the Group Contracts Matrix.

### Confirmed requirements

- New contract means a new group contract with a designated first individual provider included in the application.
- Enrollment means adding an individual provider to an existing group contract.
- The selected SOP fixes the form path. Contract status and the website URL must not switch that path automatically.
- Capture both Aetna workflows from empty configurations. Do not copy or union the existing mixed mappings.
- Provide Reset form mapping for restarting an existing configuration. Reset is distinct from creating a separate scenario and from discarding a local capture.
- Use the selected group's contracting contact for the new-contract path. Existing-contract enrollment omits that section according to its captured workflow.
- Missing contact values allow partial fill and an explicit warning. Do not substitute the coordinator or signing contact.
- Staff usually wait for a contract, but this release adds no waiting requirement. Early-enrollment exceptions remain manual actions on the payer site.
- A human reviews attachments and submits. A fill is not a submission, contract execution, or provider approval.
- Differences beyond contracting contact remain unknown until both complete workflows are captured. They must be represented in the separate configurations or SOP instructions, not guessed in application code.

### Deliberately outside this release

No generic workflow-run/cycle engine, participant-management system, new contract task engine, recurring recredentialing automation, cross-case evidence linking, automatic contract/provider outcomes, reporting overhaul, shared mapping inheritance, new page/field storage system, or elaborate mapping publication/version UI.

Contract work gets SOP instructions and precise form launch from the Matrix. Staff continue recording its status, dates, and notes through the existing Matrix controls. Automatic contract step completion and submission-ledger integration are deferred. The combined first-provider application's provider outcome is recorded manually through the existing provider workflow; the system must not demand a duplicate payer submission merely to use autofill.

## 2. What is already implemented

Reviewed local Panel HEAD `44306f82`, existing uncommitted work, extension HEAD `746c70d`, and the current GitHub default-branch SOP-selection source. Local work was preserved.

| Capability | Finding | Plan treatment |
| --- | --- | --- |
| Multiple matching SOPs for payer/state | Implemented by merged [PR #454](https://github.com/sonny303/mintedpanel/pull/454). | Reuse candidate ranking and explicit selection. |
| Overlapping global SOPs; change template on an untouched case | [PR #461](https://github.com/sonny303/mintedpanel/pull/461) is merged. Matching source/migrations are also present in this checkout. | Extend its validation; do not create another replacement mechanism. |
| Explicit Contract/Enrollment/Recredentialing fields and type filtering | Not found in reviewed local app/schema/extension. Current [main selection code](https://github.com/sonny303/mintedpanel/blob/main/src/lib/pickTemplate.ts) accepts payer, state, and group, without type. | Still required. SOP choice is useful groundwork, but is not case-type support. |
| Exact form reference in SOP step | `portalKey` already exists. | Keep it as configuration identity. |
| Independent mapping namespaces | Existing `portals` and `portal_field_maps` use `portal_key`; URL is not the mapping identity. | Create separate registry rows and empty maps; no duplicate mapping system. |
| Safe handling of equal URLs in extension | URL matching returns one winner; Train/Work selection can be replaced by recognition. | Must change before launching the two configurations. |
| Matrix-origin SOP/form launch | Matrix currently manages contracts, not this launch context. | Add a small SOP assignment and launch surface. |
| Group contracting contact | Existing group fields and profile tokens include name/title/email. | Reuse; add fields only if capture proves they are missing. |
| Full reset before recapture | Shared propose preserves existing decisions; extension Delete selected only clears its local capture. No full reset was found in the reviewed services. | Add a configuration-scoped reset and stale-capture protection. |

Verification performed for this revision: **6 existing test files, 60 tests passed** covering template ranking, manual selection, reapplication, unstarted-case template changes, template uniqueness, and task stamping. These establish the reusable source foundation; they do not verify the proposed feature or the payer workflow.

Deployment remains unverified. A merged PR is not proof that its migrations, Panel deployment, or extension package are live. Reconcile the migration ledger before rollout, including `20261001140000_allow_multiple_sop_templates_per_state.sql`, `20261001150100_allow_global_sop_duplicates.sql`, and `20261001150200_replace_unstarted_case_sop.sql`.

## 3. Selection rules and identity

1. **Type filters SOPs.** Filter by explicit case type, then apply existing payer/state/group/org precedence. Do not infer type from a template name or contract status.
2. **The operator resolves ambiguity.** One eligible top-ranked SOP may be preselected; several require a choice. Automated generation with an unresolved tie reports that choice is needed instead of selecting the oldest row.
3. **The SOP step selects the configuration.** A step stores its exact `portalKey`. Multiple configurations may share URL, payer, and type. Do not make any of those combinations unique.
4. **The URL validates location.** Recognition returns candidates. An explicitly selected configuration is eligible when the current page matches its allowed URL rules; it need not be the first URL candidate.
5. **Context stays explicit.** Work mode is bound to the owner, SOP/version, task/step, provider/location, and configuration. The operator cannot silently switch configurations inside an SOP-bound fill. Return to the appropriate SOP/step to change the path.
6. **Legacy stays identifiable.** Null type means legacy/unclassified, not all types. Preserve old work; do not silently backfill types from names. New typed work cannot fall back to an unclassified or differently typed SOP. A generic fallback must be explicitly classified for its permitted type.

The largest release risk is a plausible-looking fill from the wrong configuration. The release gate is end-to-end identity preservation through selection, handoff, page navigation, mapping load, fill receipt, and any case submission action.

## 4. Frontend requirements

### SOP authoring and provider cases

- Add Case type to SOP Basics, draft persistence, review, publish, list filters, and version display. Require it for new typed publications. Published content remains immutable; classification of legacy content produces a new version.
- Show eligible configurations by payer and type in the form-step picker, with readable names and distinct keys internally. Two equal URLs remain separate choices. Server validation mirrors the picker.
- Show case type in the case detail/selection surfaces used for launch. New provider-case creation defaults explicitly to Enrollment. Selecting Contract takes staff to the matching Matrix context. Recredentialing is visible as not yet available for execution, rather than creating a second credential case.
- Reuse the existing template selector and Change template action. Filter both by type and preserve its unstarted/activity checks. Started work retains its stamped SOP; changing the catalog does not rewrite it.
- Update manual creation, reapply, bulk/generation, preview, and replacement callers consistently. Existing generation remains Enrollment; do not create Contract/Recredentialing records from legacy rules.
- Missing typed SOP means “SOP not configured” and no automated launch. Do not use the other scenario as a fallback.

### Group Contracts Matrix

- In the contract detail drawer, add selected Contract SOP/version, its instructions/form steps, a designated first-provider picker, a location picker when needed, and Work in portal for each configured form step.
- Persist the SOP assignment on the group/payer/state contract. Use the contract's scope as authoritative. One active assignment per contract is enough for this release.
- Select an eligible provider in that group and an eligible location for the state. These are form input context, not contract ownership. A contract may exist without a provider; require one only for provider-dependent launch.
- Provider/location selection may be supplied at launch and remembered within the current UI session. Persist the actual choice in the fill receipt, avoiding a new permanent provider-participation model.
- Render instructions directly from the assigned immutable SOP version. Do not generate contract rows in the provider task queue or insert a fake credential case.
- Preserve existing manual contract status/dates/notes. The extension provides a return-to-Matrix link instead of posting a contract submission to a case timeline.
- SOP replacement is allowed before recorded filling begins. After activity, retain the assignment in v1 and show the existing version; a general restart/history feature is deferred. Corrections requiring another SOP remain a manual payer-site operation for this release.

### Form configuration library and training

- Reuse portal registration/editing. Use the label Form configuration where helpful; no broad navigation redesign is required.
- Create clean configuration collects name, payer, case type, and URL. It creates a unique immutable `portal_key`, zero mappings, and no inherited proof. State applicability remains on the SOP initially.
- Create “Aetna — New group contract” and “Aetna — Add provider to existing contract” independently. Keep the old mixed configuration available for existing references/history; remove it from new typed choices only after inventorying those references.
- In Train and Test, choose a configuration explicitly and keep its name/type visible throughout the capture. Known URL recognition never overrides this choice.
- Keep captures, edits, fixed answers, field decisions, training buffers, and proof under that key. Switching targets must not save an old buffer into the new target. No sibling-configuration auto-learning or copied suggestions during clean training.
- Map the entire scenario, including branch-selecting fixed answers. Use existing mapping/page-step capabilities and SOP notes for manual actions or attachments. Required unsupported controls are marked manual, not silently treated as successfully filled.
- Existing proof remains configuration-specific. Record full-path/state review separately from a mock or single-page test using existing proof/notes facilities; do not introduce a new publication product.
- Warn on observable selector collisions: if the same configuration/selector would overwrite a different page's meaning, stop that save and require a more specific supported selector or manual field. Never silently overwrite or merge. Only an observed unresolvable collision justifies a separately scoped page-aware mapping change.

### Extension Work experience

- Keep selected type, scenario/configuration, owner, and provider visible. Show task/step context where applicable.
- Handoff selection wins over URL ranking. Without a handoff, require explicit selection when several configurations match. Train/Test may select independently; production SOP-bound Work may not substitute a sibling configuration.
- Bind the context to the actual launched/confirmed tab. Opening another same-origin tab must not receive the first tab's context accidentally. Preserve existing expiry behavior and reject stale asynchronous responses after any context switch.
- Allow partial fill for missing contact values and unsupported/manual fields. Show what needs manual completion. Missing required owner/SOP/configuration context blocks autofill because the intended scenario is unknown.
- Keep human submission. For Enrollment, an existing Mark submitted action must target the exact case task/step. For Contract, do not display a case submission action; staff update the Matrix manually.

### Reset form mapping and recapture

This enhancement belongs in the configuration/training slice. It does not change case-type routing or justify the deferred workflow engine. There are three separate operations:

| Action | Meaning |
| --- | --- |
| Create clean configuration | Create another scenario with a new key, empty fields, and independent training. Use this for the initial Aetna Contract/Enrollment split. |
| Reset form mapping | Keep one configuration's identity and SOP references, but make its active captured field setup empty and invalidate its training/proven status. Use this to retrain that same scenario. |
| Discard capture / Delete selected | Clear only the extension's unsent/local capture. These actions do not reset the saved library. |

- Creating a clean configuration adds a new independent key and leaves the old mixed setup untouched. Reset instead targets an existing key, invalidates its active maps/proof, and may interrupt autofill until recapture. Preserve historical receipts/fields and stored organization overrides; old overrides become inactive until reviewed.
- Put Reset form mapping on Form setup for the selected configuration, not on an individual SOP step. The confirmation names the configuration, its Global or organization scope, the number of current saved fields, and affected SOP references that the operator is authorized to see. Do not expose other organizations' private SOP names.
- For a shared configuration, use explicit copy such as: “Reset the shared mapping for Aetna — New group contract? This clears its active saved fields and training/proven status for everyone using this configuration, including other templates. Autofill will be unavailable until it is retrained. Aetna — Add provider to existing contract is unaffected.” Show sibling names only when known and authorized.
- The reset covers the whole configuration across its captured pages, not just the seven visible fields or the current page. Clear active field decisions, fixed answers, transforms, control options, presentation overrides, and prior training coverage from the new setup. Keep name, URL, payer/type, key, and SOP instructions/references.
- Preserve existing cases/contracts, filled payer-page values, and historical fill/audit evidence. Reset does not retract submissions or erase values already placed on the external website. It does not promise automatic undo or full historical mapping replay.
- After success, show an empty setup with “Recapture in Train forms.” Select the same configuration in the extension with a fresh capture; do not resend an older local draft. Recapture is deliberate and does not automatically submit or approve mappings.
- Production autofill stays unavailable after reset until the current setup is captured, mapped, and reviewed. Draft Train/Test remains available. Reuse the existing verified/proven indicators; do not add a publication system. Zero fields must never count as successfully trained.
- Global reset must not delete organization overrides. Overrides based on the previous shared setup become inactive for filling until reviewed against the new setup. Otherwise they could make an apparently empty reset continue filling old answers. Explain this effect in the confirmation/help text.
- Start with the shared/global configurations used by Form setup. An organization-only configuration may use the same reset contract when it has no shared fallback. Clearing an organization override to reveal shared mappings is a different operation; do not label it “start empty.”
- Authorization is enforced server-side. The 2026-09-30 product decision authorizes global Reset form mapping, including bulk reset operations, under the existing signed-in, non-restricted shared-edit policy; do not add a narrower platform capability or infer global ownership from an organization-admin role. This policy decision does not require a multi-configuration bulk UI and is not authorization to perform a live reset during planning.

## 5. Backend and schema changes

All schema changes are additive. Retain the four-part credential-case uniqueness and existing contract grain. Update domain/generated types and the table register in the same implementation PR. Proposed names below are implementation targets, not claims about current tables.

| Storage | Minimal change | Invariant |
| --- | --- | --- |
| SOP heads, draft payloads, published version payloads | Add nullable `case_type`, using `contract`, `enrollment`, `recredentialing`. New typed publications require it. | Historical null values stay unclassified; immutable published content is not rewritten. |
| `credential_cases` | Add nullable `case_type`; explicitly stamp `enrollment` for new supported provider work. | Contract records never go here. Recredentialing creation remains disabled; no uniqueness change or cycle backfill. |
| `portals` | Add nullable `case_type` and a capability marker such as `requires_explicit_selection`, default false for legacy records. | Distinct keys may share URLs. New scenario configs require explicit-selection support. |
| Reset generation metadata | Add `mapping_generation` to configuration records and map rows, initially 1; include it on capture drafts, proof requests, and fill receipts. | Reset advances the configuration generation. Only maps/proof for the current generation are active. This is an invalidation counter, not a mapping version/publication engine. |
| New `form_mapping_reset_events` | Append-only reset receipt: configuration identity/scope, old/new generation, actor, timestamp, affected field count, and idempotency key. Global events have explicit global authorization, not a fabricated org ID. | Record the reset atomically without storing provider values or claiming to snapshot every historical mapping edit. Restrict reads/writes appropriately. |
| New `contract_sop_assignments` | `id`, `org_id`, `contract_id`, `sop_template_id`, `sop_version`, `context_version`, actor/timestamps; unique contract ID. | One current Contract SOP assignment per contract; exact immutable version, same authorized scope. No task engine or status duplication. |
| `fill_sessions` | Add nullable contract/assignment linkage, SOP/version, task/step reference, selected facility, context receipt ID, and effective mapping fingerprint where absent. Reuse existing provider/configuration fields. | New workflow fills have exactly one case or contract owner. Legacy/test rows keep their supported nullable behavior. Contract fill has no case ID. |
| `portal_field_maps` | Keep existing table and per-key mapping namespace. | Do not drop selector uniqueness or union sibling maps. Scope reads, writes, overrides, and learning to the exact key. |

Use a small shared closed-set type module for UI/API validation. This is business purpose, separate from task `execution_type` such as extension-fill or PDF.

A contract SOP step can be identified by assignment + immutable SOP version + task/step position in that version. Existing case work uses stamped task IDs plus an unambiguous step reference. Do not rely on label text or `portalKey` alone: the same configuration can appear in more than one step. Adding stable step keys to newly published payloads is acceptable if already supported, but a general step-ID migration is not required.

### Services and writes

- Extend existing SOP selection/publish/stamping and unstarted-replacement services with type validation. Integrate the merged replacement RPC rather than duplicating its atomic task replacement and auditing.
- Add service/DI operations to read and assign a Contract SOP, validate launch context, and resolve the designated provider's profile against the contract's group/state. Components use hooks → services; extension APIs call these same services via DI.
- Make assignment creation/replacement transactional and retry-safe, with expected `context_version`. Concurrent selection must not silently overwrite another operator. Check recorded fill activity before allowing replacement.
- Resolve type, organization, payer/group/state, and configuration from the authorized owner and selected SOP version. Never trust a request containing individually valid but unrelated IDs.
- For telemetry, preserve existing fill-event idempotency and reject reuse with conflicting owner/step/configuration context. Contract receipts must not trigger case status or task-completion side effects.
- Scope learning to the exact configuration and matching evidence. If current learning requires case submission evidence, keep it disabled for Contract v1; intentional training still works. Do not invent case evidence to enable it.
- Add one transactional reset RPC/service. Lock the configuration, check permission and expected generation, advance generation, clear `is_verified`, `last_verified_at`, and `proven_at`, and append the reset event. Retry of the same idempotency key returns the same result; a concurrent conflicting reset returns a conflict. Do not implement this as seven individual Unmap requests.
- Retire old field rows from active reads by generation rather than dropping tables, changing selector uniqueness, or deleting historic evidence. On a fresh capture of an existing selector, the propose RPC may reuse that row only after replacing its old decision and all obsolete metadata with clean captured defaults. Within the same generation, ordinary recapture continues preserving decisions. A field not seen again stays inactive. Exclude inactive rows from learning, export, testing, verification counts, and filling—not just the editor.
- All training/map edits, captures, proof updates, and learning writes must carry/check the expected generation. A pending pre-reset write must fail rather than revive an old map or re-mark the configuration proven. Serialize these writes with reset at the configuration boundary. Legacy writers without this token may access untouched legacy configurations only; reject them for reset-enabled configurations.
- Reuse group contact tokens. Add phone/name components only after capture demonstrates a missing source field; do not infer names or substitute unrelated contacts.

### Mapping changes during a fill

Use the existing mapping service to return an opaque fingerprint of the effective mapping set, including organization overrides and relevant configuration settings. Pin it in the extension's current fill context. Revalidate before each Fill action. A changed mapping set requires reloading and reviewing the current application; do not mix configurations or silently use new mappings halfway through.

Compute the fingerprint from canonical mapping content plus mapping generation; this avoids new mapping revision tables or publication UI. Store the applied fingerprint, generation, and map IDs in the normal fill receipt. Generation makes a reset detectable even when recapture eventually produces identical mappings. It detects change but does not provide historical replay, which is deferred. Cancellation/context checks must also occur immediately before applying fetched values to the page. Preserve accurate receipts for fills that already occurred before reset; do not treat those receipts as current proof or permit them to repopulate mappings. Reset cannot remotely undo values already entered by an offline client; its next contact must invalidate the old context. Require an online generation check before a new Fill action on a reset-enabled configuration.

### Permissions and sensitive data

- Add explicit grants and org/role RLS for the assignment table; preserve existing global-catalog versus organization override policies.
- Add equivalent explicit protection for reset receipts and the reset RPC, including the distinct global scope. Existing `audit_log` requires an organization; do not attach a global reset to an invented organization to satisfy that constraint.
- Service-role routes use `guard.ts`, membership-derived org/actor, DI, and full relationship validation. Provider-bearing responses use `Cache-Control: no-store`.
- Handoff and session context contain IDs and safe metadata, not provider field values. Training capture and telemetry preserve current no-value rules.
- Leave the sensitive-identifier vault unchanged. Its existing case-scoped release cannot be used with a fabricated case for Contract. Any contract field requiring an unsupported sensitive-data release is explicitly manual in v1.
- Retain existing append-only audit/history rules. Do not write Contract activity to `touches`, which requires a case, or broaden delete permissions.

## 6. API and extension protocol

Extend current APIs where possible. A new generic workflow/execution REST platform is out of scope. Browser CRUD continues through services/RLS rather than duplicate browser REST routes.

| Surface | Required change |
| --- | --- |
| `GET /api/cases/:id/context` | Include explicit type, selected SOP/version, exact task/step configuration references, and a context version/fingerprint. Preserve legacy response fields. |
| New `GET /api/contracts/:id/form-context` | Return authorized assigned SOP/version and launchable form steps. Validate requested provider/location against contract scope. Return Contract type and assignment context version. |
| `GET /api/portals` and existing mapping endpoints | Return type/capability metadata. Load maps by exact key. Return effective mapping fingerprint. Filter configurations requiring the new protocol from legacy registry responses. |
| `GET /api/providers/:id/profile` | Extend context input for contract/assignment and selected location; derive group/state from validated ownership. Keep case behavior and sensitive-data limits. |
| `POST /api/fill-events` | Accept explicit case-or-contract owner and exact SOP step/configuration/fingerprint; validate and persist through existing fill services. Test/ad hoc modes cannot cause workflow state changes. |
| `POST /api/cases/:id/touches` | For typed submission recording, validate exact task/step and matching fill context. Contract context is rejected. Preserve legacy behavior for legacy case work. |
| Existing capture/map mutation routes | Enforce exact target key, capability requirements, and captured target consistency; collision checks must apply server-side too. |
| Reset RPC through Panel services/hooks | Request configuration ID, expected generation, and idempotency key; derive scope/actor and return new generation, cleared active-field count, and reset receipt. A browser-only reset needs no duplicate REST endpoint. |
| Capture/map/proof APIs and shared-map reads | Return current generation and require it on supported writes. Reject stale capture uploads, old proof, and old learning evidence after reset. Notify the extension to discard/review affected drafts and cached plans; server checks remain authoritative if it is offline. |

Add a versioned handoff, for example `SET_ACTIVE_WORK`, rather than putting new required fields into the old parser that currently drops unknown fields. Required context:

```text
protocolVersion, ownerKind (case | contract), ownerId,
sopTemplateId, sopVersion, task/step reference,
portalKey, providerId, optional facilityId,
assignment/context version, launch receipt ID, portal URL
```

The server revalidates the tuple; the browser message does not grant access. The extension acknowledges capability and the exact selected context before Panel considers launch ready. Keep `SET_ACTIVE_CASE` for legacy work during rollout.

Unsupported extension versions receive an update-required message for new configurations. Server reads and mutations also enforce capability requirements so a hidden registry row cannot still be accessed through old profile/map paths. An old client must never fill a new scenario configuration based solely on URL. This is compatibility gating, not a replacement for authorization.

Errors distinguish no SOP/configuration, ambiguous selection, incompatible type, stale context/mappings, wrong owner/step, unsupported client, and missing data. Only missing form values permit partial fill; routing failures stop the fill.

## 7. Edge cases and acceptance tests

| Scenario | Expected result |
| --- | --- |
| Two Aetna configurations have the exact same URL | Train, Test, and Work retain the selected key on every page. No sibling fields or fixed answers appear. |
| Several SOPs match one type/payer/state/group | Explicit choice; no ordering-dependent write or generation. |
| SOP or configuration has wrong type/payer or is unavailable | Server rejects typed publish/launch; no cross-type fallback. |
| Legacy SOP/configuration has no type | Existing work remains accessible; new typed use requires classification. |
| Recredentialing selected | Explain execution is not configured in v1; do not overwrite Enrollment or bypass its uniqueness. |
| Contract exists without a provider; provider belongs to another group | Keep contract record; require an eligible provider for launch. Reject mismatched relationships. |
| Same configuration occurs twice in an SOP | Fill/submission receipt identifies one exact step, not both. |
| Provider, location, org, SOP, or tab changes during an API request | Cancel old results; require current context before writing values. |
| Two tabs share origin/URL | Bind the confirmed tab. Ambiguity never silently changes the target. |
| Mapping edited or organization override changed mid-form | Fingerprint changes; stop/reload/review before another fill. |
| Reset one of two same-URL configurations | Only the selected key's active setup/proof is cleared; sibling configuration and mappings remain unchanged. |
| Global configuration used by several SOPs is reset | Every reference sees it as requiring retraining; confirmation explains shared impact. Existing work records and payer-page values remain. |
| Reset while another client captures, maps, proves, learns, or fills | Stale writes/future fills fail generation checks. Completed pre-reset fill receipts remain historical; they cannot certify or repopulate the new generation. |
| Reset retried, fails midway, or races another reset | One atomic receipt/generation change, or no change. No partially cleared setup or double reset from a retry. |
| Old selector recaptured after reset; different old selector absent | Recaptured row has no inherited answer/transform/options; absent field remains inactive despite ordinary upsert uniqueness. |
| Old organization overrides or old learned evidence exist | They do not refill or auto-recreate the cleared setup. Review overrides explicitly against the new generation. |
| Empty reset configuration is verified or used in Work | Reject verification of an empty setup and production autofill until retraining is reviewed; allow Train/Test. |
| Reused selector on different pages | Use a supported distinguishing selector; otherwise mark manual and prevent destructive overwrite. Capture decides whether a future schema change is necessary. |
| Missing contracting contact | Partial fill plus specific missing-field warning; no contact substitution. |
| Contract not yet executed, but Enrollment SOP selected | No new wait gate and no automatic switch to Contract path. |
| Initial application includes first provider | Contract remains group-owned. Staff record individual outcome manually without an automatic duplicate submission. |
| Contract fill logged; Enrollment marked submitted | Only the explicit owner and step receive their permitted effects. Contract never changes provider status through legacy triggers. |
| Old extension encounters new configuration | Update required; no URL fallback through another API. |
| Same-group unauthorized actor or cross-org identifiers | Existing role rules and full owner relationships enforced; no profile/map data leak. |
| Attachment or conditional question cannot be automated | Visible manual instruction; no false full-workflow verification. |

Verification during implementation must include focused service/RPC tests for types/assignment/concurrency, extension tests for equal-URL precedence and stale context, API isolation/idempotency tests, and browser-to-extension integration for both owners. Add new resource routes to `scripts/verify-org-isolation.mjs` and `scripts/mock-api-server.mjs`. Exercise actual existing triggers to prove contract receipts do not advance a provider case. Test legacy behavior alongside the new flow.

Complete two reviewed Aetna Medical walkthroughs on the supported state/path before marking those configurations ready. Stop before real submission during testing. Mock success alone is insufficient; unsupported state/path coverage remains explicitly unverified.

## 8. Implementation sequence and rollout

1. **Reconcile existing work.** Start from integrated main, inventory deployed migrations and extension version, and reuse PRs #454/#461. Preserve unrelated local changes. Inventory references to the mixed Aetna configuration.
2. **Add type foundation.** Add metadata/draft/version support, type-aware SOP selection, server validation, and UI choices. Keep new typed execution behind a feature gate. Do not bulk relabel historical work.
3. **Make configuration selection and reset reliable.** Reuse separate portal keys; fix URL candidate handling across Train/Test/Work, protocol capability gating, exact-key maps/captures, effective mapping fingerprints, and stale-context cancellation. Add transactional reset, generation-aware reads/writes, and the scoped confirmation in this slice before retraining. Clean creation and reset share empty-setup UI, but create has no destructive side effects.
4. **Train both workflows independently.** Capture from empty configurations, document all observed differences and manual steps, inspect actual selector/page behavior, and verify needed group-contact sources. Escalate only demonstrated mapper limitations; do not presuppose a new storage system.
5. **Connect production launches.** Wire exact case task/step context, add the Matrix SOP assignment/launch, validate profile context and receipts, and keep contract tracking manual. Bind each typed SOP to its clean configuration.
6. **Verify and pilot.** Run regression/isolation checks and both complete walkthroughs. Enable new configurations only for capable extension clients; pilot the captured states before broader use.
7. **Retire new use of mixed mapping.** Once references are migrated deliberately and the clean paths are reviewed, stop offering the mixed mapping for new typed work. Retain historical references. Rollback disables new launch/config availability without deleting cases, contracts, assignments, or receipts.

### Table trace

- Read: SOP heads/versions/drafts, credential cases and stamped tasks, contracts, groups, provider/group/location associations, portals, portal field maps, current fill/proof records.
- Write: additive typed/reset-generation metadata, new contract SOP assignments and reset event receipts, existing mapping/capture/proof records under independent keys, existing fill sessions with new context fields, normal audit records.
- Existing operator actions continue writing contract status/history/notes and Enrollment case touches. This release adds no automatic cross-owner outcome writes.

### Likely implementation touchpoints

Panel: `src/lib/pickTemplate.ts`, SOP draft/template services and `TemplateWizard`, `ManualCaseModal`, `ReapplyCaseAction`, `ChangeCaseSopAction`, case stamping/generation services, `ContractDetailDrawer`, contracts service/hooks, portal registration/map editors, `src/server/extensionRoutes.ts`, API dispatch, and additive migrations/types.

Extension: `src/shared/portals.ts`, `src/shared/trainForms.ts`, `src/shared/handoff.ts`, `src/background/activeCase.ts`, worker profile/map/capture/fill handlers, and sidepanel Work/Train/Test selection.

Keep protected `src/lib/sopResolver.ts` unchanged by validating/stamping at its existing boundaries unless a separately identified implementation requirement proves that insufficient.

## 9. Completion criteria and remaining uncertainty

The first release is complete when staff can author typed SOPs, train independent same-URL configurations, reset and recapture one configuration without stale data returning, and launch the exact scenario from either an Enrollment case or the Contract Matrix, with correct data context, traceable fills, and no silent fallback. Existing manual status management remains usable.

Architecture confidence is supported by the existing per-key mapping model and merged SOP-selection groundwork. Full Aetna field coverage, conditional branches, attachment requirements, and state variation are not yet verified. Do not claim 95% end-to-end confidence until both complete captured paths pass the acceptance checks above. Those remaining observations may justify small targeted mapper changes; they do not justify building the deferred workflow platform now.

## MINT-43 frozen v1 field/API contract — proposed, not implemented

This is the cross-ticket naming contract; it records proposed behavior and does not claim these fields or messages exist in the current runtime. Database/API names use `snake_case` where applicable; the TypeScript extension handoff uses the exact `camelCase` names below.

| Concern | Frozen v1 name and invariant |
| --- | --- |
| Work purpose | `case_type` is `contract | enrollment | recredentialing`. Contract belongs to the Contract/Matrix owner; provider enrollment is the supported case workflow; recredentialing is authoring/filtering only in v1. It is separate from task `execution_type`, and does not change credential-case uniqueness. |
| Mapping invalidation | `mapping_generation` is a monotonic counter, initially 1, scoped to the portal configuration's owner scope and exact `portal_key`, never URL. Reset advances it; reads and writes reject stale generations. |
| Contract assignment concurrency | `context_version` versions the Matrix-owned Contract SOP assignment, which pins its contract, SOP head, and immutable `sop_version`. Replacement is transactional, checks the expected version, and is unavailable after recorded fill activity. |
| Exact work step | Case receipts bind `task_id` + stamped `step_id` from the case task; authored SOP steps have no ID today and the resolver stamps `step-${idx}`. Contract receipts bind `assignment_id` + immutable `sop_version` + zero-based `task_index` + `step_index`. A label or `portal_key` alone is not a step identity. |
| Same-URL capability | `requires_explicit_selection` is the boolean portal-configuration capability marker; legacy rows default false. New same-URL configurations require end-to-end explicit selection and must be unavailable to unsupported old clients. |
| Extension handoff | Keep legacy `SET_ACTIVE_CASE` unchanged. Add `SET_ACTIVE_WORK` with `protocolVersion: 2` and camelCase `ownerKind`, `ownerId`, `sopTemplateId`, `sopVersion`, `portalKey`, `providerId`, optional `facilityId`, `launchReceiptId`, and `portalUrl`. Case context carries `taskId` + `stepId`; Contract context carries `assignmentId` + `contextVersion` + zero-based `taskIndex` + `stepIndex`. The server revalidates the tuple; the message itself grants no authority. |

**Resolved reset authorization policy (2026-09-30):** The existing signed-in, non-restricted shared-edit authorization covers global reset, including bulk reset operations; no narrower platform capability is needed, and no multi-configuration bulk UI is required. Every reset still checks server-side authorization, exact configuration/owner scope, and expected `mapping_generation`, then commits atomically with an idempotent receipt and shared-impact confirmation. Preserve historic receipts/fields and organization overrides; prior overrides stay stored but inactive until reviewed. Adding an independent key leaves the old mixed setup untouched; resetting an existing key invalidates that key's active maps/proof and may interrupt autofill until recapture. This records policy only; it does not implement or execute a reset.
