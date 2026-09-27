# WP1.2 — Billing Readiness and Credentialing Change Feed

## Approved change contract

The PM approved option A on September 25, 2026, including the supplied review
notes: implement the constrained report and draft PR from `origin/main`
`72ccbbe5380ec6b92c0d2485bfcdd46cf27f359c`. This approval authorizes this work
package directly; it does not depend on unmerged WP1.1 / PR #417, authorize a
merge, or authorize deployment or production release.

Billing specialists need to inspect current enrollment readiness for a clinician,
facility, and payer, then review recorded changes before releasing held claims in
their own billing system. This report receives no claims or encounter data and
does not establish claim-level eligibility, retro authorization, or payment.

## Requirements and acceptance

| ID   | Requirement                                                                          | Acceptance evidence                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BR-1 | Add `/reporting/billing-readiness` under the Reporting Center's credentialing group. | Existing AppShell, PageHeader, StatusPill, Geist tokens and component primitives; accessible lookup and feed states.                                                                                                                                                                                                                                               |
| BR-2 | Search/select clinician, facility and payer in the active organization.              | Facility supplies the group and state; evaluate the exact provider/group/payer/state case key. Null or ambiguous identity never acts as a wildcard.                                                                                                                                                                                                                |
| BR-3 | Evaluate current readiness conservatively.                                           | Green requires active, verified, non-test provider; active group/facility; current group membership; started facility assignment; explicit case-facility linkage; approved case; reached confirmed effective date; no effective termination; and active, verified, unexpired matching state license.                                                               |
| BR-4 | Explain holds and stop-billing conditions.                                           | Submitted/in-review and missing evidence hold. Denial, absent enrollment, termination or expired license prevent billing. Malformed, conflicting, missing, stale or failed reads never produce green or a digest download.                                                                                                                                         |
| BR-5 | Display only supportable date and therapy guidance.                                  | Show recorded confirmed effective date. Retro eligibility is `Not recorded`. Pending estimate uses submission date plus payer average decision days when both are usable, clearly labeled as an estimate. PTA candidates never establish supervision; PTA remains on hold. CQ identifies PTA guidance; CO identifies OTA guidance, subject to payer/service rules. |
| BR-6 | Show a chronological 7/30/90-day feed.                                               | Recorded approval transitions and surviving facility additions; clearly identified date-derived termination and license-expiration warnings. Filter by active organization, facility and payer. Current and legacy transitions are deduplicated.                                                                                                                   |
| BR-7 | Download the Newly Billable Digest as CSV.                                           | Filtered approval/linkage events are re-evaluated against current readiness; only current green combinations appear, once per case/facility. Include business identifiers and recorded dates; formula-safe cells; no PHI, notes, or inferred retro window. Download through the existing browser CSV mechanism.                                                    |
| BR-8 | Preserve the read-only and organization boundaries.                                  | Components → hooks → services → browser Supabase client; explicit organization filters, organization/session-scoped query cache, narrow columns, bounded complete reads, and no query before organization/session selection.                                                                                                                                       |

Green means the recorded enrollment prerequisites pass for the displayed
assessment date. It does not authorize every historical date of service. Billing
staff must confirm the applicable payer, service, timely-filing and retro rules.

Recognized PTAs and OTAs both remain on hold without recorded supervision.
PT candidates are informational only; the CQ/CO reminder does not determine
whether a modifier applies to a specific claim line.

The original mission explicitly accepts exact `approved` and legacy `in_network`
case status values. That compatibility does not permit a missing or unknown
current status to inherit approval from a legacy status label. Initialization
and migration backfill records cannot trigger the newly-billable digest.

## Source findings and decisions

| Finding                                                                                                                  | Implementation decision                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `credential_cases.confirmed_effective_date` exists, but there is no separate effective-date verification flag.           | Label the value as recorded/confirmed; never manufacture verification provenance or substitute an expected date.          |
| Retro-policy fields were removed in `20260717221914_payer_dead_column_drop_superseding.sql`.                             | Do not infer a retro window from an effective date, approval date, or elapsed time.                                       |
| There is no explicit assistant-to-supervisor relation.                                                                   | Same-facility eligible PTs are candidates only. Supervision remains unverified and blocks PTA green.                      |
| `case_status_history` is the unified transition source; `status_history` contains legacy events.                         | Prefer the unified source for matching transitions; preserve distinct historical events.                                  |
| `case_facilities` rows can be deleted; current license and termination dates can change.                                 | Do not describe the feed as a complete immutable audit ledger. Distinguish recorded additions from date-derived warnings. |
| Provider-facility assignments have a start date but no end date/status; provider-group assignments have start/end dates. | Check available assignment evidence and current entity status; never assume a future assignment is current.               |
| Payer average decision days exist, but no guaranteed decision interval is stored.                                        | Show a labeled estimate only when inputs support it.                                                                      |

## Data trace and ownership

Read-only sources: `providers`, `provider_groups`, `facilities`,
`provider_group_assignments`, `provider_facility_assignments`, `credential_cases`,
`case_facilities`, `state_licenses`, `payers`, `case_status_history`,
`status_history`, and legacy status configuration needed to interpret history.
Organization names and membership context reuse the existing authenticated app
state. No tables, grants, functions, policies, or transactions are modified.

The implementation owns the new billing-readiness service, pure evaluation/feed/
CSV library, hook, route, three report components, tests, registry entry and
generated route registration. Shared layout, UI primitives, tokens, domain types,
and unrelated work packages are not changed.

Implementation uses Luna/xhigh; independent review uses Astra/high. The
orchestrator owns the requirements, integration checks, findings resolution and
draft PR. Fixes remain on the same branch.

## Design references

The inspected [1Password activity log on Mobbin](https://mobbin.com/screens/4df9de3d-fe83-46ba-b832-33c3ffbc48df)
informs the compact filter row, chronological table and export placement. The
[Klaviyo activity log](https://mobbin.com/screens/1f44450b-8a6f-4d19-83e8-24addf2ca0e8)
informs the date-range controls. Minted components and tokens govern the actual
implementation. No external design assets or framework are introduced.

Modifier guidance follows the distinction in [CMS Therapy Services](https://www.cms.gov/medicare/coding-billing/therapy-services).
The report cannot decide claim-line modifier applicability without service data.

## Verification and delivery

Deterministic tests cover identity, dates, assignments, license verification,
assistant holds/candidate filtering, recorded/derived feed events, filtering,
deduplication and safe digest output. Service tests cover the query boundary,
organization isolation and incomplete/error responses where executable locally.

Required integration checks: `npm run lint`, `node_modules/.bin/tsc --noEmit`,
`npm run test`, `npm run build`, `npm run lint:epics`, formatting and
`git diff --check`. The PR records actual results and separates local/source
evidence from hosted RLS verification and PM preview/UAT acceptance.

No migrations, case writeback, EHR/clearinghouse integration, outbound email,
new framework, merge or production release are included.
