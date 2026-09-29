# WP 1.3 — Provider Roster Engine, Phase 1

## Authority and delivery

The user approved Option A on 2026-09-25 after repository discovery: implement
the complete engine with clearly marked draft payer schemas, independent
review, and a draft PR. This is explicit approval to include requirements and
implementation together in this PR. It does not authorize merge, hosted
migration, deployment, release, or payer submission.

Base: `origin/main` at `72ccbbe5380ec6b92c0d2485bfcdd46cf27f359c`.
Branch: `feat/wp1.3-provider-roster-engine`. No dependency on PR #417.
Implementation: Luna/xhigh. Independent review: Astra/high.

The attached design handoff and pasted review are references. The user mission
and approved checkpoint control scope, original table names, and SSN last-4
only. The broader attachment's SFTP, fourth grain, second approver, alternate
table names, and vault release paths are not part of this work.

## Requirements and acceptance

| ID     | User outcome                                                                | Acceptance evidence                                                                                                                                                                                                    |
| ------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP13-1 | Open payer roster templates through Reporting Center                        | Credentialing registry entry; org-scoped catalog; BCBS NC, Humana, and Medicare reassignment draft schemas explicitly unverified; existing shell retained                                                              |
| WP13-2 | Save an ordered field mapping for an explicit provider/location/group scope | Real persistence; allowed source fields and per-column transforms; three supported grains; explicit secondary locations; no Cartesian group/location multiplication                                                    |
| WP13-3 | See deterministic values and blockers before exporting                      | Uppercase, two date formats, phone stripping, NPI format/Luhn, mandatory address/ZIP+4 and active target-state license tests; required fields and target types enforced                                                |
| WP13-4 | Record an attributable exception to a data blocker                          | Admin/specialist only; trimmed reason at least 20 characters; immutable DB event saved when submitted; row/rule/field and source fingerprint binding; changed inputs invalidate its use                                |
| WP13-5 | Export the validated data as CSV or XLSX                                    | Server revalidation; unchanged expected input fingerprint; exact ordered headers/cells; leading zeros preserved; formula-safe text; deterministic bytes; limits fail explicitly rather than truncate                   |
| WP13-6 | Retrieve an unchanged historical export                                     | Atomic original bytes, database SHA-256, frozen schema/mapping/rows, applied overrides, actor/time/counts; scoped idempotent retries; authorized original-byte download after source changes                           |
| WP13-7 | Keep organization data and ledger writes protected                          | Org RLS, explicit grants, service-only RPC execution, verified actor and current membership checks; wrong-org and billing write denials; append-only snapshot/override enforcement; real SQL rollback and tamper tests |

## Data and authorization contract

| Surface          | Contract                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sources read     | `providers`, `provider_group_assignments`, `provider_facility_assignments`, `provider_groups`, `facilities`, `state_licenses`, `memberships`                   |
| New tables       | `roster_templates`, `roster_mappings`, `roster_export_snapshots`, `roster_export_overrides`                                                                    |
| Existing writes  | `audit_log` through approved operations; no changes to provider data                                                                                           |
| TIN identity     | Selected facility's `group_id` resolves `provider_groups.tin`; `providers.group_id` is not a source of truth                                                   |
| Sensitive fields | Only explicitly mapped DOB and SSN last-4; never full SSN or vault access; no sensitive values in logs or history list responses                               |
| Writers          | Existing `admin` and `specialist` roles; no second approver                                                                                                    |
| Readers          | Current organization members, including read-only billing; no anonymous access                                                                                 |
| Server boundary  | Narrow `/api/rosters/*` browser-service exception; `guard.ts` verifies JWT and resolves membership; no organization or actor authority from body/query         |
| Persistence      | Service-only operations verify actor membership; store artifact bytes and metadata in one transaction; no object-storage/DB partial commit window              |
| Immutability     | Snapshots and override events cannot be updated, deleted, or truncated through ordinary or service-role operations; history never regenerates from live source |

Provider grain must reject ambiguous location-dependent mappings until scope is
explicit. Provider–Location and Provider–Location–TIN use actual assignments,
not every possible group/location pair. License validity uses the selected
location state and current validation date. Missing or expired credentials
produce visible blockers; overrides do not grant access or bypass malformed
requests, source ambiguity, or tenant boundaries.

## Draft payer schemas

The seed schemas are editable mapping starting points, not certified copies of
payer workbooks. `is_verified=false` and draft status remain visible through
export and frozen history. Exact payer acceptance remains outside this source
delivery until authoritative payer specifications are reconciled.

CMS discontinued CMS-855R and moved reassignment into CMS-855I; the seed is
therefore named **Medicare Reassignment Worksheet**, not an official Medicare
submission form. Source: [CMS September 7, 2023 notice](https://www.cms.gov/training-education/medicare-learning-network/newsletter/2023-09-07-mlnc).

## UI and design references

Use the existing Geist shell and stock components, with compact rows, token
borders, and local roster navigation. Mapping has ordered source/target rows
and a persistent preview. Validation has issue filtering and a detail/override
inspector. Narrow screens stack the inspector without whole-page overflow.

Mobbin references were visually inspected:

- [Attio mapping and preview](https://mobbin.com/screens/66a5a32c-0b06-4b83-b48b-d96cb4da4e12).
- [Melio errors and detail inspector](https://mobbin.com/screens/b3b4de02-bcd9-4d8d-b0ff-c04d53119f32).

## Verification and release boundary

Required: `npm run lint`, `node_modules/.bin/tsc --noEmit`, `npm run test`,
`npm run build`, `npm run lint:epics`, format/diff checks, focused export and
validation tests, real isolated PostgreSQL authorization/immutability checks,
and the repository's API isolation gate. Synthetic fixtures only.

The verification record and PR must distinguish local/CI evidence from hosted
runtime proof and human UI acceptance. No SFTP, automated delta detection, PDF
mapping, heavy grid suite, external delivery, or production activation.

Phase 1 bounds exports to 5,000 rows and 3 MiB per artifact. Selection and
history reads are paginated with an explicit 5,000-record ceiling; over-limit
requests fail rather than silently truncate. CSV uses UTF-8 and CRLF with
formula-safe text. XLSX uses deterministic ZIP metadata and text cells to
preserve identifiers. Both formats retain ordered headers and output values;
history downloads retrieve the original bytes and verify their checksum.

## Verification record — 2026-09-25

| Gate                             | Result                                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting / diff                | Prettier and `git diff --check` pass                                                                                                                       |
| `npm run lint`                   | Pass: zero errors; 14 existing warnings in unchanged files                                                                                                 |
| `node_modules/.bin/tsc --noEmit` | Pass                                                                                                                                                       |
| `npm run test`                   | 177 files, 2,342 tests pass; 39 focused roster tests                                                                                                       |
| `npm run build`                  | Pass, including client, SSR, and Nitro output                                                                                                              |
| `npm run lint:epics`             | Pass: all 65 tables registered; 167 existing scenarios                                                                                                     |
| Browser flow                     | One Chromium test passes with synthetic HTTP fixtures: save mapping, record override, retry export with the same key, download, and inspect frozen history |
| API isolation gate               | Correct mock passes; all 21 deliberate leak modes fail as expected, including roster lists, history, and downloads                                         |
| SQL security suite               | 33 assertions pass on PostgreSQL 16.15; owned container cleanup passes                                                                                     |
| Full migration replay            | All 115 migrations apply on disposable PostgreSQL 16; all four roster tables have RLS enabled                                                              |
| Independent artifact readback    | Python/openpyxl and ZIP/CSV readers verify deterministic bytes, text cells, identifier zeros, Unicode, CRLF, safe formulas, and fixed ZIP timestamps       |
| Independent review               | Astra/high reviewed final production code, tests, SQL harness, and CI wiring; no remaining confirmed blockers                                              |

The permanent SQL command is `node scripts/security/verify-roster-engine.mjs`.
It uses a fresh, network-disabled local container and a cached `postgres:16`
image. Optional local overrides are `P01_DOCKER_CONTEXT` and
`WP13_POSTGRES_IMAGE`. The CI authorization job runs the same suite. Its fixture
loads the real baseline, provider-group assignment and facility start-date
migrations, then WP 1.3; full historical replay is a separate gate.

Browser proof is mocked HTTP interaction, not hosted authentication or payer
acceptance. No hosted migration, deployment, production activation, or human
UI acceptance was performed. Those gates remain open for the release owner.
