# Known debt map (starting N-register)

Use as a **seed**, not a ceiling. Re-verify in code; mark fixed/obsolete when evidence exists. Align IDs with `TECH-DEBT.md` when claiming a close. See also `next-agent-context.md`.

**Cadence:** `daily` | `setup` | `once-payer` | `ops` | `rare`.

## P0 — correctness / security / hosted blockers

| ID | 3M | Cadence | Area | Symptom | Likely bites |
| -- | -- | ------- | ---- | ------- | ------------ |
| GEN-SILENT | Muri | daily | panel | Pre-candidacy skips silent on `/generation` | **R2 locked — #284 build**; `no_facility` + `pending_verification` |
| OPA-RETIRE | Muri | setup | panel/db | Assignments still gate catalog/attach/`create_payer` | **R1 B locked** — retire gate; table dormant; after GEN-SILENT; **not Slice 3** |
| OPS-S6 | Muri | ops | ops | `20260809120100` SOP read may be unapplied; vault | Apply only that migration; regen types; vault checklist |
| OPS-PURGE | Muri | ops | ops | #275 DELETE merged, not hosted (~270 payers) | Second PM sign-off; never agent-apply |
| TRAIN-DUAL | Mura | once-payer | extension | Login/redirect false “New form”; URL bind | Spike #281 + build #40; no further Train until daily-loop clear |
| TD-51 | Muri | rare | extension | Capture click “wiring” = source tripwire only | jsdom click or effect-owner extract (TD-50 Train phase) |
| LISTPORTALS | Mura | daily/setup | panel | Browser `listPortals` vs API D6.4 | **#282** — close when merged |
| CAPTURE-PHI | Muri | once-payer | extension | Labels/values risk in capture | Audit payload; redact; no value logging |
| VAULT | Muri | ops | panel/ops | E4.4 vault not verified hosted | Ops checklist only |
| DOC-PICK | Mura | rare | panel docs | SCHEMA/CLAUDE pre–D3.3-G prose | Truth scrub only |

## P1 — active muda / mura

| ID | 3M | Cadence | Area | Symptom | Likely bites |
| -- | -- | ------- | ---- | ------- | ------------ |
| SOP-TT | Mura | setup | panel | Tasks & steps: dual execution×step types + 1:1 bloat | Spike `docs/ops/sop-tasks-steps-simplification-spike.md` → BITE-SOP-TT-01..04 (#293/#295/#296/#297) |
| PAY-UNIVERSE | Mura | setup | both | Three payer lists confuse | Doc map + UI copy; then consolidate |
| GLOBAL-PAYERS | Muda | ops | panel/db | Dead catalog rows | Ops apply after OPS-PURGE sign-off |
| ORPHAN-REPORTS | Muda | rare | panel | `components/reports/*` | Delete + grep imports |
| DEAD-ADMIN | Muda | rare | panel | Unused admin panels | Grep + delete/hide |
| F13-REST | Mura | setup | extension | Manifest/handoff/CORS | One concern per bite |
| TD-41/49/50 | Muda | rare | panel/ext | Per TECH-DEBT | Follow register |

## P2 — maintainability

| ID | 3M | Cadence | Area | Symptom | Likely bites |
| -- | -- | ------- | ---- | ------- | ------------ |
| SIDEPANEL-GOD | Muri | rare | extension | `main.ts` godfile | TD-50 phased extract |
| DOC-DRIFT | Mura | rare | docs | README/ARCHITECTURE vs code | Truth PR only |
| AUDIT-HIST | Muda | rare | docs | Slice 4 audit as live AC | Banner historical |

## Closed in 3M (do not re-open as open F-items)

- F1 open-case status · F8 portals empty UX · F3 NotYetAvailable · F4 reporting redirect
- F5 AGENTS/ARCHITECTURE · F6 watch→content.js · F13 Vite overrides (rest may remain)
- F23/F24 platform filter + authoring (Slice 6)
- Workflow doc + UAT checklist · Postman skipped (D4)
- Payer create S0 (#274) · Ready + attach defaults (#277) · Catalog purge **code** (#275)
- **TD-47 / SOP All-states + D3.3-G** (#280)

## Open spikes (awaiting PM)

- **SOP Tasks & steps simplification** — `docs/ops/sop-tasks-steps-simplification-spike.md` (D-SOP-1..4); no product code until ack.

## Canonical registers

- `TECH-DEBT.md` / `DESIGN-DEBT.md`
- `docs/ops/audit-course-correct-2026-08-10.md` (R1/R2 locks)
- `docs/ops/train-dual-registry-spike.md`
- `docs/ops/slice-3-sop-all-states-spike.md` (#280 — owns “Slice 3”)
- `docs/ops/slice-6-platform-org-spike.md`
- `docs/ops/3m-slice-5-closeout.md` (closed 3M Slice 5)
- `docs/ops/3m-slice-4-sowmya-audit.md` (historical)
- `docs/ops/slice-3-sop-all-states-spike.md` (payer-setup Slice 3 — D3.1 A + D3.3-G locked; build #280)
- `docs/ops/train-dual-registry-spike.md` (TRAIN-DUAL — pointer + registry; awaiting PM ack)
- `docs/ops/global-portal-payer-inventory.sql`
