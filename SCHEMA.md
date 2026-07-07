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

`id, name, created_at` — tenant root.

### memberships

`id, org_id, user_id, role, created_at` — `role ∈ {admin, specialist, billing}`. Unique `(user_id, org_id)`.

### profiles

`id, full_name, email, created_at` — `id` mirrors `auth.users.id`.

### provider_groups

`id, org_id, name, tin, npi_type2, states[], is_active, created_at`.

### facilities

`id, org_id, group_id, name, street, city, state, zip, is_active, status_id, effective_date, created_at` (plus operational detail columns).

A launch is a facilities row in a pre-active location-track status: `status_id` references a `status_configs` row with `track = 'location'` (Prospect → Planned → Interviewing → Pending Fulfillment → Ready for Launch → Live, plus Inactive), and `effective_date` holds the target/start date (month-only dates stored as the 1st). The Launches page is a filtered view of this table; cases link to a location through `credential_cases.facility_id`. The legacy `launches` table remains in the hosted database but is no longer read or written.

### providers

`id, org_id, group_id, first_name, last_name, middle_initial, suffix, credentials, date_of_birth, gender, ethnicity, ssn_last4, email, phone, home_*, npi, caqh_id, caqh_last_attested_date, dea_number, dea_expiration_date, taxonomy_code, specialty, sub_specialty, board_certified, languages, medicaid_attested, cultural_competency_training, additional_certifications, age_groups_served, start_date, status, is_new_grad, terminated_date, degree, school_name, graduation_date, malpractice_*, license_number, license_state, license_issue_date, license_expiration_date, created_at, updated_at`.
Demographic/attestation/license fields (all nullable per the live schema): `middle_initial`, `suffix`, `gender`, `ethnicity`, `sub_specialty` (text); `board_certified`, `medicaid_attested`, `cultural_competency_training` (boolean, default false); `languages`, `age_groups_served` (text[], default `{}`); `additional_certifications` (jsonb, default `[]`); `dea_expiration_date`, `license_issue_date`, `license_expiration_date` (date); `license_number`, `license_state` (text) — a denormalized primary-license mirror carried on the provider alongside the per-state `state_licenses` rows.

### provider_facility_assignments

`id, org_id, provider_id, facility_id, created_at` — many-to-many.

### state_licenses

`id, org_id, provider_id, state, license_number, license_type, issue_date, expiration_date, status, created_at`.

### payers

`id, org_id, name, is_active, avg_decision_days, provisional_billing_allowed, provisional_billing_notes, retro_billing_allowed, retro_billing_window_days, caqh_pull_deadline_days, provider_type_path, prior_auth_vendor, payer_billing_id, portal_url, created_at`.

### msos

`id, org_id, name, portal_url, created_at`.

### mso_routing_rules

`id, org_id, payer_id, state, specialty, route_type, mso_id, notes, created_at` — resolves which MSO (if any) handles a new case.

### credential_cases

`id, org_id, provider_id, group_id, facility_id, payer_id, state, specialty, credentialing_status_id, mso_id, submitted_date, approved_date, expected_effective_date, confirmed_effective_date, termination_date, assigned_to, created_by, case_email_token, created_at, updated_at`.
**Unique** `(provider_id, payer_id, state)`. Credentialing status only. `case_email_token` is `text NOT NULL` (default `substr(md5(gen_random_uuid()::text), 1, 12)`) — the opaque per-case token the inbound email-to-touch webhook resolves back to `case_id` + `org_id` (see below).

### contracts

`id, org_id, group_id, payer_id, state, effective_date, expiration_date, notes, contracting_status_id, created_at, updated_at`. Contracting status lives here, never on cases.

### tasks

`id, org_id, case_id, provider_id, title, description, sop_content, status, sort_order, due_date, completed_date, is_auto_generated, created_at, updated_at`. Auto-generated on case creation from `sop_templates`.

### sop_templates

`id, org_id, name, group_id, state, specialty, payer_id, task_definitions jsonb, is_archived, created_at, updated_at`. Matching ignores archived rows. Token list in `src/lib/sopResolver.ts` is closed — never accept arbitrary tokens.

### status_configs

`id, org_id, track, label, color, sort_order, required_fields, action_bucket, created_at` — `track ∈ {credentialing, contracting, location}`. The location track drives the Launches pipeline.

### status_history (APPEND-ONLY)

`id, org_id, case_id, contract_id, track, from_status_id, to_status_id, metadata, changed_by, changed_at, created_at`.

### touches (APPEND-ONLY)

`id, org_id, case_id, touch_date, touch_type, outcome, next_follow_up_date, notes, coordinator_id, source, created_at`.

### notes

`id, org_id, entity_type, entity_id, content, author_id, created_at` — generic notes attached to any entity.

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
