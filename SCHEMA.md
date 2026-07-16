# Schema

All tables live in the `public` schema, carry `org_id uuid NOT NULL`, and are RLS-scoped to the caller's memberships. Every table has explicit `GRANT`s for `authenticated` and `service_role`. Append-only tables have no UPDATE/DELETE policies.

## Core rules

- **Unique case**: one row in `credential_cases` per `(provider_id, group_id, payer_id, state)` — `UNIQUE NULLS NOT DISTINCT` since E2.1 (`20260713150000`), so legacy NULL-group rows stay unique at the old 3-part key. Credentialing only — contracting status lives on `contracts`.
- **Contracts**: one row per `(group_id, payer_id, state)`. Contracting status, effective/expiration dates.
- **Append-only**: `touches`, `status_history`, `audit_log`. Never updated, never deleted.
- **PHI minimization**: `providers.ssn_last4` only in ordinary tables. The full SSN exists solely in the E4.4 server-only vault (separated table, no client SELECT grant, encrypted at rest, audited definer-RPC access only — PM security decision 2026-07-14); it is never stored or accepted anywhere else.
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

`id, org_id, group_id, first_name, last_name, middle_initial, suffix, credentials, date_of_birth, gender, ethnicity, ssn_last4, email, phone, home_*, npi, caqh_id, caqh_last_attested_date, dea_number, dea_expiration_date, taxonomy_code, specialty, sub_specialty, board_certified, languages, medicaid_attested, cultural_competency_training, additional_certifications, age_groups_served, start_date, status, is_new_grad, terminated_date, degree, school_name, graduation_date, malpractice_*, license_number, license_state, license_issue_date, license_expiration_date, reference_only, verification_state, created_at, updated_at`.
`reference_only` (`boolean NOT NULL DEFAULT false`, migration `20260707150000_reference_only_flag.sql`, Epic 2e): a migrated/onboard-existing provider that exists to be referenced, not worked — skipped by the action engine, the Fix-it queue, and Home queues, and listed under a "Reference" section (with a "Reference" chip) in the providers work view. All pre-migration rows are `false`.
`verification_state` (`text NOT NULL DEFAULT 'verified'`, CHECK `IN ('verified','pending_verification')`, migration `20260713190000_provider_verification_state.sql`, E3.1 TE-1): the bulk-import staging fence. Committed import rows land `pending_verification` and are excluded from E1.8 readiness AND E2.0 generation candidacy by a single `.neq('verification_state','pending_verification')` filter on `listProviderReadinessFacts` (the ONE shared read both surfaces consume) until an explicit verify action flips them to `verified`. The `verified` DEFAULT preserves every pre-migration row. Distinct from `reference_only` (action-engine meaning) and `status` (onboarding/active/terminated). Partial index `idx_providers_pending_verification (org_id) WHERE verification_state='pending_verification'`.
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

### org_payer_assignments (P2, 2026-07-07; lifecycle E4.2, 2026-07-15)

`id, org_id, payer_id, starter, status (active|archived), archived_at, created_at`. Per-org subscription to a global-catalog payer, unique `(org_id, payer_id)`; `starter` flags starter-pack payers (Epic 1c / P4). **E4.2 hardening (`20260715160000`): `status`/`archived_at` make the subscription reversible & history-safe** — adding a canonical payer is a first-class org-admin action, removal ARCHIVES (never DELETE) like `payer_network_targets`, and reactivation is a status flip (existing rows default `active`; partial index `idx_org_payer_assignments_org_active` on the active-per-org read). RLS: member SELECT own-org, admin INSERT/UPDATE/DELETE own-org. **Atomic archive via the `archive_org_payer_assignment(p_org_id, p_payer_id)` RPC** (SECURITY INVOKER, admin-guarded): flips the assignment to archived AND archives its active `payer_network_targets` in one transaction (the assignment row is preserved so the targets' RLS WITH CHECK still passes and history survives); returns `{ assignment, archived_target_count }`. Reactivation never recreates scope — archived targets stay archived for the existing restore/review flow. Migrations `20260707060000_global_catalog_org_assignment.sql`, `20260715160000_org_payer_assignment_lifecycle.sql`. Catalog isolation is a browser-RLS concern (not the /api gate) — verified by `scripts/verify-catalog-rls.sql`.

### payer_network_targets (E1.5, 2026-07-12)

`id, org_id, payer_id, group_id, state, status (active|archived), created_at`. The group×payer×state attachment grain under the org-level "we work with this payer" intent — DISTINCT from the `org_payer_assignments` subscription layer (locked [stage-1b] split; `org_id` deliberately denormalized for RLS). `UNIQUE (group_id, payer_id, state)`; `state ~ '^[A-Z]{2}$'`; FK cover indexes. RLS: member SELECT own-org; admin INSERT/UPDATE WITH CHECK additionally requires the group to belong to the org AND a matching `org_payer_assignments` row. Archive = status flip, never DELETE; E2.x case generation reads `status='active'`. Migration `20260712190000_payer_network_targets.sql`.

### msos

`id, org_id, name, portal_url, created_at`.

### mso_routing_rules

`id, org_id, payer_id, state, specialty, route_type, mso_id, notes, created_at` — resolves which MSO (if any) handles a new case.

### credential_cases

`id, org_id, provider_id, group_id, facility_id, payer_id, state, specialty, credentialing_status_id, mso_id, submitted_date, approved_date, expected_effective_date, confirmed_effective_date, termination_date, assigned_to, created_by, case_email_token, payer_reference_id, generation_run_id, payer_pipeline_state, payer_provider_id, payer_individual_provider_id, payer_group_provider_id, created_at, updated_at`.
**Unique** `(provider_id, group_id, payer_id, state)` — `UNIQUE NULLS NOT DISTINCT` (E2.1 migration `20260713150000`: safety-net backfill + swap from the old 3-part constraint; NULL = NULL, so legacy NULL-group rows keep the 3-part rule). Credentialing status only. `case_email_token` is `text NOT NULL` (default `substr(md5(gen_random_uuid()::text), 1, 12)`) — the opaque per-case token the inbound email-to-touch webhook resolves back to `case_id` + `org_id` (see below). `payer_reference_id` (`text`, nullable) is the latest payer reference / submission ID, latest-wins (Story 2, migration `20260707120200_case_payer_reference_id.sql`) — per-submission history lives in the touchlog, not here; **E4.0** reuses it as the pipeline Tracking ID. `generation_run_id` (`uuid`, nullable FK → `case_generation_runs`, E2.1 `20260713150100`): the batch that created the case; NULL = manual one-off or pre-E2.1 row. **E4.0 external pipeline (parallel to the internal `credentialing_status_id` machine, A3 decoupling):** `payer_pipeline_state text NOT NULL DEFAULT 'not_started'` CHECK `∈ {not_started, assigned, drafting, submitted, in_review, action_required, approved, denied, oon}` (migration `20260715120000`); Approved writes `confirmed_effective_date` (reused, no new column) + the two structured payer-issued IDs `payer_individual_provider_id` (Type 1 / NPI-linked) and `payer_group_provider_id` (Type 2 / Tax-ID-linked) (`20260715120500`). `payer_provider_id` (`20260715120100`) is a **dormant** single-id column superseded by the split — kept per the additive rule, never read/written. All pipeline transitions go ONLY through the `advance_payer_pipeline` RPC (below).

### payer_pipeline_history (E4.0, 2026-07-15)

`id, org_id, case_id → credential_cases, from_state, to_state, reason_code_id → denial_reason_codes (SET NULL), is_correction, justification, changed_by, changed_at`. The append-only external-pipeline transition log (migration `20260715120300`), a dedicated sibling of `status_history` (which can't hold the payer enum — its `from/to_status_id` FK `status_configs` and its `track` CHECK is `credentialing|contracting`). `from_state`/`to_state` share the 9-value CHECK domain of `credential_cases.payer_pipeline_state`; `is_correction` + `justification` carry the admin correction row (CHECK: justification present when `is_correction`; also stores the Denied-"Other" single-line context). **Append-only by policy shape AND grant floor** (`GRANT SELECT, INSERT` only; no UPDATE/DELETE). RLS: member SELECT own-org (the visible timeline is read-only to ALL roles incl. billing); writer (admin|specialist) INSERT with same-org case WITH CHECK. FK-cover index on `case_id`. Written ONLY by `advance_payer_pipeline`.

### denial_reason_codes (E4.0, 2026-07-15)

`id, org_id (NULL = global default), code, label, active, created_at`. The governed denial/return reason vocabulary (migration `20260715120200`; F4.0.4). Six global defaults seeded (`org_id NULL`): Missing Documentation, Network Closed, Demographic Mismatch, Incomplete Application, Credentialing Criteria Not Met, Other. Org-added codes (non-NULL `org_id`) are managed in **E4.2** (F4.2.3 CRUD — not built in E4.0). `UNIQUE NULLS NOT DISTINCT (org_id, code)`. RLS: member SELECT the global + own-org rows; admin-only INSERT/UPDATE. Codes deactivate (`active=false`), never delete, so `payer_pipeline_history.reason_code_id` references never dangle.

**`advance_payer_pipeline(p_case_id, p_to_state, p_expected_state, p_reason_code_id, p_justification, p_is_correction, p_effective_date, p_individual_provider_id, p_group_provider_id) RETURNS jsonb`** (E4.0 TE-5, migrations `20260715120400` + `20260715120500`): the ONE atomic transition entry point. **SECURITY INVOKER** (runs under the caller's RLS — no privilege escalation; billing has no `credential_cases` UPDATE policy so it is read-only automatically), pinned `search_path`, EXECUTE `authenticated` only. In one transaction it: validates the edge against the TE-1 domain (mirrored in SQL — a rejected edge RAISEs `pipeline_invalid_transition` and rolls back, so NO history row and NO partial write), enforces the reason-code rules (Denied requires a code; "Other" requires the justification context; RFI reason optional), the admin-only gate for corrections/post-terminal/approval-reversal (`user_role(org) = 'admin'` — RLS can't express "only when is_correction or terminal"), optimistic concurrency (`p_expected_state` ≠ current → `pipeline_state_conflict:<actual>`), then updates `payer_pipeline_state`, applies the Approved enrollment writes (or clears them on an admin approval reversal), inserts the `payer_pipeline_history` row, and writes an in-RPC `audit_log` STATUS_CHANGE row. Reapply (Denied → Drafting) is a normal forward edge, not a correction. Edge map + labels + terminal set are the shared pure `src/lib/payerPipeline.ts`.

### case_generation_runs

`id, org_id, created_by → profiles, created_at, proposed_count, created_count, skipped_existing_count, excluded_count, failed_count`. One row per confirmed generation batch (E2.1 F2.1.2), inserted BEFORE the per-row create loop so created cases can FK it. **Immutable by omission** — no UPDATE/DELETE policy or grant (`GRANT SELECT, INSERT` only); the stored counts are the confirm-time plan — since E2.4 the `case_generation_run_rows` disposition child rows supersede them at read time (zero-row runs fall back to the plan, flagged). RLS: member SELECT own-org; writer (admin|specialist) INSERT own-org. Migration `20260713150100_case_generation_runs.sql`.

### case_generation_run_rows (E2.4, 2026-07-13)

`id, org_id, run_id → case_generation_runs, provider_id, group_id, payer_id, state, disposition, reason, case_id → credential_cases (SET NULL), exclusion_id → case_generation_exclusions (SET NULL), sop_template_id, sop_version, sop_resolution_tier, created_at`. The immutable per-candidate disposition ledger: one row per 4-part key per run (`UNIQUE (run_id, provider_id, group_id, payer_id, state)`), written once when the outcome is known — skipped_existing/excluded at confirm (skipped rows link the BLOCKING case), created/failed as each `create_case_with_tasks` call resolves (a mid-batch crash leaves an honestly short record). `disposition ∈ {created, skipped_existing, excluded, failed}` (CHECK); created requires `case_id`, excluded/failed require `reason` (CHECKs); `state ~ '^[A-Z]{2}$'`. `reason` is the confirm-time snapshot (derivation reason / existing-case label / exclusion reason label / error message — never an exclusion note, no PHI). **E4.2 SOP hardening (migration `20260716120000`):** additive `sop_template_id`/`sop_version`/`sop_resolution_tier` (nullable, CHECK `sop_resolution_tier ∈ {organization, global_payer, generic_fallback}`) record the resolution provenance of every `created` row — plain columns, no FK (a confirm-time SNAPSHOT, like `reason`, keeping the ledger truly immutable) — so generic-fallback usage is countable by run/payer/state/group/org. **INSERT-only by policy shape AND grant floor** (`GRANT SELECT, INSERT` only; no UPDATE/DELETE policy). RLS: member SELECT own-org; writer (admin|specialist) INSERT with same-org run/provider/group WITH CHECKs. Migration `20260713170000_case_generation_run_rows.sql`.

### contracts

`id, org_id, group_id, payer_id, state, effective_date, expiration_date, notes, contracting_status_id, created_at, updated_at`. Contracting status lives here, never on cases.

### tasks

`id, org_id, case_id, provider_id, title, description, sop_content, status, sort_order, due_date, completed_date, is_auto_generated, created_at, updated_at, sop_template_id, sop_version, execution_type, sop_resolution_tier`. Auto-generated on case creation from `sop_templates`. **`sop_template_id`/`sop_version` (E1.7b) stamp which SOP version generated the task — nullable, both-null-or-both-present CHECK, composite FK to `sop_template_versions (template_id, version)`; written by E2.2 generation, legacy tasks stay NULL/NULL.** **E4.2 SOP hardening — `sop_resolution_tier` (nullable CHECK `{organization, global_payer, generic_fallback}`, migration `20260716120000`) stamps the deterministic `pickTemplate` tier the SOP was selected at, so a manual case (no generation run) stays directly tier-reportable without reconstructing tier from mutable template ownership.**

### sop_templates

`id, org_id, name, group_id, state, specialty, payer_id, task_definitions jsonb, is_archived, created_at, updated_at, current_version`. Matching ignores archived rows. Token list in `src/lib/sopResolver.ts` is closed — never accept arbitrary tokens. **`org_id` is NULLABLE (P2): a NULL row is a global-catalog SOP, visible to an org only when the org is assigned the SOP's `payer_id` (`org_payer_assignments`). A global SOP with `payer_id` NULL is the E1.7b generic FALLBACK — visible to all orgs' members (third SELECT disjunct, PM-confirmed [r4-review] Q1); exactly one is seeded (`00000000-0000-4000-a000-00000000e17b`).** `current_version` (E1.7b) is the Model A head pointer; content edits go through the `publish_sop_template_version` RPC, match-key edits stay plain head updates (unversioned). **E4.2 SOP hardening — `pickTemplate` is now an EXPLICIT deterministic ranking (org exact-group → org any-group → global-payer exact-group → global-payer any-group → generic fallback → null; order-independent, another group/payer/state never resolves). The supported org-authored match key is `payer + state (+ optional group)`; `specialty` is preserved legacy/non-routing metadata, NOT a runtime match key. Additive partial unique index `uq_sop_templates_active_org_match (org_id, payer_id, state, group_id) NULLS NOT DISTINCT WHERE org_id IS NOT NULL AND payer_id IS NOT NULL AND state IS NOT NULL AND archived = false` (migration `20260716120000`) enforces one active org SOP per supported grain; `src/services/templates.ts` validates the destination key ahead of the constraint.**

### sop_template_versions (E1.7b, 2026-07-13)

`id, template_id → sop_templates, version, name, task_definitions jsonb, change_note, published_at, published_by`. **IMMUTABLE, INSERT-only**: one row per publish (`UNIQUE (template_id, version)`, the `tasks` composite-FK target). No `org_id` — tenancy derives from the parent; SELECT policy is an EXISTS on the parent's visibility disjunct. `authenticated` has SELECT only; writes happen exclusively inside `publish_sop_template_version` (SECURITY DEFINER, ADMIN-only for org rows, service-role-only for global rows, optimistic concurrency on `current_version`, writes the audit row), the `sop_templates_seed_version` AFTER INSERT trigger (every new head gets its version-1 row), and the migration backfill. Rollback = republish old content as N+1.

### case_generation_exclusions (E2.0, 2026-07-13)

`id, org_id, provider_id, group_id, payer_id, state, reason, note, status (active|voided), created_by → profiles, created_at, voided_by, voided_at`. Persistent reasoned exclusions the generation preview honors at the 4-part case grain. `reason ∈ {already_credentialed, panel_closed, not_pursuing, other}` (text + CHECK, not a Postgres enum); `other` requires a non-blank `note` (CHECK); `state ~ '^[A-Z]{2}$'`. Partial `UNIQUE (provider_id, group_id, payer_id, state) WHERE status='active'` — voided history never blocks a later re-exclusion. **Restore = void (status flip + `voided_by`/`voided_at`), never DELETE — there is no DELETE grant.** RLS: member SELECT own-org; INSERT/UPDATE admin-only with WITH CHECKs requiring provider AND group to belong to the org (`payer_id` unchecked — shared catalog). Migration `20260713130000_case_generation_exclusions.sql`.

### import_runs (E3.0, 2026-07-13)

`id, org_id, created_by → profiles, source (internal|onboarding), file_name, state, total_rows, staged_rows, error_rows, error_report jsonb, created_at, updated_at`. The bulk-roster-import run header — the durable async-scan progress record (`state ∈ {uploading, scanning, ready_for_review, committed, failed, cancelled}`, CHECK). `error_report` is the compact `[{line, column, reason}]` list (values never echoed — TE-6) that survives the `import_rows` purge, so the error-report download outlives commit/cancel. A WORKING table, not a ledger: UPDATE is allowed (state/count progress); no DELETE grant. RLS: member SELECT own-org; INSERT/UPDATE **admin-only** (the F3.0.1 role gate — the org rep is provisioned as an admin of their own org). Migration `20260713180000_import_runs_rows_staging.sql`. **E3.3** adds `entity_kind` (`text NOT NULL DEFAULT 'combined'` CHECK `provider_group|facility|provider|combined`, migration `20260714120000_import_runs_entity_kind.sql`) — the additive discriminator so one staging machine serves the three per-section uploads; `'combined'` is the legacy E3.0 default (in-flight combined runs stay reviewable). `import_rows` unchanged (its `run_id` inherits the kind).

### import_rows (E3.0, 2026-07-13)

`id, org_id, run_id → import_runs (CASCADE), line, raw jsonb, mapped jsonb, row_state (staged|error), error_column, error_reason, created_at`. The staging grain: one row per parsed source line; `UNIQUE (run_id, line)` is the idempotent resume key (a re-sent chunk conflicts instead of duplicating). `raw`/`mapped` hold parsed cells (PII under org RLS) — **a full SSN never lands here**: the client scan rejects and REDACTS any 9-digit / `NNN-NN-NNNN` value before the row is written (TE-6). Written via the batched **`stage_import_rows(p_run_id, p_rows)`** SECURITY DEFINER RPC (pinned search_path, membership + admin re-checked inside, `ON CONFLICT (run_id, line) DO NOTHING`, recomputes the run's staged/error counts; EXECUTE granted to authenticated only). Rows are **PURGED (DELETE) when a run is committed (E3.1) or cancelled** — the TE-7 staged-PII lifecycle. RLS: member SELECT own-org; admin INSERT (WITH CHECK: run belongs to the same org) + admin DELETE. Nothing here feeds live provider/group/facility tables in E3.0. Same migration as `import_runs`.

**E3.1 commit (`commit_import_run(p_run_id, p_plan jsonb) RETURNS jsonb`, migration `20260713191000_commit_import_run.sql`, repo + hosted):** the ONE transactional staged-commit RPC — SECURITY DEFINER, pinned search_path, EXECUTE `authenticated` only; re-checks org membership + admin role. `p_plan` is the reviewed dedupe/conflict plan the client built from `src/lib/importDedupe` (`creates` fold every staged line of one new provider — id ARRAYS `group_ids`/`facility_ids`/`licenses`, first group = primary; `updates` carry ONLY conflict-resolved provider `set` fields + additive `add_group_ids`/`add_facility_ids`/`license_inserts`/`license_updates`; `blocked_entries`/`skipped_count`). In ONE transaction it locks the run (idempotency guard: a `committed` run no-ops and returns the stored ids; only `ready_for_review` proceeds), validates plan↔staged-row consistency + org ownership of every referenced group/facility/provider/license, inserts providers `verification_state='pending_verification'` + their assignments (`ON CONFLICT DO NOTHING` on both assignment uniques) + licenses `unverified`, applies the narrow updates, writes one `audit_log` row per created/updated provider + a run-level `import_run` row (ids/counts only — never row PII, TE-6), flips the run to `committed` (stamping `committed_at`/`created_provider_ids`/`updated_provider_ids`, appending `blocked_entries` to `error_report`), and DELETEs the run's `import_rows`. A failure rolls the whole thing back — live tables untouched, run resumable (TE-5/TE-6/TE-8). `writeAudit` (browser-side) is deliberately NOT called by the service — the RPC owns the audit rows (the E1.7b publish-RPC precedent).

**E3.3 group/facility commit (`commitSectionImportRun`, no new RPC):** only `entity_kind='provider'` runs use `commit_import_run`. The simpler `provider_group` (dedupe grain = TIN, skip-on-match) and `facility` (grain = group + name + address) runs fan out through the EXISTING create services (`createProviderGroup`/`createFacility`) — a thin per-kind branch, not a second engine (E3.3 TE-8; `src/lib/importDedupe` `dedupeGroupRows`/`dedupeFacilityRows`). The service runs the create loop, then flips the run to `committed` (`WHERE state='ready_for_review'`) and purges `import_rows`; not single-transaction like the RPC, but a mid-loop failure leaves the run resumable — the TIN / name+address dedupe skips what already landed. The create services own their per-entity audit rows.

### status_configs

`id, org_id, track, label, color, sort_order, required_fields, action_bucket, created_at` — `track ∈ {credentialing, contracting, location}`. The location track drives the Launches pipeline.

### status_history (APPEND-ONLY)

`id, org_id, case_id, contract_id, track, from_status_id, to_status_id, metadata, changed_by, changed_at, created_at`.

### touches (APPEND-ONLY) — the touchlog

`id, org_id, case_id, touch_date, entry_type, touch_type, outcome, next_follow_up_date, notes, coordinator_id, task_id, communication_event_id, source, created_at, clears_follow_up, recipient_name, recipient_contact, corrects_touch_id`.

The single case-activity spine (Story 1, migration `20260707120000_touchlog_entry_types.sql`). `entry_type ∈ {touchpoint, note, system_event, task_update}` (CHECK). Only touchpoints carry a channel — `touch_type`/`outcome` are nullable; note/system_event/task_update entries put their text in `notes`. `task_id` (nullable FK → `tasks`) links a note/update to a task and drives the task detail's filtered slice. `communication_event_id` (nullable) links a touchpoint to a batch payer call (Story 8; FK + parent table land in the Story 8 migration). Indexed on `task_id` and `entry_type`.

**E4.1 (Structured Touches & Follow-up Cadence, migration `20260715130000_structured_touches.sql`):** `touch_type` widened to the seven fixed E4.1 types `{call, email, portal, fax, caqh_update, provider_outreach, internal_sync}` ∪ legacy `mail` (see `src/lib/touchTypes.ts`; provider_outreach + internal_sync are the internal-facing pair). `outcome` CHECK gains the optional disposition set `{successful, attempted, no_response, error, other}` (`src/lib/touchDispositions.ts`) on top of the Story 3 taxonomy ∪ legacy codes. `touches_touchpoint_shape_check` **loosened**: a touchpoint must carry `touch_type`, but `outcome` may now be NULL (F4.1.4). New additive columns: `clears_follow_up boolean NOT NULL DEFAULT false` (the only way to end a follow-up — F4.1.2 carry-forward: a date-less touch carries the prior follow-up forward), `recipient_name` / `recipient_contact` (optional recipient capture, F4.1.5), and `corrects_touch_id` (self-FK — corrections are appends, never edits; indexed `touches_corrects_touch_id_idx`). Still append-only: no UPDATE/DELETE policy, corrections included.

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
