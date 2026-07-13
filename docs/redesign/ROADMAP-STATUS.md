# Redesign Roadmap Status

_Living status page for business review. Refreshed at least once per release
milestone (owner: Devin, the reviewer/orchestrator). Last updated:
**2026-07-13** (R4 reviews merged; E1.7b built; E2.0 build next)._

```
R0 ✅ ──► R1 ✅ ──► R2 ✅ ──► R3 ✅ ──► R4 🚧 builds 1/6 (E1.7b ✅, E2.0 next) ──► R5…R10 📋
```

## Release status

| Release                     | Scope                                                                       | State                                                                                                                                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R0 — Shell & foundation** | E0.0–E0.10 (app shell, party model, reporting, capture links, hardening)    | ✅ Built & merged                                                                                                                                                                                                                                          |
| **R1 — People & places**    | E1.0 wizard, E1.1 groups, E1.2 facilities, E1.3 roster                      | ✅ Built & merged (#108–#111)                                                                                                                                                                                                                              |
| **R2 — Payer directory**    | E1.6 payer catalog, E1.7a SOP-versioning spike                              | ✅ Complete: E1.6 built & merged (#122, seeds from the in-repo reference dataset, `payer_slug` identity); E1.7a Model A **signed off** 2026-07-12 (#120) with worked examples from the two real business SOPs (#121).                                      |
| **R3 — Scope & readiness**  | E1.4 assignments, E1.5 payer attachment, E1.8 readiness                     | ✅ Complete: E1.4 (#113), E1.5 (#125), E1.8 (#127 + follow-up #131 — end-dated assignments exit readiness, COI check live). Hotfixes #128 (provider-group modal), #129/#130 (onboarding side-panel residual org + mastered US-state dropdown) also merged. |
| **R4 — Case generation**    | E1.7b SOP-as-data, E2.x preview/generate/dedupe/traceability/audit          | 🚧 All six epics independently reviewed (#134–#139) with PM answers applied ([r4-review], #140) — all `reviewed: true`. **E1.7b built & merged (#141)**. Sequential builds continue: E2.0 → E2.1 → E2.2 → E2.3 → E2.4.                                     |
| **R5 — Scale pack**         | Bulk roster import (CAQH/NPPES), bulk assignment rules                      | 📋                                                                                                                                                                                                                                                         |
| **R6/R7 — Execution**       | Payer workflows, touches, extension fill; Sensitive Identifiers Vault (SSN) | 📋                                                                                                                                                                                                                                                         |
| **R8 — Outcomes/reporting** | Credentialing outcome reporting                                             | 📋                                                                                                                                                                                                                                                         |
| **R9 — Recurring ops**      | Expiration radar, recredentialing, PSV re-verify clocks, payer change radar | 📋                                                                                                                                                                                                                                                         |
| **R10 — Government payers** | Medicare / Medicaid / Tricare workflows (`payer_kind` activation)           | 📋                                                                                                                                                                                                                                                         |

## Epic board (R4)

| Epic  | Title                               | Reviewed | Built                  |
| ----- | ----------------------------------- | -------- | ---------------------- |
| E1.7b | SOP-as-data (Model A build)         | ✅       | ✅ #141                |
| E2.0  | Generation preview & exclusions     | ✅       | 🚧 build next          |
| E2.1  | Case creation & 4-part key          | ✅       | ⏳ queued (after E2.0) |
| E2.2  | SOP resolution & stamping           | ✅       | ⏳ queued              |
| E2.3  | Next-best-action queue ("My Cases") | ✅       | ⏳ queued              |
| E2.4  | Generation traceability & audit     | ✅       | ⏳ queued              |

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
| E1.8  | Enrollment readiness         | ✅       | ✅ #127 (+#131 follow-up)                     |

## Who mobilizes (roles)

| Role                  | Who            | Responsibility                                                       |
| --------------------- | -------------- | -------------------------------------------------------------------- |
| PM / business owner   | Sowmya (human) | Scope decisions, PM approvals (`reviewed: true`), stage promotion    |
| Author / orchestrator | Devin          | Epic authoring, decision records, PR gating & merges into `redesign` |
| Independent reviewer  | Claude Code    | Per-epic technical review per `REVIEW-HANDOFF.md`                    |
| Builder               | Claude Code    | One implementation PR per reviewed epic, targeting `redesign`        |

## Current jobs to be done

1. **R4 build queue** — sequential Claude Code builds (one session at a time): E1.7b done (#141); E2.0 next, then E2.1 → E2.4. Devin final-reviews and merges each PR before the next build starts.
2. **PM manual test pass** — hotfixes #128/#129/#130 and E1.8 on the `redesign` preview.
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
- R4 review answers ([r4-review], 2026-07-13): global credential-free fallback
  SOP visible to all orgs; candidacy requires a facility (clinic) assignment
  under the group; Credentialed/final-Denied suppression is status-linked;
  reapply = Denied → In Progress on the same case; queue nav label "My
  Cases"; run history via generation surface + case deep links; run records
  retained ≥ 7 years, immutable.
