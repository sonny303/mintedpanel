# Schema

All tables live in the `public` schema, carry `org_id uuid NOT NULL`, and are RLS-scoped to the caller's memberships. Every table has explicit `GRANT`s for `authenticated` and `service_role`. Append-only tables have no UPDATE/DELETE policies.

## Core rules

- **Unique case**: one row in `credential_cases` per `(provider_id, group_id, payer_id, state)` — `UNIQUE NULLS NOT DISTINCT` since E2.1 (`20260713150000`), so legacy NULL-group rows stay unique at the old 3-part key. Credentialing only — contracting status lives on `contracts`.
- **Contracts**: one row per `(group_id, payer_id, state)`. Contracting status, effective/expiration dates.
- **Append-only**: `touches`, `status_history`, `audit_log`. Never updated, never deleted.
- **PHI minimization**: `providers.ssn_last4` only. Full SSN is never stored or accepted.
- **Role checks**: `admin` (full), `specialist` (operational write), `billing` (read-only at policy level). Enforced via `has_role(uid, role)` security-definer function.
- **Grain rule**: a new field goes on the table whose grain matches how the field varies. A field that varies by state, purpose, or payer is a child row keyed by that dimension — never a new column on a grain-less master row.
- **M:N rule**: any relationship that could plausibly become many-to-many gets a join table from day one (`memberships`, `org_payer_assignments`, `provider_facility_assignments` are the house pattern).
- **Table register**: `docs/data-model/table-register.md` is the living inventory (layer, lifecycle status, replacement) for every table; any migration that adds or supersedes a table/column updates it in the same PR. Spike findings and the hardening backlog: `docs/data-model/spike-2026-07-10-findings.md`.

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
(owner party + `owner` role at org scope). **Redesign E0.2 added a further
additive 5-arg overload
`create_organization(p_name, p_owner_name, p_owner_email, p_customer jsonb, p_sales_rep jsonb DEFAULT NULL)`**
(migration `20260709130000_create_organization_rpc_v3_contacts.sql`): also
requires a customer-escalation contact + sales rep (stored as parties with their
roles; sales rep defaults to Zeb Loewenstine when omitted) via the
`assert_contact_valid` / `insert_contact_party` helpers. Legacy 1-arg and 3-arg
overloads are retained (additive rule) but the redesign app calls only the
enforced 5-arg form.

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

`id, org_id, provider_id, state, license_number, license_type, issue_date, expiration_date, status, created_at`. **E1.3 PSV trail (`20260712120100`):** `verified_status` (unverified|verified|failed CHECK), `verified_at`, `verified_by`, `verification_source_url`.

### provider_group_assignments (E1.3, 2026-07-12)

`id, org_id, provider_id, group_id, is_primary, created_at`. The M:N provider↔group join (migration `20260712120000`, mirrors the `provider_facility_assignments` template): org-scoped RLS, `UNIQUE (provider_id, group_id)`, partial unique ONE `is_primary` per provider. `providers.group_id` is a FROZEN legacy mirror of the primary assignment — no new readers.

### payers

`id, org_id, name, is_active, avg_decision_days, provisional_billing_allowed, provisional_billing_notes, retro_billing_allowed, retro_billing_window_days, caqh_pull_deadline_days, provider_type_path, prior_auth_vendor, payer_billing_id, portal_url, created_at`. **`org_id` is NULLABLE (P2, migration `20260707060000`): a NULL row is a global-catalog payer, visible to an org only via `org_payer_assignments`.** SELECT policy = `(org_id IN user_org_ids()) OR (org_id IS NULL AND assigned)`; writes stay own-org-only (org users can't create/edit global rows). **E1.6 catalog identity columns (`20260712180000`):** `payer_kind` (CHECK commercial|medicare|medicaid|medicaid_mco|medicare_advantage|tricare, default commercial), `status` (active|merged|retired), `aliases text[]`, `states text[]`, **`payer_slug`** (canonical dataset key, partial UNIQUE `uq_payers_payer_slug WHERE payer_slug IS NOT NULL` — the sync dedupe/identity key), dormant `prerequisite_payer_id`/`merged_into_id` self-FKs, `cms_hios_id`, `last_synced_at`.

### payer_catalog_changes (E1.6, 2026-07-12)

`id, payer_id, field, old_value, new_value, source, review_state (unreviewed|accepted|rejected), reviewed_by, reviewed_at, created_at`. Append-only sync diff log (migration `20260712180100`): authenticated shared-queue SELECT (like `inbound_leads`), NO authenticated writes — review happens through the `review_payer_catalog_change` RPC (accept applies an identity-field whitelist: name/aliases/states/cms_hios_id/status — never the slug or curated fields). `list_global_payers` (SECURITY DEFINER read) serves the browse-everything directory without touching the P2 RLS disjunction.

### org_payer_assignments (P2, 2026-07-07)

`id, org_id, payer_id, starter, created_at`. Per-org subscription to a global-catalog payer, unique `(org_id, payer_id)`; `starter` flags starter-pack payers (Epic 1c / P4). RLS: member SELECT own-org, admin INSERT/UPDATE/DELETE own-org. Migration `20260707060000_global_catalog_org_assignment.sql`. Catalog isolation is a browser-RLS concern (not the /api gate) — verified by `scripts/verify-catalog-rls.sql`.

### payer_network_targets (E1.5, 2026-07-12)

`id, org_id, payer_id, group_id, state, status (active|archived), created_at`. The group×payer×state attachment grain under the org-level "we work with this payer" intent — DISTINCT from the `org_payer_assignments` subscription layer (locked [stage-1b] split; `org_id` deliberately denormalized for RLS). `UNIQUE (group_id, payer_id, state)`; `state ~ '^[A-Z]{2}$'`; FK cover indexes. RLS: member SELECT own-org; admin INSERT/UPDATE WITH CHECK additionally requires the group to belong to the org AND a matching `org_payer_assignments` row. Archive = status flip, never DELETE; E2.x case generation reads `status='active'`. Migration `20260712190000_payer_network_targets.sql`.

### msos

`id, org_id, name, portal_url, created_at`.

### mso_routing_rules

`id, org_id, payer_id, state, specialty, route_type, mso_id, notes, created_at` — resolves which MSO (if any) handles a new case.

### credential_cases

`id, org_id, provider_id, group_id, facility_id, payer_id, state, specialty, credentialing_status_id, mso_id, submitted_date, approved_date, expected_effective_date, confirmed_effective_date, termination_date, assigned_to, created_by, case_email_token, payer_reference_id, generation_run_id, created_at, updated_at`.
**Unique** `(provider_id, group_id, payer_id, state)` — `UNIQUE NULLS NOT DISTINCT` (E2.1 migration `20260713150000`: safety-net backfill + swap from the old 3-part constraint; NULL = NULL, so legacy NULL-group rows keep the 3-part rule). Credentialing status only. `case_email_token` is `text NOT NULL` (default `substr(md5(gen_random_uuid()::text), 1, 12)`) — the opaque per-case token the inbound email-to-touch webhook resolves back to `case_id` + `org_id` (see below). `payer_reference_id` (`text`, nullable) is the latest payer reference / submission ID, latest-wins (Story 2, migration `20260707120200_case_payer_reference_id.sql`) — per-submission history lives in the touchlog, not here. `generation_run_id` (`uuid`, nullable FK → `case_generation_runs`, E2.1 `20260713150100`): the batch that created the case; NULL = manual one-off or pre-E2.1 row.

### case_generation_runs

`id, org_id, created_by → profiles, created_at, proposed_count, created_count, skipped_existing_count, excluded_count, failed_count`. One row per confirmed generation batch (E2.1 F2.1.2), inserted BEFORE the per-row create loop so created cases can FK it. **Immutable by omission** — no UPDATE/DELETE policy or grant (`GRANT SELECT, INSERT` only); the stored counts are the confirm-time plan — since E2.4 the `case_generation_run_rows` disposition child rows supersede them at read time (zero-row runs fall back to the plan, flagged). RLS: member SELECT own-org; writer (admin|specialist) INSERT own-org. Migration `20260713150100_case_generation_runs.sql`.

### case_generation_run_rows (E2.4, 2026-07-13)

`id, org_id, run_id → case_generation_runs, provider_id, group_id, payer_id, state, disposition, reason, case_id → credential_cases (SET NULL), exclusion_id → case_generation_exclusions (SET NULL), created_at`. The immutable per-candidate disposition ledger: one row per 4-part key per run (`UNIQUE (run_id, provider_id, group_id, payer_id, state)`), written once when the outcome is known — skipped_existing/excluded at confirm (skipped rows link the BLOCKING case), created/failed as each `create_case_with_tasks` call resolves (a mid-batch crash leaves an honestly short record). `disposition ∈ {created, skipped_existing, excluded, failed}` (CHECK); created requires `case_id`, excluded/failed require `reason` (CHECKs); `state ~ '^[A-Z]{2}$'`. `reason` is the confirm-time snapshot (derivation reason / existing-case label / exclusion reason label / error message — never an exclusion note, no PHI). **INSERT-only by policy shape AND grant floor** (`GRANT SELECT, INSERT` only; no UPDATE/DELETE policy). RLS: member SELECT own-org; writer (admin|specialist) INSERT with same-org run/provider/group WITH CHECKs. Migration `20260713170000_case_generation_run_rows.sql`.

### contracts

`id, org_id, group_id, payer_id, state, effective_date, expiration_date, notes, contracting_status_id, created_at, updated_at`. Contracting status lives here, never on cases.

### tasks

`id, org_id, case_id, provider_id, title, description, sop_content, status, sort_order, due_date, completed_date, is_auto_generated, created_at, updated_at, sop_template_id, sop_version`. Auto-generated on case creation from `sop_templates`. **`sop_template_id`/`sop_version` (E1.7b) stamp which SOP version generated the task — nullable, both-null-or-both-present CHECK, composite FK to `sop_template_versions (template_id, version)`; written by E2.2 generation, legacy tasks stay NULL/NULL.**

### sop_templates

`id, org_id, name, group_id, state, specialty, payer_id, task_definitions jsonb, is_archived, created_at, updated_at, current_version`. Matching ignores archived rows. Token list in `src/lib/sopResolver.ts` is closed — never accept arbitrary tokens. **`org_id` is NULLABLE (P2): a NULL row is a global-catalog SOP, visible to an org only when the org is assigned the SOP's `payer_id` (`org_payer_assignments`). A global SOP with `payer_id` NULL is the E1.7b generic FALLBACK — visible to all orgs' members (third SELECT disjunct, PM-confirmed [r4-review] Q1); exactly one is seeded (`00000000-0000-4000-a000-00000000e17b`).** `current_version` (E1.7b) is the Model A head pointer; content edits go through the `publish_sop_template_version` RPC, match-key edits stay plain head updates (unversioned).

### sop_template_versions (E1.7b, 2026-07-13)

`id, template_id → sop_templates, version, name, task_definitions jsonb, change_note, published_at, published_by`. **IMMUTABLE, INSERT-only**: one row per publish (`UNIQUE (template_id, version)`, the `tasks` composite-FK target). No `org_id` — tenancy derives from the parent; SELECT policy is an EXISTS on the parent's visibility disjunct. `authenticated` has SELECT only; writes happen exclusively inside `publish_sop_template_version` (SECURITY DEFINER, ADMIN-only for org rows, service-role-only for global rows, optimistic concurrency on `current_version`, writes the audit row), the `sop_templates_seed_version` AFTER INSERT trigger (every new head gets its version-1 row), and the migration backfill. Rollback = republish old content as N+1.

### case_generation_exclusions (E2.0, 2026-07-13)

`id, org_id, provider_id, group_id, payer_id, state, reason, note, status (active|voided), created_by → profiles, created_at, voided_by, voided_at`. Persistent reasoned exclusions the generation preview honors at the 4-part case grain. `reason ∈ {already_credentialed, panel_closed, not_pursuing, other}` (text + CHECK, not a Postgres enum); `other` requires a non-blank `note` (CHECK); `state ~ '^[A-Z]{2}$'`. Partial `UNIQUE (provider_id, group_id, payer_id, state) WHERE status='active'` — voided history never blocks a later re-exclusion. **Restore = void (status flip + `voided_by`/`voided_at`), never DELETE — there is no DELETE grant.** RLS: member SELECT own-org; INSERT/UPDATE admin-only with WITH CHECKs requiring provider AND group to belong to the org (`payer_id` unchecked — shared catalog). Migration `20260713130000_case_generation_exclusions.sql`.

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

## Redesign E0.5 — Secure data capture link + inbound leads

First surfaces that cross the app's trust boundary (unauthenticated external
writes). Two additive migrations: `20260709140000_party_capture_links.sql`,
`20260709140100_inbound_leads.sql` (repo + hosted). No pgcrypto dependency —
token entropy is two `gen_random_uuid()`s, hashing is core `sha256(bytea)`.

### party_capture_links

`id, org_id, party_id, recipient_email, token_hash, state, expires_at, used_at,
created_by, created_at`. One row per issued one-time capture link. `state`:
`active | used | expired | revoked`. Partial unique index
`(org_id) WHERE state = 'active'` enforces the single-active-link invariant in
the schema. Only the token HASH is stored (raw token lives only in the emitted
URL). Browser RLS: member SELECT only (operators read link state); every write
goes through the SECURITY DEFINER RPCs below.

### inbound_leads

`id, org_name, contact_name, contact_email, contact_phone, address_*, status,
converted_org_id, created_at`. Public "contact us" leads — NOT org-scoped (no
org until converted). `status`: `new | converted | dismissed`. RLS: any
authenticated user SELECT/UPDATE (Stage 0 shared internal triage queue);
INSERT only via the anon RPC. Converting a lead calls `create_organization`
(prospect) and sets `status='converted'` + `converted_org_id`.

### RPCs (repo migrations, not hosted-only)

- `create_capture_link(p_org_id, p_party_id, p_recipient_email, p_recipient_name
DEFAULT NULL) RETURNS jsonb` — SECURITY DEFINER, EXECUTE to `authenticated`.
  Writer-member check; resolves an existing party or provisions an ad-hoc person
  party; revokes any prior active link then issues a fresh 256-bit token
  (returned once), 72h expiry; audits. Returns `{ token, party_id,
recipient_email, recipient_name, org_name, expires_at }`.
- `validate_capture_token(p_token) RETURNS jsonb` — SECURITY DEFINER, EXECUTE to
  `anon`. Hash-validates; lazy-expires a stale-active link; returns
  `{ state, org_name, recipient_name, recipient_email, expires_at,
required_fields, current }` for an active link, `{ state }` for
  invalid/used/expired/revoked. Never leaks any org beyond the authorized one.
- `submit_capture(p_token, p_payload jsonb) RETURNS jsonb` — SECURITY DEFINER,
  EXECUTE to `anon`. Re-validates state + expiry, enforces completeness via
  `assert_contact_valid` (E0.2), overwrites the authorized party, flips the link
  to `used`, audits. Returns `{ ok, state }`.
- `submit_inbound_lead(p_payload jsonb) RETURNS jsonb` — SECURITY DEFINER,
  EXECUTE to `anon`. Honeypot (`company_website`) + required-field validation;
  inserts a `new` lead (never an org). Returns `{ ok }`.

## Redesign E0.6 — Secure read-only report share

The app's SECOND public unauthenticated surface (after E0.5's capture link), but
READ-ONLY — there is no anon write RPC. Migration
`20260709150000_report_shares.sql` (repo + hosted; core sha256, no pgcrypto).

### report_shares

`id, report_key, scope, scope_org_id, recipient_email, token_hash, state,
expires_at, created_by, created_at, revoked_at`. One row per issued share.
`scope`: `full | single_org` (a CHECK ties `scope_org_id` present ⇔ single_org).
`state`: `active | revoked | expired`. 30-day expiry (vs E0.5's 72h — read-only

- scope-filtered, PM decision). Only the token HASH is stored. RLS: the creator
  reads their own shares (`created_by = auth.uid()`); all writes via the RPCs.

### RPCs (repo migration)

- `create_report_share(p_report_key, p_scope, p_scope_org_id, p_recipient_email)
RETURNS jsonb` — SECURITY DEFINER, `authenticated`. Validates scope +
  membership (single_org requires the caller to be a member), issues a 256-bit
  token (hash stored), 30-day expiry; audits; returns the raw token once.
- `revoke_report_share(p_id) RETURNS void` — SECURITY DEFINER, `authenticated`.
  Creator-only, active-only → `revoked` + `revoked_at`.
- `validate_report_share(p_token) RETURNS jsonb` — SECURITY DEFINER, `anon`.
  Hash-validates, lazy-expires, and returns ONLY the in-scope orgs (full = every
  org the creator belongs to; single_org = the one scope org). The scope filter
  is applied server-side, so a filtered share cannot leak other orgs (TE-6).
  Read-only — no write RPC.

## Redesign E0.7/E0.8 — Stage 0 hardening (grants + rate limiting)

E0.7 (`20260710120000_stage0_grant_hardening.sql`) locked down the Stage 0
GRANT surface; `scripts/verify-stage0-rls-grants.sql` is the re-runnable audit
(empty result set = pass; run via MCP `execute_sql`). E0.8 adds the BD-1
in-Postgres rate limiter (`20260710130000_public_rpc_rate_limiting.sql`, repo +
hosted) and folds the check into the four anon RPCs.

### public_rpc_attempts

`id, rpc_name, caller_hash, attempted_at, was_valid`. One row per public-RPC
attempt, keyed by `sha256(inet_client_addr())` (core sha256, no pgcrypto). RLS
enabled with NO policies — only the SECURITY DEFINER helpers and service_role
touch it. Lazily pruned (rows older than 2x the window for the caller+rpc are
deleted on each check).

### Helpers (SECURITY DEFINER, NO anon/authenticated EXECUTE)

- `check_rpc_throttle(p_rpc_name, p_max_attempts, p_window_minutes, p_count_all
DEFAULT false) RETURNS boolean` — counts the caller's recent FAILED attempts
  (or ALL when `p_count_all`), logs the current attempt, returns
  allowed/throttled.
- `mark_rpc_attempt_valid(p_rpc_name) RETURNS void` — flips the caller's latest
  attempt to `was_valid = true` after a successful token lookup. Deliberately
  NOT executable by anon/authenticated: the public RPCs are SECURITY DEFINER so
  their inner calls run as the function owner, and an anon-callable mark-valid
  would let an attacker whitewash failed probes and defeat the throttle. The
  grants audit asserts both helpers stay locked down.

### Throttled RPC behavior (CREATE OR REPLACE of the four E0.5/E0.6 anon RPCs)

- `validate_capture_token` / `submit_capture` / `validate_report_share`: 20
  FAILED attempts / 15 min per source fingerprint; a successful hash lookup is
  marked valid and does not count toward the cap. Throttled → the same generic
  `{ state: 'invalid' }` (`{ ok: false, state: 'invalid' }` for submit) as a
  wrong token — invalid/revoked/expired/throttled stay indistinguishable.
- `submit_inbound_lead`: 5 TOTAL attempts / 60 min (a submission cap, not a
  validation cap); throttled → fake success `{ ok: true }`, the same response
  as the honeypot path.

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
