# Redesign Roadmap Status

_Living status page for business review. Refreshed at least once per release
milestone (owner: Devin, the reviewer/orchestrator). Last updated:
**2026-07-17** (R6 complete: E4.0–E4.5 built & merged; E4.4 vault + E4.5
document-storage hosted migrations pending as operator tasks)._

```
R0 ✅ ──► R1 ✅ ──► R2 ✅ ──► R3 ✅ ──► R4 ✅ ──► R5 ✅ ──► R6 ✅ ──► R7…R10 📋
```

## Release status

| Release                      | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R0 — Shell & foundation**  | E0.0–E0.10 (app shell, party model, reporting, capture links, hardening)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅ Built & merged                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **R1 — People & places**     | E1.0 wizard, E1.1 groups, E1.2 facilities, E1.3 roster                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ Built & merged (#108–#111)                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **R2 — Payer directory**     | E1.6 payer catalog, E1.7a SOP-versioning spike                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ Complete: E1.6 built & merged (#122, seeds from the in-repo reference dataset, `payer_slug` identity); E1.7a Model A **signed off** 2026-07-12 (#120) with worked examples from the two real business SOPs (#121).                                                                                                                                                                                                                                                  |
| **R3 — Scope & readiness**   | E1.4 assignments, E1.5 payer attachment, E1.8 readiness                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅ Complete: E1.4 (#113), E1.5 (#125), E1.8 (#127 + follow-up #131 — end-dated assignments exit readiness, COI check live). Hotfixes #128 (provider-group modal), #129/#130 (onboarding side-panel residual org + mastered US-state dropdown) also merged.                                                                                                                                                                                                             |
| **R4 — Case generation**     | E1.7b SOP-as-data, E2.x preview/generate/dedupe/traceability/audit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ Complete. All six epics independently reviewed (#134–#139) with PM answers applied ([r4-review], #140). Built & merged: **E1.7b (#141), E2.0 (#143), E2.1 (#144), E2.2 (#145), E2.3 (#147), E2.4 (#149)**.                                                                                                                                                                                                                                                          |
| **R5 — Scale pack**          | E3.0 import intake, E3.1 preview/staged commit, E3.3 sectioned intake uniformity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ Complete. Discovery ([r5], 12 decisions) + [r5-review] + [r5-debt] all resolved. Built & merged: **E3.0 (#152), E3.1 (#153), E3.3 (#154)**. E3.2 NPPES aid moved to end of redesign (PM 2026-07-13: nice-to-have, not a requirement). CAQH deferred to a later release.                                                                                                                                                                                             |
| **R6 — Execution**           | E4.0 payer pipeline (tracking IDs, structured resolution + denial reasons), E4.1 structured touches + follow-up cadence, E4.2 Payer & SOP admin module (upstream config, bulk generation entry), E4.3 extension workbench handoff (read-only fill), E4.4 Sensitive Identifiers Vault (SSN), E4.5 Document Storage (provider + group docs, **mandatory expiration tracking** — the E1.8 deferred surface)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ✅ Complete. Discovery ([r6], 2026-07-14) + independent reviews + PM sign-offs done. Built & merged: **E4.0 (#155), E4.1 (#156), E4.2 (#157 + hardening pack #158–#176), E4.3 (panel #178 + extension #28; amendment #177), E4.4 (#183), E4.5 (#185)**. Operator tasks pending: hosted apply of the E4.4 vault migrations + key provisioning, the E4.5 activation + Storage bucket, and the superseding payer dead-column drop (#184) — runbook delivered (prompt-15). |
| **R7 — Execution follow-on** | Reserved for R6 spillover / deferred execution scope: email-inbox↔touch integration with auto-created Email touches + human-confirmed suggested RFI transitions; standing per-payer cadence rules; **payer-contact directory/CRM**; **global settings + role/capability administration** with a richer model beyond `admin / specialist / billing`; and **platform payer-catalog administration / pre-credentialing intake**. The catalog workflow is internal/platform-only: search and duplicate/alias check → create a draft canonical payer → curate identity, states, aliases, portal and credentialing facts → review/publish → make available for organization selection. It extends `payer_catalog_changes`, is fully audited, and never grants org admins global-payer create access. Existing org-local payer rows are mapped to canonical rows and their references re-keyed; unreferenced rows that do not represent current work are deleted only after a zero-reference audit. No org-user “request payer” queue is planned. | 📋 PM-approved 2026-07-15; catalog-admin epic still to author and independently review.                                                                                                                                                                                                                                                                                                                                                                                |
| **R8 — Outcomes/reporting**  | Credentialing outcome reporting, including structured reporting of cases and generation runs that resolved through the generic SOP fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 📋                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **R9 — Recurring ops**       | Expiration radar, recredentialing, PSV re-verify clocks, payer change radar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 📋                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **R10 — Government payers**  | Medicare / Medicaid / Tricare workflows (`payer_kind` activation); **enrollment identifiers** — group/provider Medicare & Medicaid IDs (parked from R5 PM review 2026-07-13: state/enrollment-varying, model as child rows per SCHEMA.md grain rules, plus CSV/UI/API surfacing)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 📋                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Post-redesign platform**   | Staging + dev environments (separate Supabase projects, promotion pipeline `dev → staging → prod`, seeded staging data) — scheduled immediately after the redesign program completes (after R10 / `redesign` → `main` promotion); **extension document auto-attach** (cross-origin file injection into payer portals — PM 2026-07-14 [r6] D3: NOT a fast follow, prioritized after the redesign; E4.5's store is architected to support it); **grant-floor hardening for `provider_ssn_intake_links`** (small revoke-then-grant migration — its grants are wider than the migration intended; harmless today since RLS blocks everything, but off the repo's grant-floor convention; PM 2026-07-14)                                                                                                                                                                                                                                                                                                                                        | 📋 PM-requested 2026-07-13/14                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Epic board (R6)

| Epic | Title                                               | Reviewed | Built                           |
| ---- | --------------------------------------------------- | -------- | ------------------------------- |
| E4.0 | Payer pipeline, tracking IDs, structured resolution | ✅       | ✅ #155                         |
| E4.1 | Structured touches & follow-up cadence              | ✅       | ✅ #156                         |
| E4.2 | Payer & SOP admin module                            | ✅       | ✅ #157 (+ hardening #158–#176) |
| E4.3 | Extension workbench handoff (read-only fill)        | ✅       | ✅ panel #178 / extension #28   |
| E4.4 | Sensitive Identifiers Vault (SSN)                   | ✅       | ✅ #183                         |
| E4.5 | Document storage & expiration tracking              | ✅       | ✅ #185                         |

## Epic board (R4)

| Epic  | Title                               | Reviewed | Built   |
| ----- | ----------------------------------- | -------- | ------- |
| E1.7b | SOP-as-data (Model A build)         | ✅       | ✅ #141 |
| E2.0  | Generation preview & exclusions     | ✅       | ✅ #143 |
| E2.1  | Case creation & 4-part key          | ✅       | ✅ #144 |
| E2.2  | SOP resolution & stamping           | ✅       | ✅ #145 |
| E2.3  | Next-best-action queue ("My Cases") | ✅       | ✅ #147 |
| E2.4  | Generation traceability & audit     | ✅       | ✅ #149 |

## Epic board (R5)

| Epic | Title                                       | Reviewed | Built                             |
| ---- | ------------------------------------------- | -------- | --------------------------------- |
| E3.0 | Roster import: intake, file gate, async     | ✅       | ✅ merged #152                    |
| E3.1 | Import preview, dedupe & staged commit      | ✅       | ✅ merged #153                    |
| E3.3 | Sectioned intake uniformity ([r5-debt])     | ✅       | ✅ merged #154                    |
| E3.2 | NPPES lookup aid (post-import verification) | ✅       | ⏸️ end of redesign (nice-to-have) |

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

1. **Vault master-key provisioning (PM)** — hosted migrations are applied and types regenerated (#187 merged); the remaining operator step is the `app.settings.ssn_vault_key` `ALTER DATABASE`, run by the PM directly in the SQL Editor. Vault RPCs fail closed until then.
2. **E6 simplification wave (supersedes the R6.5 / E5.x slate)** — PM alignment 2026-07-18/19 produced `DECISION-RECORD-2026-07-19-simplification.md` + five mocks (`mocks/2026-07-simplification/`); the E5.0 epic and its review were closed unmerged (#193/#194). Build order: **E6.0** unified case status → **E6.1** sidebar & surface restructure → **E6.2** Groups + Payer Network board → **E6.3** decoupled generation → **E6.4** providers area → **E6.5** Payer Setup consolidation → **E6.6** reporting + touch unification. Each epic: PM review of the draft → independent review → `reviewed: true` → build. Ships before the production cut.
3. **R7 epic authoring** — platform payer-catalog administration + the platform-role hardening deferred from E6.5, payer-contact directory, email-inbox↔touch integration, cadence rules, richer roles (PM-approved 2026-07-15); author + independent review before build. Starts after the E6 wave.
4. **Main promotion** — #189 (redesign → main plain sync, not the production cut) MERGED by the PM 2026-07-19; next sync after the E6 wave lands.
5. **Business ops:** rotate the shared payer-portal password found in a circulated SOP PDF (see `E1.7b-sop-worked-examples.md` data-hygiene note).

Done since last refresh: hosted operator run complete (all five R6 migrations verified on hosted, types regen #187); full data wipe confirmed complete/verified by the PM — the one-time AGENTS.md ledger carve-out is expired.

## Key locked decisions

- Case grain target: provider × group × payer × state (live DB constraint is
  3-part until the E2.x additive migration — see AGENTS.md).
- Contract grain: group × payer × state; payer attachment intent lives in
  `payer_network_targets` (active|archived; archive on remove, easy re-attach).
- Readiness = current-enrollment only, advisory (soft-warn), fully derived;
  CAQH current = re-attested within 120 days.
- SSN: `ssn_last4` only in ordinary tables; the full SSN lives exclusively in
  the E4.4 server-only vault (shipped #183 — fill-only release, admin-only
  audited reveal, secure-link/modal ingress).
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
- Payer/SOP hardening (PM, 2026-07-15):
  - New organization-authored payer identities and free-text payer creation are
    removed. Canonical payer identity remains platform-managed.
  - Legacy org-local payers are mapped and re-keyed to canonical payers.
    Unreferenced rows outside current work may be deleted after a zero-reference
    audit; no case, SOP, network-target, assignment, or audit history is deleted.
  - The supported organization-authored SOP routing key is
    `payer + state + group`: payer and state are required, group may be
    “Any group,” and specialty is preserved as non-routing legacy metadata.
  - Generic fallback does not block generation. Its use must be explicit,
    structured, persisted with the resolved SOP tier, and reportable; the UI
    must not mislabel fallback use as payer-specific readiness.
  - Payer administration consolidates into one Payer Setup workspace with
    first-class Catalog, SOP templates, Forms & portals, and organization
    settings surfaces.
  - `draft_email` steps require a structured `to` recipient, support optional
    `cc`, and defer `bcc`; recipient data is versioned with the SOP and resolved
    through the immutable SOP stamp in generated task workflows. Extension
    handoff consumes only the applicable structured execution payload and must
    not parse free-text instructions.
  - Missing portal dependencies use an inline setup deep link; no separate
    sidebar destination is added in this cycle.
  - Organization payer removal archives its active network targets while
    preserving history; reactivation does not silently restore scope.
    Retired/merged payers cannot be newly selected and point to a successor.
- R6 execution ([r6], 2026-07-14; fallback clarified by PM 2026-07-15): SOP
  resolution is mandatory and deterministic, but a payer-specific SOP is not a
  hard generation blocker — the generic fallback remains allowed and its use is
  stamped for reporting. Upstream config is owned through the dedicated Payer
  & SOP admin module; the payer pipeline is a distinct immutable state machine
  (Not Started → Assigned → Drafting → Submitted → In Review → Action Required
  (RFI) → Closed Approved/Denied) decoupled from internal task states; touches
  are typed (Call/Portal Check/Email/Fax/CAQH Update) with overdue follow-ups
  surfacing in My Cases; denials carry structured reason codes; the extension
  is scoped to read-only token resolution with manual touch logging; full SSN is
  vaulted — fill-only, masked `***--1234`, admin-only audited reveal,
  secure-link/modal ingress; document storage is provider + group grain with
  mandatory expiration tracking; extension auto-attach is deferred
  post-redesign but the store must support it.
