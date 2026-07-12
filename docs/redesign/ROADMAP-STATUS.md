# Redesign Roadmap Status

_Living status page for business review. Refreshed at least once per release
milestone (owner: Devin, the reviewer/orchestrator). Last updated:
**2026-07-12**._

```
R0 ✅ ──► R1 ✅ ──► R2 ✅ ──► R3 🚧 (E1.4/E1.5 ✅, E1.8 in build) ──► R4 🚧 discovery done ──► R5…R10 📋
```

## Release status

| Release                     | Scope                                                                       | State                                                                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R0 — Shell & foundation** | E0.0–E0.10 (app shell, party model, reporting, capture links, hardening)    | ✅ Built & merged                                                                                                                                                                                                     |
| **R1 — People & places**    | E1.0 wizard, E1.1 groups, E1.2 facilities, E1.3 roster                      | ✅ Built & merged (#108–#111)                                                                                                                                                                                         |
| **R2 — Payer directory**    | E1.6 payer catalog, E1.7a SOP-versioning spike                              | ✅ Complete: E1.6 built & merged (#122, seeds from the in-repo reference dataset, `payer_slug` identity); E1.7a Model A **signed off** 2026-07-12 (#120) with worked examples from the two real business SOPs (#121). |
| **R3 — Scope & readiness**  | E1.4 assignments, E1.5 payer attachment, E1.8 readiness                     | 🚧 E1.4 built & merged (#113); E1.5 built & merged (#125); E1.8 build in flight (last R3 item).                                                                                                                       |
| **R4 — Case generation**    | E1.7b SOP-as-data, E2.x preview/generate/dedupe/traceability/audit          | 🚧 Discovery complete 2026-07-12 — all 5 workflow decisions locked (`CLARIFICATIONS_NEEDED.md` [r4], #124); epics drafting next.                                                                                      |
| **R5 — Scale pack**         | Bulk roster import (CAQH/NPPES), bulk assignment rules                      | 📋                                                                                                                                                                                                                    |
| **R6/R7 — Execution**       | Payer workflows, touches, extension fill; Sensitive Identifiers Vault (SSN) | 📋                                                                                                                                                                                                                    |
| **R8 — Outcomes/reporting** | Credentialing outcome reporting                                             | 📋                                                                                                                                                                                                                    |
| **R9 — Recurring ops**      | Expiration radar, recredentialing, PSV re-verify clocks, payer change radar | 📋                                                                                                                                                                                                                    |
| **R10 — Government payers** | Medicare / Medicaid / Tricare workflows (`payer_kind` activation)           | 📋                                                                                                                                                                                                                    |

## Epic board (R1–R3)

| Epic  | Title                        | Reviewed | Built                                         |
| ----- | ---------------------------- | -------- | --------------------------------------------- |
| E1.0  | Wizard scope sections        | ✅       | ✅ #108                                       |
| E1.1  | Provider group entity        | ✅       | ✅ #109                                       |
| E1.2  | Facilities / locations       | ✅       | ✅ #110                                       |
| E1.3  | Provider roster              | ✅       | ✅ #111                                       |
| E1.6  | Global payer catalog         | ✅       | ✅ #122 (payer_slug identity rework included) |
| E1.7a | SOP versioning spike         | ✅       | ✅ #112; Model A signed off (#120)            |
| E1.4  | Provider–facility assignment | ✅       | ✅ #113                                       |
| E1.5  | Payer network attachment     | ✅       | ✅ #125                                       |
| E1.8  | Enrollment readiness         | ✅       | 🚧 in build (last R3 item)                    |

## Who mobilizes (roles)

| Role                  | Who            | Responsibility                                                       |
| --------------------- | -------------- | -------------------------------------------------------------------- |
| PM / business owner   | Sowmya (human) | Scope decisions, PM approvals (`reviewed: true`), stage promotion    |
| Author / orchestrator | Devin          | Epic authoring, decision records, PR gating & merges into `redesign` |
| Independent reviewer  | Claude Code    | Per-epic technical review per `REVIEW-HANDOFF.md`                    |
| Builder               | Claude Code    | One implementation PR per reviewed epic, targeting `redesign`        |

## Current jobs to be done

1. **E1.8 build** — the last R3 item; derives over `payer_network_targets` (now on `redesign` via #125).
2. **R4 epic drafting** — E1.7b + E2.x, grounded in the locked [r4] decisions and the SOP worked examples; then the R1-style review queue.
3. **Business ops:** rotate the shared payer-portal password found in a circulated SOP PDF (see `E1.7b-sop-worked-examples.md` data-hygiene note).

## Key locked decisions

- Case grain target: provider × group × payer × state (live DB constraint is
  3-part until the E2.x additive migration — see AGENTS.md).
- Contract grain: group × payer × state; payer attachment intent lives in
  `payer_network_targets` (active|archived; archive on remove, easy re-attach).
- Readiness = current-enrollment only, advisory (soft-warn), fully derived;
  CAQH current = re-attested within 120 days.
- SSN: `ssn_last4` only until the R6/R7 Sensitive Identifiers Vault.
- Payer identity source: self-built reference dataset (Stedi withdrawn,
  2026-07-12; see `CLARIFICATIONS_NEEDED.md` [e1.6]); `payer_slug` is the
  canonical key (clearinghouse IDs unused).
- SOP versioning: Model A signed off 2026-07-12 — versioned SOPs, in-flight
  cases keep their generation version ([e1.7a]).
- R4 case generation ([r4], 2026-07-12): preview checklist with persistent
  reasoned exclusions; duplicates gray out and reapplications continue on the
  existing case; **no prerequisite-payer logic** (commercial + MA run in
  parallel); no-SOP cases get the generic fallback SOP; post-generation lands
  on a deadline-ordered next-best-action queue.
