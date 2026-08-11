# Audit course-correct (2026-08-10)

**Status:** R1 + R2 **locked** (PM 2026-08-10). Docs lock in this PR;
**GEN-SILENT** builds as a separate product PR. OPA-RETIRE (retire-as-gate) is
payer-setup follow-on — rename off “Slice 3”; no DDL drop of the table.

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

## Stop-the-line rulings — **LOCKED** (PM 2026-08-10)

### R1 — `org_payer_assignments` → **B retire as a gate**

| Decision | Detail |
| -------- | ------ |
| **Lock** | Stop reading `org_payer_assignments` to gate catalog visibility, attach eligibility, and `create_payer` side-effect |
| **Table** | Leave table + rows in place, **dormant**, additive rule — **never DROP** |
| **Cases** | Proven safe: not a `buildGenerationPreview` candidacy input |
| **Touches** | `payers_select` RLS + attach WITH CHECK — that is **OPA-RETIRE** (paused payer-setup work; **do not** call it Slice 3 — #280 owns that label) |

```
R1: B retire-as-gate (LOCKED)
Work id if built: OPA-RETIRE / PS-UNIVERSE — not "Slice 3"
```

### R2 — Next code bite → **GEN-SILENT** (LOCKED)

Daily-loop fix: a provider with no facility assignment, or stuck in
`pending_verification`, produces **zero rows and zero explanation** on
`/generation`. Surface why, using signals the system already computes.
License-state stays an advisory readiness gap on rows that *do* generate —
do not conflate.

Hot files: `src/lib/generationPreview.ts`, `src/hooks/useGenerationPreview.ts`,
`src/components/generation/GenerationGrid.tsx`.

```
R2: GEN-SILENT (LOCKED) — build next; OPA-RETIRE is separate follow-on
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

## Naming collisions

| Label | Meaning | Urgency |
| ----- | ------- | ------- |
| **3M / shipped Slice 3** (#280) | SOP All-states + D3.3-G `pickTemplate` — `docs/ops/slice-3-sop-all-states-spike.md` | **Live** — number already shipped |
| **Payer-setup Slice 3** (unbuilt) | Collapse payer universe / retire `org_payer_assignments` as gate | **Collides with #280** if R1 = retire — rename before that work ships (e.g. **PS-UNIVERSE** / **OPA-RETIRE**) |
| **3M Slice 5** (closed) | F13 hygiene + TD-41/49/50 park — `docs/ops/3m-slice-5-closeout.md` | Closed; prefer TD ids |
| **Payer-setup Slice 5** (out) | Generation-reason visibility (+ sidepanel extract) | Prefer **GEN-SILENT** / **TD-50** |

Prefer **GEN-SILENT** / **OPA-RETIRE** / **TD-*** IDs in chat over bare “Slice N.”
R1 = retire-as-gate is **locked** — that follow-on is **OPA-RETIRE**, never “Slice 3.”
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
Locked: R1 = B retire-as-gate (table stays dormant); R2 = GEN-SILENT build.
Bind: .cursor/skills/minted-3m-audit/
GEN-SILENT: emit skip rows for no_facility + pending_verification on /generation;
mirror gated-style banner; unit tests; do not change candidacy math.
OPA-RETIRE: separate bite after GEN-SILENT — payers_select RLS + attach WITH
CHECK + create_payer side-effect; never DROP org_payer_assignments; never
name it Slice 3 (#280).
Ops: OPS-PURGE / OPS-S6 remain human sign-off.
Never self-merge. Never claim source-grep = behavioral coverage (TD-51).
```
