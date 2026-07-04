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

`id, org_id, group_id, first_name, last_name, credentials, date_of_birth, ssn_last4, email, phone, home_*, npi, caqh_id, caqh_last_attested_date, dea_number, taxonomy_code, specialty, start_date, status, is_new_grad, terminated_date, degree, school_name, graduation_date, malpractice_*, created_at, updated_at`.

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

`id, org_id, provider_id, group_id, facility_id, payer_id, state, specialty, credentialing_status_id, mso_id, submitted_date, approved_date, expected_effective_date, confirmed_effective_date, termination_date, assigned_to, created_by, created_at, updated_at`.
**Unique** `(provider_id, payer_id, state)`. Credentialing status only.

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

`id, org_id, ts, user_id, user_name, action_type, entity_type, entity_id, before jsonb, after jsonb, description, created_at`. No edit, no delete, by anyone — including admins.

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
