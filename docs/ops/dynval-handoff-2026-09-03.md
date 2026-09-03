# DYNVAL handoff — 2026-09-03

**Purpose:** next-session orientation for the dynamic-values / page-aware fill
tranche. Prefer this over re-reading chat.

**As of:** 2026-09-03 evening (UTC) · Cloud agent session that supervised the
spike and started the page-aware build.

**ADHD first action:** push extension `cursor/dyn-page-01-2517` (or re-apply
the patch below), open its PR, then build **DYN-PAGE-02**.

---

## One-screen status

| Item                                 | State                                      | Where                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spike (decision-ready)               | **Open — not on `main`**                   | panel [PR #353](https://github.com/sonny303/mintedpanel/pull/353) · branch `claude/dynamic-values-healthcare-9o0yod` · file `docs/ops/dynamic-values-autofill-spike.md` |
| **DYN-PAGE-00** panel consumer       | **Merged**                                 | panel [PR #354](https://github.com/sonny303/mintedpanel/pull/354) → `main` @ `bca21b9`                                                                                  |
| **DYN-PAGE-01** extension exact-page | **Built + verified locally; push blocked** | extension branch `cursor/dyn-page-01-2517` · commit `6cab4d0` · patch: [`dyn-page-01-extension.patch`](./dyn-page-01-extension.patch)                                   |
| **DYN-PAGE-02** hidden-control guard | Not started                                | extension; depends on PAGE-01 shipped                                                                                                                                   |
| **DYN-TOKEN-00** token-parity spike  | Not started                                | panel (+ extension map); parallel OK                                                                                                                                    |
| Cloud env write access               | **panel only**                             | `minted-extension` push returned 403                                                                                                                                    |

Pinned producer contract (panel `src/lib/formDrift.ts`, already on `main`):

- kind: `other_page`
- reason: `field belongs to another page`

---

## Locked decisions (do not reopen)

| ID       | Decision                                                           |
| -------- | ------------------------------------------------------------------ |
| D-DYN-1  | Build by engineering dependency, not original list order           |
| D-DYN-2  | `system.today` = coordinator browser-local calendar at fill click  |
| D-DYN-3  | Offered token must mean the same on web portal and payer PDF       |
| D-DYN-4  | Token parity is its own prerequisite before `system.today`         |
| D-DYN-5  | Dynamic-date v1 is **today only** — no offsets, formulas, `case.*` |
| Existing | Extension never submits; human reviews and submits                 |
| Existing | Token keys stay bare (`system.today`), no mini-language            |

Full rationale, evidence, and bite specs: spike on #353.

---

## What already shipped

### Panel PAGE-00 (merged)

`src/lib/formDrift.ts` + tests:

- Exports `OTHER_PAGE_KIND` / `OTHER_PAGE_REASON`
- `isOnPageNotFound` / `isOtherPageSkip` helpers
- Drift (`brokenMapsForFill`) still only genuine on-page not-found
- `lastWorkingAt` walks past other-page reports (no inferred success)
- Partial producer (kind **or** reason alone) still treated as off-page

### Extension PAGE-01 (local only — not on GitHub)

Against extension `main` @ `a51fd71`:

| File                              | Change                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `src/shared/fillPage.ts` (+ test) | Exact URL-tail matcher; other-page report helper                             |
| `src/shared/fill.ts`              | `FillInstruction.pageStep`; widen `ReportedFieldKind`                        |
| `src/background/fill.ts`          | Carry `pageStep`; preserve producer kinds when logging (`kind ?? "skipped"`) |
| `src/background/mockFill.ts`      | Carry `pageStep`                                                             |
| `src/content/fillEngine.ts`       | Apply-time other-page skip; `applyFillOnPage` for tests                      |
| `src/shared/fixit.ts`             | Re-export other-page pins; drift strip ignores other-page reason             |

Behavior:

1. Portal-wide planning unchanged (coverage denominator stable)
2. Exact URL-tail ↔ trained exact `pageStep` → classify other pages
3. `Page N` / null / unmatched URL → ordinary not-found (no guessing)
4. No selector-overlap scoring

Verified locally: `npm run typecheck`, `lint`, `test` (439), `build`.

---

## Blockers

1. **Extension push 403.** This Cloud Agent environment only lists
   `github.com/sonny303/mintedpanel`. `git push` to `minted-extension` fails.
   Fix: attach `minted-extension` with write access, **or** push from a machine
   that has it:
   ```bash
   # If the VM still has the checkout:
   cd /tmp/minted-extension && git push -u origin cursor/dyn-page-01-2517
   # Else from a fresh clone:
   git checkout -b cursor/dyn-page-01-2517 origin/main
   git am docs/ops/dyn-page-01-extension.patch   # from panel after this PR merges
   # or: git apply /path/to/dyn-page-01-extension.patch && git commit
   git push -u origin cursor/dyn-page-01-2517
   ```
2. **Spike not on `main`.** Read #353 / its branch for full bite specs until
   that PR merges. This handoff is enough to continue PAGE-02 / TOKEN-00.
3. **Do not ship PAGE-01 to users before PAGE-00 is live.** PAGE-00 is already
   merged to panel `main` — shipping PAGE-01 is now unblocked once the
   extension PR lands (confirm Vercel/production deploy of panel if that lags
   `main`).

---

## Next bites (ordered)

### 1. Unblock + open extension PAGE-01 PR (ops / access)

- Branch: `cursor/dyn-page-01-2517`
- Title suggestion: `DYN-PAGE-01: report exact off-page fill misses`
- Depends on: panel PAGE-00 (**done**)
- AC: exact other-page visible + non-drift; ambiguous = old behavior; kinds preserved in fill-event log

### 2. DYN-PAGE-02 — never write hidden controls (extension)

- Depends on: PAGE-01 merged (or at least on the same branch if stacking)
- Hot files: `src/content/captureScan.ts` visibility predicate,
  `src/content/fillEngine.ts`, DOM tests
- Emit a **distinct non-drift** skip reason (do not reuse `FIELD_NOT_FOUND` or
  `OTHER_PAGE_REASON`)
- AC: hidden target unchanged; visible fill unchanged; skip not counted as drift
- Non-goals: custom widgets, shadow DOM, animation timing

### 3. DYN-TOKEN-00 — token-parity prerequisite (panel spike, parallel)

- Depends on: none
- Objective: honest web/PDF token capability matrix before `system.today`
- Non-goals: implementing parity, adding `system.today`, `case.*`
- After acceptance: parity **build** bites, then **DYN-TODAY-01**

### Later (evidence-gated — do not start)

- Conditional fields → after clean post-PAGE telemetry
- Cascading/async → named payer fixture
- Transforms/masks → DYN-XFORM-00 + named form need
- Custom widgets / CAPTCHA pacing → named failure only
- OPS re-capture → after PAGE-00..02

---

## Paste-ready next mandate

```text
Mandate: (1) land extension DYN-PAGE-01 (push cursor/dyn-page-01-2517 or
  re-apply docs/ops/dyn-page-01-extension.patch), then (2) build ONE bite:
  DYN-PAGE-02 hidden-control guard — OR DYN-TOKEN-00 in parallel on panel.
Bind: docs/ops/dynval-handoff-2026-09-03.md + spike PR #353 +
  .cursor/skills/minted-3m-audit/ + both repos' CLAUDE.md / AGENTS.md.

Locked:
- D-DYN-1..5 (dependency order; browser-local today; web=PDF token meaning;
  parity prerequisite; today-only)
- other_page / "field belongs to another page" already on panel main
- never guess Page N; extension never submits; panel-first telemetry
- draft PRs; never self-merge

Stop:
- no system.today before TOKEN-00
- no conditional column / async / custom widgets without evidence gates
- no transform change in one repo only
- source-grep ≠ behavioral coverage
```

---

## Recovery notes

- Panel PAGE-00 code: already on `origin/main` — do not re-implement.
- Extension PAGE-01 patch checked in beside this file:
  [`dyn-page-01-extension.patch`](./dyn-page-01-extension.patch)
  (also copied under `/opt/cursor/artifacts/` on the originating VM).
- Spike full text: `git show origin/claude/dynamic-values-healthcare-9o0yod:docs/ops/dynamic-values-autofill-spike.md`
  until #353 merges.
- Hosted skip-count percentages in the original spike draft were withdrawn;
  architecture finding does not depend on them. Re-run PHI-safe SQL in the
  spike before quoting counts in a build PR.

---

## Session changelog (this run)

1. Supervised spike → decision-ready #353
2. Built + merged panel PAGE-00 #354
3. Built extension PAGE-01 locally; push denied
4. Wrote this handoff + checked in the PAGE-01 patch for recovery
