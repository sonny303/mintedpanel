# Decision Record — Redesign Simplification Wave (2026-07-19)

PM alignment sessions, Sowmya, 2026-07-18/19. This record supersedes the R6.5
wave slate (E5.0–E5.7): PR #193 (E5.0 epic) and #194 (its independent review)
were closed unmerged 2026-07-19. The E6.x epics in this directory are authored
from this record; visual companions live in
`docs/redesign/mocks/2026-07-simplification/` (five HTML mocks: the
consolidated decision record, the Payer Network / generation screens, the
providers-area + sample-case screens, the two-actor swimlane with gate audit,
and the journey handoff visual).

## The model in four sentences

Journey A (payer readiness — catalog + SOP with embedded form setup) is
standalone, global, authored once, inherited by every org. Journey B (org
reality — org, group, facilities, providers, group-grain payer attach) records
facts and never creates work. Journey C (generation) is the ONLY door cases
come through — a human always confirms; candidates wait in a visible buffer.
Journey D (casework) drives the one status list, and everything above case
level is derived math.

## Decisions (each maps to an E6.x epic)

1. **One case status list** — Not Started → In Progress → Submitted →
   In Review → Action Required → Approved / Denied (reason required) /
   Not Pursuing. Fixed, canonical; replaces the internal credentialing track,
   the payer pipeline, the contracting track, and the location track. Statuses
   are set by evidence: the system sets what it witnessed (creation, first
   activity, extension-logged submission), humans set what they learned (payer
   calls, RFIs, letters). Admin corrections append, never rewrite. → E6.0
2. **Six-item sidebar** — Cases (default landing) · Payer Setup · Reporting
   Center | Org Detail · Groups · Providers. No Home, no admin section.
   Retired surfaces: Home, My Cases/Cases split, Fix-it, Client Progress,
   Scope Review, Onboarding tab, Launches page, Facilities entry, Data Import
   page, Statuses page, MSO Routing page, Settings page, Forms & Portals
   module, training deck, starter cases, launch-dialog case creation,
   "Log Payer Call". Every job has a named new home. → E6.1
3. **Groups is the working entity** — payers attach at group × payer × state
   (org enablement implicit), facilities belong to exactly ONE group (shared
   addresses entered per group — payers see per-TIN service locations), and
   the fulfillment board (Targeted → In Progress → Active, derived,
   most-advanced-case-wins; Active = ≥1 approved case OR enrollment fact)
   lives at group grain. Single-group orgs auto-land. → E6.2
4. **Generation is decoupled and singular** — onboarding creates zero cases;
   candidates (targets − enrollment facts − existing cases − exclusions)
   accumulate in a visible "awaiting generation" buffer; the preview grid
   (provider×payer, pivotable, check-alls) distinguishes Skip-for-now (stays
   in buffer) from Exclude (reasoned, restorable); the confirm bar always
   reconciles buckets to the target count. Starter cases and launch-dialog
   creation retired; the manual one-off modal is the escape hatch. → E6.3
5. **Providers is the consolidated people record** — A→Z roster (PHI-safe
   list), one-page record with inline field editing (the monolithic edit form
   dies, fixing the defect where saving it dropped facility assignments),
   in-place Add facility/group, per-payer case + denial history. **Migration
   enrollments are enrollment facts, never auto-cases** — "active under THIS
   group's contract" only; a new hire's prior-employer status never carries
   over (full path regardless). Expiring a fact re-opens the candidate. → E6.4
6. **Payer Setup is two tabs** (Catalog, SOPs), open to everyone for now
   (two users, both admins; revisit at the third hire). Portals fold into the
   SOP form step (register/pick portal → capture → train → dry run → publish,
   all in place); the dry run uses masked MOCK data, once per payer, never per
   org — mappings proven before any user starts casework. Drift repair
   (ex-Fix-it) reopens the same editor. MSO routing retires as an org rules
   engine — delegation is a payer fact (catalog) and SOP content; existing
   MSO paths get re-encoded as payer SOPs before the page dies. Journey A
   output is global: authored once, inherited by every org. → E6.5
7. **Reporting Center groups; Add touch unifies** — Performance (Portfolio,
   Launches report) · Credentialing (Denials rollup — provider-first,
   payer-pivotable · Expiring credentials) · Compliance (Audit Log) · Intake
   (Inbound leads, badge). Occasional counts (facilities with no providers,
   locations per group) are reports, not screen widgets. "Add touch" is the
   ONE logging action (multi-case select replaces Log Payer Call); Settings
   page retires (members → Org Detail; denial word-list + queue ranking ship
   as fixed defaults). → E6.6

## The driving business scenarios (from the alignment; each is a named TS)

These are the concrete situations that forced the decisions — every one maps
to seed-universe scenarios (TS-104–TS-137) and to acceptance criteria in the
epics:

1. **The Nov-1 contract** — org + one group + one NC facility onboarded day
   1, seven payers promised (4 commercial, 3 government), zero providers
   until a day-50 hire. Drove: day-1 target-state recording, the fulfillment
   board, the awaiting-generation buffer, provider-start-date ranking.
   (TS-109, TS-111)
2. **The day-50 hire** — provider added → group → facility → instantly a
   candidate for all seven targets with nobody assigning payers by hand.
   Drove: derived provider↔payer tying, the buffer banner naming its cause,
   the provider-record generation entry. (TS-109, TS-127, TS-129)
3. **The migration variant** — an established practice arrives already
   enrolled with two payers UNDER THIS GROUP'S CONTRACT; a new hire's
   prior-employer status never carries over. Drove: enrollment facts (never
   auto-cases — "auto cases are noise"), the guard label, expire-reopens-
   candidate. (TS-113, TS-128)
4. **The denial story** — Cigna denies (panel closed), the panel reopens,
   reapply continues the SAME case; denials roll up to the provider for
   reporting and pivot payer-first for patterns. Drove: required reasons,
   the reapply cycle, the denials report. (TS-116, TS-136)
5. **The fax payer** — NC Medicaid submits by fax; the system never
   witnessed it, so it never presumes. Drove: auto-vs-human transition
   rules and the Add-touch bump. (TS-105, TS-137)
6. **Portfolio parallelism / no chokeholds** — two people, interchangeable
   hats, working different orgs and payers the same week; exactly ONE
   deliberate gate (generation confirm) in the whole system; a missing SOP
   warns and falls back, never blocks. Drove: standalone Journey A,
   authored-once, the gate audit. (TS-114, TS-126, TS-132)
7. **Drift mid-flight** — a payer changes its form while cases are open;
   work continues manually, repair happens in the authoring editor. Drove:
   the Fix-it dissolution and in-editor repair. (TS-132)
8. **The long unsorted lists** — the live facilities page and provider
   roster. Drove: A→Z defaults, state grouping, search/filters, and
   counts-as-reports. (TS-108, TS-112, TS-135)
9. **The grain mismatch** — payers were being "assigned to orgs" in the UI
   while every real fact is group-grain. Drove: the Groups menu item,
   group-scoped boards, eligibility-filtered attach, implicit org
   enablement. (TS-110, TS-122)
10. **The two status machines on one case** — internal track vs payer
    pipeline disagreeing. Drove: the eight-word unified list and
    evidence-based setting. (TS-104, TS-105, TS-118)

## Cross-cutting rules

- **No chokeholds:** exactly one deliberate gate (generation confirm, any
  admin); everything else warns and flows. A missing SOP never blocks
  generation (generic fallback, visibly flagged); readiness gaps warn, never
  block; all handoffs are system-mediated and asynchronous.
- **Statuses are set by evidence; everything above case level is math.**
- **Imports live with their data** (Providers, Groups › Facilities, Groups ›
  Payer Network); templates pre-fill real parent names; one row per
  relationship for multi-value; unified post-commit summary.
- **A→Z by default on every list**; facilities state-grouped, A→Z within.
- **Out of scope / unchanged:** the Chrome extension and its fill contract
  (human always submits — locked, forever); append-only audit/touch ledgers;
  org RLS; roles as-is for two users; per-analyst case assignment (future).

## Revision history

- 2026-07-19 v1, Claude (PM-directed session) — authored from the live
  alignment; supersedes E5.0–E5.7 planning.
