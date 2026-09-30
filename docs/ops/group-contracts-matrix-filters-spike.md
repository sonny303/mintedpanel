# Group Contracts Matrix filters spike

**Date:** 2026-09-29

**Scope:** Select multiple provider groups and filter the matrix by specialty.

## Findings

- The existing report reads provider groups, payers, contracts, facilities, and payer network targets through query hooks. The `contracts` list already includes `specialty`; no new query, migration, or API contract is needed.
- The existing matrix assumes one group. Its contract lookup uses only payer and state, and the edit drawer receives the selected group. Combining groups in that lookup would merge distinct contracts and could send an edit to the wrong group.
- A contract is unique at `(group_id, payer_id, state)`. `specialty` is optional free text on that record, not another identity dimension. The filter therefore selects existing contract records; it cannot create separate Physical Therapy and Nutrition contracts for the same group, payer, and state.
- The earlier workflow specification defines a blank specialty as multi-specialty / all. The filter shows blank values under **Multi-Specialty / Unspecified** so their meaning remains visible rather than silently assigning them to a named specialty.
- The staging UX audit records a separate matrix load failure: the hosted `contracts` table was missing `tentative_effective_date` and `specialty` when the source queried them. This change does not modify that schema or resolve the hosted rollout dependency.

## Implementation plan and acceptance

1. Replace the one-group selector with a checkbox menu. Keep the first group selected on initial load and allow any set of groups, including an empty selection.
2. Render one payer × state matrix section per selected group. Build every contract lookup and edit target with that section's group ID. Keep state columns from that group's facilities, targets, and contracts when all specialties are shown.
3. Derive specialty choices from loaded contract values, matching case-insensitively after trimming. **All Specialties** shows the full matrix. A named specialty or **Multi-Specialty / Unspecified** shows matching contract payers and states in each selected group; a group without matches gets an explicit empty state. Blank cells in a filtered view are view-only because another specialty may own that group/payer/state contract.
4. Apply the same group and specialty scope to notes and the contract count. Keep payer search as an additional filter. Verify default single-group behavior, combined groups, both named specialties, the empty state, and the edit drawer's group identity with a mocked browser test.

## Release dependency

The code can be reviewed and merged independently. Hosted acceptance still requires the existing contracts-field migration to be present in the target database, followed by a matrix load and filter check in the preview/UAT environment.

## Local verification

- Mocked Playwright contracts-matrix flow passed, including two groups sharing a payer and state, named and unspecified specialties, payer search, and correct edit-drawer group context.
- TypeScript, repository lint, epic hygiene, formatting, and production build passed. Repository lint reported existing warnings and no errors.
- Full Vitest run: 2,672 passed and one unrelated failure in `src/services/providerProfile.di.test.ts` (`profile.tokens` had 16 entries; the test expected 15). This branch changes neither that test nor its service.
- Hosted schema and preview behavior remain unverified in this spike.
