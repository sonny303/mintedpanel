# Schema

All tables live in the `public` schema, carry `org_id uuid NOT NULL`, and are RLS-scoped to the caller's memberships. Every table has explicit `GRANT`s for `authenticated` and `service_role`. Append-only tables have no UPDATE/DELETE policies.

## Core rules

- **Unique case**: one row in `credential_cases` per `(provider_id, payer_id, state)`. Credentialing only — contracting status lives on `contracts`.
- **Contracts**: one row per `(group_id, payer_id, state)`. Contracting status, effective/expiration dates.
- **Append-only**: `touches`, `status_history`, `audit_log`. Never updated, never deleted.
- **PHI minimization**: `providers.ssn_last4` only. Full SSN is never stored or accepted.
- **Role checks**: `admin` (full), `specialist` (operational write), `billing` (read-only at policy level). Enforced via `has_role(uid, role)` security-definer function.

## Tables

### organizations

`id, name, lifecycle_state, created_at` — tenant root. Created via the SECURITY
DEFINER `create_organization(...) RETURNS uuid` RPC (self-serve intake): there is
no INSERT policy on this table — the RPC inserts the org, the caller's admin
membership, the canonical `status_configs` seed, and a CREATE audit row as the
definer (migration `20260707140000_create_organization_rpc.sql`). **Redesign
E0.1 added an additive v2 overload
`create_organization(p_name, p_owner_name, p_owner_email)`** (migration
`20260709120100_create_organization_rpc_v2.sql`): hard-blocks a duplicate
normalized name (case-/space-insensitive), requires a valid owner name+email,
sets `lifecycle_state = 'prospect'`, and writes the owner into the party model
(owner party + `owner` role at org scope). The legacy 1-arg overload is retained
(additive rule) but the redesign app calls only the enforced 3-arg form.

`lifecycle_state` (`text NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN
('prospect','active','inactive'))`, migration
`20260708120000_org_lifecycle_state.sql`, redesign E0.0): internal-only signal
driving the redesigned Portfolio buckets (active→"In motion", prospect→
"Prospects", inactive excluded). Read-only in the app and NEVER rendered to the
Credentialing Manager as a status label. All pre-migration rows are `active`.
Stage 0 does not write it; transitions are manual until later tooling exists.

### Party model (redesign Stage 0, canonical E0.3 §5)

Landed in the E0.1 PR (migration `20260709120000_party_model_foundation.sql`).
The single, reusable way stakeholders (owner, CRM contacts, later entities) are
represented.

- **parties** — `id, party_type ('person'|'organization', default 'person'),
name, email, phone_office, phone_mobile, address_line1, address_line2, city,
state, postal_code, country, created_by, created_at`. **No `org_id`** — the one
  approved exception to org-scoping: a party is reused across orgs (E0.3 F0.3.4).
  RLS grants access where `created_by = auth.uid()` OR the caller is a member of
  an org the party is assigned to (via `party_role_assignments`); writes also
  require a writer role in one of those orgs. `created_by` has no FK (seed uses a
  fixed placeholder).
- **party_role_types** — governed role reference list `role_key (PK), label,
is_active`. Active: `owner`, `customer_escalation_contact`, `sales_rep`.
  Reserved (`is_active = false`): `billing_contact`, `contracting_signer`,
  `credentialing_contact`. Read-only to `authenticated`; new roles are data
  inserts, never schema changes (E0.3 F0.3.5).
- **party_role_assignments** — `id, org_id, party_id, role_key, scope_type
('org'|'facility'|'case', default 'org'), scope_id, created_at`, `UNIQUE NULLS
NOT DISTINCT (org_id, party_id, role_key, scope_type, scope_id)`. Org-RLS-scoped
  (member SELECT, writer INSERT/UPDATE/DELETE). A BEFORE trigger rejects
  assigning an inactive (reserved) role. Stage 0 writes only `scope_type='org'`
  (scope_id NULL).

### memberships

`id, org_id, user_id, role, created_at` — `role ∈ {admin, specialist, billing}`. Unique `(user_id, org_id)`.

### profiles

`id, full_name, email, created_at` — `id` mirrors `auth.users.id`.

### provider_groups

`id, org_id, name, tin, npi_type2, states[], is_active, created_at`.

### facilities

`id, org_id, group_id, name, street, city, state, zip, is_active, status_id, effective_date, reference_only, created_at` (plus operational detail columns).

`reference_only` (`boolean NOT NULL DEFAULT false`, migration `20260707150000_reference_only_flag.sql`, Epic 2e): a migrated/onboard-existing location that exists to be referenced, not worked — skipped by Home's "Launches at risk" queue and shown with a "Reference" chip in the launches list/detail. All pre-migration rows are `false` (fully worked).

A launch is a facilities row in a pre-active location-track status: `status_id` references a `status_configs` row with `track = 'location'` (Prospect → Planned → Interviewing → Pending Fulfillment → Ready for Launch → Live, plus Inactive), and `effective_date` holds the target/start date (month-only dates stored as the 1st). The Launches page is a filtered view of this table; cases link to a location through `credential_cases.facility_id`. The legacy `launches` table remains in the hosted database but is no longer read or written.

### providers

`id, org_id, group_id, first_name, last_name, middle_initial, suffix, credentials, date_of_birth, gender, ethnicity, ssn_last4, email, phone, home_*, npi, caqh_id, caqh_last_attested_date, dea_number, dea_expiration_date, taxonomy_code, specialty, sub_specialty, board_certified, languages, medicaid_attested, cultural_competency_training, additional_certifications, age_groups_served, start_date, status, is_new_grad, terminated_date, degree, school_name, graduation_date, malpractice_*, license_number, license_state, license_issue_date, license_expiration_date, reference_only, created_at, updated_at`.
`reference_only` (`boolean NOT NULL DEFAULT false`, migration `20260707150000_reference_only_flag.sql`, Epic 2e): a migrated/onboard-existing provider that exists to be referenced, not worked — skipped by the action engine, the Fix-it queue, and Home queues, and listed under a "Reference" section (with a "Reference" chip) in the providers work view. All pre-migration rows are `false`.
Demographic/attestation/license fields (all nullable per the live schema): `middle_initial`, `suffix`, `gender`, `ethnicity`, `sub_specialty` (text); `board_certified`, `medicaid_attested`, `cultural_competency_training` (boolean, default false); `languages`, `age_groups_served` (text[], default `{}`); `additional_certifications` (jsonb, default `[]`); `dea_expiration_date`, `license_issue_date`, `license_expiration_date` (date); `license_number`, `license_state` (text) — a denormalized primary-license mirror carried on the provider alongside the per-state `state_licenses` rows.

### provider_facility_assignments

`id, org_id, provider_id, facility_id, created_at` — many-to-many.

### state_licenses

`id, org_id, provider_id, state, license_number, license_type, issue_date, expiration_date, status, created_at`.

### payers

`id, org_id, name, is_active, avg_decision_days, provisional_billing_allowed, provisional_billing_notes, retro_billing_allowed, retro_billing_window_days, caqh_pull_deadline_days, provider_type_path, prior_auth_vendor, payer_billing_id, portal_url, created_at`. **`org_id` is NULLABLE (P2, migration `20260707060000`): a NULL row is a global-catalog payer, visible to an org only via `org_payer_assignments`.** SELECT policy = `(org_id IN user_org_ids()) OR (org_id IS NULL AND assigned)`; writes stay own-org-only (org users can't create/edit global rows).

### org_payer_assignments (P2, 2026-07-07)

`id, org_id, payer_id, starter, created_at`. Per-org subscription to a global-catalog payer, unique `(org_id, payer_id)`; `starter` flags starter-pack payers (Epic 1c / P4). RLS: member SELECT own-org, admin INSERT/UPDATE/DELETE own-org. Migration `20260707060000_global_catalog_org_assignment.sql`. Catalog isolation is a browser-RLS concern (not the /api gate) — verified by `scripts/verify-catalog-rls.sql`.

### msos

`id, org_id, name, portal_url, created_at`.

### mso_routing_rules

`id, org_id, payer_id, state, specialty, route_type, mso_id, notes, created_at` — resolves which MSO (if any) handles a new case.

### credential_cases

`id, org_id, provider_id, group_id, facility_id, payer_id, state, specialty, credentialing_status_id, mso_id, submitted_date, approved_date, expected_effective_date, confirmed_effective_date, termination_date, assigned_to, created_by, case_email_token, payer_reference_id, created_at, updated_at`.
**Unique** `(provider_id, payer_id, state)`. Credentialing status only. `case_email_token` is `text NOT NULL` (default `substr(md5(gen_random_uuid()::text), 1, 12)`) — the opaque per-case token the inbound email-to-touch webhook resolves back to `case_id` + `org_id` (see below). `payer_reference_id` (`text`, nullable) is the latest payer reference / submission ID, latest-wins (Story 2, migration `20260707120200_case_payer_reference_id.sql`) — per-submission history lives in the touchlog, not here.

### contracts

`id, org_id, group_id, payer_id, state, effective_date, expiration_date, notes, contracting_status_id, created_at, updated_at`. Contracting status lives here, never on cases.

### tasks

`id, org_id, case_id, provider_id, title, description, sop_content, status, sort_order, due_date, completed_date, is_auto_generated, created_at, updated_at`. Auto-generated on case creation from `sop_templates`.

### sop_templates

`id, org_id, name, group_id, state, specialty, payer_id, task_definitions jsonb, is_archived, created_at, updated_at`. Matching ignores archived rows. Token list in `src/lib/sopResolver.ts` is closed — never accept arbitrary tokens. **`org_id` is NULLABLE (P2): a NULL row is a global-catalog SOP, visible to an org only when the org is assigned the SOP's `payer_id` (`org_payer_assignments`); a global SOP with `payer_id` NULL is visible to no org.**

### status_configs

`id, org_id, track, label, color, sort_order, required_fields, action_bucket, created_at` — `track ∈ {credentialing, contracting, location}`. The location track drives the Launches pipeline.

### status_history (APPEND-ONLY)

`id, org_id, case_id, contract_id, track, from_status_id, to_status_id, metadata, changed_by, changed_at, created_at`.

### touches (APPEND-ONLY) — the touchlog

`id, org_id, case_id, touch_date, entry_type, touch_type, outcome, next_follow_up_date, notes, coordinator_id, task_id, communication_event_id, source, created_at`.

The single case-activity spine (Story 1, migration `20260707120000_touchlog_entry_types.sql`). `entry_type ∈ {touchpoint, note, system_event, task_update}` (CHECK). Only touchpoints carry a channel + outcome — `touch_type`/`outcome` are nullable and enforced present for touchpoints via `touches_touchpoint_shape_check`; note/system_event/task_update entries put their text in `notes`. `touch_type ∈ {call, email, portal, fax, mail}` (mail added Story 3). `outcome` CHECK widened to the Story 3 channel-aware taxonomy (see `src/lib/touchOutcomes.ts`) ∪ legacy codes. `task_id` (nullable FK → `tasks`) links a note/update to a task and drives the task detail's filtered slice. `communication_event_id` (nullable) links a touchpoint to a batch payer call (Story 8; FK + parent table land in the Story 8 migration). Indexed on `task_id` and `entry_type`.

### communication_event

`id, org_id, payer_id, channel, occurred_at, created_by, created_at` (Story 8, migration `20260707130000_communication_event_batch_touchpoint.sql`). The parent record for a batch payer call — one row per call, one child `touches` touchpoint per case (`touches.communication_event_id` FK). `channel` ∈ `{call, email, portal, fax, mail}` (stored as the touch_type). RLS mirrors `touches`: member SELECT, writer INSERT, no UPDATE/DELETE. A single-case touchpoint keeps `communication_event_id` NULL — one model, no fork. **Note:** `src/integrations/supabase/types.ts` carries a hand-added `communication_event` block (MCP `generate_typescript_types` was unavailable at build time) — normalize it on the next regen.

### notes

`id, org_id, entity_type, entity_id, content, author_id, created_at` — generic notes attached to any entity. **Dormant for `entity_type` case/task since Story 1**: those rows were migrated into the touchlog (`20260707120100_migrate_notes_to_touchlog.sql`, backup table `notes_pre_touchlog_backup`) and the app now reads/writes case + task notes through `touches`. Still the live store for **provider** notes. Kept, not dropped, per the additive rule.

### audit_log (APPEND-ONLY, immutable)

`id, org_id, ts, user_id, user_name, action_type, entity_type, entity_id, before jsonb, after jsonb, description, created_at`. No edit, no delete, by anyone — including admins. `action_type` is check-constrained to `CREATE | UPDATE | STATUS_CHANGE | TOUCH_LOGGED | TERMINATION | READ` (`READ` added 2026-07-05 for profile-endpoint read auditing — migration `20260705190000_audit_log_read_action_type.sql`).

## Extension + cleanup surfaces

### portal_field_maps

`id, org_id, portal_key, url_pattern, page_step, map_type, selector, selector_fallbacks[], source, token, hardcoded_value, transform, field_type, notes, status, field_label, form_section, confidence, created_at, updated_at`. The extension fill engine's selector catalog. `org_id NULL` = shared global catalog row (portal truths); non-null = org override. `status`: `proposed → approved → retired`. `source`: `token | manual | manual_partial | hardcoded`. Browser RLS: member SELECT of global + own-org rows; writer-only INSERT/UPDATE on own-org rows (global rows stay read-only in the app). `field_label`, `form_section`, `confidence` (smallint 0–100) added 2026-07-06 (migration `20260706120000_cleanup_surfaces_schema.sql`) — captured per proposed row and consumed by Mapping review.

### fill_sessions

`id, org_id, case_id, provider_id, portal_key, fill_mode, started_at, completed_at, fields_filled, fields_skipped jsonb, docs_attached jsonb, performed_by`. One row per extension fill attempt; `id` is a client-generated idempotency key. Browser RLS: member SELECT, writer INSERT. Portals admin's "last fill" column derives from the latest org row per `portal_key` — nothing is stored on `portals`.

### portals (2026-07-06)

`id, org_id, portal_key, name, payer_id, form_url, is_verified, last_verified_at, url_changed_at, created_at, updated_at`. Org-scoped registry of payer portals the extension can fill; unique `(org_id, portal_key)`. Editing `form_url` clears `is_verified` and stamps `url_changed_at` (drives the "Needs re-verify" pill). RLS mirrors `payers`: member SELECT, writer INSERT/UPDATE. Migration `20260706120000_cleanup_surfaces_schema.sql`.

### field_dictionary (2026-07-06)

`id, org_id, label_normalized, token, status, seen_count, decided_at, decided_by, created_at, updated_at`. Org-scoped label → token memory; unique `(org_id, label_normalized)`. `status`: `suggested | confirmed | rejected` (check-constrained). Mapping review upserts a `suggested` row (bumping `seen_count`) on each token approval; a `suggested` row with `seen_count >= 2` becomes a Fix-it "confirm" card; a confirmed rule makes future matches high-confidence. Same migration as `portals`.

## Inbound webhook: email-to-touch

Email replies on a case thread are forwarded to a public webhook that appends a `touches` row with `source = 'email'`. Implementation comes next.

**Endpoint** (planned): `POST /api/public/email-touch`

**Body**:

```json
{
  "caseEmailToken": "string — opaque token identifying the case",
  "fromAddress": "sender@example.com",
  "subject": "string",
  "receivedAt": "ISO 8601 timestamp",
  "bodyText": "plain-text email body"
}
```

**Handler contract**:

- Verify shared-secret signature header before processing.
- Resolve `caseEmailToken` → `case_id` + `org_id`.
- Insert one `touches` row: `touch_type = 'inbound_email'`, `outcome = subject`, `notes = bodyText`, `source = 'email'`, `touch_date = receivedAt`.
- Never trust `fromAddress` for authorization — token alone resolves the case.
- Return `200 ok` on success, `401` on bad signature, `404` on unknown token.
