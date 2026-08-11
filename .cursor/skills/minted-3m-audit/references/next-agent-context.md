# Next-agent context (read first for residual lean)

**Purpose:** cheap orientation so the next agent does not re-derive the Aug
2026 thread. Prefer this + `known-debt-map.md` over re-reading chat.

**As of:** 2026-08-11 (24h PR clear — all open product PRs CI-green; merge
order in `docs/ops/24h-pr-wiki-audit-2026-08-11.md`).

---

## Where we are (one screen)

| Item                       | State                                                    | PR / id                        |
| -------------------------- | -------------------------------------------------------- | ------------------------------ |
| Skill pack                 | Canonical in **panel** `.cursor/skills/minted-3m-audit/` | Twin on extension (#41 merged) |
| Course-correct             | Docs lock R1/R2                                          | panel #283 merged              |
| **GEN-SILENT**             | Merged                                                   | panel #284                     |
| 24h audit skill            | Ready                                                    | panel #299                     |
| LISTPORTALS                | Ready to merge                                           | panel #282                     |
| CAP panel                  | Ready (#290 sort refresh, #289 stale copy)               | merge before/with ext CAP      |
| SOP-TT                     | Tip ready (#297); 01–03 closed as superseded             | panel #297                     |
| Add Provider harden        | Ready                                                    | panel #288                     |
| **OPA-RETIRE**             | Ready (merge last among product)                         | panel #285 — hosted apply ops  |
| TRAIN-DUAL spike           | Locked C amended                                         | panel #281 merged              |
| TRAIN-DUAL build           | Ready                                                    | extension #40                  |
| CAP extension              | Ready stack #43 → #44; #46 independent                   | after CAP-01 (#42)             |
| OPS-PURGE / OPS-S6 / VAULT | Hosted residual                                          | Human sign-off only            |

**Cadence rule:** daily provider→cases was unblocked by GEN-SILENT. Prefer
landing OPA-RETIRE (#285) after smaller Form/portal bites. Do not start new
Train/payer-setup product while those ready PRs are still open unless PM
re-orders.

---

## Locked product decisions (do not reopen)

| Lock                  | Meaning                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Ready = checklist SOP | #277 — not autofill/train/prove                                                                                                         |
| Attach defaults only  | #277 — do not reverse E6.2                                                                                                              |
| D3.3-G `pickTemplate` | #280 — state → group → ownership; `state='All'`                                                                                         |
| **R1 B**              | Retire `org_payer_assignments` **as a gate** only; table+rows **dormant** (never DROP). Not a `buildGenerationPreview` candidacy input. |
| **R2**                | **GEN-SILENT** — explain `no_facility` / `pending_verification` skips on `/generation`                                                  |
| TRAIN-DUAL D-TD.*     | URL = capture bind; selection sticky nav/messaging; C1 mismatch copy; keep two APIs; reject B/D auto-bind                               |
| #275 DELETE           | Code merged; hosted needs **second** PM sign-off                                                                                        |

---

## Naming (avoid collisions)

| Say this                         | Not this                                                             |
| -------------------------------- | -------------------------------------------------------------------- |
| **OPA-RETIRE** / **PS-UNIVERSE** | “Slice 3” for assignment retire (#280 owns Slice 3 = SOP All-states) |
| **GEN-SILENT** / **TD-50**       | Bare “Slice 5” (3M Slice 5 closed ≠ payer-setup generation-reason)   |
| **LISTPORTALS**                  | chrome.storage portals (extension fill already uses `/api/portals`)  |

---

## Verification bar (when touching Train/Work / generation)

1. UI — no silent no-op; mismatch/skip copy honest
2. Client → API — Train: no `x-org-id`; Work: org portals
3. API → DB — shared propose `org_id` null; generation candidacy unchanged unless AC says so
4. Tests — pure helpers under `src/lib` or extension `src/shared`; **source-grep ≠ behavioral coverage** (TD-51)
5. Hosted — optional; only with signed Supabase / ops

---

## Hot files (by bite)

| Bite        | Files                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------ |
| GEN-SILENT  | `generationPreview.ts`, `useGenerationPreview.ts`, `GenerationGrid.tsx`                    |
| OPA-RETIRE  | `payers` RLS / select policies, attach WITH CHECK, `create_payer` side-effect; **no DROP** |
| LISTPORTALS | `services/portals.ts` `listPortals`, `portalVisibility.ts`                                 |
| TRAIN-DUAL  | extension `shared/trainForms.ts`, `sidepanel/main.ts` (wire only)                          |
| DOC-PICK    | `SCHEMA.md`, `CLAUDE.md` pickTemplate prose scrub                                          |

---

## Ops residual (never agent-apply)

- #275 catalog DELETE unapplied (~270 payers) until second sign-off
- OPA-RETIRE + CAP-02 migrations — confirm hosted after merge
- `20260809120100` SOP read widen — confirm hosted
- Vault checklist

Announce merges as **repo-green**, never as production-live without ops.

---

## Paste-ready next mandate

```
Mandate: Human-merge open PRs in docs/ops/24h-pr-wiki-audit-2026-08-11.md order.
  After merge: operator-apply OPA + CAP-02 migrations; second sign-off #275.
Bind: .cursor/skills/minted-3m-audit/ — read references/next-agent-context.md first.
Locked: R1 B dormant assignments table; R2 GEN-SILENT shipped; D3.3-G; Ready=checklist;
  TRAIN-DUAL C amended; never DROP assignments.
Verify: unit + Playwright green on each PR before merge; hosted≠merged.
Stop: never self-merge; never claim source-grep = wiring proof (TD-51).
```
