# Known debt map (starting N-register)

Use as a **seed**, not a ceiling. Re-verify in code; mark fixed/obsolete when evidence exists. Align IDs with `TECH-DEBT.md` when claiming a close.

## P0 — correctness / security / hosted blockers

| ID          | 3M   | Area       | Symptom                                                               | Likely bites                                                                                             |
| ----------- | ---- | ---------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| OPA-CONFLICT | Muri | both/ops  | Skill/#280 keep `org_payer_assignments` vs payer-setup “retire it”    | **PM R1** before next payer-setup PR — see `docs/ops/audit-course-correct-2026-08-10.md`                |
| GEN-SILENT  | Muri | panel      | Pre-candidacy skips (`no_facility`, facts fence) leave no `/generation` row | Surface skip records + banner; license already on readiness — don’t conflate                       |
| OPS-S6      | Muri | ops        | Slice 6 **SOP read** migration may still be unapplied; vault          | Apply `20260809120100` only ( `20260809120000` is **superseded** by #274 ); regen types; vault checklist |
| OPS-PURGE   | Muri | ops        | #275 catalog DELETE merged but not hosted                             | **Second PM sign-off** then apply; never agent-apply                                                     |
| TRAIN-DUAL  | Mura | extension  | Login/redirect false “New form”; URL bind (build #40)                 | Spike #281 + build #40 open; **once-per-payer** — no further Train until GEN-SILENT/R2                   |
| TD-51       | Muri | extension  | Capture click wiring unproven (source tripwire ≠ click sim)           | Extract side-effect owner or jsdom click; rides TD-50; do not count as covered                           |
| CAPTURE-PHI | Muri | extension  | Labels/values risk in capture path                                    | Audit payload fields; redact; no value logging                                                           |
| VAULT       | Muri | panel/ops  | E4.4 vault not verified hosted                                        | Ops checklist only                                                                                       |
| DOC-PICK    | Mura | panel docs | SCHEMA/CLAUDE still describe pre–D3.3-G `pickTemplate` ownership wall | Truth scrub only (no behavior); code + table-register already D3.3-G after #280                          |
| LISTPORTALS | Mura | panel      | Browser `listPortals` skipped D6.4                                    | **In flight** #282 — close when merged                                                                   |

## P1 — active muda / mura

| ID             | 3M   | Area      | Symptom                                               | Likely bites                                            |
| -------------- | ---- | --------- | ----------------------------------------------------- | ------------------------------------------------------- |
| PAY-UNIVERSE   | Mura | both      | Three payer lists (ops / authoring / globals) confuse | Doc map + UI copy; then consolidate call sites          |
| GLOBAL-PAYERS  | Muda | panel/db  | Dead catalog rows (code path #275)                    | Ops apply after second PM sign-off — not a re-inventory |
| ORPHAN-REPORTS | Muda | panel     | `components/reports/*` after `/reporting`             | Delete orphan modules + grep imports                    |
| DEAD-ADMIN     | Muda | panel     | Unused admin panels/routes                            | Grep + delete or route-hide per TD                      |
| F13-REST       | Mura | extension | Env incomplete (manifest/handoff/CORS)                | One concern per bite                                    |
| TD-41/49/50    | Muda | panel     | Per TECH-DEBT rows                                    | Follow register; don’t reopen F23/F24                   |

## P2 — maintainability

| ID            | 3M   | Area      | Symptom                         | Likely bites                        |
| ------------- | ---- | --------- | ------------------------------- | ----------------------------------- |
| SIDEPANEL-GOD | Muri | extension | Sidepanel size / mixed concerns | Extract helpers → hooks → UI chunks |
| DOC-DRIFT     | Mura | docs      | README/ARCHITECTURE vs code     | Truth PR only; no behavior change   |
| AUDIT-HIST    | Muda | docs      | Slice 4 audit read as live AC   | Banner “historical” or archive path |

## Closed in 3M (do not re-open as open F-items)

- F1 open-case status (Slice 1)
- F8 portals empty registry UX (Slice 1)
- F3 NotYetAvailable / home orphan pattern (Slice 2)
- F4 reporting redirect (Slice 2) — **components cleanup may remain**
- F5 AGENTS/ARCHITECTURE truth (Slice 3)
- F6 watch → content.js (Slice 3)
- F13 Vite env overrides (Slice 4–5) — **rest may remain**
- F23/F24 platform filter + authoring (Slice 6)
- Workflow doc + UAT checklist (Slice 0)
- Postman skipped (D4)
- Payer create S0 (`create_payer` 10-arg converge) — #274
- Ready = checklist SOP + attach facility-backed defaults — #277
- Catalog purge **code** — #275 (hosted apply still OPS-PURGE)
- **TD-47 / SOP All-states + D3.3-G `pickTemplate`** — #280 (spike #278)

## Canonical registers

- `TECH-DEBT.md` (root)
- `DESIGN-DEBT.md` (root)
- `docs/ops/3m-slice-4-sowmya-audit.md` (historical)
- `docs/ops/3m-slice-5-closeout.md`
- `docs/ops/slice-6-platform-org-spike.md`
- `docs/ops/slice-3-sop-all-states-spike.md` (payer-setup Slice 3 — D3.1 A + D3.3-G locked; build #280)
- `docs/ops/train-dual-registry-spike.md` (TRAIN-DUAL — locked; build #40; cadence once-per-payer)
- `docs/ops/audit-course-correct-2026-08-10.md` (stop-the-line: OPA R1 + GEN-SILENT R2; TD-51)
- `docs/ops/global-portal-payer-inventory.sql`
