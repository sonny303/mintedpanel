# Provider CSV template ↔ Add Provider form parity

**Status:** ticket / work order only — not implemented.  
**Requested:** 2026-09-19.  
**Base for implementation:** current `staging`.  
**Owner:** PM schedules; one bounded draft PR; local evidence does not authorize hosted work.

## Problem

The downloadable provider import template (`provider-import-template.csv` /
`PROVIDER_TEMPLATE_HEADERS` in `src/lib/importSections.ts`) does **not** have
parity with the Add Provider form (`/providers/new` → `ProviderForm` /
`ProviderFormState` in `src/components/providers/providerFormShared.ts`).

Operators who fill the CSV cannot capture several fields the manual Add
Provider path writes on create. Those values must be entered again in the UI
after import. `importSections.ts` already states the design intent that each
section header list is derived from that section’s manual form (“no more, no
fewer”); the provider section has drifted from that contract.

P03 (license preservation) did **not** cause this gap and does not change the
import write path. Import still commits through `commit_import_run`, not
`updateProviderWithLicenses`.

## Source of truth for parity

| Surface                                                                                                 | Role                                                                                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Add Provider form** (`ProviderFormState` + `toProviderInput` / `toLicenseInputs` on `/providers/new`) | Required parity baseline for provider + license columns                                                       |
| **Existing template relationship columns** (`group_*`, `facility_name`, `enrollment_*`)                 | Keep; already beyond single-group Add Provider and must not regress                                           |
| **`providers` table / full `Provider` type**                                                            | **Not** the parity target (DEA, ethnicity, malpractice legacy columns, etc. stay out unless PM expands scope) |

Roster edit (`ProviderRosterForm`) adds `gender` and richer license PSV UI;
those are **out of scope** unless PM explicitly widens this ticket. Home
address is also out of Add Provider today (roster comment notes CSV as a
possible address writer — treat as a **separate** PM decision, not part of
this parity ticket).

## Current vs required columns

### Already on the template (keep)

| Template column                                                                    | Maps to                                                                 |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `group_name`, `group_tin`                                                          | Parent group match                                                      |
| `provider_first_name`, `provider_middle_initial`, `provider_last_name`             | Identity (`middle_initial` is template-only vs Add Provider — **keep**) |
| `npi`, `caqh_id`, `specialty`, `taxonomy_code`                                     | Provider credentials                                                    |
| `license_number`, `license_state`, `license_issue_date`, `license_expiration_date` | `state_licenses`                                                        |
| `ssn_last4`, `date_of_birth`                                                       | Provider demographics (last-4 only)                                     |
| `facility_name`                                                                    | Existing facility assignment by name                                    |
| `enrollment_payer`, `enrollment_state`, `enrollment_effective_date`                | Enrollment fact capture                                                 |

### Missing vs Add Provider (add)

| Proposed template column  | Add Provider field                   | Notes                                                                          |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| `credentials`             | `credentials`                        | Optional                                                                       |
| `email`                   | `email`                              | Format-validate when present                                                   |
| `phone`                   | `phone`                              | Optional                                                                       |
| `start_date`              | `startDate`                          | Date coerce                                                                    |
| `degree`                  | `degree`                             | Optional                                                                       |
| `school_name`             | `schoolName`                         | Optional                                                                       |
| `graduation_date`         | `graduationDate`                     | Date coerce                                                                    |
| `caqh_last_attested_date` | `caqhLastAttestedDate`               | Date coerce; blank when new grad                                               |
| `is_new_grad`             | `isNewGrad`                          | Bool (`yes`/`no`); when true, ignore/clear CAQH id + attestation like the form |
| `license_type`            | license `type` (`full` \| `compact`) | Per license row; blank allowed                                                 |

### Explicitly excluded (do not add in this ticket)

| Field / topic                                                        | Why                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Full SSN                                                             | Vault-only; template stays `ssn_last4`                                     |
| Home address                                                         | Not on Add Provider; separate PM call                                      |
| Gender, suffix, DEA, ethnicity, languages, board flags, age groups   | Not on Add Provider                                                        |
| Malpractice\* on provider                                            | Moved to group insurance; form omits                                       |
| License PSV (`verified_status`, URL, stamps)                         | Add Provider create does not set PSV (import already inserts `unverified`) |
| `status`, `reference_only`, `is_test_provider`, `verification_state` | System / import-toggle / always `pending_verification` on create           |
| Frozen `providers.license_*` mirrors                                 | Never write; `state_licenses` remains the grain                            |

## Requirements

| ID  | Requirement                                                                                                                      | Acceptance                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Template headers include every Add Provider–writable provider and license field listed above, plus existing relationship columns | Downloaded `provider-import-template.csv` header row matches the approved ordered list; unit drift test vs `ProviderFormState` (+ documented extras) fails if a form field is dropped |
| R2  | Scan + map persist every new column into the commit plan                                                                         | Staged mapped JSON and `buildCommitPlan` creates carry the new provider/license fields                                                                                                |
| R3  | `commit_import_run` inserts the new provider columns and `license_type` on license inserts                                       | Object-verify RPC body; create path writes values; omitted cells leave DB null/default                                                                                                |
| R4  | Validation matches Add Provider rules where applicable                                                                           | Email format, NPI/CAQH/date/bool/`license_type` enum; `is_new_grad=yes` clears CAQH fields like the form                                                                              |
| R5  | Exact header gate remains strict; old templates fail loudly                                                                      | Missing/extra/renamed headers still reject with the existing `checkHeaders` UX; helper text tells operators to re-download                                                            |
| R6  | Existing relationship behavior unchanged                                                                                         | Multi-row fold for groups/facilities/enrollments/licenses still works; unknown facility/payer names still error                                                                       |
| R7  | No P03 / interactive license-command regression                                                                                  | Import does not call `updateProviderWithLicenses`; record/roster license editors unchanged                                                                                            |

## Implementation sketch (for the assignee)

1. **Widen `PROVIDER_TEMPLATE_HEADERS`** and `PROVIDER_DESCRIPTOR.spec` (`dateColumns`, `boolColumns`, etc.) in `src/lib/importSections.ts`; refresh helper text.
2. **Map** new fields in `buildMapped`; fold into disposition provider objects in `src/lib/importDedupe.ts` / wire shapes in `buildCommitPlan`.
3. **Additive migration** updating `commit_import_run` create `INSERT INTO providers (...)` to accept the new keys from `v_entry -> 'provider'`, and license insert to set `license_type` when present. Do not drop columns or change update narrow-set rules unless PM asks (conflict updates today only touch name/npi/specialty + license number/dates — document whether create-only parity is enough).
4. **Tests:** header drift / form-parity unit test; scan+map cases for each new column; commit-plan wire assertions; e2e template download header + one happy-path create asserting persisted email/phone/license_type/is_new_grad behavior; migration dry-run.
5. **Docs:** fix the stale “derived from ProviderRosterForm” comment in `importSections.ts` to cite Add Provider `ProviderFormState` + documented relationship extras; note in table-register / import docs if the RPC signature changes.

Suggested header order (identity → contact → credentials → education → license → relationships) is an implementation detail; keep deterministic and pinned by test.

## Table trace (expected)

| Table / object                                                                    | Read                           | Write                                                                             |
| --------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| `providers`                                                                       | Unchanged preflight/org checks | Create INSERT widened with new optional columns                                   |
| `state_licenses`                                                                  | Unchanged                      | Create/insert path may set `license_type`; updates stay as today unless PM widens |
| `provider_group_assignments` / `provider_facility_assignments` / enrollment facts | Unchanged                      | Unchanged                                                                         |
| `import_runs` / `import_rows`                                                     | Unchanged                      | Staged `mapped` JSON gains keys (no DDL required if jsonb)                        |
| `commit_import_run`                                                               | —                              | Additive RPC body change (migration)                                              |
| `audit_log`                                                                       | —                              | Existing import audit rows; no new entity types                                   |

## Out of scope

- Implementing this ticket in the same PR as P03 or vault work
- Combined-template resurrection
- Full `providers` row CSV dump / export
- Home-address CSV writer (unless PM adds a follow-on)
- Changing interactive Add Provider / roster UI fields
- Hosted apply without the normal migration verification gate
- Extension `/api` contracts

## Verify (when built)

- Unit: form↔template drift test green; section scan/map/commit-plan tests for new columns
- `npx tsc --noEmit`, focused vitest, affected Playwright import/roster specs
- Migration present; object-verify `commit_import_run` on hosted after operator apply
- Manual: download fresh template, upload a row exercising every new column, open provider record and confirm values match Add Provider semantics (including new-grad CAQH clearing)

## Open PM decisions (resolve before coding)

1. **Create-only vs update conflict path** — Do new fields participate in E3.1 conflict review / narrow updates, or only on create?
2. **`middle_initial`** — Keep template-only (recommended) or add to Add Provider later?
3. **Home address** — Explicit non-goal for this ticket, or add optional columns now?
4. **Breaking header change** — Confirm operators must re-download templates (no dual-header compatibility window).
