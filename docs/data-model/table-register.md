# Table Register

The living inventory of every table in the public schema: its layer in the data
model, its lifecycle status, and its replacement when superseded. This is the
reconciliation surface for the planning harness (chatprd → reviewer → dev):

- **Epic authors / chatprd**: every epic lists a _table trace_ — the tables its
  screens and API calls read and write. Reconcile the trace against this
  register at design time; a core table absent from a stage's traces must be a
  deliberate decision, not an omission.
- **Reviewer**: check the epic's table trace against the register and the diff.
  Any migration PR that adds or supersedes a table/column updates the register
  row in the same PR.
- **Stage gates**: at each stage promotion, re-run the usage audit (grep
  `from("<table>")` across `src/`, excluding tests) and diff against the
  register. A table whose usage drops to zero is re-statused deliberately or
  the drop is a redesign bug.

## Status vocabulary

- **core** — the model's spine; epics must account for it.
- **support** — real but peripheral; used by specific features.
- **frozen-mirror** — legacy columns/tables kept per the additive rule;
  readable, never the source of truth. Must name its replacement.
- **dormant** — no code reads or writes it; kept for history/backup.
- **dead** — no code usage and no data value; never reference again.

## The data model in one paragraph

`credential_cases` is the center: one row per provider × payer × state (an
application per customer × product × jurisdiction). The party layer
(groups, providers, facilities, licenses, payers, MSOs) feeds it; `contracts`
(group × payer × state) is the entity-level agreement a case rides on (a value
join on that triple — there is no FK); the ledger layer (`touches`,
`status_history`, `audit_log`, `communication_event`) is the append-only
journal of everything that happened to it. Current status columns are
materialized balances; the ledger is the transaction log that produced them.

## Register (audited 2026-07-10)

Usage = non-test files in `src/` referencing the table (services, server
routes, lib). RPC-mediated tables note the RPC.

| Table                         | Layer     | Status                                         | Usage                   | Notes / replacement                                                                                                                                                                   |
| ----------------------------- | --------- | ---------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| organizations                 | tenant    | core                                           | 2                       | + `create_organization` RPC                                                                                                                                                           |
| memberships                   | tenant    | core                                           | 6                       | the M:N house pattern                                                                                                                                                                 |
| profiles                      | tenant    | core                                           | 7                       | mirrors `auth.users`                                                                                                                                                                  |
| pending_invites               | tenant    | support                                        | 1 + `claim_invites` RPC | RPC-mediated by design                                                                                                                                                                |
| provider_groups               | party     | core                                           | 3                       | sprawl target: 30 purpose-keyed contact/address columns → planned `group_addresses` / `group_contacts` child tables                                                                   |
| providers                     | party     | core                                           | 4                       | `license_*` mirrors `state_licenses` (child table is truth); `malpractice_*` → planned `provider_insurance_policies`; `launch_id` column is dead                                      |
| facilities                    | party     | core                                           | 5                       | absorbed the launches concept (location status track)                                                                                                                                 |
| provider_facility_assignments | party     | core                                           | 4                       | template for planned `provider_group_assignments` (provider↔group is really M:N)                                                                                                      |
| state_licenses                | party     | core                                           | 4                       | source of truth for licensure                                                                                                                                                         |
| payers                        | party     | core                                           | 3                       | org-scoped + global catalog (`org_id` NULL)                                                                                                                                           |
| org_payer_assignments         | party     | core                                           | 1                       | catalog subscription join                                                                                                                                                             |
| msos                          | party     | support                                        | 1                       |                                                                                                                                                                                       |
| mso_routing_rules             | party     | support                                        | 2                       | no uniqueness/priority — overlapping rules are storable                                                                                                                               |
| credential_cases              | work      | **core (center)**                              | 7                       | unique `(provider_id, payer_id, state)`; `credentialing_status_id` nullable (MVD gap)                                                                                                 |
| contracts                     | work      | core                                           | 2                       | MVD gap: `group_id`/`payer_id`/`contracting_status_id` all nullable — nullable columns inside the unique triple mean the one-contract-per-(group,payer,state) invariant is unenforced |
| tasks                         | work      | core                                           | 5                       | no owner CHECK — a task with neither case nor provider is storable                                                                                                                    |
| sop_templates                 | work      | support                                        | 1                       | matching precedence lives in `src/lib/sopResolver.ts`                                                                                                                                 |
| status_configs                | work      | core                                           | 3                       | no `(org_id, track, label)` uniqueness                                                                                                                                                |
| touches                       | ledger    | core                                           | 7                       | the touchlog; reference-standard table shape                                                                                                                                          |
| status_history                | ledger    | core                                           | 1 + RPC writes          | append-only; XOR case/contract enforced                                                                                                                                               |
| communication_event           | ledger    | support                                        | 2                       | batch-call parent                                                                                                                                                                     |
| audit_log                     | ledger    | core                                           | 2 + RPC writes          | append-only, immutable                                                                                                                                                                |
| notes                         | ledger    | frozen-mirror (case/task) / support (provider) | 1                       | case/task rows migrated to `touches` (2026-07-07); still the live store for provider notes                                                                                            |
| notes_pre_touchlog_backup     | ledger    | dormant                                        | 0                       | migration backup                                                                                                                                                                      |
| launches                      | work      | dead                                           | 0                       | replaced by facilities location track; only inbound ref is the dead `providers.launch_id`                                                                                             |
| provider_documents            | work      | dormant — decide                               | 0                       | fully-built table (doc types, owner CHECK, indexes) with zero application code touching it; decide build-or-retire during Stage 0 planning                                            |
| group_insurance_policies      | party     | support                                        | 2                       | template for planned `provider_insurance_policies`                                                                                                                                    |
| user_table_prefs              | config    | support                                        | 2                       | also backs extension view prefs                                                                                                                                                       |
| portal_field_maps             | extension | core (ext)                                     | 1 + server routes       | `org_id` NULL = global catalog row                                                                                                                                                    |
| portals                       | extension | support                                        | 1                       | owns the `portal_key` natural key shared with `portal_field_maps` / `fill_sessions` (no FK)                                                                                           |
| fill_sessions                 | extension | support                                        | 2                       |                                                                                                                                                                                       |
| field_dictionary              | extension | support                                        | 1                       |                                                                                                                                                                                       |

## Design rules (defended by this register)

1. **Grain rule.** Every table has exactly one grain (case = provider×payer×
   state; contract = group×payer×state; license = provider×state). A new field
   goes on the table whose grain matches how the field varies. A field that
   varies by state, purpose, or payer is a child row keyed by that dimension —
   never a new column on a grain-less master row. (The `provider_groups`
   billing/correspondence/credentialing column blocks are the cautionary tale.)
2. **M:N rule.** Any relationship that could plausibly become many-to-many gets
   a join table from day one. `memberships`, `org_payer_assignments`, and
   `provider_facility_assignments` are the house pattern. `providers.group_id`
   (single-group assumption, now known false) is the cautionary tale.
3. **Ledger rule.** History lives in append-only event tables, never in master
   rows. Latest-wins columns (e.g. `credential_cases.payer_reference_id`) are
   acceptable only when per-event history explicitly lives in the touchlog.
4. **Supersede, don't mutate.** Per the additive migration rule, a replaced
   structure becomes a frozen mirror with its replacement named here; when the
   redesigned UI leaves a mirror with no readers, it is re-statused dormant.
