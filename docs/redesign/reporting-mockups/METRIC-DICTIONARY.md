# Network Health & Ops Pipeline — Metric Dictionary (v1)

CEO-readable definitions. **Every metric is derivable from the current schema.**
No revenue, capacity, sanctions, committee, or SLA-baseline metrics.

Mockups: [`index.html`](./index.html) · Epic: [`../E7.0-competitive-reporting-dashboards.md`](../E7.0-competitive-reporting-dashboards.md)

---

## Hosted data footnote (2026-08-07)

Probes on project `fkvuhfsqcmujywzgczmc` (org **BEST Physical Therapy LLC**, prospect):

| Signal | Result |
|---|---|
| Cases | 1 (`in_progress`) |
| `assigned_to` fill | 0% |
| Approved / live enrollment facts | 0 / 0 |
| Touchpoints | 0 |
| Active targets | 2 (1 payer × 2 states) |
| Orgs | 1 prospect |

**Schema probes run cleanly; volume is insufficient to validate rates or MoM.**
Build QA requires a restored/seeded active org (e.g. seed-universe / backup restore) before claiming production-ready charts.

---

## Canon rules (do not fork)

| Rule | Definition |
|---|---|
| Case truth | `credential_cases.case_status` only — ignore `payer_pipeline_*` and `credentialing_status_id` mirrors |
| Active (enrollment) | Live `enrollment_facts` (`expired_at IS NULL`) **OR** `case_status = approved` (same union as `groupPayerFulfillment`) |
| TAT / MoM time | `case_status_history.changed_at` first transition into the status — not latest-wins `submitted_date` / `approved_date` alone |
| Scope | Owner + Ops = **active org only**. Portfolio stays the cross-org report |
| Open case | `case_status ∈ {not_started, in_progress, submitted, in_review, action_required}` |

---

## Owner Network Health

### This month — Approved
- **Meaning:** Count of cases whose **first** history row with `to_status = 'approved'` falls in the calendar month (or trailing window control).
- **Source:** `case_status_history`
- **Grain:** case

### This month — Submitted
- **Meaning:** Count of first `to_status = 'submitted'` transitions in the window.
- **Source:** `case_status_history`
- **Grain:** case

### This month — Denied
- **Meaning:** Count of first `to_status = 'denied'` transitions in the window (includes cases later reapplied).
- **Source:** `case_status_history`
- **Grain:** case

### Median days to approve
- **Meaning:** Median of (first Approved `changed_at` − case `created_at`) in days for cases with a first-Approved history row in the window (or all-time trailing control — product default: trailing 30/90 approvals cohort).
- **Source:** `credential_cases.created_at` + `case_status_history`
- **Not included:** Expected vs actual (`payers.avg_decision_days` is stop-write)

### Enrollment matrix (provider × payer)

- **Columns:** Distinct `payer_id` with ≥1 **active** `payer_network_targets` row for the selected group filter (All groups = union of those payers).
- **Rows:** Non-terminated providers that belong to the selected group(s) via un-ended `provider_group_assignments` (All groups = org roster minus terminated).
- **Optional state filter:** Restricts cases/facts/targets considered for the cell; when unset, collapse across states.
- **Cell resolve (locked):**
  1. Consider cases + live facts for that provider×payer under the group/state filters.
  2. If any live fact **OR** any approved case → **Active** (even if another open case exists).
  3. Else if no cases → **Not Started**.
  4. Else pick the single display status by priority: highest open-spine among `{action_required, in_review, submitted, in_progress, not_started}` → else **Denied** if any denied → else **Not Pursuing**.
- **Labels allowed:** Not Started, In Progress, Submitted, In Review, Action Required, Active, Denied, Not Pursuing.  
  **Forbidden:** Gathering docs, PTP, free-text spreadsheet notes.
- **Share:** Extend `report_shares` pattern (Portfolio) for this report key.  
- **CSV:** One row per provider×payer cell (provider, payer, status, group filter, state filter).

---

## Ops Pipeline

### Tab order
Provider Network → Workload → Turnaround

### Provider Network tab

| Metric | Definition | Source |
|---|---|---|
| Active network % | `# group×payer pairs with fulfillment=active` ÷ `# pairs with any active target` | `groupPayerFulfillment` over targets + cases + live facts |
| Open cases | Count of open `case_status` | `credential_cases` |
| At-risk launches | Same rule as Launches report (`launchReport`) | facilities + assignments + open cases |
| Standing denials | Denied cases not reapplied (`buildDenialRows` cycle `standing`) | cases + `case_status_history` |
| Risk watch | Union list: at-risk launches, expiring current documents (`documents.classifyExpiration`), Awaiting ID (`enrollmentIdBadge` / approved + expected ID null), generation buffer size (`generationBuffer`) | existing libs only |
| Fulfillment bars | Counts of active / in_progress / targeted pairs | `groupPayerFulfillment` |
| Provider coverage snapshot | `providerCaseProgress` + `providerGaps` + soonest `state_licenses.expiration_date` | existing libs |

### Workload tab

| Metric | Definition | Source |
|---|---|---|
| Overdue follow-ups | Cases whose carry-forward follow-up date &lt; today | `touches` + `followUps.resolveActiveFollowUp` |
| Overdue tasks | Open tasks with `due_date` &lt; today | `tasks` |
| Touches (window) | `entry_type = 'touchpoint'` in window | `touches` |
| NBA queue depth | Length of `buildNextBestActions` | existing reducer |
| Touches by type | Counts by `touch_type` | `touches` |
| Workload by coordinator | Group touchpoints by `coordinator_id` (null → Unattributed); overdue FU attributed via case’s active follow-up | `touches` — **not** `assigned_to` as primary (hosted fill 0%; treat assignee as optional secondary if ever populated) |

### Turnaround tab

| Metric | Definition | Source |
|---|---|---|
| Median create→approve | Same definition as Owner strip | history |
| Median submit→approve | Median (first Approved − first Submitted) for cohort | history |
| Approved (window) | Same as Owner Approved count | history |
| Still open &gt;60d | Open cases with `created_at` ≤ today−60d | `credential_cases` |
| By payer table | Per payer: approved count, median create→approve, denied count in window | history ⨝ cases |

---

## Explicit non-metrics (v1)

- Revenue at risk, panel capacity, FTE utilization  
- Sanctions / NPDB / OIG / SAM  
- Committee / MEC votes  
- State board processing benchmarks  
- Expected decision days / SLA variance  
- Spreadsheet “PTP” / tentative-effective free text as cell types  

---

## Distribution

| Report | Share link | CSV |
|---|---|---|
| Owner Network Health | Yes (`report_shares`, scope full\|single_org pattern) | Yes |
| Ops Pipeline (each tab) | No | Yes |
| Existing Portfolio / Denials / etc. | Unchanged | Unchanged |

---

## Legacy

`/reports` (SummaryTab / RosterTab) redirects into Reporting Center after build; its label-based “open” logic must not be reused.
