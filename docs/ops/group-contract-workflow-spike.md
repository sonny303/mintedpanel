# Group–Payer Network Decision Report — 3M Scope

**Date:** 2026-09-26

**Status:** Report plan for PM review; no application or schema changes in this PR

**Base:** `sonny303/mintedpanel` `main` at `06261a400261203bbb2b03e40a9b73adc7e0c2fc`

## Decision

Give internal staff one Reporting Center report at **group × payer** grain. Start with every payer attached to a group, including those without a payer decision. Staff can record a **validated group-level payer decision** on that relationship. A payer's denial of the group must be visible even if no provider case exists. A provider denial remains on its provider case and never becomes a group denial by inference.

“Contract” here means the group's payer-network relationship and its confirmed outcome. Staff should not create or save a separate contract object. This replaces the earlier proposal for agreement versions, a contract ledger, client publication, and extension work.

| 3M | Waste or burden removed | User outcome |
| --- | --- | --- |
| Muda | A separate agreement system and six dependent slices for one report | One small report slice can reach the screen |
| Mura | The current board's denial marker is derived from provider cases | Group decisions and provider cases have separate, clear meanings |
| Muri | Staff must attach a payer to generate cases but cannot record that the payer denied the group | Staff can record and find the payer's group decision in one workflow |

## What exists

| Surface | Verified source behavior | Consequence |
| --- | --- | --- |
| `payer_network_targets` | One row per group × payer × state; `status` means active or archived target. Active targets feed provider-case generation. | Keep target intent separate from a payer decision. Do not rename `status` to Denied. |
| Group Payer Network board | Shows one payer row per group. Its Targeted/In Progress/Active pill derives from provider cases and enrollment facts; “Denial on file” comes from provider-case history. | This board cannot establish whether the group itself was accepted or denied. |
| `contracts` and old reports tabs | The legacy contract status editor and matrix remain in source but are not mounted; `/reports` redirects to `/reporting`. The earlier read-only spike counted zero contract rows in staging and production on September 26. | Do not revive the old Add contract flow or use provider cases to populate contract records. Recheck live counts before implementation. |
| Reporting Center | Its registry at `src/lib/reports.ts` and `/reporting` are the active report entry. | Add one internal report card and route using the existing shell. |

## Small operator workflow

| Step | Staff action | Screen result |
| --- | --- | --- |
| 1 | Attach a payer to the group for the relevant state(s), using the existing group Payer Network flow. | The group × payer pair appears in the report as **No confirmed decision**. |
| 2 | When the payer responds, record its group-level decision for each applicable state, response date, reason when denied, and a payer communication or document reference. | The report shows the confirmed state outcome. An unsupported verbal assumption does not become Accepted or Denied. |
| 3 | If the payer changes its decision, correct the same relationship with a new dated, sourced outcome. | The current outcome is visible; the existing audit trail retains who changed it and when. |
| 4 | Review the report from Reporting Center. | One row per group × payer; state outcomes appear within that row. Provider cases can be opened separately and do not determine the group outcome. |

The first screen is **internal staff only**. Existing organization access and target-write permissions remain the starting point; do not add a client publication flow.

## Report contract

- **Row key:** organization + group + payer. Never multiply a row by provider, case, product, or state.
- **Row set:** distinct group × payer pairs with a payer-network target; a target with no decision remains visible.
- **Columns:** group, payer, targeted states with each state's current decision and response date, denial reason where applicable, and an edit action for an authorized target writer.
- **State handling:** several states remain in one group × payer row. Show each state's outcome explicitly; do not collapse mixed states into one misleading “Contracted” or “Denied” label.
- **Filters:** organization, group, payer, state, and group decision. Empty/loading/error behavior follows existing Reporting Center reports.
- **Source:** the group's target relationship plus its recorded payer decision. Provider-case denial, approval, and enrollment facts do not set a group decision.
- **Meaning:** “Accepted” means a sourced payer decision for the group in that state; it does not by itself certify every provider's enrollment or billing eligibility.

## Minimal implementation proposal — one slice after PM review

| Field | Scope |
| --- | --- |
| Objective | Record a sourced group-level payer decision and show the group × payer report. |
| Model | Add only the needed decision, decision date, reason, and source-reference fields to the existing group × payer × state target. Keep active/archived target status and legacy `contracts` untouched. Reuse existing audit behavior and org-scoped write permissions. |
| UI | Add a small outcome editor on the existing group payer relationship and a report route/card in Reporting Center. Use one shared source; do not make staff enter the same decision twice. |
| Likely files | Additive migration and table register; `payerNetworkTargets` service/hook; group payer board; one report route/component and registry entry; narrow tests for group isolation, mixed-state display, and provider-denial separation. |
| Verify | Typecheck, lint, focused tests, build, migration checks, and an internal preview walkthrough of a targeted pair, denied group, and mixed-state pair. PM verifies the screen. |
| Rollback | Hide the report/editor and stop writing additive fields; retain recorded data and audit history. |
| Done | Staff can attach a payer, record a sourced group decision, see exactly one group × payer row, and distinguish group denial from provider denial. |
| Outside this slice | Separate contract records, agreement versioning, product coverage, client report, export, form fill, portal submission, and billing clearance. |

### Open behavior decision before build

Should a **confirmed group denial** prevent *new* provider-case generation for that exact group × payer × state until staff records a new group decision? Existing provider cases would remain intact. This choice changes case-generation behavior and is not implied by the report request.

## Source pointers

- [`payer_network_targets` schema](../../supabase/migrations/20260712190000_payer_network_targets.sql) and [`target service`](../../src/services/payerNetworkTargets.ts)
- [`group payer board`](../../src/components/groups/PayerNetworkBoardContent.tsx) and [`case-derived rollup`](../../src/lib/caseRollups.ts)
- [`generation preview`](../../src/lib/generationPreview.ts) and [`Reporting Center registry`](../../src/lib/reports.ts)
- [`/reports` redirect](../../src/routes/reports.tsx) and dormant [`ContractsTab`](../../src/components/reports/ContractsTab.tsx)
