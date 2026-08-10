# Audit course-correct (2026-08-10)

**Status:** stop-the-line for new payer-setup / Train product work until the
two PM rulings below land. Docs only — no schema/behavior in this PR.

Companion: skill `.cursor/skills/minted-3m-audit/` ·
[`repo-workflow.md`](./repo-workflow.md) · TECH-DEBT **TD-51**.

---

## What the last review got right

1. **Extension #40 bugfix is real** — fresh `tabId`/`tabUrl` + `detectPortal()`
   on Work mismatch closes the stale-id hole.
2. **Harness “wiring” coverage was overclaimed** — the new assert is a
   **source tripwire** (`readFileSync` + `toContain`), not a click simulation.
   Helper rejection of a mismatched tab is real; proving the click handler
   *uses* that decision is **not**. Logged as **TD-51** (rides TD-50 extract).
3. **Cadence discipline slipped** — LISTPORTALS (#282) was the right daily-loop
   sibling; TRAIN-DUAL **build** (#40) went ahead without usage/frequency
   evidence after the spike asked for it. Fix quality ≠ plan execution.

---

## Stop-the-line rulings (need PM)

### R1 — `org_payer_assignments`

| Lane signal | Claim |
| ----------- | ----- |
| Skill / #280 / #281 locks | **Keep** `org_payer_assignments` (org↔payer adoption ≠ group↔payer ops) |
| Payer-setup lane mandate (chat) | Assignments **not needed**; keep `payer_network_targets` |

Same table, opposite directions. Every subsequent attach/create/SOP-read PR
hardens one assumption. **No further payer-setup product PR until R1.**

```
R1 org_payer_assignments: keep (skill lock) | retire (payer-setup mandate) | spike-only (inventory consumers + D-questions, no DDL)
```

### R2 — Next code bite = daily provider→cases loop

Do **not** start more Train / catalog / portal dual-registry work until a
daily-loop bite is in flight (or PM explicitly re-orders).

**Recommended next code bite (after R1, or in parallel if R1 = keep):**

**GEN-SILENT** — surface pre-candidacy skips on `/generation` (especially
`no_facility` / facts-fenced providers). Today `buildGenerationPreview` drops
them with **no row and no reason**. License-state is already a readiness gap on
*proposed* rows — do not conflate.

Hot files: `src/lib/generationPreview.ts`, `src/hooks/useGenerationPreview.ts`,
`src/components/generation/GenerationGrid.tsx`, optional `providerGaps.ts`.

```
R2 next build: GEN-SILENT (recommended) | other daily-loop (name it) | resume Train/payer-setup anyway
```

---

## Hosted ≠ merged (ops residual — not agent-apply)

| Item | Repo | Hosted |
| ---- | ---- | ------ |
| #275 catalog DELETE | merged code | **Unapplied** until second PM sign-off (OPS-PURGE) |
| `20260809120100` SOP read widen | on main | **Unverified** apply (OPS-S6) |
| Vault | checklist | Unverified |

Announce merges as **repo-green**; never imply production-live without ops.

---

## Naming collision

| Label | Meaning |
| ----- | ------- |
| **3M Slice 5** (closed) | F13 hygiene + TD-41/49/50 park — `docs/ops/3m-slice-5-closeout.md` |
| **Payer-setup Slice 5** (out) | Generation-reason visibility (+ sidepanel extract) — skill lock “out unless asked” |

Prefer **GEN-SILENT** / **TD-50** IDs in chat over “Slice 5.”

---

## TRAIN-DUAL status (honest)

| Piece | State |
| ----- | ----- |
| Spike #281 | Open — decisions locked |
| Build extension #40 | Open — C1 + URL bind + stale-tabId fix **code-correct** |
| Cadence / frequency line | Still missing on debt map — once-per-payer |
| Click wiring proof | **TD-51 open** — tripwire only |
| Further Train PRs | **Stopped** pending R1/R2 |

---

## Next-agent packet

```
Stop: no new Train / payer-setup product until PM replies R1 + R2.
Bind: .cursor/skills/minted-3m-audit/
If R2 = GEN-SILENT: panel-only; emit skip rows for pre-candidacy drops;
mirror gated banner; unit tests; no org_payer_assignments DDL.
Ops: OPS-PURGE / OPS-S6 remain human sign-off.
Never self-merge. Never claim source-grep = behavioral coverage.
```
