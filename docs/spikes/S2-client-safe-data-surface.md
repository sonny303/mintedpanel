# S2 — Client-safe data surface

**Status:** field classification complete against the checked-in schema;
hosted column recheck remains blocked by Supabase MCP authentication  
**Persona:** client owner / executive sponsor; provider self-view is out of
scope  
**Default:** never expose a source row. Client API DTOs contain only fields
marked visible or an explicitly described masked derivation.

## Answer

The minimum useful surface answers:

> For the providers in my granted groups and selected facilities, which payers
> are not started, underway, with the payer, blocked, approved but not
> effective, or ready to bill—and what is the best supported start date?

It needs provider identity, professional label, planned start, group/facility
geography, payer identity, case milestones, contract/effective dates, and a
derived client status. It does not need home address, DOB, SSN last four,
provider contact data, internal tasks/touches/SOPs, audit history, documents, or
coordinator identities.

Use dedicated API DTOs, not public database views and not existing internal
extension routes. Every query must use S1's server-resolved org and group
grants, explicit source projections, and query-level exclusion predicates.

## Evidence and completeness

The S2 brief required a live `information_schema.columns` query. Supabase MCP
required authentication in this run, so hosted could not be independently
queried. The classification was built from
`src/integrations/supabase/types.ts` and checked-in migration final state on
2026-09-02:

- 14 named tables from the brief;
- 9 additional tables required by current joins, grains, status history, and
  the matrix;
- 23 tables and **378 source columns total**.

Run `node scripts/benchmarks/audit-client-surface-columns.mjs` to prove every
generated `Row` column in those tables appears exactly once below. This proves
repository completeness, not hosted parity. A hosted `information_schema`
diff is a pre-build blocker.

The brief's statement that a case is provider + payer + state is stale:
`credential_cases` is currently unique on provider + group + payer + state.
The additional `case_status_history` table is also the canonical case-status
trail and cannot be replaced by the older generic `status_history` table.

### Verdict definitions

| Verdict     | Contract                                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Visible** | The value may appear unchanged in a narrowly typed client DTO. An opaque ID may be present on the wire without being rendered.                                 |
| **Masked**  | The raw value never leaves the server. It may contribute to a coarsened label, boolean, date, masked suffix, aggregate, or derived status named in the reason. |
| **Never**   | The value and a direct equivalent are not returned. Some never fields are still mandatory server-side exclusion predicates.                                    |

Rows group columns only when each named column has the same verdict and reason.
Every backticked name independently inherits that row's verdict.

## Full column allowlist

### `providers` (53)

| Columns                                                                                                                                                                                              | Verdict     | Reason                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `id`                                                                                                                                                                                                 | **Visible** | Opaque provider key for matrix and drill-down navigation.                                |
| `first_name`, `last_name`                                                                                                                                                                            | **Visible** | Minimum roster identity.                                                                 |
| `credentials`                                                                                                                                                                                        | **Visible** | Distinguishes clinicians with the same name and gives professional context.              |
| `npi`                                                                                                                                                                                                | **Visible** | Public professional identifier; useful to disambiguate providers.                        |
| `specialty`, `sub_specialty`                                                                                                                                                                         | **Visible** | Required for cohort/filter context.                                                      |
| `start_date`                                                                                                                                                                                         | **Visible** | Client-supplied planned-start input to the executive forecast.                           |
| `status`                                                                                                                                                                                             | **Masked**  | Return only a coarse roster state; terminated rows are excluded by default.              |
| `updated_at`                                                                                                                                                                                         | **Masked**  | May contribute only to an aggregate “data current as of” timestamp.                      |
| `is_test_provider`, `reference_only`, `verification_state`                                                                                                                                           | **Never**   | Mandatory query predicates; non-real or unverified rows must not enter a client payload. |
| `date_of_birth`, `ssn_last4`, `home_street`, `home_city`, `home_state`, `home_zip`                                                                                                                   | **Never**   | Direct PHI is unnecessary for an executive readiness question.                           |
| `email`, `phone`                                                                                                                                                                                     | **Never**   | Provider contact data has no positive v1 use case; product must explicitly opt in.       |
| `caqh_id`, `caqh_last_attested_date`, `dea_number`, `dea_expiration_date`                                                                                                                            | **Never**   | Credentialing operations data; exposes identifiers and internal readiness mechanics.     |
| `license_number`, `license_state`, `license_issue_date`, `license_expiration_date`                                                                                                                   | **Never**   | Use the state-license child row for footprint and only a masked readiness result.        |
| `malpractice_carrier`, `malpractice_policy_number`, `malpractice_coverage_start`, `malpractice_coverage_end`                                                                                         | **Never**   | Insurance evidence belongs to internal credentialing operations.                         |
| `additional_certifications`, `age_groups_served`, `board_certified`, `cultural_competency_training`, `degree`, `graduation_date`, `is_new_grad`, `medicaid_attested`, `school_name`, `taxonomy_code` | **Never**   | Not needed to answer billing-start readiness; default-deny applies.                      |
| `ethnicity`, `gender`, `languages`                                                                                                                                                                   | **Never**   | Sensitive demographic/person attributes without an executive-readiness purpose.          |
| `middle_initial`, `suffix`                                                                                                                                                                           | **Never**   | First/last name, credentials, and NPI are sufficient v1 identity.                        |
| `group_id`                                                                                                                                                                                           | **Never**   | Frozen primary-group mirror; scope and display must use `provider_group_assignments`.    |
| `launch_id`                                                                                                                                                                                          | **Never**   | Deprecated launch relationship; launches are dormant.                                    |
| `org_id`                                                                                                                                                                                             | **Never**   | Authorization scope is server-derived, never a payload entitlement.                      |
| `created_at`, `terminated_date`                                                                                                                                                                      | **Never**   | Creation metadata and terminated-provider history are outside the v1 cohort.             |

### `credential_cases` (28)

| Columns                                                                                                            | Verdict     | Reason                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `id`, `case_number`                                                                                                | **Visible** | Stable opaque and human-readable case identities.                                                             |
| `provider_id`, `group_id`, `payer_id`, `facility_id`, `state`                                                      | **Visible** | Keys needed to assemble the granted provider/group/payer/location cell.                                       |
| `submitted_date`, `approved_date`, `expected_effective_date`, `confirmed_effective_date`, `contract_executed_date` | **Visible** | Client-safe milestones directly relevant to forecast and billing readiness.                                   |
| `created_at`                                                                                                       | **Visible** | Supports a client-safe “case opened” milestone.                                                               |
| `case_status`                                                                                                      | **Masked**  | Map the canonical eight statuses to the client vocabulary; never return the raw enum as the display contract. |
| `updated_at`                                                                                                       | **Masked**  | May contribute only to response freshness.                                                                    |
| `credentialing_status_id`, `payer_pipeline_state`                                                                  | **Never**   | Frozen/internal status mirrors; client status derives from canonical state.                                   |
| `assigned_to`, `created_by`                                                                                        | **Never**   | Internal coordinator identities.                                                                              |
| `case_email_token`                                                                                                 | **Never**   | Secret-like workflow token.                                                                                   |
| `generation_run_id`, `mso_id`                                                                                      | **Never**   | Internal generation/delegation provenance.                                                                    |
| `payer_reference_id`, `payer_group_provider_id`, `payer_individual_provider_id`                                    | **Never**   | External identifiers are product decisions; default is no exposure.                                           |
| `org_id`                                                                                                           | **Never**   | Server-derived authorization scope.                                                                           |
| `specialty`                                                                                                        | **Never**   | Duplicate snapshot; use the provider's approved display field.                                                |
| `termination_date`                                                                                                 | **Never**   | Terminated providers/cases are excluded in v1.                                                                |

### `contracts` (12)

| Columns                               | Verdict     | Reason                                                                                   |
| ------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `id`, `group_id`, `payer_id`, `state` | **Visible** | Opaque contract identity and the dimensions needed for the case-to-contract join.        |
| `effective_date`, `expiration_date`   | **Visible** | Determines when billing can begin or ceases to be supported.                             |
| `contracting_status_id`               | **Masked**  | Resolve to `status_configs.action_bucket`, then map to client status; never send the ID. |
| `updated_at`                          | **Masked**  | May contribute only to response freshness.                                               |
| `payer_group_id`                      | **Never**   | External group identifier requires an explicit product yes; default no.                  |
| `notes`                               | **Never**   | Internal contract operations.                                                            |
| `org_id`, `created_at`                | **Never**   | Scope and storage metadata are not client content.                                       |

### `provider_groups` (43)

| Columns                                                                                                                                                                                                                                                                                                                                                                                                              | Verdict     | Reason                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| `id`, `name`                                                                                                                                                                                                                                                                                                                                                                                                         | **Visible** | Group grant identity and client-facing scope label.                       |
| `npi_type2`, `tax_id_type`                                                                                                                                                                                                                                                                                                                                                                                           | **Visible** | Business-entity identifiers that disambiguate similarly named groups.     |
| `tin`                                                                                                                                                                                                                                                                                                                                                                                                                | **Masked**  | If product approves, return only a last-four display; never the full TIN. |
| `states`                                                                                                                                                                                                                                                                                                                                                                                                             | **Visible** | Safe scope/filter context, not an entitlement by itself.                  |
| `is_active`                                                                                                                                                                                                                                                                                                                                                                                                          | **Never**   | Mandatory server predicate; inactive groups do not appear.                |
| `billing_city`, `billing_state`, `billing_street`, `billing_suite`, `billing_zip`, `correspondence_city`, `correspondence_state`, `correspondence_street`, `correspondence_suite`, `correspondence_zip`, `credentialing_city`, `credentialing_state`, `credentialing_street`, `credentialing_suite`, `credentialing_zip`                                                                                             | **Never**   | Business addresses are not needed for the v1 executive forecast.          |
| `billing_contact_name`, `billing_email`, `billing_fax`, `billing_phone`, `contract_signer_email`, `contract_signer_name`, `contracting_contact_email`, `contracting_contact_name`, `contracting_contact_title`, `correspondence_contact_name`, `correspondence_email`, `correspondence_fax`, `correspondence_phone`, `credentialing_contact_name`, `credentialing_email`, `credentialing_fax`, `credentialing_phone` | **Never**   | Contact and signer details are internal operations data.                  |
| `preferred_contact_method`, `website_url`                                                                                                                                                                                                                                                                                                                                                                            | **Never**   | Not required for billing-start readiness.                                 |
| `org_id`, `created_at`                                                                                                                                                                                                                                                                                                                                                                                               | **Never**   | Server-derived scope and storage metadata.                                |

### `facilities` (28)

| Columns                                                                                                                                                                                                                  | Verdict     | Reason                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------ |
| `id`, `group_id`, `name`                                                                                                                                                                                                 | **Visible** | Location identity within granted groups.                                             |
| `street`, `suite`, `city`, `state`, `county`, `zip`                                                                                                                                                                      | **Visible** | Identifies the practice location and makes “Raleigh” an explicit facility geography. |
| `effective_date`                                                                                                                                                                                                         | **Visible** | Facility go-live date is an input to billing readiness.                              |
| `status_id`                                                                                                                                                                                                              | **Masked**  | If used, map to a coarse client location state; never return the internal status ID. |
| `is_active`, `reference_only`                                                                                                                                                                                            | **Never**   | Mandatory query predicates; inactive/reference locations cannot enter the response.  |
| `accepting_new_patients`, `ada_compliance`, `appointment_phone`, `contact_name`, `email`, `fax`, `hours`, `interpreter_languages`, `language_line`, `languages_offered`, `phone`, `service_types`, `treating_categories` | **Never**   | Operational/location-profile fields outside the executive readiness question.        |
| `org_id`, `created_at`                                                                                                                                                                                                   | **Never**   | Scope and storage metadata.                                                          |

### `launches` (15)

| Columns                                                                                                                                                                                                          | Verdict   | Reason                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| `address`, `city`, `clinic_director_name`, `clinic_director_provider_id`, `confirmed_start_date`, `created_at`, `facility_id`, `group_id`, `gym_name`, `id`, `name`, `org_id`, `state`, `status`, `target_month` | **Never** | The launch model is dormant/deprecated and must not become a new client data dependency. |

### `tasks` (18)

| Columns                                                                                                                                                                                                                                                           | Verdict   | Reason                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `case_id`, `completed_date`, `created_at`, `description`, `due_date`, `execution_type`, `id`, `is_auto_generated`, `org_id`, `provider_id`, `sop_content`, `sop_resolution_tier`, `sop_template_id`, `sop_version`, `sort_order`, `status`, `title`, `updated_at` | **Never** | Tasks and SOP execution are internal operations. A future coarse blocker/action flag must be a separate derived DTO decision, not task-row exposure. |

### `touches` (18)

| Columns                                                                                                                                                                                                                                                                       | Verdict   | Reason                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `case_id`, `clears_follow_up`, `communication_event_id`, `coordinator_id`, `corrects_touch_id`, `created_at`, `entry_type`, `id`, `next_follow_up_date`, `notes`, `org_id`, `outcome`, `recipient_contact`, `recipient_name`, `source`, `task_id`, `touch_date`, `touch_type` | **Never** | Touches expose internal notes, people, cadence, and correction mechanics; case milestones provide the safe client history. |

### `status_configs` (9)

| Columns                                                                | Verdict    | Reason                                                                                        |
| ---------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| `track`, `label`, `action_bucket`                                      | **Masked** | Inputs to a server-owned client status mapping; raw internal vocabulary never leaves the API. |
| `color`, `created_at`, `id`, `org_id`, `required_fields`, `sort_order` | **Never**  | Internal configuration, rendering, validation, and storage metadata.                          |

### `status_history` (11)

| Columns                                                                                                                                   | Verdict   | Reason                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| `case_id`, `changed_at`, `changed_by`, `contract_id`, `created_at`, `from_status_id`, `id`, `metadata`, `org_id`, `to_status_id`, `track` | **Never** | Generic internal status/audit trail; safe case and contract milestones come from explicit DTO fields. |

### `provider_documents` (15)

| Columns                                                                                                                                                                                                                        | Verdict   | Reason                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------- |
| `case_id`, `created_at`, `doc_type`, `document_family_id`, `effective_date`, `expiration_date`, `file_name`, `file_path`, `group_id`, `id`, `org_id`, `provider_id`, `supersedes_document_id`, `uploaded_by`, `version_number` | **Never** | Documents are excluded from v1 pending a product decision; storage paths and uploader identity are never client-safe. |

### `payers` (24)

| Columns                                                                                              | Verdict     | Reason                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| `id`, `name`, `payer_kind`, `states`                                                                 | **Visible** | Safe payer identity and filter context.                                                 |
| `aliases`                                                                                            | **Never**   | May support server-side search but does not need to be returned.                        |
| `is_active`, `status`, `archived_at`, `merged_into_id`                                               | **Never**   | Mandatory lifecycle predicates; inactive/archived/merged rows do not enter the payload. |
| `avg_decision_days`, `last_synced_at`, `payer_slug`, `resolution_id_expected`, `resolution_id_label` | **Never**   | Deprecated fields cannot support a client forecast.                                     |
| `group_id_expected`, `group_id_label`, `provider_id_expected`, `provider_id_label`                   | **Never**   | Internal payer-form requirements.                                                       |
| `delegation_note`, `source`                                                                          | **Never**   | Internal governance and delegation metadata.                                            |
| `created_by`, `org_id`, `created_at`, `updated_at`                                                   | **Never**   | Catalog provenance and storage scope are not client content.                            |

### `msos` (5)

| Columns                                            | Verdict   | Reason                                                      |
| -------------------------------------------------- | --------- | ----------------------------------------------------------- |
| `created_at`, `id`, `name`, `org_id`, `portal_url` | **Never** | MSO routing is dormant; delegation details remain internal. |

### `audit_log` (12)

| Columns                                                                                                                                 | Verdict   | Reason                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `action_type`, `after`, `before`, `created_at`, `description`, `entity_id`, `entity_type`, `id`, `org_id`, `ts`, `user_id`, `user_name` | **Never** | Append-only internal audit evidence. Client-authorized mutations may write audit rows, but clients never read them. |

### `provider_group_assignments` (8)

| Columns                                                           | Verdict     | Reason                                                                             |
| ----------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `provider_id`, `group_id`, `is_primary`, `start_date`, `end_date` | **Visible** | Authoritative provider-to-group membership and roster dates within granted groups. |
| `created_at`, `id`, `org_id`                                      | **Never**   | Storage identity and server-derived scope.                                         |

### `provider_facility_assignments` (8)

| Columns                                                  | Verdict     | Reason                                                                |
| -------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| `provider_id`, `facility_id`, `is_primary`, `start_date` | **Visible** | Authoritative provider-to-location relationship for facility cohorts. |
| `practice_frequency`                                     | **Never**   | Unused field with no reliable client semantics.                       |
| `created_at`, `id`, `org_id`                             | **Never**   | Storage identity and server-derived scope.                            |

### `case_facilities` (7)

| Columns                                    | Verdict     | Reason                                                                 |
| ------------------------------------------ | ----------- | ---------------------------------------------------------------------- |
| `case_id`, `facility_id`, `is_primary`     | **Visible** | Current full case-location set; primary is display context, not scope. |
| `created_at`, `created_by`, `id`, `org_id` | **Never**   | Internal provenance, storage identity, and scope.                      |

### `payer_network_targets` (8)

| Columns                         | Verdict     | Reason                                                                               |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `group_id`, `payer_id`, `state` | **Visible** | Defines which payer columns are relevant for a granted group and state.              |
| `status`                        | **Masked**  | Return only inclusion/availability semantics; raw target workflow state is internal. |
| `payer_issued_id`               | **Never**   | External identifier requires explicit product approval.                              |
| `created_at`, `id`, `org_id`    | **Never**   | Storage identity, provenance, and scope.                                             |

### `enrollment_facts` (13)

| Columns                                                          | Verdict     | Reason                                                                                 |
| ---------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| `provider_id`, `group_id`, `payer_id`, `state`, `effective_date` | **Visible** | The enrollment grain and known billing-effective date directly answer readiness.       |
| `expired_at`                                                     | **Masked**  | Return only active/inactive enrollment semantics unless historical access is approved. |
| `payer_issued_id`                                                | **Never**   | Product must explicitly approve external payer IDs.                                    |
| `source`                                                         | **Never**   | Internal provenance.                                                                   |
| `created_at`, `created_by`, `expired_by`, `id`, `org_id`         | **Never**   | Internal audit/storage identity and server-derived scope.                              |

### `state_licenses` (14)

| Columns                                                 | Verdict     | Reason                                                                               |
| ------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `provider_id`, `state`                                  | **Visible** | Safe provider footprint for state filters.                                           |
| `expiration_date`, `status`, `verified_status`          | **Masked**  | May contribute only to a coarse license-ready/blocker result after product approval. |
| `license_number`, `license_type`, `issue_date`          | **Never**   | Credential details are unnecessary for executive readiness.                          |
| `verification_source_url`, `verified_at`, `verified_by` | **Never**   | Internal PSV evidence and coordinator identity.                                      |
| `created_at`, `id`, `org_id`                            | **Never**   | Storage identity, provenance, and scope.                                             |

### `organizations` (4)

| Columns           | Verdict     | Reason                                                                                     |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `id`, `name`      | **Visible** | Opaque context key and client-facing account label; the server still resolves entitlement. |
| `lifecycle_state` | **Never**   | Server predicate; inactive contexts are unavailable rather than exposed as data.           |
| `created_at`      | **Never**   | Storage metadata.                                                                          |

### `case_status_history` (12)

| Columns                                                                                                                                                         | Verdict   | Reason                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `actor_kind`, `case_id`, `changed_at`, `changed_by`, `evidence_touch_id`, `from_status`, `id`, `is_correction`, `note`, `org_id`, `reason_code_id`, `to_status` | **Never** | Canonical append-only internal transition evidence; the client receives current mapped status and explicit safe milestones, not actors/reasons/history rows. |

### `case_generation_exclusions` (13)

| Columns                                                              | Verdict    | Reason                                                                                              |
| -------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `provider_id`, `group_id`, `payer_id`, `state`, `status`             | **Masked** | May derive a coarse “not pursued/closed” matrix cell; raw exclusion records never leave the server. |
| `reason`, `note`                                                     | **Never**  | Internal rationale may contain operational or person-sensitive detail.                              |
| `created_at`, `created_by`, `id`, `org_id`, `voided_at`, `voided_by` | **Never**  | Internal append/void provenance, storage identity, and scope.                                       |

## Client-facing status vocabulary

The brief assumes status derives from `status_configs`. Current architecture is
more specific:

- case status is the code-owned `credential_cases.case_status` enum;
- contract and location statuses reference `status_configs`;
- ready-to-bill is a multi-table/date derivation and must never be stored as a
  flag.

Recommended vocabulary:

| Client status                                         | Source mapping                                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `not_started` — Not started                           | Case `not_started`, or an approved matrix population rule finds an active target with no case.                                                                                 |
| `preparing` — Preparing                               | Case `in_progress`; legacy/config fallback `action_bucket=ours`.                                                                                                               |
| `with_payer` — With payer                             | Case `submitted` or `in_review`; config fallback `action_bucket=waiting_payer`.                                                                                                |
| `attention_needed` — Attention needed                 | Case `action_required` or `denied`; config fallback `action_bucket=waiting_provider`. Do not expose an internal reason unless product approves a separate safe action summary. |
| `approved_waiting_start` — Approved, waiting to start | Case `approved`, but the agreed ready-to-bill predicate is not yet true.                                                                                                       |
| `ready_to_bill` — Ready to bill                       | Case approved plus the product-approved combination of active enrollment, contract state/effective date, facility effective date, and confirmed payer effective date.          |
| `closed` — Closed / not pursued                       | Case `not_pursuing`, terminated provider exclusion, or approved coarse exclusion mapping.                                                                                      |

Mapping should live in a pure, tested `src/lib/clientStatus.ts` and be called by
the client DTO service. It must accept a passed-in date-only `today`, use
canonical status helpers/labels, and return a closed TypeScript union. Do not
put this mapping into a UI component, database column, or public view.

The exact `ready_to_bill` predicate and whether `denied` maps to attention or
closed are product decisions. Until answered, the API must not claim a billing
date.

## Recommended read surface

Use API DTOs only for the wire contract:

- `ClientScopeDto`: safe organization/group labels and granted IDs.
- `ClientMatrixPageDto`: normalized providers, payer columns, narrow cells,
  response freshness, cursor, total provider count, and safe aggregate summary.
- `ClientProviderDto`: one provider's visible fields, safe facilities, payer
  cells, and explicit milestone dates.

Reasons:

1. S1's client identity is intentionally absent from RLS memberships.
2. TypeScript DTOs are positive allowlists; adding a database column cannot
   silently widen a response.
3. The API can combine/coarsen status without exposing tasks, touches, or
   `status_configs`.
4. Existing extension DTOs are locked contracts and contain internal data.
5. PostgreSQL views bypass RLS by default unless carefully configured. A view
   would not replace the API guard and adds another contract to audit.

If query complexity later justifies a private SQL view, it remains an
implementation detail with no direct client grant. List queries must use
explicit projections; never `select("*")`. Person-level responses should set
`Cache-Control: no-store` and bodies must never be logged.

## Mandatory exclusion and join rules

Apply these in every list, count, facet, export, and drill-down query—not only
in UI filtering:

1. `providers.is_test_provider = false`.
2. `providers.reference_only = false`.
3. `providers.status <> 'terminated'`.
4. `providers.verification_state <> 'pending_verification'` (missing from the
   brief but already enforced by the internal matrix).
5. Provider/group scope comes from active
   `provider_group_assignments`, never frozen `providers.group_id`.
6. Provider/facility cohorts use `provider_facility_assignments`; product must
   define primary-vs-any semantics.
7. `provider_groups.is_active = true`.
8. `facilities.is_active = true AND facilities.reference_only = false`.
9. Payers are active, not archived, and not merged.
10. `payer_network_targets.status = 'active'` when targets define columns.
11. Every joined org-owned table is independently constrained to
    `ctx.orgId`; every group-bearing row is intersected with
    `ctx.allowedGroupIds`. Embedded joins do not inherit safety automatically
    under the service-role client.
12. Cross-group/nonexistent IDs return 404 before any secondary read, signing,
    or audit side effect.

## Product decisions, as yes/no questions

Default remains “no” until each is answered.

1. May clients see provider email or phone?
2. May clients see payer tracking/reference IDs and payer-issued
   provider/group IDs?
3. May clients see group TIN last four (never the full TIN)?
4. Are provider documents in v1? If yes, which document kinds and metadata,
   and must every signed download be audited?
5. May clients see a coarse license-ready result or expiration date?
6. May clients see a sanitized “action needed from you” summary derived from
   tasks, while raw tasks/SOPs/touches remain never?
7. Does “Raleigh provider” mean assigned to any active Raleigh facility?
8. Does an active payer target with no case display as “Not started”?
9. Does `denied` display as “Attention needed” rather than “Closed”?
10. Is ready-to-bill true only when credentialing approval, contract
    effectiveness, facility go-live, and payer effective date all pass?
11. Are terminated providers and historical enrollments entirely absent from
    v1 rather than available behind a history filter?
12. May clients export the same allowlisted DTO, with no additional columns?

## Audit behavior

Clients never read `audit_log`. Future client writes, acknowledgements, exports
containing person-level rows, access/grant changes, and document signing should
append internal audit evidence with actor, action, and safe entity IDs—never
the response body, token, URL, PHI, or internal notes. Ordinary paged matrix
reads need access telemetry, but should not create an `audit_log` row per page
unless compliance explicitly requires it; high-volume access logs belong in
server observability with PHI-safe metadata.

## Data/privacy risks

| Rank | Risk                                                                                                       | Control                                                                           |
| ---: | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
|    1 | Reusing `GET /api/providers/:id` returns the full PHI-rich provider row.                                   | Dedicated client DTO and route; route-reuse prohibition.                          |
|    2 | A membership-based client can read 51 org-wide SELECT policies, including internal and PHI-bearing tables. | S1 option B; no client `memberships` row.                                         |
|    3 | `select("*")` silently widens when schema changes.                                                         | Explicit service projections plus DTO contract tests and the column audit.        |
|    4 | Filtering test/reference/terminated rows only after fetch still leaks counts and payload data.             | SQL predicates in every query and aggregate.                                      |
|    5 | Internal notes/SOP/task titles can contain unexpected person-sensitive details.                            | All task/touch fields remain never; only approved coarse derivations.             |
|    6 | A service-role embedded relation can cross org/group if only the root query is scoped.                     | Scope both root and each embed; isolation leak-mode tests.                        |
|    7 | “Ready to bill” can create false precision.                                                                | Product-approved predicate, source freshness, and estimate/confirmed distinction. |

## Experience gaps to carry into design

These are requirements exposed by the data contract, not screen designs:

- **Loading:** show scope and cached filter context while a page loads; announce
  loading to assistive technology.
- **Empty:** distinguish no grants, no active providers, no payer targets/no
  cases, and no filter matches. “No data” must never imply “ready.”
- **Error:** distinguish access revoked, partial source failure, and transient
  load failure. Preserve filters/cursor on retry.
- **Freshness:** show response “current as of” and label expected dates as
  estimates versus confirmed dates.
- **Accessibility:** status cannot rely on color; every cell has provider,
  payer, and status text, and virtualized focus must remain stable.
- **Responsive behavior:** the 20-column matrix is a large-screen secondary
  view. Narrow screens start with provider list/drill-down, not tiny columns.
- **Coordinator-to-client handoff:** client-facing status must not expose how
  coordinators work, but it must surface a safe “we need something from you”
  state if product approves it; otherwise executives cannot act on blockers.
- **Forecast summary:** answer the cohort question above the details with
  denominator, ready count, attention count, expected range/date, and explicit
  unknown count. Never collapse unknown dates into zero days.

## Dependency handoff

S2's content answer was independent of S1, but implementation is not:

1. S1 provides verified org/group grants.
2. S2 fixes the only permissible DTO fields and status derivation.
3. S4 supplies server-side pagination, payload limits, and virtualization.

No epic, user story, or build acceptance criteria should be written until
product answers the yes/no list and confirms the S1/S4 recommendations.
