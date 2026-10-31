# Verified Credentialing Knowledge Package

**Source boundary:** Minted Panel repository only. **Prepared:** 2026-10-01. **Classification:** internal handoff; no payer workflow is approved for unattended drafting or submission. This package is self-contained as an agent policy and source inventory, but the linked repository records remain the evidence for implementation claims. A repository design note, a code path, a test fixture, a registry flag, or a prior fill is not an authoritative payer instruction.

## Section 1: Executive Summary

The local agent may identify a case, find an approved payer × state × specialty/provider type × scenario record, compare the case's provider, group, location, and document evidence against an approved form map, and prepare a cited draft for specialist review. It must return a gap when any required dimension, form version, source, answer, destination, or approval is absent. It may never infer a payer rule from generic credentialing practice, a mock fill, a similarly named payer, a different state, an old application, or an unclassified SOP. It never signs, attests, submits, or contacts a payer.

**Current scope and finding.** The repository documents Panel's data model, SOP authoring, case status, form registry, PDF catalog, and fill mechanics. It contains no checked-in payer-issued form PDF, completed payer application, approved current payer operating SOP, or complete payer × state × specialty × scenario submission record. A [reviewed modeling appendix](../redesign/E1.7b-sop-worked-examples.md) summarizes two real PM-provided business SOPs dated 2026-07-12, but the originals are expressly retained off-repo; its redacted, partial steps and changed contract context cannot certify current payer requirements. The [payer onboarding runbook](../redesign/payer-onboarding-runbook.md) is a blank worksheet with worked examples, not a completed SOP. Aetna's two scenario-specific configurations are a [plan](scenario-specific-form-workflows-plan.md), not captured/approved payer procedures. BCBSKS has a documented live-form observation, not a verified full workflow ([form enhancement note](payer-form-enhancements-2026-09-29.md)). The [baseline handoff](case-types-v1-baseline-handoff.md) reports legacy Aetna configuration counts but expressly does not establish a scenario-safe path. **Verified production payer records in this package: zero.** The agent's safe present behavior is to identify context and gaps; it cannot produce a payer-form draft from this package alone.

**Human review.** A credentialing specialist owns scenario confirmation, source promotion, disclosure/attestation answers, conflicts, expired evidence, conditional form branches, and final draft review. The provider or legally authorized signer owns signatures and certifications. An authorized operator controls external communication and submission. The case owner stores receipts, payer reference, follow-up, and outcomes. These are role assignments for the proposed agent workflow, not claims that a particular payer accepts delegation or an electronic signature.

### Status and evidence contract

| Label | Meaning and permitted use |
|---|---|
| **VERIFIED FACT** | A current fact about this case or the Panel implementation, with an exact source and verification time. Implementation facts do not become payer requirements. |
| **CONFIGURATION DECISION** | A project-approved operating rule, cited to a decision document; it is not a statement about what a payer requires. |
| **PAYER-SPECIFIC REQUIREMENT** | A named payer, state, specialty/type, scenario, group/location status, form version, and authoritative payer/approved-SOP evidence reviewed by a named owner. None qualifies in this repository snapshot. |
| **UNKNOWN / GAP** | Missing, stale, conflicting, or insufficient evidence. Block the affected route or answer. |
| **PLACEHOLDER** | Example, mock value, blank worksheet, or test fixture. Never pass to a real form or prompt as a fact. |
| **REQUIRES HUMAN REVIEW** | Legal, clinical, compliance, licensure, sanctions, exclusion, ownership, malpractice, work history, disclosure, signature, certification, attestation, conflict, or low-confidence extraction decision. |

Item-level audit statuses in Section 5 are `VERIFIED`, `NEEDS VERIFICATION`, `OUTDATED`, `CONFLICTING`, `PLACEHOLDER`, `NOT APPLICABLE`, and `HUMAN DECISION REQUIRED`. `VERIFIED` there can mean a verified **Panel configuration rule**, never automatically a payer requirement.

### Source inventory and limits

Reviewed the repository's agent instructions; `docs/wiki` case, provider, group, payer, and data pages; `docs/redesign` payer onboarding and SOP specifications, including the reviewed worked-example appendix; `docs/ops` scenario, form, Aetna baseline, contract, and PDF notes; `CLARIFICATIONS_NEEDED.md`; `SCHEMA.md` and the table register; `src/types/index.ts`, document/readiness/form/field mapping services and utilities; and the checked-in migration and fixture inventory. `rg --files` found no checked-in `.pdf`, `.docx`, or `.xlsx` payer form/application in this repository. Hosted record counts quoted in a prior handoff are historical observations, not a fresh database audit. This review did not query live tenant data, open payer sites, inspect private Storage, or verify installed extension/deployment versions. No external source was used because the requested source boundary is Minted Panel.

## Section 2: Verified Credentialing Knowledge Base

### Retrieval and publication rule

Index records at the full tuple `(payer ID, state, specialty/provider type, scenario, group contract status, location status, effective interval, source version)`. An `All`-states SOP, a legacy specialty label, a payerless fallback, and a portal URL may help find candidates but are not payer authority. The [table register](../data-model/table-register.md) states that specialty is legacy/non-routing SOP metadata; current selection therefore cannot establish specialty-specific correctness. The [scenario plan](scenario-specific-form-workflows-plan.md) proposes explicit case-type routing but labels it future implementation. If a tuple is missing or several candidate SOPs tie, stop for a specialist's choice.

A record may become `VERIFIED` only after a credentialing specialist captures the payer's current source document or written response, records form title/version and its actual fields, confirms every applicable requirement and destination in the template below, records source date/page and verified-by identity, and approves that exact tuple. A portal's `verified` or `proven` flag, a successful mock run, and a prior submission alone do not satisfy this test. Expire a record on payer change, superseding form, changed URL/destination, contradictory response, or an owner-set review date; block it pending re-verification. Do not infer an arbitrary annual review interval.

### Current candidate inventory (excluded from production retrieval)

| Candidate | Known evidence | Missing context/requirement | Status |
|---|---|---|---|
| Aetna, North Carolina, unspecified specialty and scenario | The [runbook worked example](../redesign/payer-onboarding-runbook.md) lines 142–151 illustrates CAQH, portal and 14-day follow-up tasks. | It is expressly an example; no payer source, form, version, destination validation, specialty or group/location status. | `PLACEHOLDER` |
| UnitedHealthCare/Optum, Humana, BCBS of Kansas, BCBS KC, and Aetna; Kansas; group-specific but specialty/scenario not fully keyed | The [reviewed SOP modeling appendix](../redesign/E1.7b-sop-worked-examples.md) §§Example 1–2 summarizes dated, PM-provided Kansas business SOPs, including differing email/portal/roster paths and a BCBS KC location caveat. | Originals are off-repo, form versions and complete instructions are missing, the summary is dated, and Humana's contract was already described as terminated/reapplication in progress. The appendix itself notes mixed KS PT and NC nutrition content. | `NEEDS VERIFICATION` |
| Aetna Medical, Contract versus Enrollment | The [scenario plan](scenario-specific-form-workflows-plan.md) §§1–4 approves separate configurations and human submission as product intent; [Aetna baseline](case-types-v1-baseline-handoff.md) §Existing source seams counts a mixed legacy key. | Supported state/path, full form fields, attachment/signature rules, and accepted destination are not captured; typed routing and clean configurations are proposed. | `GAP` |
| BCBSKS network enrollment page | The [2026-09-29 form note](payer-form-enhancements-2026-09-29.md) records a URL, a taxonomy control observation, and a datepicker behavior on a blank form. | Specialty, scenario, form revision, documents, all fields, signature, payer acceptance, submission method/receipt, and follow-up. The note says no enrollment was submitted. | `GAP` |
| Other configured payer/portal/PDF rows | Panel supports stored SOPs, portal maps, and immutable `payer_forms` versions ([table register](../data-model/table-register.md), rows `sop_templates`, `portal_field_maps`, `payer_forms`). | Live record inventory, evidence provenance and completeness were not available within this source boundary. | `NEEDS VERIFICATION` |

There is no honest way to enumerate one production record per combination without the live approved SOP/form inventory and payer evidence. The verification queue specifies the exact export/review needed. Until then, the agent must return `NO VERIFIED WORKFLOW RECORD` for every combination.

### Canonical record template (mandatory before activation)

```text
Record ID: [immutable ID; absent = GAP]
Payer: [canonical payer ID and name]
State: [two-letter code; never inferred from address]
Specialty / Provider Type: [exact validated value]
Scenario: [one of the ten scenario codes in Section 6]
Group Contract Status: [source and as-of date]
Location Status: [source and as-of date]
Effective Date: [payer instruction effective date]
Last Verified Date: [actual specialist review date]
Verification Owner: [named role/person]

Required Forms:
- Form name: [exact title or explicit none per payer evidence]
- Version/date: [exact revision/publication date]
- Storage location or URL: [stable approved source]
- Purpose: [case-specific purpose]
- Required fields requiring human review: [exact labels/pages]

Required Attachments:
- Document: [exact document]
- Acceptable version/date: [payer rule or GAP]
- Expiration rule: [payer rule or GAP]
- Source of truth: [approved case document/version]

Submission Instructions:
- Method: [confirmed portal/email/fax/mail/other]
- Portal URL / email / fax / mailing address: [exact verified endpoint]
- Recipient or destination: [exact]
- Naming convention: [payer rule or explicitly none]
- Submission timing requirement: [payer rule or GAP]
- Submission confirmation required: [exact receipt]
- Submission evidence to store: [receipt, timestamp, form/version, actor]

Follow-Up:
- First follow-up timing: [payer/approved SOP rule]
- Subsequent cadence: [payer/approved SOP rule]
- Escalation contact/process: [exact path]
- Payer reference number field: [exact field/response]
- Expected payer status outcomes: [payer-defined status meanings]

Exceptions:
- Known payer-specific exceptions: [evidenced list or none confirmed]
- Common return reasons: [evidenced list or unknown]
- Human-review triggers: [exact branch/attestation/uncertainty]

Evidence:
- Source: [payer document or approved SOP identifier]
- Source owner / authoritative origin: [payer department, approved internal SOP owner, or other named authority]
- Source date: [date]
- Page/section: [specific reference]
- Verified by: [person/role and date]
- Notes: [conflict resolution; source hierarchy]

Status: VERIFIED / NEEDS VERIFICATION / OUTDATED / GAP
```

## Section 3: Canonical Data Dictionary

This is the **agent's required target dictionary**, not a claim that every field is already stored in Panel. `P` = existing Provider/profile/child/document record; `G` = existing group/contract/network/document record; `L` = existing facility/assignment record; `C` = existing case/task/touch record; `D` = immutable document/PDF version; `H` = new human-supplied verified record required; `S` = approved tuple-specific SOP/form source. `R` means required for identity/routing or always for an output; `C` means conditional on the verified form; `O` means optional case metadata. `Y` under Fill means candidate autofill **only after exact form-map approval, current evidence, and a human-reviewed draft**; `N` means never. `Prompt` is `M` metadata/minimized, `A` allowed value only in an authorized case-scoped fill context with a need for that exact field, `N` never include in a general LLM prompt. An `A` value is not permission to transmit to an outside model. All source rows need record ID, origin document, collected/verified timestamps, reviewer, and conflict history; the current Panel model does not uniformly provide this provenance.

**Priority used by the agent:** current signed/primary-source evidence reviewed for this specific fact → current specialist-verified canonical field with linked source → corroborated payer-issued/case artifact → extracted text for review only. A newer OCR extraction never overwrites verified data. Existing data without field provenance is `NEEDS VERIFICATION`. For licensure, `state_licenses` is primary over `providers.license_*` mirrors; for group membership, `provider_group_assignments` is primary over `providers.group_id`; for case locations, `case_facilities` is primary over `credential_cases.facility_id` ([table register](../data-model/table-register.md), rows cited). The payer form's baked version is primary over a newly current catalog version for an existing case ([payer form service](../../src/services/payerForms.ts)). A `provider_field_verifications` stamp records who/when/method; it does not identify the underlying document and does not, by itself, prove a payer rule ([service](../../src/services/fieldVerifications.ts)).

In the tables, `recheck` means on source change, before each draft, and at an explicit expiry if present; `current` means the document must be unexpired on the draft date; `payer` means follow an approved tuple-specific expiry rule, otherwise gap. `review` means specialist, plus the person legally responsible when an attestation or signature applies. Validation rules are target rules for the agent; where Panel lacks enforcement, the field remains a gap until a source is verified.

### Provider Profile

| Field (definition) | Type; need; validation | Priority | Fill; review | Refresh; sensitive; prompt | Panel status |
|---|---|---|---|---|---|
| `legal_name` (current legal first/middle/last/suffix) | text parts; R; exact source spelling | P identity document → verified P | Y; review conflicts | recheck; yes; A | Parts exist; legal-name evidence unverified |
| `name_history` (other legal names and dates) | list; C; exact documented periods | H source → verified H | N until reviewed; yes | recheck; yes; A | GAP |
| `date_of_birth` (DOB) | date; C; valid calendar date | P identity evidence → verified P | Y only if form asks; yes | recheck; high; A | P exists |
| `npi_type_1` (individual NPI) | 10-digit ID; C; source-verified Type 1 | NPI evidence → verified P `npi` | Y; review mismatch | recheck; yes; A | P stores `npi`; type not encoded in field |
| `caqh_id` (CAQH identifier) | text; C; exact ID | CAQH evidence → verified P | Y; review | recheck; yes; A | P exists |
| `caqh_attestation_date` (last attested) | date; C; date supported by CAQH | CAQH record → P | Y; review age | payer; yes; A | P exists; 120-day Panel readiness is a project rule, not payer requirement |
| `specialty` / `sub_specialty` (clinical classification) | text; R for routing; verified vocabulary | credential/source → P | Y; specialist | recheck; yes; A | P exists; SOP routing does not use specialty |
| `taxonomy_code` (provider taxonomy) | code; C; exact source/code | taxonomy evidence → P | Y; review | recheck; yes; A | P exists |
| `state_licenses[]` (number, state, type, issue/expiry, PSV) | child rows; C; state match, current, verified status | state board/PSV → `state_licenses` → P mirror | Y only after PSV review | current; high; A | Child and mirror exist |
| `dea_cds[]` (DEA/CDS number, state, dates) | child evidence; C; applicable scope/expiry | registration document → P DEA fields; CDS H | Y only when applicable; review | current; high; A | DEA fields exist; CDS model GAP |
| `education_training[]` (schools, degrees, training dates) | list; C; no inferred date | diploma/training evidence → P degree/school/graduation → H | Y only verified elements; review | recheck; yes; A | P basic fields; full history GAP |
| `work_history[]` (employers, roles, dates, gaps) | list; C; complete exact periods | signed current CV/employer proof → H | N until reviewed; yes | payer; high; A | Structured history GAP |
| `board_certification[]` (board, status, dates) | list; C; source/current | board proof/D → P boolean | Y only documented specifics; review | current; yes; A | Boolean and document kind exist; details GAP |
| `medicare_medicaid_ids[]` (program IDs by payer/state) | keyed list; C; no cross-payer reuse | payer-issued evidence → network/case ID → H | Y after context check; review | recheck; high; A | P `medicaidAttested`; payer IDs exist elsewhere; complete keyed registry GAP |
| `malpractice_coverage` (carrier, policy, period, limits) | record; C; period/limits evidenced | current COI/D → P malpractice fields → H limits | Y only documented values; review | current; high; A | P basic fields; limits/structured policy GAP |
| `sanctions_exclusions_discipline` (questions and answers) | dated disclosures; C; exact question/period | current provider attestation and specialist review → H | N; required human | each application; high; N | GAP; never default No |
| `contact_email_phone_address` (provider contact) | text/address; C; exact recipient/purpose | verified P/source | Y; review | recheck; yes; A | P exists |
| `cv_document_version_date` (current CV lineage) | D ID/date; C; current exact version | D current family → verified CV | N as answer until reviewed; yes | payer; high; M | D kind exists; CV contents not parsed canonically |
| `document_expiration_dates` (per required credential) | map; C; valid dates | D and state license/DEA source | N as inferred value; review | current; yes; M | D metadata exists |
| `signature_attestation_authorization` (signed answer/authority) | signed evidence; C | person legally responsible → H | N; required human | each application; high; N | No agent authority |

### Organization / Group Profile

| Field (definition) | Type; need; validation | Priority | Fill; review | Refresh; sensitive; prompt | Panel status |
|---|---|---|---|---|---|
| `legal_entity_name` (registered billing entity) | text; R; exact legal name | formation/IRS proof → verified G `name` | Y; review | recheck; yes; A | G name exists; legal status not proven |
| `dba_names[]` (doing-business-as names) | list; C; source verified | entity filing → H | Y after review | recheck; yes; A | GAP |
| `tax_id_ein` (group TIN/EIN) | ID; C; exact nine digits and entity match | CP 575/current W-9 D → G `tin` | Y; review | recheck; high; A | G exists; document kinds exist |
| `npi_type_2` (organization NPI) | 10-digit ID; C; Type 2 confirmed | NPI evidence → G `npiType2` | Y; review | recheck; yes; A | G exists |
| `taxonomy` (group taxonomy) | code/list; C; exact entity/location context | authoritative enrollment evidence → H | Y after review | recheck; yes; A | GAP in group interface |
| `w9_family_version_signed_date` (current signed W-9) | D ref/date; C; signed date valid/nonfuture | current D `w9` | N as a form answer; review | payer; high; M | D kind/version/date exists; payer acceptability GAP |
| `owners_controlling_interests[]` (reportable persons/percentages) | structured list; C; exact disclosure threshold | current signed ownership evidence → H | N; required human | each application; high; N | GAP |
| `billing_contact_address` (billing channel) | purpose-keyed G fields; C; complete required parts | verified G billing block | Y; review | recheck; yes; A | Exists |
| `credentialing_contact_address` (credentialing channel) | purpose-keyed G fields; C | verified G credentialing block | Y; review | recheck; yes; A | Exists |
| `correspondence_contact_address` (mail channel) | purpose-keyed G fields; C | verified G correspondence block | Y; review | recheck; yes; A | Exists |
| `eft_payment_details` (bank/ACH) | secured record; C; exact signed authority | signed banking proof → H | N; required human | each request; high; N | Voided-check kind exists; no general LLM banking payload |
| `payer_contract_status` (group × payer × state status) | keyed record/date; R for scenario | G `contracts` + actual agreement/payer proof | N as payer assertion; specialist | recheck; yes; M | Contract row exists; status alone may not prove effective participation |
| `payer_group_ids[]` (payer-issued group IDs) | keyed by group/payer/state; C | payer-issued proof → `payer_network_targets` or case ID | Y after exact context review | recheck; high; A | Contextual ID support exists |
| `contract_effective_date` (payer-confirmed date) | date; C; written payer confirmation | agreement/confirmation → G contract | Y after review | recheck; yes; A | Date field exists |

### Location Profile

| Field (definition) | Type; need; validation | Priority | Fill; review | Refresh; sensitive; prompt | Panel status |
|---|---|---|---|---|---|
| `service_location_name` (site name) | text; R; match case site | verified L `name` | Y; review | recheck; yes; A | Exists |
| `physical_address` (actual service site) | address; R; complete, state matches scenario | verified L street/suite/city/state/ZIP | Y; review | recheck; yes; A | Exists |
| `billing_address` (address for billing) | address; C; explicit purpose | verified G billing block or H site-specific billing source | Y after choice; review | recheck; yes; A | No independent location billing block |
| `mailing_address` (correspondence destination) | address; C; explicit purpose | verified G correspondence block or H site-specific source | Y after choice; review | recheck; yes; A | No independent location mail block |
| `phone_fax` (site contact) | text; C; no group substitution without approval | verified L phone/fax | Y; review | recheck; yes; A | Exists |
| `location_npi_type_2_id` (site-linked organization NPI/ID) | ID; C; prove entity/location association | NPI/payer evidence → H; G Type 2 only if verified same | Y after review | recheck; high; A | Dedicated site NPI GAP |
| `location_taxonomy` (site taxonomy) | code; C; site scope confirmed | source → H | Y after review | recheck; yes; A | GAP |
| `hours` (per-day operating hours) | structured schedule; C; exact days/times | verified L `hours` | Y; review | recheck; yes; A | Exists |
| `accessibility` (ADA/access details) | structured flag/notes; C; source confirmed | verified L `adaCompliance` | Y; review if asked | recheck; yes; A | Exists; does not prove payer-specific accessibility answer |
| `effective_date` (site operating start) | date; C; actual/target distinguished | verified L `effectiveDate` and status | Y after review | recheck; yes; A | Exists |
| `associated_group` (billing entity for site) | G ID; R; active membership | L `groupId` → G assignment | N as free text; review | recheck; yes; M | Exists |
| `associated_providers[]` (who practices there) | joins; C; active/date-valid | `provider_facility_assignments` | N until exact selection; review | recheck; yes; M | Exists |
| `payer_participation_by_location` (payer/state/site status) | keyed record; R when scenario depends on it | payer confirmation/approved H, corroborated by C and contracts | N until proof; specialist | recheck; yes; M | No universal location participation proof in L; GAP |

### Document

| Field (definition) | Type; need; validation | Priority | Fill; review | Refresh; sensitive; prompt | Panel status |
|---|---|---|---|---|---|
| `document_id_family_version` (immutable lineage) | IDs/int; R; one current family version | D metadata | N; review supersession | recheck; yes; M | `provider_documents` and `payer_forms` versioning exist |
| `owner_type_owner_id` (provider/group owner) | enum/ID; R; match case | D metadata + case identity | N; review | recheck; yes; M | Exists for provider/group; site-only owner GAP |
| `kind_title` (document classification/exact title) | enum/text; R; payer-required title separately verified | D metadata + S | N; review | recheck; yes; M | Governed kinds include license, DEA, COI, W-9, CV, board cert, etc. |
| `source_file_path_hash` (actual immutable artifact) | private ref/hash; R; retrievable, hash desired | D Storage path → H hash | N; review | recheck; high; N | Private path exists; hash not in interface |
| `issue_effective_signed_date` (document dates) | dates; C; valid/nonfuture when signed | artifact → D dates | Y only for verified mapped question; review | recheck; yes; A | Effective date exists |
| `expiration_date` (credential expiry) | date; C; current | artifact → D expiry | Y if form asks; review | current; yes; A | Required at upload for license/DEA/COI; payer freshness still GAP |
| `origin_verified_by_at` (provenance) | source/actor/timestamp; R | approved H evidence record | N; required human | recheck; yes; M | Incomplete across existing D records |
| `payer_acceptability` (tuple-specific accepted version) | S rule; R before attachment | payer source → approved S | N; specialist | payer; yes; M | GAP |

Panel's document expiration windows (90 days license, 60 DEA, 30 COI) are **UI warning thresholds**, not payer rules ([document metadata](../../src/lib/documents.ts)). The 120-day CAQH window is a Panel readiness/configuration decision ([readiness code](../../src/lib/enrollmentReadiness.ts)); do not call it a payer deadline.

### Credentialing Case

| Field (definition) | Type; need; validation | Priority | Fill; review | Refresh; sensitive; prompt | Panel status |
|---|---|---|---|---|---|
| `case_id_number` (immutable work identifier) | ID/int; R; resolve exact case | C | N; review | recheck; yes; M | Exists |
| `payer_state_specialty_provider_type` (routing tuple) | IDs/text; R; all four explicit | case C + provider P + approved S | N until specialist confirms | each case; yes; M | Case has payer/state/specialty; type routing GAP |
| `scenario_group_location_status` (work purpose and status) | enum/dated facts; R | approved case decision + G/L proof | N; specialist | each case; yes; M | Scenario type and location-specific payer status GAP |
| `provider_group_locations` (exact subjects) | IDs/list; R; active joins | C + group/assignment + `case_facilities` | N; review | each case; yes; M | Exists; primary facility mirror is not full set |
| `sop_id_version` (approved procedure snapshot) | IDs/version; R; tuple eligible | published S + stamped C task | N; specialist | on source revision; yes; M | Stamp/version support exists; approved payer content unverified |
| `form_ids_versions` (exact blank forms) | D IDs/version; R if forms required | approved S → baked `payer_forms` version | N; specialist | on form change; yes; M | PDF catalog exists; actual live inventory unknown |
| `required_documents` (attachment checklist) | typed list; R per S | approved S + current D | N; specialist | current; yes; M | SOP step kinds supported; actual payer checklist unknown |
| `destination_method` (where/how to submit) | S endpoint/method; R | current payer evidence → S | N; specialist | before submission; yes; N | No verified destination in this package |
| `submission_status_date_evidence` (what happened) | enum/date/D; R after action | actual receipt/touch C | N; operator | on action; yes; M | Case status, touches, evidence available |
| `payer_reference_number` (payer tracking ID) | text; C; copied exactly from response | payer receipt → C `payerReferenceId` | N; review | on payer response; yes; A | Exists; latest wins, history in touch/audit |
| `follow_up_cadence_owner` (approved schedule and assignee) | interval/person; R after submission | approved S + C assignment/touch | N; specialist | each action; yes; M | Touch next date exists; payer cadence GAP |
| `human_approval_status` (review/signoff) | actor/time/scope; R before release | signed approval H + audit | N; required human | per draft/revision; yes; M | Case audit exists; explicit agent-draft approval record GAP |
| `exceptions_unresolved_questions` (blocking issues) | list/status; R when present | case notes + H decision trail | N; specialist | each change; yes; M | Notes/tasks exist; standardized gap ledger proposed here |

## Section 4: Form Mapping Library

**Approved forms and field maps for agent drafting: none.** Panel stores blank PDF versions in `payer_forms` and captured field rows in `portal_field_maps`; neither registry proves that a payer form is current, complete, or applicable to the case tuple. No checked-in live form supplies exact field labels/pages and a reviewed mapping. Do not promote the legacy `aetna_direct` 80 rows or BCBSKS observed fields to this library. [Payer PDF types](../../src/types/index.ts), [field registry classifier](../../src/lib/fieldRegistry.ts), and [fill planner](../../src/lib/payerFormFill.ts) describe mechanics only.

An approved mapping row must contain **all**: record ID; payer/state/specialty/scenario; group/location status branch; form family and immutable version/title/date/file reference; page and exact field label/selector; canonical field and record type (`Provider`, `Group`, `Location`, `Case`, `Manual Input`); accepted format/allowed values; required/optional and conditional branch; source priority and provenance; whether any derived transform is allowed; human review and signature/attestation flags; missing/conflict/expired/low-confidence behavior; reviewer/date; observed form revision and last recheck. A `portal_key` scopes captured selectors, but a URL or key alone cannot establish scenario applicability ([scenario plan](scenario-specific-form-workflows-plan.md) §3). PDF rows use `payer-form:<family_id>` as the technical mapping key; an existing case uses its baked form version, not an automatically substituted current version ([table register](../data-model/table-register.md), `portal_field_maps`/`payer_forms`).

| Existing map state | New-agent interpretation |
|---|---|
| `proposed` or invalid | Unverified field; do not fill. |
| `approved + token` | Technical fill candidate; still require current canonical value, source citation, tuple-specific map approval, and review. Empty token is `NEEDS HUMAN INPUT`. |
| `approved + hardcoded` | A fixed literal can technically fill; do not treat it as a payer-approved answer without source and branch validation. |
| `approved + manual` | Deliberately human-entered; never count as an automatable answer. |
| `retired`/stale | Excluded; re-capture and re-review before reuse. |

For each proposed answer, emit `{case_id, tuple_record_id, form_version_id, page, exact_label, canonical_field, source_record_id, source_document_id, source_verified_at, proposed_value_or_redacted_reference, transform, map_review_id, reviewer_required, warnings}`. Keep sensitive values out of logs and generic prompts. Never infer a legal/disclosure `No`, fill a signature/attestation, invent a date, use an old answer as sole source, or overwrite verified data with OCR. If any required answer lacks complete provenance, leave the field blank and return `NEEDS HUMAN INPUT`. A saved fill plan or setter attempt is not evidence the form retained the value; semantic readback and human acceptance are separate ([PDF/portal refresh note](portal-pdf-filler-refresh.md) §Honest outcomes). No automatic submission.

## Section 5: Generic Content Replaced or Retired

The following is a source-linked log of the generic or misleading **credentialing claims and examples identified** in the reviewed operational surfaces. It records the unsafe content rather than deleting or silently correcting source files. The agent must apply the replacement rule in this package even if an old UI/wiki page remains visible. A repository-wide exhaustive assertion about every historical note is not possible from the available materials; any later discovered generic statement joins this log before promotion.

| Original Generic Statement | Why It Is Unsafe or Incomplete | Replacement Verified Information | Evidence | Status |
|---|---|---|---|---|
| “Portal payer (Aetna NC)” example: prepare CAQH, submit in Aetna portal, follow up after 14 days | Worked example lacks form/version, provider type, group/location status, payer source, and destination confirmation. | Treat as authoring illustration only. Obtain Aetna NC scenario SOP and current payer source. | [Runbook](../redesign/payer-onboarding-runbook.md) lines 142–147 | PLACEHOLDER |
| “Paper payer (small Medicaid MCO)” with mail, fax W-9/roster, five-day turnaround | No named payer/state/specialty or destination. | No route/attachments/cadence until a named tuple is verified. | [Runbook](../redesign/payer-onboarding-runbook.md) lines 148–151 | PLACEHOLDER |
| “Email payer” enrollment request | No named payer, email, form, or authorization. | No generated email or send. Verify endpoint and approved template. | [Runbook](../redesign/payer-onboarding-runbook.md) lines 152–154 | PLACEHOLDER |
| “Stale-case nudge threshold (default 14 days)” | Product queue default is not payer response/follow-up requirement. | Use only as a Panel reminder if configured; payer cadence must come from approved S. | [Runbook](../redesign/payer-onboarding-runbook.md) line 35 | NEEDS VERIFICATION |
| Payer catalog `states` or ranking CSV as evidence a payer credentials a specialty in that state | The historical dataset says states can mean top-ten market ranking, not all operating states; its sync retired in July 2026. | Use catalog only for identity discovery; confirm product, network and geographic applicability from current payer evidence. | [Catalog README](../redesign/data/payer-catalog/README.md) §§Frozen, Mapping | OUTDATED |
| Seed universe, staging UAT cases or synthetic form dry run as completed provider examples | Fixtures deliberately use synthetic identities and are prohibited from production seeding. | Do not copy any fixture provider, group, case, answer or contact into a real draft. | [Seed universe](../redesign/seed-universe.md) §§Status, fixture rules; [UAT data](staging-uat-data.md) lines 1–8 | PLACEHOLDER |
| “Payer-issued ID label(s) (e.g. Aetna ‘Provider PIN’)” | Example label is not evidence that this payer/line uses that identifier. | Read current payer-specific configured label and actual payer-issued proof; otherwise GAP. | [Runbook](../redesign/payer-onboarding-runbook.md) line 31 | PLACEHOLDER |
| “CAQH ID, 10-year work history, malpractice coverage amounts” as examples of required attributes | No named payer rule, time period, or limits. | Configure only from verified form/SOP; work-history structure and limits are gaps. | [Runbook](../redesign/payer-onboarding-runbook.md) lines 96–105 | NEEDS VERIFICATION |
| Kansas per-payer SOP summary (Optum email and attachments, Humana roster/W-9, BCBSKS/BCBS KC/Aetna portals) | The appendix summarizes real but off-repo July 2026 business documents and is missing source pages, current payer confirmation, exact forms/versions, destinations and scenario keys. Humana contract context was changing. | Use as a lead for source collection, never as a live routing/submission instruction. Re-open original SOPs and verify each payer × state × specialty × scenario with the specialist and payer. | [Worked examples](../redesign/E1.7b-sop-worked-examples.md) lines 18–64 | NEEDS VERIFICATION |
| BCBS KC applies to Kansas City locations only | An important group/site caveat in the dated SOP summary; current selector cannot encode sub-state geography. | Explicit specialist gate on actual site geography and current BCBS KC source before any launch. | [Worked examples](../redesign/E1.7b-sop-worked-examples.md) lines 39–63 | NEEDS VERIFICATION |
| General Fitness Physio enrollment checklist points to payer steps | It mixes onboarding, KS PT and NC nutrition/group content and has no standalone payer-specific authority. | Treat as internal checklist only; split by group/state/payer and verify each source. Never let its payerless fallback authorize a form. | [Worked examples](../redesign/E1.7b-sop-worked-examples.md) lines 68–109 | CONFLICTING |
| “Commercial and Medicare Advantage applications run in parallel; once Medicare is approved the MA contract follows automatically” | A historical PM product-scope decision is phrased as an outcome that may depend on payer and contract. | Keep prerequisite logic out of the agent unless a current tuple-specific source confirms it; never infer MA contract approval. | [Clarifications](../../CLARIFICATIONS_NEEDED.md) lines 672–682 | NEEDS VERIFICATION |
| “Match key … specialty = ____” suggests specialty selection | SOP runtime does not route by specialty. | Agent requires explicit specialty validation independent of current SOP selection. | [Runbook](../redesign/payer-onboarding-runbook.md) line 69; [table register](../data-model/table-register.md) `sop_templates` row | CONFLICTING |
| Generic payerless fallback SOP | It can resolve as a checklist without payer-specific content. | Never use fallback as payer requirement or as grounds to draft/submit. | [Table register](../data-model/table-register.md) `sop_templates` row; [payer setup wiki](../wiki/payer-setup.md) | NEEDS VERIFICATION |
| “Ready” SOP/form coverage or `verified`/`proven` flags | These represent configured content/technical proof, not payer acceptance or exact scenario validation. | Require record promotion and full form review before payer-specific use. | [Payer setup wiki](../wiki/payer-setup.md); [Aetna baseline](case-types-v1-baseline-handoff.md) §§Environment, Proof | NEEDS VERIFICATION |
| Aetna legacy `aetna_direct` map (80 global rows) | Mixed Contract/Enrollment mapping; scenario and state coverage unproven. | Quarantine for existing history; separately capture/review each exact scenario and state. | [Aetna baseline](case-types-v1-baseline-handoff.md) §§Environment, Existing source seams; [scenario plan](scenario-specific-form-workflows-plan.md) §§1,4 | CONFLICTING |
| “Staff usually wait for a contract” | Descriptive practice; plan expressly adds no waiting requirement. | Human resolves early-enrollment decision against actual payer/group facts. | [Scenario plan](scenario-specific-form-workflows-plan.md) §Confirmed requirements | HUMAN DECISION REQUIRED |
| “Capture both Aetna workflows” | Approved project intent but not evidence they have been captured or accepted. | Keep both as planned configurations; no production map until complete review. | [Scenario plan](scenario-specific-form-workflows-plan.md) §§1,6 | NEEDS VERIFICATION |
| BCBSKS form URL and observed date/taxonomy behavior | Live technical observation on blank form does not prove every field, attachment or accepted submission. | Use only to investigate mapping; specialist verifies full workflow and payer receipt. | [Payer form note](payer-form-enhancements-2026-09-29.md) lines 11–17, 27–30 | NEEDS VERIFICATION |
| Mock `Sample Provider`, fabricated NPI/CAQH/date and heuristic defaults | Synthetic dry-run values; deliberately always nonempty. | Prohibit all mock/fixture values in real case answers and production prompts. | [Mock profile](../../src/lib/mockFillProfile.ts) lines 1–75 | PLACEHOLDER |
| Approved `hardcoded` map value | Approval in technical registry does not cite payer rule or conditional branch. | Require specific source, version and review before any fixed answer is used. | [Field registry](../../src/lib/fieldRegistry.ts) lines 87–101; [fill planner](../../src/lib/payerFormFill.ts) lines 211–217 | NEEDS VERIFICATION |
| `provider.license_*` or `providers.group_id` used as canonical | Both are mirrors; a stale mirror can conflict with child records. | Use `state_licenses` and `provider_group_assignments`, then review mismatches. | [Table register](../data-model/table-register.md) rows `providers`, `state_licenses`, `provider_group_assignments` | OUTDATED |
| Case primary `facility_id` as all locations | Multi-location cases have a join table. | Use `case_facilities` complete set; review location-specific participation. | [Table register](../data-model/table-register.md) rows `credential_cases`, `case_facilities` | OUTDATED |
| First selected facility is the provider's “primary” | The app's first-facility rule is a data-entry convention, not payer confirmation that this is the correct site for a specific form. | Confirm the actual practice/site relationship and payer-requested primary site for this case. | [Provider wiki](../wiki/providers.md) §Add provider | HUMAN DECISION REQUIRED |
| Group Payer Network “Active” pill means group contract/site participation | The pill is derived from at least one approved case or migrated enrollment fact, not a current signed contract or all-site approval. | Validate group × payer × state contract and each relevant site's participation from payer evidence. | [Group wiki](../wiki/groups.md) §§Payer Network, Enrollment facts | NEEDS VERIFICATION |
| 120-day CAQH “current” and 90/60/30-day document warnings | Panel readiness/UI thresholds, not verified payer expiration rules. | Retain as internal configuration decisions only; obtain payer-specific acceptability. | [Readiness](../../src/lib/enrollmentReadiness.ts) line 23; [documents](../../src/lib/documents.ts) lines 59–82 | NOT APPLICABLE |
| “A PDF/portal fill succeeded” based on count, save, or preview | Attempt may be reverted or rejected; prior note calls live acceptance unverified. | Separate attempted, semantic-readback verified, human-reviewed, submitted, and payer-accepted states. | [Refresh plan](portal-pdf-filler-refresh.md) lines 24–34, 105–107 | OUTDATED |
| Prior form answer used for sanctions, ownership, malpractice, or attestation | Stale answer cannot establish current disclosure truth. | Direct current human response and source review; never default `No`. | Agent policy in this package; absence of structured verified fields in [Provider type](../../src/types/index.ts) | HUMAN DECISION REQUIRED |

## Section 6: Open Gaps and Verification Queue

### Scenario decision logic

Scenario codes are an **agent classification policy**. They do not claim Panel already implements all ten flows. First confirm payer, state, specialty/type, provider, group and all applicable sites; distinguish contract status from provider status; then choose exactly one code. If more than one business purpose is present, create separate reviewed work items and do not reuse a form map. Every row below inherits these gates: `forms`, `attachments`, `completion`, `delivery`, `first/subsequent follow-up`, and `escalation` come solely from an approved tuple-specific record; if absent, **do not route or submit**. A specialist approves every draft and signs off all exceptional/legal answers; actual signer approves attestations/signatures. The case owner records an immutable source/draft/review/action trail. No universal payer cadence or delivery rule exists.

| Code / entry criteria | Exclusions and required case evidence | Form/completion/approval/delivery rule | Tracking, exit, escalation |
|---|---|---|---|
| `S1` New provider, existing contracted group, existing state/site | Exclude unconfirmed group contract, new site, new payer, or recred. Need active provider↔group/site joins, contract proof, specialty, license and current docs. | Approved `S1` SOP/form only; human reviews conditional answers and sends via verified channel. | Case status and actual receipt/reference; exit only on payer-confirmed outcome. Escalate missing proof, returned application, or missed SOP date. |
| `S2` Provider added to existing group at new site | Exclude site already participating or group contract unconfirmed. Need site identity, group/site relationship, site participation evidence. | Approved `S2` rule must state whether provider, site, or both submissions are required; no reuse of `S1` by assumption. | Track both site and provider outcomes when distinct; escalate ambiguity or partial approval. |
| `S3` New site for already contracted group | Exclude provider-only addition. Need group contract and new-site data, associated providers where payer asks. | Approved `S3` location form/attachments/destination only. | Record site confirmation separately; exit when payer confirms site status; escalate missing site acknowledgment. |
| `S4` New group contract in new state | Exclude active group contract in state. Need entity/TIN/NPI, state, specialty, first provider if approved process requires, sites, signatory. | Contract is group-owned in Panel's [scenario plan](scenario-specific-form-workflows-plan.md); actual payer form/authority still GAP. | Matrix contract status, receipt and signed agreement; do not infer provider approval. Escalate contract/credentialing split or missing signatory. |
| `S5` New group contract with not-currently-contracted payer | Exclude existing same group/payer/state contract. Need payer identity, group and site, line of business, contract status proof. | Exact Contract SOP; do not switch to enrollment from URL or generic template. | Matrix outcome; provider cases only on verified separate instruction. Escalate duplicate/overlap or missing payer source. |
| `S6` Individual credentialing/enrollment | Exclude group-owned contract work. Need proof that individual path applies and payer-specific entity association. | Separate `S6` record, never assume group contract prerequisite. | Individual case and payer-issued reference/outcome; escalate uncertain participation. |
| `S7` Recredentialing | Exclude first enrollment and demographic update. Need payer notice/deadline, prior approval, current disclosures/documents. | The [scenario plan](scenario-specific-form-workflows-plan.md) reserves Recredentialing type but does not implement recurring cases; no automatic recred form. | Track human-owned deadline and payer response; escalate before payer deadline or if no notice/source. |
| `S8` Demographic update | Exclude a credentialing/contract application. Need exact changed field, old/new source and effective date, impacted payer/site scope. | Use payer's change channel and specific form only after verification; protect prior verified data. | Store confirmation and effective change; escalate conflicting payer records. |
| `S9` Provider termination | Exclude mere site transfer or status correction. Need authorized termination decision, date, affected group/payer/sites. | Human-approved payer termination path; no inferred effective date or external notice. | Record receipt and payer confirmation; escalate unresolved coverage/effective-date conflict. |
| `S10` Corrective resubmission | Requires actual return/denial/RFI and original case/receipt. Do not create a fresh initial application by default. Need exact payer request, due date, changed evidence. | Only requested corrections through the payer's confirmed return path; re-review all affected attestations. | Append receipt and version history to original case; exit on payer acceptance or confirmed final outcome. Escalate unclear RFI or deadline. |

For all scenarios, the `required data` are the applicable dictionary rows plus payer-approved S fields; the current repository cannot enumerate the payer's forms, attachments, exceptions or timing. The Panel's [case wiki](../wiki/cases.md) describes internal status/touch tracking; it does not establish payer receipt or approval. A fill is not a submission ([scenario plan](scenario-specific-form-workflows-plan.md) §Confirmed requirements).

| Priority | Missing or Unverified Information | Payer/State/Specialty/Scenario | Why It Blocks Automation | Exact Verification Needed | Owner | Due Date | Temporary Safe Behavior |
|---|---|---|---|---|---|---|---|
| P0 | Inventory of live SOP heads/versions, forms, portal keys/maps and their source provenance | All active tuples | Cannot enumerate or validate combination records | Export scoped metadata and approvals from Panel; compare against current payer sources and this file; do not expose tenant PHI in package | Credentialing lead + Panel admin | Before agent activation | Do not route or submit the case. |
| P0 | Actual payer operating-state/network applicability | Every candidate payer/state/specialty/scenario | Historical catalog `states` and market rankings do not establish credentialing coverage | Compare current payer network/product/state directory and written payer confirmation with selected catalog ID | Credentialing lead | Before tuple promotion | Stop and request human input. |
| P0 | Original Kansas business SOPs and current approval status | UnitedHealthCare/Optum, Humana, BCBS of Kansas, BCBS KC, Aetna/KS/actual specialty/S1–S6 as applicable | Repo has only a dated, redacted modeling summary; Humana contract and site caveats may have changed | Retrieve the off-repo originals through the credentialing lead, record revision/page/owner, compare with payer's current source, split by group/site/scenario, and obtain specialist approval | Credentialing lead | Before any Kansas tuple is enabled | Do not route or submit the case. |
| P0 | Current authoritative payer form, version, requirements, destination, signatures, timing, follow-up and escalation | Every tuple/S1–S10 | No approved payer-specific KB record | Obtain payer-issued current instructions or written payer confirmation; specialist signs a completed Section 2 record | Credentialing lead | Before that tuple is enabled | Do not route or submit the case. |
| P0 | Specialty/provider-type and explicit scenario routing | Every tuple/S1–S10 | Existing SOP selector ignores specialty; typed scenarios are planned | Verify chosen SOP/form against exact specialty and case type; implement/enforce tuple gate before automation | Product owner + credentialing lead | Before agent activation | Stop and request human input. |
| P0 | Current signed disclosures and legal/ownership/sanctions/malpractice answers | Any form asking them | Cannot infer from empty records or old answers | Obtain direct authorized response and reviewed supporting evidence for exact form wording | Provider/signer + specialist | Before draft of affected field | Create draft but do not populate affected field. |
| P0 | Production separation and full capture of Aetna Contract/Enrollment forms | Aetna/actual state/actual specialty/S4–S5 versus S1/S6 | Existing key is mixed and distinct paths are not validated | Capture both full live paths from empty configurations; record form revision, all fields/branches/attachments, reviewer and payer response | Credentialing lead + form trainer | Before Aetna activation | Do not route or submit the case. |
| P0 | BCBSKS end-to-end workflow and accepted submission | BCBSKS/KS/actual specialty/actual scenario | Blank-form control observation proves no completed application | Capture current form revision/fields/attachments, specialist test, human submission receipt and payer acknowledgment | Credentialing lead | Before BCBSKS activation | Do not route or submit the case. |
| P0 | Group contract and site participation evidence | Any S1–S5 | Contract row/site data may not prove payer participation | Attach dated agreement/payer confirmation for group × payer × state × site | Contract owner | Before route choice | Stop and request human input. |
| P1 | Legal name history, structured work/education history, CDS, board details, malpractice limits, ownership and EFT vault policy | Applicable forms | Panel fields are partial or absent | Define secure source records, review and prompt minimization; collect current evidence per case | Data steward + specialist | Before affected form draft | Create draft but do not populate affected field. |
| P1 | Form-level approved mapping rows and version/drift review | Every supported form | Captured selector and technical approval lack full field provenance | For every exact field/page/branch, approve source, format, allowed values, manual flags and conflict rule | Form trainer + specialist | Before that form is enabled | Create draft and flag for credentialing review. |
| P1 | Freshness/acceptability rules for CAQH, CV, W-9, COI, licenses and all other attachments | Every tuple with those docs | Internal warning windows are not payer rules | Record payer's accepted document age/expiry in approved S, including exception path | Credentialing lead | Before attachment selection | Stop and request human input. |
| P1 | Exact destination, proof of receipt, reference capture and follow-up owner/cadence | Every tuple | Portal URL alone is not accepted delivery | Specialist confirms channel/address/path, receipt type, payer contact and cadence | Case owner + specialist | Before submission preparation | Do not route or submit the case. |
| P1 | Human approval and immutable per-answer provenance structure | All draftable tuples | Existing field stamps and case audit do not cover every answer/source/revision | Define and implement audited answer evidence + approval record before production agent use | Product/security owner | Before agent activation | Create draft and flag for credentialing review. |
| P1 | Deployed app/extension/schema identity for scenario-specific paths | Aetna and other portal workflows | Repository plan and historical hosted observation do not prove active runtime | Reconcile migration ledger, served Panel build and installed extension; perform specialist walkthrough | Release owner | Before runtime activation | Do not route or submit the case. |
| P2 | Follow-up and escalation process for recredentialing, demographic changes, termination and corrections | Each named tuple/S7–S10 | No universal cadence/response path | Obtain payer instructions and approve separate scenario records | Credentialing lead | Before each scenario is enabled | Stop and request human input. |

No due date was supplied or evidenced; “Before …” is a release gate, not a fabricated calendar deadline. The owner labels are proposed responsibility assignments pending named-person confirmation. The safe behaviors use only the allowed vocabulary.

## Section 7: New-Agent Guardrails

Copy the following block into the local agent's governing instructions. It is a **CONFIGURATION DECISION** for this handoff, not proof that Panel already enforces all checks.

```text
You assist with provider credentialing drafts inside Minted Panel. Use only the
case-provided records and approved, current knowledge-base entries. The minimum
requirement context is payer ID × state × specialty/provider type × scenario,
plus group-contract and location status. If a dimension is missing, ambiguous,
or conflicts with the selected SOP/form, stop and return a labeled GAP.

For every proposed answer cite the exact internal source record/document ID,
source date/version, and mapped form field/page. Distinguish a verified fact
from extracted text, a Panel configuration decision, an assumption, a
placeholder, and missing data. Extracted/OCR text is a proposal for review,
never a replacement for verified canonical data. A technical mapping, SOP
presence, mock run, fill count, or previous answer does not verify payer rules.

Do not use generic credentialing knowledge for payer-specific questions. Do
not invent, estimate, infer, or fill an absent value or date. Do not answer No
merely because evidence was not found. Do not use an old form answer as the
sole source for a current question. Do not make legal, clinical, compliance,
licensure, sanctions, exclusions, ownership, malpractice, work-history, or
attestation determinations.

Require credentialing-specialist review for every draft and for signatures,
certifications, attestations, disclosure questions, conflicting sources,
expired documents, conditional branches, low-confidence extraction, and
unverified form fields. Leave the affected field blank and say NEEDS HUMAN
INPUT. Never sign, submit, contact a payer, or communicate externally without
explicit human approval for the exact final artifact and destination.

Preserve an audit trail for every source, form version, proposed answer,
transform, warning, human edit, approval, fill attempt/readback, and any
submission-related action. Do not log raw sensitive values. A generated
draft, successful local fill, human submission, and payer acceptance are
distinct states. If requirements are not verified, return the exact gap and
verification action, not a recommendation phrased as fact. Never use
placeholders, synthetic dry-run values, or a payerless generic SOP in a
production answer.
```

### Quality check at handoff

- No payer-specific procedure is labeled verified; the candidate inventory is excluded from agent retrieval.
- Every scenario is identified as agent classification policy and requires a payer/state/specialty/scenario record for actual forms, attachments, destination, and timing.
- No form without title/version/source and no channel without confirmed destination is enabled.
- Every candidate auto-fill field has source priority and a current-evidence/review gate. Sensitive disclosures and attestations are manual.
- Every listed gap has one allowed safe behavior, owner role, and an exact verification action. All placeholders in the identified credentialing examples and mock profile are barred from production.
- This is a source-bounded review. It does not certify that all historical repository prose, live tenant records, private form files, or deployed behavior have been verified. The P0 inventory and specialist review must be completed before claiming a comprehensive payer KB.
