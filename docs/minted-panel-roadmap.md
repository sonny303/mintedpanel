# Minted Panel — State of Affairs & Roadmap

_The "where we are heading" companion to the Code Dev Guide (`CLAUDE.md` +
`AGENTS.md` + `ARCHITECTURE.md` + `SCHEMA.md`). Written for a product manager:
epics, workflows, user stories. Ordered by **complexity, hardest first**._

_Last updated 2026-07-06. Status legend: **Decided** (direction locked, build it)
· **In progress** (partially shipped, reconcile & finish) · **Open** (needs a
decision before build)._

---

## Where we are

Minted Panel is a live, multi-tenant credentialing-ops SaaS (React 19 / TanStack
Start / Supabase) with two paying-ish orgs loaded and R1/R2 shipped: the provider
work view, payer-grouped cases, launches-as-locations, the Home action engine,
the Client Progress owner view, and — most recently — the three cleanup surfaces
(Fix-it queue, Mapping review, Portals admin) plus the six extension-facing `/api`
endpoints behind `guard.ts` and the org-isolation gate. The **data path is dual by
locked decision**: the app UI talks straight to Supabase under RLS; the Chrome
extension is the only consumer of the API layer. The next chapter is not more
screens — it is turning the **payer → SOP → steps → tasks** loop into a real
engine, redesigning **onboarding** so a human (not Claude) can stand up an org, and
maturing the extension into the **Workbench**. Those three, plus the tech-debt
sweep, are the roadmap below.

**Up next (called out independent of complexity ordering): Epic 1 — the
Payer → SOP → Steps → Tasks engine.**

---

## Roadmap — hardest first

| # | Epic | Complexity | Status | Depends on |
|---|------|-----------|--------|-----------|
| 1 | Payer → SOP → Steps → Tasks engine + global catalog | ●●●●● | Decided · **up next** | Panel + Extension |
| 2 | Onboarding & launch redesign (org/facility/provider intake, CSV, funnel) | ●●●●○ | Decided | Panel |
| 3 | Workbench (extension) — form sensor, Fixit, field mapping, "what's my…" | ●●●●○ | In progress | **Panel + Extension** |
| 4 | Gmail integration & mail-merge draft flow | ●●●○○ | Open | Extension (+ Panel) |
| 5 | Touch points + inherited notes → "add" / roster & PDF generation | ●●○○○ | Open | Panel |
| 6 | Admin cleanup & tech debt (statuses-to-code, remove Users, starter-pack, providers/cases) | ●●○○○ | Mixed | Panel |

---

## Epic 1 — Payer → SOP → Steps → Tasks engine + global catalog

**Complexity ●●●●● · Status: Decided · UP NEXT**

This is the credentialing core and the deepest change. Two things happen at once:
the **nesting becomes a real engine**, and the **payer/SOP catalog goes global**.

### 1a. The full nesting, end to end

The loop we worked out, top to bottom:

```
Payer            the entity you credential with (global catalog; assigned to an org)
  └─ SOP         the recipe for that payer (renamed from "Template"; optionally scoped payer+state+group)
       └─ Steps  the components of the recipe — reusable, typed (draft-email | online-form | PDF[future])
            └─ Tasks   the actual cooking — concrete step instances on a real case, with due dates & assignee
                 └─ Fixed buckets   every task/case status rolls into ours | waiting_payer | waiting_provider | complete
```

Read it as a workflow: **assign a payer to an org → a case is opened for
`(provider, payer, state)` → the SOP resolves (payer+state+group) → its steps
instantiate as tasks on the case → each task's status maps to one fixed bucket →
the buckets drive the Home action engine, dashboards, and the payer scorecard
(1e).**

**Steps vs Tasks — the distinction to hold onto:** *steps are the components of
the recipe; tasks are the actual cooking.* A step is defined once on the SOP and
reused across every case. A task is that step made real for one provider on one
case — it has a due date, an owner, a status, and a bucket. You edit a step to
change every future case; you complete a task to move one case forward.

**Step types (the recipe primitives):**
- **Draft email** — a mail-merge, pre-canned templated email that pulls the
  provider/case fields you select (see the wizard, 1d).
- **Online form to fill** — a portal form the Workbench fills from the profile
  payload.
- **PDF (future)** — a downloadable form filler (ties to Epic 5's PDF generation).

### 1b. Global catalog, assigned per org — **the reversal**

**Decided:** payer sets and their SOPs are built **once, globally**, and
**assigned to an org as needed** — not rebuilt per tenant. Steps and tasks defined
on a global payer flow into any case in any org that the payer is assigned to.

Today this is the opposite: `payers` and `sop_templates` are `org_id`-scoped with
per-org RLS. The move mirrors the pattern **already proven** by
`portal_field_maps` (`org_id NULL` = global row, org rows = overrides). So the
model is: **global catalog rows (`org_id NULL`) + a per-org assignment/subscription
+ optional org overrides.**

**User stories:**
- _As a credentialing admin_, I pick from a curated global payer list instead of
  re-typing "Aetna / BCBS / …" for every new org.
- _As the platform owner_, I fix a payer's SOP once and every org on that payer
  inherits the fix.
- _As an org_, I can override a step or a field map locally without forking the
  whole SOP.

### 1c. Starter pack (auto-attach ~6 common cases)

_Folded here because "common" is a property of the global catalog._

**In progress / needs requirements.** Reconciled with the Code Dev Guide: **there
is no starter-pack code on this branch.** The only pre-check that exists is
launch-scoped (`CreateCasesDialog` pre-checks payers that have MSO routing and no
existing case). There is **no** "attach the 6 common cases when a provider is
created," and the New Case flow still fronts a ~60-payer dropdown.

- **Requirement:** flag a small set of catalog payers as `starter`/`common` (per
  org, since the common set differs by market). On provider create, auto-create
  cases for the org's starter payers via `create_case_with_tasks` (SOP tasks +
  audit included) — no dropdown scroll.
- **Not an isolated fix:** ships as a story under this epic with the catalog work,
  not a one-off.

### 1d. Wizard (tab-to-tab)

A case runs its steps as a **wizard**: tab-to-tab progression, one step per tab. At
a **draft-email** step, a mail-merge templated email pre-fills from the fields you
chose. The provider/case profile payload already exists server-side
(`/api/providers/:id/profile` resolves every catalog token to a value); the wizard
consumes that payload. Advancing a tab completes the step's task and moves the
case's bucket.

### 1e. Payer scorecard (quality indicators)

Payer functions **roll up into a scorecard** of quality indicators — a read-only
per-payer quality view. Candidate indicators (all derivable from data we already
write):

| Indicator | Source |
|-----------|--------|
| Field coverage (available ÷ required) | profile `unresolved` vs SOP step field tokens |
| Mapping coverage (mapped ÷ proposed) | `portal_field_maps` counts |
| First-pass submission rate | `fill_sessions` + submission touches |
| Avg time-in-bucket | `status_history` |
| SOP freshness / verification | `portals.url_changed_at`, `markPortalVerified` |

### Code-side dependencies (cross-ref Dev Guide)
- **Rename Templates → SOPs.** The type is already `SOPTemplate`; the **UI is
  not** — `admin.templates.*` routes and labels still say "Templates." Rename
  routes/labels/nav; keep `sop_templates` table name or migrate deliberately.
- **Promote steps to first-class, typed.** Today steps live inside
  `sop_templates.task_definitions` (`{dueOffsetDays, steps:[{label, dataFields}]}`)
  with no `step_type`. Add a `step_type` enum (`draft_email|online_form|pdf`) and
  the email template body. (Watch the **known wart**: `seed.sql` stores a legacy
  `task_definitions` shape `sopResolver` can't read — normalize on the way.)
- **Global catalog migration.** New `org_id NULL` rows on `payers`/`sop_templates`
  + an org-assignment table + RLS rewrite (member SELECT of global+assigned,
  writer edits on own overrides) — the `portal_field_maps` policy is the template.
  **This reverses locked decision #1's per-org assumption for payers/SOPs; the
  gate (`verify-org-isolation.mjs`) must gain assertions that a global payer is
  visible cross-org but org data never leaks.**
- **`pickTemplate` is duplicated** in `NewCaseModal` and `CreateCasesDialog` — keep
  them in sync or centralize as part of this work.
- **Fixed buckets** already exist (`status_configs.action_bucket`,
  `src/lib/actionState.ts`) — but the status rows that map to them are per-org user
  config today; Epic 6 moves them into code, which this engine assumes.

---

## Epic 2 — Onboarding & launch redesign

**Complexity ●●●●○ · Status: Decided**

Today **you cannot set up an organization in-platform at all** — orgs are loaded by
hand / MCP / Claude. That is the bottleneck to onboarding real customers. This epic
makes a credentialing manager or owner do it through the UI.

### 2a. Org intake through the UI
- _As an owner_, I fill out org detail in a form and my org exists — no engineer,
  no Claude ingestion.

### 2b. Two launch paths
A **launch** is still "a `facilities` row in a pre-active location-track status" —
the funnel, not a new entity. Two entry paths:

- **(a) Onboard existing** — migrate existing facilities + providers in as
  **reference data**: no status, no tasks, for ~the next 1.5 years. They exist to
  be referenced, not worked.
- **(b) Net-new everything** — a build chain: **org net-new → facility net-new →
  provider net-new**, each step leading into the next, ending in live cases.

### 2c. CSV upload packages (app logic, not an LLM)
- **Decided:** bulk onboarding is **CSV packages the app ingests and maps into the
  tables.** Get away from an LLM / Claude Code doing ingestion — **this is app
  logic**: a deterministic parser + column→table mapper + validation + preview.
- _As a manager_, I upload the org/facility/provider CSVs and the system maps them
  in, shows me what it parsed, and lets me fix before commit.

### 2d. Launch as its own workflow (funnel → dashboards)
- A **prospects → in-flight funnel** with status markers, feeding dashboarding and
  reports. Builds on the existing location-track statuses
  (Prospect→Planned→Interviewing→Pending Fulfillment→Ready for Launch→Live) and
  `splitLaunchSections` / Reports contract matrix.

### 2e. Migration data = reference-only
- Migrated providers/facilities carry **no status and no tasks** (~1.5-yr horizon).
  They must be visibly distinct from net-new (which get the full SOP/task engine).

### Code-side dependencies
- New **org-creation service + route** (none exists; org rows are hand-loaded).
- **CSV ingestion module** — pure parse/map/validate in `src/lib/*` with tests,
  service to write, wizard UI. Reuses `createProviderWithDetails` and the
  facilities/`provider_facility_assignments` model.
- A **`reference_only` flag** (or a reserved status) on migrated
  facilities/providers so the action engine, Fix-it queue, and scorecards skip
  them.
- Cross-check the **launches-as-locations** model (`launchLocations.ts`) and the
  gate's expected per-org provider counts when bulk-loading.

---

## Epic 3 — Workbench (the extension)

**Complexity ●●●●○ · Status: In progress · Depends on BOTH Panel + Extension**

The Chrome extension is **renamed "Minted Panel Workbench"** and becomes the doing
surface: organize fields, update steps, update field mappings, play the Fixit game,
and answer "what's my reference number / latest note."

### 3a. Form-sensor filler (data-gap surfacing)
- _As a filler_, when a payer wants 50 fields and we can supply 20, the Workbench
  **shows the 30-field gap** instead of silently filling 20.
- **Reconcile:** the raw material exists — `/api/providers/:id/profile` already
  returns `unresolved` tokens with reasons, and `portal_field_maps` carries
  coverage. The gap is the **presentation**: "required vs available" as a first-
  class sensor, per portal.

### 3b. Fixit game
- **In progress.** The panel already ships **Surface 1 — Fix-it queue** (`/fix-it`,
  impact-ordered, weekly "good catch" counter, **no timers/streaks by product
  law**). The Workbench side is the "gaps create bugs that force fixes" loop.
- **Overlap flag:** the panel *finds and orders* the work; the Workbench is where
  you *do* the fill. Keep the single-owner rule for `portal_field_maps` (MCP-only
  edits, code + DB change together).

### 3c. Organize fields / update steps / update field mappings
- Mapping review already exists as **Surface 2** (`/portals/$portalKey/train`) with
  batch/one-at-a-time confirm and the closed token catalog. The Workbench mirrors
  this against the live portal DOM.

### 3d. "What's my reference number / latest note"
- _As a filler mid-portal_, I can see the case's reference number and the latest
  touch/note without leaving the tab. Reuses `GET /api/cases` + a
  touches/latest-note read (new small endpoint or extend the profile envelope).

### Code-side dependencies
- Extension rename (`minted-extension` repo: manifest, store listing, the
  `chrome-extension://<id>` CORS allowlist entry in `API_CORS_ORIGINS`).
- Data-gap needs a **required-fields source** per portal — ties to Epic 1's
  step field tokens.
- New read endpoint(s) follow the **consumer-pulled** rule and add **gate
  assertions** before merge (`guard.ts` + `verify-org-isolation.mjs`).

---

## Epic 4 — Gmail integration & mail-merge draft flow

**Complexity ●●●○○ · Status: Open**

The draft-email step (1a/1d) needs a delivery surface.

- _As a filler_, I **land in Gmail with the body pre-copied**, kick off the email,
  and the associated **PDF is downloaded locally** so a **human stays in the loop**
  (the extension never sends on its own — consistent with "the extension never
  submits forms").
- **Explore email tracking** — open/receipt signals feeding the scorecard's
  submission indicators.

### Open questions this epic must answer
- Gmail **compose deep-link / clipboard hand-off** vs a real Gmail API integration
  (OAuth scope, consent screen). Deep-link keeps the human-in-loop invariant
  cheaply; API unlocks tracking but adds auth surface.
- Where the **PDF** comes from (ties to Epic 5).

---

## Epic 5 — Touch points + inherited notes → "add" / generation

**Complexity ●●○○○ · Status: Open**

Turn the append-only record (`touches` + inherited `notes`) into an **"add"
function** that generates artifacts:

- **Generate a roster file** — export the provider/case roster for a payer/launch.
- **Generate the PDF form filler** — the "PDF" step type from Epic 1; downloaded
  locally (Epic 4's human-in-loop).

### Code-side dependencies
- `touches` and `notes` are append-only and already read across the app; this adds
  **generation/export services**, not schema churn.
- PDF filler is shared with Epic 1 step type and Epic 4 download flow — build once.

---

## Epic 6 — Admin cleanup & tech debt

**Complexity ●●○○○ · Status: Mixed**

Lower-risk groundwork. Each item is small but gets **real requirements + a PR**, not
an isolated fix.

| Item | Status | Reconciliation with the code |
|------|--------|------------------------------|
| **Statuses → code, not user config** | Open | Today `status_configs` is per-org, editable in `admin.statuses.tsx` (drag reorder, add/edit modal). Move canonical status sets into code/migration; lock or remove the editor. **Risk:** semantics are matched **by label** app-wide and orgs have custom labels — needs a migration + a compatibility pass. Buckets are already fixed (4 values); this fixes the *rows*. |
| **Remove Users section (duplicate)** | Confirmed | `admin.users.tsx` **and** `admin.settings.tsx` both handle members/invites/roles. Verify `admin.users` is the redundant one, then delete route + nav (follow the M6 delete-after-verify pattern). |
| **Starter pack** | See Epic 1c | Not in code on this branch; ships with the catalog work, not here. |
| **Providers & Cases revisit** | Open | Re-examine against the payer engine: surface data-gaps (3a) on the provider profile and step/task progress on cases. `PROVIDER_LIST_COLUMNS` is a partial projection and provider **edit drops facility assignments** (known warts) — fix if the payer engine reads those fields. |

---

## Cross-cutting concerns

### Concurrency & overlap — Extension ↔ Panel
Items that **depend on both** and need coordinated PRs (single-owner rule on shared
state, per Dev Guide):
- **Field mappings** (`portal_field_maps`) — Epic 3c. MCP-only edits; code + DB
  change same day, one actor.
- **Step definitions & field tokens** — Epic 1 (panel defines) ↔ Epic 3a (extension
  senses the gap).
- **Fixit loop** — Epic 3b: panel finds/orders (`/fix-it`), extension does the fill.
- **Draft-email + PDF** — Epics 1d/4/5 span both surfaces.

**Flagged multi-surface epics: 1, 3, 4.** Sequence their panel-side contract
(endpoints, tokens, step types) **before** the extension side pulls it — the API is
consumer-pulled, so the panel ships the route when the Workbench is ready to consume
it, and both get gate assertions.

### Environments & dev readiness
- **Keep structured data cleanly segmented by org.** The global payer/SOP catalog
  (Epic 1b) is the one deliberate exception — global *definitions*, never global
  *tenant data*. The **org-isolation gate is the wall** (`guard.ts` +
  `verify-org-isolation.mjs`); every new route and the catalog reversal add
  assertions before merge. Red gate = stop-ship.
- Bulk onboarding (Epic 2c) must update the gate's expected per-org counts in the
  same PR (single-owner rule #3).

---

## Open questions needing a decision

1. **Global catalog mechanics.** Confirmed direction is "global catalog assigned to
   orgs as needed." Decide the **assignment model**: a subscription/join table
   (`org_payer_assignment`) vs a visibility flag. Recommend the join table — it
   also carries the per-org `starter`/`common` flag for Epic 1c.
2. **SOP scoping key.** Keep SOP resolution at `payer+state+group` (current
   `pickTemplate`), or simplify to `payer(+state)` now that SOPs are global?
3. **Statuses-to-code migration.** Existing orgs have custom status **labels** and
   the app matches semantics by label. Do we (a) force everyone onto a canonical
   set, or (b) ship a code-owned default with a label-compat shim? Recommend (b).
4. **Gmail: deep-link vs API.** Human-in-loop deep-link/clipboard (cheap, no OAuth)
   vs Gmail API (enables tracking, adds auth surface). Recommend deep-link for v1,
   revisit tracking.
5. **Migration reference-data representation.** A `reference_only` boolean vs a
   reserved status vs a separate table? Recommend a flag — least schema churn, and
   the action engine/Fix-it queue just filter on it.
6. **`sop_templates` rename.** Rename the **table** to `sops`, or only the UI/type
   (already `SOPTemplate`)? Table rename is a migration + type regen; UI-only is
   cheap. Recommend UI/label rename now, defer table rename.

---

## Dependencies on the Code side — cross-reference the Dev Guide

| Roadmap item | Code Dev Guide anchor | What changes |
|--------------|----------------------|--------------|
| Global payer/SOP catalog (1b) | Locked decision #1 (three products, per-org RLS); `portal_field_maps` global pattern | Reverses per-org payers; new `org_id NULL` rows + assignment table + RLS + gate assertions |
| Rename Templates→SOPs (1) | `admin.templates.*`, `SOPTemplate` type, `pickTemplate` (duplicated) | UI/route/label rename; optional table rename |
| First-class typed steps (1a) | `sop_templates.task_definitions` shape; `sopResolver`; seed.sql legacy-shape wart | Add `step_type` enum + email body; normalize seed shape |
| Fixed buckets (1a) | `status_configs.action_bucket`, `src/lib/actionState.ts` | Reused as-is; assumes Epic 6 statuses-to-code |
| Starter pack (1c) | `create_case_with_tasks`, `CreateCasesDialog` pre-check | New provider-create auto-attach; no code today |
| Org intake + CSV (2) | No org-creation path; `createProviderWithDetails`; launches-as-locations | New service/route + deterministic CSV ingestion module |
| Reference-only data (2e) | Action engine, Fix-it (`fixitQueue.ts`), scorecards | New flag consumers filter on |
| Form sensor (3a) | `/api/providers/:id/profile` `unresolved`; `portal_field_maps` | Presentation of required-vs-available |
| Fixit / Mapping (3b/3c) | Surfaces 1–2 (`/fix-it`, `/portals/$k/train`); single-owner rule | Extension-side mirror; coordinated PRs |
| "What's my…" reads (3d) | `GET /api/cases`, `touches` | New consumer-pulled read + gate assertion |
| Gmail + PDF (4/5) | Human-in-loop invariant ("extension never submits") | New external surface; PDF filler shared with 1/5 |
| Remove Users (6) | `admin.users.tsx` vs `admin.settings.tsx` | Verify-then-delete route + nav |
| Statuses-to-code (6) | `admin.statuses.tsx`, label-matched semantics | Code-owned status sets + compat migration |
| Gate everywhere | `guard.ts`, `verify-org-isolation.mjs`, "the gate is the wall" | Every new route + the catalog reversal adds assertions |
