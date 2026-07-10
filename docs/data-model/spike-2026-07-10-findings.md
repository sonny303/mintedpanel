# Data-Model Spike — Findings & Open Questions (2026-07-10)

Consolidated output of the Stage 0 data-model spike: join audit, hardening
backlog, MVD definitions, and the business questions that gate the structural
work. The living inventory lives in `table-register.md`; this file is the
point-in-time findings and the work queue derived from them.

## 1. Join audit summary

Of ~20 relationships: 2 structurally wrong, ~8 under-constrained, the rest
sound. The ledger layer is the best-built part of the schema; the party layer
is the weakest.

**Structurally wrong:**

1. **provider ↔ group cardinality.** Modeled as `providers.group_id` (1:N) but
   a provider can work under multiple groups/TINs (M:N). Fix: additive
   `provider_group_assignments (org_id, provider_id, group_id, is_primary,
start_date, end_date, UNIQUE(provider_id, group_id))`, backfilled from
   `providers.group_id`, which then becomes a frozen "primary group" mirror.
   `credential_cases.group_id` already records which TIN each case is
   credentialed under, so case history survives; case creation changes from
   "copy the provider's group" to "pick which of the provider's groups"
   (auto-pick when sole). The extension profile endpoint grows `?groupId=`
   mirroring the existing `?facilityId=` selection pattern (`meta.needs_group`
   when ambiguous; the server never guesses).
2. **case ↔ contract is an invisible join.** No FK; the relationship is a value
   join on `(group_id, payer_id, state)` resolved in app code, and the nullable
   columns in the contract unique key make even that unreliable. Harden the
   NOT NULLs first; optionally add `credential_cases.contract_id` later to make
   the join explicit and survive grain changes (renewals/versions).

**Under-constrained (the hardening bundle — one low-risk migration):**

- NOT NULL (via `CHECK ... NOT VALID` → validate) on `contracts.group_id`,
  `contracts.payer_id`, `provider_facility_assignments.provider_id/facility_id`,
  `state_licenses.provider_id` — nullable columns inside UNIQUE constraints
  mean those invariants are silently unenforced (NULLs never collide).
- `CHECK (state ~ '^[A-Z]{2}$')` (NOT VALID first) on the six state columns.
- ~10 missing FK indexes (`credential_cases.payer_id/group_id/mso_id/
assigned_to`, `contracts.group_id/payer_id`, `state_licenses.provider_id`,
  `touches.coordinator_id`, `tasks.provider_id`, `status_history.changed_by`).
- `UNIQUE(org_id, payer_id, state, specialty)` on `mso_routing_rules`.
- `UNIQUE(org_id, track, label)` on `status_configs`.
- Partial unique `provider_facility_assignments (provider_id) WHERE is_primary`.
- `CHECK (case_id IS NOT NULL OR provider_id IS NOT NULL)` on `tasks`.
- `entity_type` CHECK on `audit_log`.

**Middle-layer impact:** the hardening bundle is nearly invisible to
`src/services/*` and `/api` — a few input types tighten (contract create makes
group/payer required) and duplicate-key errors get friendly handling. Only the
multi-group change meaningfully touches the API layer, and it copies the
existing facility-selection pattern.

## 2. Data-quality ownership

- **Database = invariants (the floor).** The browser writes straight to
  Postgres under RLS; there is no API choke-point for most writes, so any
  invariant not in the DB is unenforced.
- **Services = normalization + cross-entity coherence** (state casing, "facility
  belongs to this provider") with friendly errors — services are the single
  write path by convention.
- **Frontend = completeness nudges only** (required-field UX, Fix-it queue) —
  never the only thing between a bad row and the database.

## 3. MVD (minimum viable data) per transactional record

| Table            | MVD                                                                             | Current gaps                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| credential_cases | org, provider, payer, state, credentialing_status, created_by, case_email_token | `credentialing_status_id` nullable (invisible to the action engine); `group_id` becomes required once multi-group lands |
| contracts        | org, group, payer, state, contracting_status (dates legitimately unknown early) | group/payer/status all nullable — the highest-value MVD fix                                                             |
| touches          | org, case, date, entry_type, author-or-source; touchpoint → channel + outcome   | essentially fully enforced — the reference standard                                                                     |
| status_history   | org, exactly-one-of case/contract, track, to_status, changed_by                 | `to_status_id` and `changed_by` nullable                                                                                |
| tasks            | org, owner (case or provider), title, status                                    | owner not enforced                                                                                                      |
| audit_log        | org, ts, actor-or-system, action_type, entity_type, entity_id                   | `entity_type` free text; nothing distinguishes system actions from missing actor                                        |

## 4. Open questions (gate the structural work)

1. **Multi-group semantics** — can the same provider + payer + state exist as
   two cases under different groups/TINs? If yes, the case unique key must
   become `(provider_id, payer_id, state, group_id)` — a bigger change than the
   join table. If no, the current key stands.
2. **Contract renewals** — ever more than one contract per (group, payer,
   state) over time? If yes, the unique triple needs a version/status dimension
   and the explicit `contract_id` FK on cases moves up the queue.
3. **Facility-less providers / group-less facilities** — legitimate states
   (telehealth-only) or data gaps? Decides whether to constrain.
4. **NULL-status cases** — how many live rows have `credentialing_status_id`
   NULL in the hosted DB? Sizes the backfill for the NOT NULL.
5. **State scope** — US states only, or territories/wildcards? Decides the
   exact CHECK shape.
6. **`contracts.payer_group_id`** — definition needed (payer-assigned group
   number? state-varying?) for SCHEMA.md.
7. **`provider_documents`** — build or retire? (Zero code usage today; see
   register.)

## 5. Sequencing recommendation

1. **Hardening bundle** as the next data epic — constraints are nearly free
   before the redesigned UI builds on these tables.
2. **`provider_group_assignments`** before any epic that redesigns case
   creation or the extension profile (it changes product UX — a "which TIN?"
   picker — not just schema). Gated on question 1.
3. **`group_addresses` / `group_contacts`** bundled with whichever epic touches
   the group settings UI (right fix, no urgency).
4. **`provider_insurance_policies`** likewise, with the provider form epic.
5. Documentation-only: case↔contract value join, `payer_group_id`, ON DELETE
   policy, `facilities` jsonb shapes, SOP matching precedence, `portals` owns
   `portal_key`.
