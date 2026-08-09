# 3M Slice 5 — close-out (not “postponed forever”)

**Status:** Complete as a 3M slice (2026-08-09).  
**Companion:** [`3m-slice-4-sowmya-audit.md`](./3m-slice-4-sowmya-audit.md).

Slice 5 was never “ignore these bugs.” It was four items that **cannot honestly
ship inside the Lean 3M reliability/simplification lane** without becoming a
second epic. This document **closes the slice** by (1) stating the real blocker
for each item, (2) shipping what _does_ fit now, and (3) parking the rest as
named backlog with acceptance criteria and owners — so nothing sits in limbo
before Slice 6.

---

## Item scorecard

| Item                       | Plan label was | Real blocker                                                                                              | 3M outcome                                                                                                      |
| -------------------------- | -------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| F13 staging deploy config  | postpone       | No `dev → staging → prod` Supabase/Vercel pipeline yet (ROADMAP post-redesign platform)                   | **Shipped hygiene** — extension config is env-overridable at build time (paired extension PR). Defaults = prod. |
| F8 unbounded `getCases`    | postpone       | Needs product limit + pagination UX; blind `.limit()` would silently truncate list/NBA consumers          | **Closed → TD-49** with measured trigger + AC                                                                   |
| TD-41 dual provider create | postpone       | Two different create UIs (`ProviderRosterForm` vs 5-step `ProviderForm`); launch `?locationId=` deep link | **Closed → TD-41** with retire-AC (Providers epic)                                                              |
| Sidepanel decomposition    | postpone       | `main.ts` ~3.5k LOC; extraction touches every Work/Train path; collision with epic + Slice 6 files        | **Closed → TD-50** with phased module map (below)                                                               |

“Postpone” in the original plan meant **out of the 3M execution batch**, not
“nobody owns this.” After this PR, Slice 5 is **done for 3M**; remaining work
is backlog with IDs.

---

## F13 — Staging config (shipped hygiene)

### Problem

`minted-extension/src/shared/config.ts` hardcoded production
`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `API_BASE_URL`. Pointing an unpacked
build at a future staging panel required editing source.

### What we ship in 3M

Build-time overrides via Vite `import.meta.env` (optional). Production defaults
unchanged when env vars are unset — current install/load path keeps working.

| Variable                 | Overrides         |
| ------------------------ | ----------------- |
| `VITE_SUPABASE_URL`      | Supabase URL      |
| `VITE_SUPABASE_ANON_KEY` | Anon key          |
| `VITE_API_BASE_URL`      | Panel `/api` base |

A real staging **environment** (separate Supabase project + promotion pipeline)
remains the ROADMAP “post-redesign platform” item — out of 3M. F13’s 3M gap was
“config requires a code edit”; that gap is closed.

---

## F8 — Unbounded case list reads → TD-49

### Problem

`getCases` in `src/services/cases.ts` selects org cases with filters but **no
ceiling**. Fine at current UAT volume; will stall as orgs grow. NBA assembly and
list hooks can amplify the cost.

### Why not a silent `.limit(N)` in 3M

Cases / reporting / NBA consumers assume “all matching rows.” Truncation without
UI (“showing first N”) is a correctness bug worse than today’s latency.

### Acceptance criteria (next epic / scale pass)

1. Add optional `limit` / cursor to `CaseFilters` with an explicit default
   documented in the service.
2. Every UI consumer either paginates or shows “first N of M.”
3. `/api` case list paths get the same ceiling + `meta` total when truncated.
4. Unit test: filter + limit; e2e smoke on `/cases` with fixture volume.

**Owner / trigger:** first org approaching multi-thousand open+closed cases, or
the next Cases performance epic. Registered as **TD-49**.

---

## TD-41 — Dual provider create doors

### Problem

- Door A: `ProviderRosterForm` (wizard / Providers roster) — CAQH baseline,
  group assignment, licenses, enrollment.
- Door B: `/providers/new` 5-step `ProviderForm` — kept for launch
  `?locationId=` deep links (`useLaunchLocation`).

Edits already consolidated on the provider record. Creation should be one door.

### Why not in 3M

Retiring Door B means teaching the roster dialog the `locationId` prefill
contract (or a param-preserving redirect into a dialog host route) and e2e for
launch deep links. That is a Providers UX epic, not a Lean cleanup hour, and it
collides with Slice 6’s “don’t expand surface area” posture.

### Acceptance criteria (Providers epic)

1. `/providers/new` becomes a redirect shell (E0.4 rule) into the shared create
   dialog / host route.
2. `?locationId=` still pre-selects group + facility.
3. `legacy-routes` / providers e2e cover the deep link.
4. Remove or thin unused `ProviderForm` create-only path once traffic is zero.

**Owner:** next Providers epic. TD-41 disposition updated in `TECH-DEBT.md`.

---

## Sidepanel decomposition → TD-50

### Problem

`minted-extension/src/sidepanel/main.ts` is ~3.5k lines: auth shell, org/provider
/case selection, fill offer, capture, CAQH push, Train forms, queue, coverage,
view settings. Pure helpers already live under `src/shared/*`; the residual is
DOM orchestration with shared mutable state (`loadGeneration`, selection, mode).

### Why a full extract is not a 3M PR

- Touches the hottest extension file while epic + Slice 6 already watch
  portal/Train contracts (`repo-workflow` collision list).
- No product behavior change — pure refactor risk.
- Needs a phased cut with harness green after each phase, not a big-bang move.

### Phased module map (build when scheduled)

| Phase | Extract target (new module under `src/sidepanel/`) | Depends on                       | Done when                                      |
| ----- | -------------------------------------------------- | -------------------------------- | ---------------------------------------------- |
| 0     | _(baseline)_ keep pure logic in `src/shared/*`     | already true                     | no DOM in shared                               |
| 1     | `renderQuickCards.ts` + view-settings picker       | `quickCards` shared              | harness + manual copy/settings still work      |
| 2     | `fillOffer.ts` (coverage, fill ready, summary)     | fill API types                   | fill path + inject tests green                 |
| 3     | `caseContext.ts` (tasks, submit, portal tasks)     | handoff / submission shared      | submit bump + context render green             |
| 4     | `trainPanel.ts` (mode UI, payer/portal lists)      | `panelMode`, `trainForms` shared | Train recognize/propose green                  |
| 5     | `caqhPanel.ts` (push / attest only)                | `caqh` shared                    | attest path green; gap strip stays quarantined |
| 6     | `main.ts` as shell (boot, wiring, listeners only)  | phases 1–5                       | line count ≪ 800; no behavior delta            |

**Owner / trigger:** extension maintainability epic after Slice 6 lands (avoid
hot-file collision). Registered as **TD-50**.

### Explicit non-goals of TD-50

- No redesign of Work vs Train IA
- No CAQH pull/value-read (Slice 2 quarantine stands)
- No new framework (keep vanilla DOM)

---

## Slice 5 exit criteria (met by this PR)

- [x] Each original Slice 5 item has a real blocker statement (not “later”)
- [x] F13 build-time override shipped (extension PR)
- [x] F8 / TD-41 / sidepanel parked as TD-49 / TD-41 / TD-50 with AC
- [x] UAT checklist lane table lists Slice 5 **Closed**
- [x] Slice 6 may start without an open Slice 5 question

---

## What remains before Slice 6 (not Slice 5)

1. Merge this close-out (+ extension F13 PR).
2. PM optional: tick hosted boxes on the UAT checklist (F1/F22) — parallel, not
   a code gate for Slice 6 build.
3. Execute Slice 6 build from
   [`slice-6-platform-org-spike.md`](./slice-6-platform-org-spike.md).
