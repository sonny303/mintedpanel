# Next-agent context (read first for residual lean)

**Purpose:** cheap orientation so the next agent does not re-derive the Aug
2026 thread. Prefer this + `known-debt-map.md` over re-reading chat.

**As of:** 2026-08-10 (after R1/R2 lock + GEN-SILENT build).

---

## Where we are (one screen)

| Item | State | PR / id |
| ---- | ----- | ------- |
| Skill pack | Canonical in **panel** `.cursor/skills/minted-3m-audit/` | Keep twin identical on extension (#39 if still open) |
| Course-correct | Docs lock R1/R2 | panel #283 |
| **GEN-SILENT** | Product build (R2) | panel #284 — **land / verify next** |
| LISTPORTALS | Browser `listPortals` D6.4 | panel #282 |
| TRAIN-DUAL spike | Locked C amended | panel #281 |
| TRAIN-DUAL build | C1 + URL bind + fresh tabId | extension #40 (TD-51 wiring gap open) |
| **OPA-RETIRE** | R1 B locked — **not started** | After GEN-SILENT; **not** “Slice 3” |
| OPS-PURGE / OPS-S6 / VAULT | Hosted residual | Human sign-off only |

**Cadence rule:** daily provider→cases (`GEN-SILENT`, then related) before
once-per-payer Train polish. Do not start new Train/payer-setup product while
GEN-SILENT is the open daily-loop bite unless PM re-orders.

---

## Locked product decisions (do not reopen)

| Lock | Meaning |
| ---- | ------- |
| Ready = checklist SOP | #277 — not autofill/train/prove |
| Attach defaults only | #277 — do not reverse E6.2 |
| D3.3-G `pickTemplate` | #280 — state → group → ownership; `state='All'` |
| **R1 B** | Retire `org_payer_assignments` **as a gate** only; table+rows **dormant** (never DROP). Not a `buildGenerationPreview` candidacy input. |
| **R2** | **GEN-SILENT** — explain `no_facility` / `pending_verification` skips on `/generation` |
| TRAIN-DUAL D-TD.* | URL = capture bind; selection sticky nav/messaging; C1 mismatch copy; keep two APIs; reject B/D auto-bind |
| #275 DELETE | Code merged; hosted needs **second** PM sign-off |

---

## Naming (avoid collisions)

| Say this | Not this |
| -------- | -------- |
| **OPA-RETIRE** / **PS-UNIVERSE** | “Slice 3” for assignment retire (#280 owns Slice 3 = SOP All-states) |
| **GEN-SILENT** / **TD-50** | Bare “Slice 5” (3M Slice 5 closed ≠ payer-setup generation-reason) |
| **LISTPORTALS** | chrome.storage portals (extension fill already uses `/api/portals`) |

---

## Verification bar (when touching Train/Work / generation)

1. UI — no silent no-op; mismatch/skip copy honest
2. Client → API — Train: no `x-org-id`; Work: org portals
3. API → DB — shared propose `org_id` null; generation candidacy unchanged unless AC says so
4. Tests — pure helpers under `src/lib` or extension `src/shared`; **source-grep ≠ behavioral coverage** (TD-51)
5. Hosted — optional; only with signed Supabase / ops

---

## Hot files (by bite)

| Bite | Files |
| ---- | ----- |
| GEN-SILENT | `generationPreview.ts`, `useGenerationPreview.ts`, `GenerationGrid.tsx` |
| OPA-RETIRE | `payers` RLS / select policies, attach WITH CHECK, `create_payer` side-effect; **no DROP** |
| LISTPORTALS | `services/portals.ts` `listPortals`, `portalVisibility.ts` |
| TRAIN-DUAL | extension `shared/trainForms.ts`, `sidepanel/main.ts` (wire only) |
| DOC-PICK | `SCHEMA.md`, `CLAUDE.md` pickTemplate prose scrub |

---

## Ops residual (never agent-apply)

- #275 catalog DELETE unapplied (~270 payers) until second sign-off
- `20260809120100` SOP read widen — confirm hosted
- Vault checklist

Announce merges as **repo-green**, never as production-live without ops.

---

## Paste-ready next mandate

```
Mandate: Finish/verify GEN-SILENT (#284) then OPA-RETIRE spike/build if PM asks.
Bind: .cursor/skills/minted-3m-audit/ — read references/next-agent-context.md first.
Locked: R1 B dormant assignments table; R2 GEN-SILENT; D3.3-G; Ready=checklist;
  TRAIN-DUAL C amended (no further Train unless asked); never DROP assignments.
Verify: unit tests; no candidacy math change in GEN-SILENT; hosted≠merged.
Stop: draft PRs; never self-merge; never claim source-grep = wiring proof (TD-51).
```
