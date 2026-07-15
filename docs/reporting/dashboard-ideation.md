# Minted Panel — Reporting & Dashboard Ideation

Audience-anchored dashboard ideation for the **authoritative signer** (the practice `owner`), with internal operational reporting positioned as a feeder layer. Ideation only — no code, no SQL. Every metric traces to a real table + column verified against live project `fkvuhfsqcmujywzgczmc`.

## Reading context

### Real vs. test data (and how they were separated)

| Bucket | Orgs | Signal used to classify |
|---|---|---|
| **Real customers (in scope)** | Kansas Fitness Physio (`20563fd6…`, 7 providers / 48 cases / 10 locations), South Park **Physician Group** (`d0e40000-0000-4000-a000-000000000001`, 4 / 13 / 2) | Carry operational data (48 & 13 cases); 4 members each; organic UUIDs & created dates weeks apart |
| **Test universe (excluded)** | 11-org block `5eed0001-0000-4000-a000-0000000000NN` + "Dummy Test Org" + "Dragon Ball PT" | UUID prefix `5eed` = "seed"; **11 orgs share one bulk-insert timestamp** `2026-07-10 07:49:28`; TV-show names (Tree Hill, Point Place, Lone Star); **0 cases each**; 1 member each |

> **Trap avoided:** `South Park Physical Therapy` (`5eed…007`) is a seed fixture; the live customer is `South Park Physician Group` (`d0e4…`). Different orgs.

### Data-reality caveat (governs every "over-time" claim)

All dense operational data — cases, status transitions, touches, fills — was created in a **~9-day window (Jun 30 – Jul 8, 2026)**. `audit_log` stretches Jun 23 – Jul 13. **The schema supports time-series; the data does not have history yet.** Trend/throughput/cycle-time visuals are structurally sound but near-empty today and become meaningful only as weeks accrue. This is the single most important constraint on the MVP cut (Step 5).

### Personas (light-touch; grounded in the real role + party model)

| Persona | Real anchor | In tool? | Cadence | Delivery | Wants |
|---|---|---|---|---|---|
| **Authoritative Signer / Owner** ⭐ | party role `owner` (active, 1 assigned) | Rarely/never | Monthly–quarterly | `report_shares` link / PDF | Proof the agreement performs; network growing; who's live; what's next |
| Credentialing Manager | `admin` membership (6 live) | Daily | Live | In-app | Operational control: blocked, aging, chase list |
| Credentialing Specialist | `specialist` role (defined, **0 live**) + extension | Daily | Live | In-app + extension | Work-list, fills, touches, SOP tasks |
| Billing / Finance | `billing` membership (2 live) | Occasional | Per pay-cycle | In-app (`/client-progress`, admin+billing gated) | Who's billable, effective dates |
| Minted Relationship Owner | party role `sales_rep` (2 live) | Platform side | Per-account | Cross-org | Account health / value delivered |

**Altitude split.** Signer-facing reports show **outcomes over time**; internal reports show the **mechanics** that produce them (queues, task completion, fills, touches). Same data, two altitudes. Signer set leads (Step 3 §A); internal feeders follow (Step 3 §B). Delivery to the signer rides **`report_shares`** (`scope`, `scope_org_id`, `recipient_email`, `token_hash`, `expires_at`) — a real but currently empty mechanism for handing a scoped report to a non-member.

### Intent-vs-reality reconciliation

| # | Flag |
|---|---|
| R1 | **Live schema is ahead of `SCHEMA.md`.** Undocumented tables: `provider_documents`, `case_generation_runs/_run_rows/_exclusions`, `payer_network_targets`, `payer_catalog_changes`, `group_insurance_policies`, `provider_group_assignments`, `sop_template_versions`, `parties`/`party_role_assignments`, `import_runs/_rows`, `report_shares`, `inbound_leads`. New columns: `providers.verification_state`, `state_licenses.verified_*`, `payers.payer_kind/states/status/aliases`. |
| R2 | The brief's premise "`fill_sessions` is the sole profile-read record; no separate endpoint audit" is **contradicted by reality**: `audit_log` carries **104 `READ`/provider** rows (a genuine endpoint-access audit) *in addition to* 31 `fill_sessions`. They measure different things (endpoint reads vs. autofill attempts). |
| R3 | **Designed-but-inert for real orgs:** `org_payer_assignments` (0), `field_dictionary` (0), `portals` (1), `provider_documents` (0), `payer_network_targets` (0), `case_generation_runs` (0), `import_runs` (0). Conformance/forecast features have no data to report on. |
| R4 | **Effective-date & reference columns barely populated:** `payer_reference_id` 0/61, `expected_effective_date` 1/61, `confirmed_effective_date` 3/61, `approved_date` 4/61 (yet 12 cases sit complete → **approval date lags status**). `providers.home_state` 0/11, `tasks.sop_template_id` 0/231. |

---

## Step 1 — Schema inventory

Population figures are **real orgs only** (KFP + South Park Physician Group). Readiness: 🟢 ready · 🟡 usable w/ caveat · 🔴 not ready.

### A. Core operational

| Table | Grain (one row =) | Org scope | Key columns | Time dimension | Populated (real) | Reporting value |
|---|---|---|---|---|---|---|
| `credential_cases` | provider×payer×state credentialing case | `org_id` | `credentialing_status_id`→status, `payer_id`, `provider_id`, `facility_id`, `state`, `mso_id`, `assigned_to` | `created_at`✓; `submitted_date` 43/61; `approved_date` 4/61; `expected_eff` 1/61; `confirmed_eff` 3/61; `termination_date` 0 | 61; facility_id 100%, status 100%, payer_ref 0% | 🟢 central object; 🟡 effective-date/cycle |
| `tasks` | one SOP checklist task on a case | `org_id` | `status`, `case_id`, `is_auto_generated`, `sop_content` | `due_date` 200/231; `completed_date` 118/124; `created_at`✓ | 231 (124 done / 100 not-started / 7 in-prog) | 🟢 workload; `sop_template_id` 0 |
| `contracts` | group×payer×state contract | `org_id` | `contracting_status_id`→status, `payer_id`, `group_id`, `state` | `effective_date` 2/12; `expiration_date` 0/12 | 12; status 100% | 🟡 contracting position (dates empty) |
| `facilities` (=locations/launches) | one clinic location | `org_id` | `status_id`→location status, `group_id`, `is_active`, `reference_only`, address | `effective_date` 10/12 (4 future); `created_at`✓ | 12; status 100% | 🟢 location roster & launch pipeline |
| `providers` | one credentialed provider | `org_id` | `status`, `specialty`, `npi`, `caqh_id`, `group_id`, `verification_state`, `reference_only` | `start_date` 10/11; `caqh_last_attested` 9/11; `license_expiration_date` 9/11; `terminated_date` 0 | 11; npi/caqh ~90%; **home_state 0**, dea 0 | 🟢 roster; 🟡 data-completeness |
| `state_licenses` | one provider state license | `org_id` | `state`, `status`, `verified_status`, `license_number` | `issue_date` 6/11; **`expiration_date` 11/11** (Dec'26–May'28) | 11 | 🟢 **best forecast source** |

### B. Reference / dimension

| Table | Grain | Org scope | Key columns | Timestamps | Populated (real) | Value |
|---|---|---|---|---|---|---|
| `status_configs` | one status in a track | `org_id` | `track`, `label`, `sort_order`, `action_bucket` | `created_at` | 44 (22/org, canonical) | 🟢 status/bucket dimension |
| `payers` | one payer (org or global) | `org_id` **nullable** (NULL=global) | `name`, `is_active`, `avg_decision_days`, `payer_kind`, `status` | `created_at`, `last_synced_at` | 16 org + 269 global; 8 with-cases/org; sentinel "Pre-Cred" ×2 | 🟢 payer dimension; `avg_decision_days`=ref SLA |
| `org_payer_assignments` | org↔global-payer subscription | `org_id` | `payer_id`, `starter` | `created_at` | **0** | 🔴 no data |
| `provider_groups` | billing group (TIN) | `org_id` | `name`, `tin`, `npi_type2`, `states[]` | `created_at` | 2 | 🟢 group dimension |
| `provider_facility_assignments` | provider↔location link | `org_id` | `provider_id`, `facility_id`, `is_primary` | `created_at`, `start_date` | 15 | 🟢 staffing per location |
| `msos` / `mso_routing_rules` | MSO / routing rule | `org_id` | `route_type`, `payer_id`, `state`, `specialty` | `created_at` | 4 / 4 | 🟡 routing mix (small) |
| `group_insurance_policies` | group malpractice/liability policy | `org_id` | `insurer_name`, `policy_number`, `policy_end_date` | `policy_start/end_date` | 2 | 🟡 insurance-expiry (2 rows) |

### C. Event streams / time-machines

| Table | Grain | Org scope | Key columns | Time dimension | Populated (real) | Value |
|---|---|---|---|---|---|---|
| `status_history` (append-only) | one status transition | `org_id` | `track`, `case_id`/`contract_id`, `from/to_status_id`, `changed_by` | **`changed_at`** (Jun30–Jul8) | 64 (cred 58 / 53 cases; contracting 6); actor 27/58 | 🟢 **transition backbone**; 🟡 ~9d history |
| `audit_log` (append-only) | one auditable action | `org_id` | `action_type` (CREATE/UPDATE/STATUS_CHANGE/TOUCH_LOGGED/READ/TERMINATION), `entity_type`, `user_id` | **`ts`** (Jun23–Jul13) | 291; READ/provider 104; UPDATE/task 55; STATUS_CHANGE only 7 | 🟢 access/activity; 🟡 partial CREATE/STATUS coverage |
| `touches` (append-only) | one touchlog entry | `org_id` | `entry_type`, `touch_type`, `outcome`, `case_id`, `task_id` | **`touch_date`** (Jul5–8) | 57 (42 "submitted"; ~10 payer comms) | 🟡 payer-contact volume (extension-dominated) |
| `communication_event` | one batch payer call | `org_id` | `payer_id`, `channel` | `occurred_at` | 2 | 🔴 too sparse |

### D. Extension / fill-coverage

| Table | Grain | Org scope | Key columns | Timestamps | Populated (real) | Value |
|---|---|---|---|---|---|---|
| `fill_sessions` | one autofill attempt | `org_id` | `portal_key`, `fill_mode`, `fields_filled`, `case_id`, `provider_id` | `started_at`/`completed_at` (Jul5–8) | 31; 9 cases, 6 providers, **1 portal**; avg 2.9 fields | 🟡 "value delivered" proxy (narrow) |
| `portals` | one payer portal | `org_id` | `portal_key`, `payer_id`, `is_verified` | `last_verified_at` | 1 | 🔴 1 row |
| `portal_field_maps` | one field selector map | `org_id` **nullable** | `status`, `confidence`, `token` | `created/updated_at` | 1 org + 24 global | 🔴 sparse |
| `field_dictionary` | one label→token memory | `org_id` | `label_normalized`, `token`, `status` | `decided_at` | **0** | 🔴 no data |

### E. Newer tables — exist, **empty/near-empty for real orgs** (future enablers, not today's sources)

| Table | Intended grain | Real-org rows | Would enable |
|---|---|---|---|
| `provider_documents` | credential doc w/ `expiration_date` | 0 | Document-expiry forecast (COI, malpractice) |
| `payer_network_targets` | planned payer pursuit (org×payer×group×state×status) | 0 | **Real future-case-volume forecast** |
| `case_generation_runs`/`_run_rows`/`_exclusions` | batch case-creation run + dispositions | 0 | Planned-work throughput |
| `parties` / `party_role_assignments` | external contact + role link | 0 / 3 | Contact-of-record on reports (owner, signer) |
| `provider_group_assignments` | provider↔group M:N | 0 | Multi-group provider reporting |
| `sop_template_versions` | published SOP version | 0 (test only) | Template governance |
| `import_runs`/`_rows` | onboarding import staging | 0 | Onboarding throughput |
| `report_shares` | tokenized report share link | 0 | **Signer delivery mechanism (already built)** |

**Excluded (non-reporting):** `profiles`, `memberships`, `pending_invites`, `user_table_prefs`, `public_rpc_attempts`, `notes` (dormant for case/task), `notes_pre_touchlog_backup`, `party_capture_links`, `party_role_types` (vocab), `launches` (legacy), `inbound_leads`, `payer_catalog_changes` (platform-side).

**Time-dimension summary.** Timestamp coverage is broad (`status_history.changed_at`, `audit_log.ts`, case dates, license/CAQH/contract expirations, `touch_date`, `fill_sessions.started_at`). The binding constraint is **history depth (~9 days)**, not schema. Forward-dated signals that already work: license expirations 🟢, CAQH re-attest (derived) 🟡, launch effective dates 🟡. Absent: recredentialing due date, reliable case effective dates, contract renewals.

---

## Step 2 — Metric candidates

Grouped by theme; `S`=signer-facing, `I`=internal. Readiness reflects **both** column population and history depth.

### Theme 1 — Credentialing state of the organization `S`

| Metric | Definition | Source column(s) | Join | Agg/Rate | Time-slice | Ready |
|---|---|---|---|---|---|---|
| Active providers | Providers not terminated | `providers.status`, `terminated_date` | — | count | by `created_at` | 🟢 |
| Open cases | Cases not in `complete` bucket | `credential_cases` × `status_configs.action_bucket` | case→status | count | snapshot | 🟢 |
| Case mix by bucket | Cases per ours/waiting_payer/waiting_provider/complete | `status_configs.action_bucket` | case→status | count/share | snapshot | 🟢 |
| % network-complete | complete cases ÷ all cases | same | case→status | rate | trend 🟡 | 🟢 |
| Locations live | Facilities in "Live" location status | `facilities.status_id` | facility→status | count | snapshot | 🟢 |

### Theme 2 — Payer onboarding progress `S`

| Metric | Definition | Source column(s) | Join | Agg/Rate | Time-slice | Ready |
|---|---|---|---|---|---|---|
| Payers in play | Distinct payers with ≥1 case | `credential_cases.payer_id` | case→payer | count-distinct | snapshot | 🟢 |
| Case status per payer | Case counts by status per payer | `credential_cases` × `payers.name` × status | case→payer,→status | count matrix | 🟡 | 🟢 |
| Contracting position per payer | Contract status per payer×state | `contracts.contracting_status_id` | contract→status,→payer | count | snapshot | 🟡 (dates sparse) |
| Payer approval rate | Approved ÷ submitted per payer | `credential_cases` status + `submitted_date` | case→payer | rate | 🟡 | 🟡 (small n) |
| Payer decision SLA (ref) | Stated avg decision days | `payers.avg_decision_days` | case→payer | value | — | 🟡 |

### Theme 3 — Provider position in workflow `S` (aggregate) / `I` (individual)

| Metric | Definition | Source column(s) | Join | Agg/Rate | Time-slice | Ready |
|---|---|---|---|---|---|---|
| In-network count per provider | # payers complete, of active payer set (clientProgress logic) | `credential_cases`+`status_configs` | case→provider,→status | ratio x/y | 🟡 | 🟢 |
| Furthest status per provider×payer | Most-advanced case status | `credential_cases.credentialing_status_id` | case→provider,→payer,→status | max by sort_order | snapshot | 🟢 |
| Providers not started | Providers whose cases are all "Not Started"/none | `credential_cases` + `status_configs` | provider→cases | count | snapshot | 🟢 |
| Task completion per provider | Completed ÷ total SOP tasks | `tasks.status` | task→case→provider | rate | 🟡 | 🟢 |

### Theme 4 — Payer standards / data conformance `I` (reframed from literal "% payers at standard")

| Metric | Definition | Source column(s) | Join | Agg/Rate | Time-slice | Ready |
|---|---|---|---|---|---|---|
| Provider data-completeness | % of required profile fields populated | `providers.*` (fixitFields whitelist) | — | rate | 🟡 | 🟡 (required-set informal) |
| Cases blocked on us / provider | Cases in `ours`/`waiting_provider` bucket | `status_configs.action_bucket` | case→status | count | 🟡 | 🟢 |
| Provider verification state | Providers by `verification_state` | `providers.verification_state` | — | count | snapshot | 🟡 (semantics undoc.) |
| Payers with verified portal | Verified ÷ registered portals | `portals.is_verified` | portal→payer | rate | — | 🔴 (1 row) |
| Fields awaiting confirmation | `field_dictionary` suggested count | `field_dictionary.status` | — | count | — | 🔴 (0 rows) |

### Theme 5 — Credentialed inventory `S`

| Metric | Definition | Source column(s) | Join | Agg/Rate | Time-slice | Ready |
|---|---|---|---|---|---|---|
| Credentialed roster | provider×payer×state in complete bucket | `credential_cases` + `status_configs` | case→provider,→payer,→status | list/count | as-of 🟡 | 🟢 (roster); 🟡 (effective 3/61) |
| Active contracts | group×payer×state contracted | `contracts.contracting_status_id` | contract→payer,→group | count/list | snapshot | 🟡 |
| Effective-dated approvals | Cases with confirmed effective date | `credential_cases.confirmed_effective_date` | — | count | by month 🔴 | 🔴 (3/61) |

### Theme 6 — Forecast `S`

| Metric | Definition | Source column(s) | Join | Agg/Rate | Time-slice | Ready |
|---|---|---|---|---|---|---|
| License expirations ahead | Licenses expiring next 30/60/90/180d | `state_licenses.expiration_date` | license→provider | count by window | forward 🟢 | 🟢 |
| CAQH re-attest due | `caqh_last_attested_date` + 120d in window | `providers.caqh_last_attested_date` | — | count by window | forward 🟡 | 🟡 (derived) |
| Upcoming launches | Pre-Live locations w/ future effective date | `facilities.effective_date`+`status_id` | facility→status | count/list | forward 🟡 | 🟡 (4 rows) |
| Contract renewals ahead | Contracts expiring in window | `contracts.expiration_date` | — | count | forward 🔴 | 🔴 (0/12) |
| Anticipated future cases | Planned payer pursuits not yet cased | `payer_network_targets` | — | count | forward 🔴 | 🔴 (0 rows) |
| Recredentialing due | Next recred per case/provider | *(no column)* | — | — | — | 🔴 (absent) |

### Theme 7 — Agreement performance over time `S`

| Metric | Definition | Source column(s) | Join | Agg/Rate | Time-slice | Ready |
|---|---|---|---|---|---|---|
| Cases opened / week | New cases by created week | `credential_cases.created_at` | — | count/period | 🟢 (but ~9d) | 🟡 |
| Submissions / week | Cases entering Submitted | `status_history`→"Submitted" or `submitted_date` | history→case | count/period | 🟡 | 🟡 |
| Approvals / week | Cases reaching complete bucket | `status_history`→complete status | history→case→status | count/period | 🟡 | 🟡 |
| Cycle: created→submitted | Days open before submission | `submitted_date` − `created_at` | — | median days | 🟡 | 🟢 (43/61) |
| Cycle: submitted→approved | Days submission to approval | `approved_date` − `submitted_date` | — | avg days | 🟡 | 🔴 (approved_date 4/61) |
| Aging in current status | Days since latest transition (open cases) | `status_history.changed_at` (max) | history→case | distribution | as-of 🟢 | 🟢 |
| Autofill activity / week | Fills + fields filled per week | `fill_sessions.started_at`,`fields_filled` | — | count/sum | 🟡 | 🟡 (1 portal) |
| Payer-contact volume | Touchpoints logged per week | `touches` (entry_type=touchpoint) | — | count/period | 🟡 | 🟡 |

---

## Step 3 — Dashboard ideation

Signer-facing dashboards lead (§A); internal operational feeders follow (§B). "Parties" = domain entities a view covers (Provider · Payer · Group · Location · MSO · Contact).

### §A — Signer-facing

#### D1 · Credentialing State of the Organization
- **Signer asks:** *"Overall, where do we stand — how many of my providers are getting into networks, and how much is still in flight?"*
- **Cadence:** Monthly · **Parties:** Provider, Payer, Location

| KPI tile | Source metric | Drill-down → |
|---|---|---|
| Active providers | `providers` not-terminated count | R3 Provider Roster |
| In-network (complete) cases | complete-bucket case count / share | R1 Case Register (filter: complete) |
| In flight (open) cases | non-complete case count | R1 Case Register (filter: open) |
| Locations live | `facilities` in "Live" status | R6 Location Register |

| Visual | Type | Axes / grain | Why chart > table |
|---|---|---|---|
| Case pipeline | Horizontal **funnel / stacked bar** | x = case count, segments = action_bucket (ours→waiting→complete); grain = case | One glance shows how much of the book is *done* vs *stuck-with-us* vs *waiting on payer* — a table makes the reader compute proportions |
| Network position | **Donut** | complete vs in-flight share of all cases | The headline ratio ("are we getting what we paid for") reads instantly |

- **Over-time dimension:** month-end snapshot of complete-share; the funnel shifts rightward across review cycles as the book matures. (Today: single snapshot — trend accrues.)

#### D2 · Credentialed Inventory — "Who's Live"
- **Signer asks:** *"Show me exactly which of my providers are approved/in-network with which payer, and since when."*
- **Cadence:** Monthly / on-demand · **Parties:** Provider, Payer, Location, Group

| KPI tile | Source metric | Drill-down → |
|---|---|---|
| Provider–payer approvals | complete-bucket case count | R2 Credentialed Roster |
| Distinct payers won | distinct `payer_id` among complete cases | R4 Payer Progress |
| Active contracts | `contracts` in contracted status | R5 Contract Register |
| Newly live this period | complete cases w/ `confirmed_effective_date` in window | R2 (filter: effective in period) |

| Visual | Type | Axes / grain | Why chart > table |
|---|---|---|---|
| Coverage matrix | **Heatmap grid** | rows = providers, cols = payers, cell = status | The single clearest "where are my providers" artifact — gaps and wins are spatial, not numeric |
| Approvals over time | **Cumulative area** | x = month, y = cumulative complete cases | Shows the network *growing* — the core proof of agreement value |

- **Over-time dimension:** cumulative approvals line is the signer's "value delivered" curve. ⚠️ Depends on `confirmed_effective_date`/`approved_date` (3–4/61 today) — currently reconstruct timing from `status_history` transitions into complete statuses; flag effective-date as a data gap (Step 6).

#### D3 · Payer Onboarding Progress
- **Signer asks:** *"For each payer we're pursuing, how far along are we?"*
- **Cadence:** Monthly · **Parties:** Payer, Provider, Group

| KPI tile | Source metric | Drill-down → |
|---|---|---|
| Payers in progress | distinct `payer_id` on non-complete cases | R4 Payer Progress |
| Payers fully in-network | payers where all provider cases complete | R4 |
| Avg stated decision window | `payers.avg_decision_days` (reference) | R4 |
| Contracts pending | `contracts` in non-complete contracting status | R5 Contract Register |

| Visual | Type | Axes / grain | Why chart > table |
|---|---|---|---|
| Payer progress bars | **100% stacked bar per payer** | y = payer, x = share of that payer's cases by status | Each payer's onboarding maturity is a single readable bar; sorting surfaces laggards a table would bury |

- **Over-time dimension:** re-run monthly — bars fill toward complete; a payer's bar advancing is the visible onboarding story.

#### D4 · Agreement Performance Over Time
- **Signer asks:** *"Are you working my book at the pace we agreed — is volume moving and are things aging out?"*
- **Cadence:** Quarterly · **Parties:** Provider, Payer

| KPI tile | Source metric | Drill-down → |
|---|---|---|
| Cases opened (period) | `credential_cases.created_at` count | R1 Case Register |
| Submitted (period) | `submitted_date` / transitions to Submitted | R1 |
| Median days to submit | `submitted_date` − `created_at` | R1 |
| Oldest open case age | max age since last `status_history.changed_at` | R8 Status-Change Log |

| Visual | Type | Axes / grain | Why chart > table |
|---|---|---|---|
| Throughput | **Column, opened vs submitted/approved per week** | x = week, y = count | Pace and momentum are a shape, not a number; a bar chart makes "are we accelerating" self-evident |
| Aging | **Box/scatter of days-in-current-status** | x = action_bucket, y = age (days) | Reveals stalls (points drifting up) that averages hide |

- **Over-time dimension:** this dashboard *is* the over-time view. ⚠️ **~9 days of history today** — structurally correct, visually thin until ≥1 quarter accrues (see Step 5 defer rationale).

#### D5 · Forecast — What's Coming Next
- **Signer asks:** *"What's on the horizon — renewals, expirations, new locations — that we need to stay ahead of?"*
- **Cadence:** Monthly · **Parties:** Provider, Location, Payer

| KPI tile | Source metric | Drill-down → |
|---|---|---|
| Licenses expiring ≤90d | `state_licenses.expiration_date` in window | R7 Expirations & Renewals |
| CAQH re-attest due ≤60d | `caqh_last_attested_date` + 120d in window | R7 |
| Upcoming launches | pre-Live `facilities` w/ future `effective_date` | R6 Location Register |
| Insurance policy expirations | `group_insurance_policies.policy_end_date` in window | R7 |

| Visual | Type | Axes / grain | Why chart > table |
|---|---|---|---|
| Renewal timeline | **Horizontal timeline / gantt** | x = date (next 6–12 mo), rows = expirable items | Puts "what's coming when" on a calendar the signer scans left-to-right; a table loses the sense of clustering |

- **Over-time dimension:** genuinely forward-looking and **works today** — `state_licenses.expiration_date` is 11/11 populated, Dec 2026–May 2028. The one dashboard whose over-time axis is not blocked by history depth.
- **Honest limit:** cannot forecast *future case volume* — `payer_network_targets`/`org_payer_assignments`/`case_generation_runs` are empty and there is no recredentialing-due field. Forecast = provider-data expirables (solid) + launch pipeline (thin); future workload = guesswork (Step 6).

### §B — Internal operational feeders (drill-down layer; Credentialing Manager / Specialist — not signer headlines)

#### D6 · Provider Position — Work View *(feeds D1/D2)*
- **Reader asks (Manager):** *"Which providers need action right now, and what's blocking each?"*
- **Cadence:** Live · **Parties:** Provider, Payer, Contact
- **Tiles:** providers needing action (`ours` bucket) · awaiting payer · awaiting provider · not-started providers. **Source:** `credential_cases`×`status_configs.action_bucket`, `tasks.status`.
- **Visual:** per-provider progress rows (x-of-y in-network bar + status chips) — the existing `/client-progress` pattern. **Drill-down:** R3 Provider Roster, R1 Case Register.
- **Over-time:** aging badges per provider (days since last transition).

#### D7 · Conformance & Data Readiness *(feeds D3; the reframed Theme 4)*
- **Reader asks (Manager):** *"What data gaps and setup gaps are holding cases back from our standard?"*
- **Cadence:** Live · **Parties:** Provider, Payer, Portal
- **Tiles:** provider data-completeness % (`providers.*` whitelist) · cases blocked (`waiting_provider`) · verified portals (`portals.is_verified`) · fields awaiting confirm (`field_dictionary`). **Mostly 🟡/🔴 — much of the "standard" infrastructure is unpopulated (R3).**
- **Visual:** completeness bar per provider + gap list. **Drill-down:** R3, R9 Work Queue.

#### D8 · Fill-Coverage & Payer-Contact Activity *(the "internal reports" — operational proof-of-work)*
- **Reader asks (Manager):** *"How much are we actually doing — fills, touches, submissions?"*
- **Cadence:** Live/weekly · **Parties:** Provider, Payer, Location
- **Tiles:** fills (period) + fields filled (`fill_sessions`) · touchpoints logged (`touches`) · submissions (portal/email `outcome='submitted'`). **Narrow:** 1 portal, 31 fills, 57 touches.
- **Visual:** activity columns per week. **Drill-down:** R10 Activity Log.

> Additional schema-supported dashboards not elevated here: **Location/Launch Pipeline** (own view of `facilities` location-track statuses — folded into D1/D5), **Contracting Status** (own view of `contracts` — folded into D3), **Cross-org Portfolio** (CSM persona, `organizations.lifecycle_state` — Minted-side, out of signer scope).

---

## Step 4 — Report specs (drill-down detail)

Every tile above opens one of these. Standard columns are the default scan set.

### R1 · Case Register
| Field | Content |
|---|---|
| Parent · tile | D1 open/complete · D4 opened/submitted |
| Grain | one credentialing case |
| **Standard columns** | Provider · Payer · State · Status (label) · Action bucket · Location · Assigned to · Created · Submitted · Approved · MSO (if routed) |
| Filters | Status/bucket · Payer · Provider · Location · State · date range (created/submitted) |
| Default sort | Days-in-status desc (oldest first) |
| Sources · join | `credential_cases` → `status_configs`, `payers`, `providers`, `facilities`, `msos` |
| Exportable? | Yes (CSV) |

### R2 · Credentialed Roster
| Field | Content |
|---|---|
| Parent · tile | D2 approvals / newly-live |
| Grain | one provider×payer×state in complete bucket |
| **Standard columns** | Provider · Credentials · NPI · Specialty · Payer · State · Status · Effective date (`confirmed_effective_date`) · Approved date · Location |
| Filters | Payer · State · Location · effective-date range |
| Default sort | Effective date desc |
| Sources · join | `credential_cases` (complete) → `providers`, `payers`, `facilities`, `status_configs` |
| Exportable? | Yes — the "proof of who's live" export |

### R3 · Provider Roster
| Field | Content |
|---|---|
| Parent · tile | D1 active providers · D6/D7 |
| Grain | one provider |
| **Standard columns** | Name · Credentials · NPI · CAQH ID · Specialty · Taxonomy · Group · Home state · Start date · Status · License # · License exp · # payers in-network · Data-completeness % |
| Filters | Group · Specialty · Status · reference-only · has-gaps |
| Default sort | Last name |
| Sources · join | `providers` → `provider_groups`, `state_licenses`, derived counts from `credential_cases` |
| Exportable? | Yes |

### R4 · Payer Progress Detail
| Field | Content |
|---|---|
| Parent · tile | D3 all tiles · D2 payers won |
| Grain | one payer (× state optional) |
| **Standard columns** | Payer · Kind (`payer_kind`) · Providers pursued · In-network · Submitted · In progress · Not started · Approval rate · Avg decision days (ref) · Contracts active |
| Filters | Payer kind · State · has-open-cases |
| Default sort | In-progress desc |
| Sources · join | `credential_cases` grouped by `payer_id` → `payers`, `status_configs`, `contracts` |
| Exportable? | Yes |

### R5 · Contract Register
| Field | Content |
|---|---|
| Parent · tile | D2/D3 contracts |
| Grain | one group×payer×state contract |
| **Standard columns** | Group · Payer · State · Contracting status · Effective date · Expiration date · Notes |
| Filters | Payer · State · status · expiring-in-window |
| Default sort | Expiration date asc (nulls last) |
| Sources · join | `contracts` → `provider_groups`, `payers`, `status_configs` |
| Exportable? | Yes · ⚠️ effective 2/12, expiration 0/12 (Step 6) |

### R6 · Location Register
| Field | Content |
|---|---|
| Parent · tile | D1 locations live · D5 upcoming launches |
| Grain | one facility/location |
| **Standard columns** | Location · Group · Street · City · State · ZIP · Location status · Effective/target date · Providers assigned · Active cases · Reference-only |
| Filters | Status · Group · State · reference-only |
| Default sort | Effective date asc |
| Sources · join | `facilities` → `status_configs`, `provider_facility_assignments` (counts), `credential_cases` (counts), `provider_groups` |
| Exportable? | Yes |

### R7 · Upcoming Expirations & Renewals
| Field | Content |
|---|---|
| Parent · tile | D5 licenses / CAQH / insurance |
| Grain | one expirable item (license · CAQH attestation · insurance policy) |
| **Standard columns** | Provider (or Group) · Item type · Identifier (license #/policy #) · State · Expiration/due date · Days remaining · Status |
| Filters | Item type · window (30/60/90/180d) · State · Provider |
| Default sort | Days remaining asc |
| Sources · join | `state_licenses` ∪ `providers.caqh_last_attested_date` (+120d) ∪ `group_insurance_policies` → `providers`/`provider_groups` |
| Exportable? | Yes — the forward-looking action list |

### R8 · Status-Change Log
| Field | Content |
|---|---|
| Parent · tile | D4 aging / oldest open |
| Grain | one status transition |
| **Standard columns** | Date · Case (Provider–Payer–State) · Track · From status · To status · Changed by · Days in prior status |
| Filters | Track · Payer · date range · to-status |
| Default sort | Date desc |
| Sources · join | `status_history` → `credential_cases`, `status_configs`, `profiles` (actor) |
| Exportable? | Yes · ⚠️ actor 27/58; history ~9d |

### R9 · Work Queue *(internal)*
| Field | Content |
|---|---|
| Parent · tile | D6/D7 blocked/tasks |
| Grain | one open task |
| **Standard columns** | Task · Case (Provider–Payer) · Status · Due date · Auto-generated · Assigned · Days open |
| Filters | Status · due-window · Provider · Payer |
| Default sort | Due date asc |
| Sources · join | `tasks` → `credential_cases`, `providers`, `payers` |
| Exportable? | Yes |

### R10 · Fill & Touch Activity Log *(internal)*
| Field | Content |
|---|---|
| Parent · tile | D8 fills/touches/submissions |
| Grain | one fill session **or** one touch |
| **Standard columns** | When · Type (fill/touch) · Provider · Case · Portal/channel · Outcome · Fields filled · Performed by |
| Filters | Type · Portal · Outcome · date range · Provider |
| Default sort | When desc |
| Sources · join | `fill_sessions` ∪ `touches` → `credential_cases`, `providers`, `profiles` |
| Exportable? | Yes · ⚠️ 1 portal, extension-dominated |

---

## Step 5 — Feasibility and MVP cut

| Dashboard | Data readiness | Build effort | Signer value | Notes |
|---|---|---|---|---|
| D1 Credentialing State | 🟢 | S | **H** | All-green sources; answers "are we getting what we paid for" in one view |
| D2 Credentialed Inventory | 🟢 roster / 🟡 dates | M | **H** | Roster green; effective-date thin (reconstruct from `status_history`) |
| D5 Forecast | 🟢 licenses / 🟡 launches | S–M | **H** | Only truly forward view that works today (license exp 11/11) |
| D3 Payer Onboarding | 🟢 status / 🟡 contracts | M | M–H | Contract dates sparse; status solid |
| D4 Performance Over Time | 🟡 (~9d history) | M | **H (later)** | Highest-impact but empty today; needs time to accrue |
| D6 Provider Work View | 🟢 | S | M (internal) | Reuses `/client-progress`; not a signer headline |
| D7 Conformance/Readiness | 🟡/🔴 | M | L | Half the infra unpopulated (R3) |
| D8 Fill/Touch Activity | 🟡 (1 portal) | S | L | Internal proof-of-work; narrow |

### Recommended MVP — **D1 + D2 + D5**

**Argument.** These three answer the signer's three questions with the greenest data and **zero dependence on the ~9-day history problem**:
- *"Are we getting what we paid for?"* → **D1** (network position, all-green).
- *"Where are my providers?"* → **D2** (the who's-live roster + coverage matrix — the tangible deliverable, exportable via `report_shares` to the owner).
- *"What's coming next?"* → **D5** (license/CAQH/insurance horizon — the one forward view whose data is 100% populated and future-dated today).

All three are S/M build effort, snapshot-oriented (robust to thin history), and map cleanly onto existing green columns and the existing `/client-progress` gating + `report_shares` delivery path.

**Deferred, with un-defer conditions:**

| Deferred | Why | Un-defer when |
|---|---|---|
| **D4 Performance Over Time** | Most valuable signer story, but ~9 days of data — trend/throughput/cycle visuals are near-empty | ≥1 full quarter of `status_history`/case activity accrues (~Oct 2026); *and* `approved_date` auto-stamped on approval (Step 6) so submitted→approved cycle-time becomes real |
| **D3 Payer Onboarding (full)** | Status solid but `contracts` effective/expiration empty; payer approval-rate has small n | `contracts.effective_date`/`expiration_date` populated; ≥3× current case volume for stable rates |
| **D7 Conformance** | `org_payer_assignments`/`field_dictionary`/`portals` unpopulated | Global-catalog assignment goes live (`org_payer_assignments` seeded) + portal registry grows |

Ship D1+D2+D5 as the signer review artifact; layer D3/D4 in as the data deepens; keep D6–D8 as the internal team's live console, not the signer packet.

---

## Step 6 — Gaps

Fields/events/timestamps that don't exist or aren't captured, with the metric each unlocks and rough capture cost.

| Gap | Metric it unlocks | Where it would be captured | Rough cost |
|---|---|---|---|
| **History depth** (~9 days) — not a field, a time problem | Every D4 trend, throughput, cycle-time | Time only; optionally a **monthly snapshot table** to make as-of trends cheap/stable | Snapshot job: M |
| `approved_date` under-populated (4/61 vs 12 complete) | Approvals/week, submitted→approved cycle-time | Auto-stamp on status→complete transition (already have `status_history`) | S (trigger/app) |
| `expected_/confirmed_effective_date` ~empty (1–3/61) | Go-live/effective-date reporting; "newly live this period"; effective-dated inventory | Prompt on approval in case detail; extension write-back | S–M |
| **Recredentialing due date** — no column | Recred forecast (a core signer "what's next") | New `credential_cases`/`providers` column + cadence seed on approval | M (schema + process) |
| `contracts.expiration_date` empty (0/12) | Contract-renewal forecast | Populate at contract entry | S–M |
| `payer_reference_id` empty (0/61) | Payer-side traceability on inventory/roster | Extension submission write-back (built) / manual entry | S |
| `org_payer_assignments` empty | Payer-standard conformance; starter-pack; **planned payer set** | Platform assignment step (global catalog) | M |
| `payer_network_targets` empty | **Real future-case-volume forecast** (the guesswork today) | Populate during intake/planning | M |
| `provider_documents` empty | Document-expiry forecast (COI, malpractice, license PDFs) | Capture at document upload | M |
| `providers.home_state` empty (0/11) | Provider geography; starter-case routing | Capture at provider intake | S |
| `status_history.changed_by` sparse (27/58) + `specialist` role unused | Per-user/coordinator throughput attribution | Ensure actor stamped on every transition | S |
| `tasks.sop_template_id` empty (0/231) | SOP-template effectiveness (which templates stall) | Backfill link at task generation | S |
| No `payers.effective` relationship on cases beyond dates | Payer-specific cycle benchmarks vs `avg_decision_days` | Depends on `approved_date`/effective-date fixes above | — |

**Bottom line:** the schema is rich and largely reporting-ready for *snapshot* questions; the recurring theme across gaps is **timing capture** (approval/effective/recred dates) and **planned-work capture** (`payer_network_targets`, `org_payer_assignments`). Close those two families and D3/D4 move from 🟡 to 🟢 and forecasting shifts from expirables-only to genuine future workload.
