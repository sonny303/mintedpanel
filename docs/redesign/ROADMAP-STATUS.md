# Redesign Roadmap Status

_Living status page for business review. Refreshed at least once per release
milestone (owner: Devin, the reviewer/orchestrator). Last updated:
**2026-07-12**._

```
R0 ✅ ──► R1 ✅ ──► R2 🚧 ──► R3 🚧 (E1.4 ✅, E1.5/E1.8 in build) ──► R4…R10 📋
```

## Release status

| Release                     | Scope                                                                       | State                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R0 — Shell & foundation** | E0.0–E0.10 (app shell, party model, reporting, capture links, hardening)    | ✅ Built & merged                                                                                                                                                                    |
| **R1 — People & places**    | E1.0 wizard, E1.1 groups, E1.2 facilities, E1.3 roster                      | ✅ Built & merged (#108–#111)                                                                                                                                                        |
| **R2 — Payer directory**    | E1.6 payer catalog, E1.7a SOP-versioning spike                              | 🚧 E1.7a decision doc merged (#112; Model A PM sign-off open). E1.6 unblocked 2026-07-12: Stedi withdrawn, seeds from the in-repo payer reference dataset (#115/#116) — build ready. |
| **R3 — Scope & readiness**  | E1.4 assignments, E1.5 payer attachment, E1.8 readiness                     | 🚧 E1.4 built & merged (#113); E1.5 and E1.8 builds kicked off (build E1.8 after E1.5 merges).                                                                                       |
| **R4 — Case generation**    | E1.7b SOP-as-data, E2.x preview/generate/dedupe/traceability/audit          | 📋 Next discovery (use-case Q&A with the credentialing team)                                                                                                                         |
| **R5 — Scale pack**         | Bulk roster import (CAQH/NPPES), bulk assignment rules                      | 📋                                                                                                                                                                                   |
| **R6/R7 — Execution**       | Payer workflows, touches, extension fill; Sensitive Identifiers Vault (SSN) | 📋                                                                                                                                                                                   |
| **R8 — Outcomes/reporting** | Credentialing outcome reporting                                             | 📋                                                                                                                                                                                   |
| **R9 — Recurring ops**      | Expiration radar, recredentialing, PSV re-verify clocks, payer change radar | 📋                                                                                                                                                                                   |
| **R10 — Government payers** | Medicare / Medicaid / Tricare workflows (`payer_kind` activation)           | 📋                                                                                                                                                                                   |

## Epic board (R1–R3)

| Epic  | Title                        | Reviewed | Built                                         |
| ----- | ---------------------------- | -------- | --------------------------------------------- |
| E1.0  | Wizard scope sections        | ✅       | ✅ #108                                       |
| E1.1  | Provider group entity        | ✅       | ✅ #109                                       |
| E1.2  | Facilities / locations       | ✅       | ✅ #110                                       |
| E1.3  | Provider roster              | ✅       | ✅ #111                                       |
| E1.6  | Global payer catalog         | ✅       | ⏭️ ready (reference dataset landed, #115)     |
| E1.7a | SOP versioning spike         | ✅       | ✅ #112 (decision doc; Model A sign-off open) |
| E1.4  | Provider–facility assignment | ✅       | ✅ #113                                       |
| E1.5  | Payer network attachment     | ✅       | 🚧 in build                                   |
| E1.8  | Enrollment readiness         | ✅       | 🚧 in build (after E1.5)                      |

## Who mobilizes (roles)

| Role                  | Who            | Responsibility                                                       |
| --------------------- | -------------- | -------------------------------------------------------------------- |
| PM / business owner   | Sowmya (human) | Scope decisions, PM approvals (`reviewed: true`), stage promotion    |
| Author / orchestrator | Devin          | Epic authoring, decision records, PR gating & merges into `redesign` |
| Independent reviewer  | Claude Code    | Per-epic technical review per `REVIEW-HANDOFF.md`                    |
| Builder               | Claude Code    | One implementation PR per reviewed epic, targeting `redesign`        |

## Current jobs to be done

1. **E1.5 build** → then **E1.8 build** (E1.8 derives over `payer_network_targets`, which E1.5 creates).
2. **E1.6 build** — now unblocked; F1.6.2 seeds from `docs/redesign/data/payer-catalog/` (quarterly manual refresh per its README).
3. **E1.7a Model A PM sign-off** + 2 real SOP examples to ground E1.7b.
4. **R4 discovery** — case-generation use-case Q&A, then draft E1.7b + E2.x epics.

## Key locked decisions

- Case grain target: provider × group × payer × state (live DB constraint is
  3-part until the E2.x additive migration — see AGENTS.md).
- Contract grain: group × payer × state; payer attachment intent lives in
  `payer_network_targets` (active|archived; archive on remove, easy re-attach).
- Readiness = current-enrollment only, advisory (soft-warn), fully derived;
  CAQH current = re-attested within 120 days.
- SSN: `ssn_last4` only until the R6/R7 Sensitive Identifiers Vault.
- Payer identity source: self-built reference dataset (Stedi withdrawn,
  2026-07-12; see `CLARIFICATIONS_NEEDED.md` [e1.6]).
