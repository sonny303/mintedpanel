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

| #   | Epic                                                                                      | Complexity | Status                | Depends on            |
| --- | ----------------------------------------------------------------------------------------- | ---------- | --------------------- | --------------------- |
| 1   | Payer → SOP → Steps → Tasks engine + global catalog                                       | ●●●●●      | Decided · **up next** | Panel + Extension     |
| 2   | Onboarding & launch redesign (org/facility/provider intake, CSV, funnel)                  | ●●●●○      | Decided               | Panel                 |
| 3   | Workbench (extension) — form sensor, Fixit, field mapping, "what's my…"                   | ●●●●○      | In progress           | **Panel + Extension** |
| 4   | Gmail integration & mail-merge draft flow                                                 | ●●●○○      | Open                  | Extension (+ Panel)   |
| 5   | Touch points + inherited notes → "add" / roster & PDF generation                          | ●●○○○      | Open                  | Panel                 |
| 6   | Admin cleanup & tech debt (statuses-to-code, remove Users, starter-pack, providers/cases) | ●●○○○      | Mixed                 | Panel                 |

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

**Steps vs Tasks — the distinction to hold onto:** _steps are the components of
the recipe; tasks are the actual cooking._ A step is defined once on the SOP and
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
model is: \*\*global catalog rows (`org_id NULL`) + a per-org assignment/subscription

- optional org overrides.\*\*

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

| Indicator                             | Source                                         |
| ------------------------------------- | ---------------------------------------------- |
| Field coverage (available ÷ required) | profile `unresolved` vs SOP step field tokens  |
| Mapping coverage (mapped ÷ proposed)  | `portal_field_maps` counts                     |
| First-pass submission rate            | `fill_sessions` + submission touches           |
| Avg time-in-bucket                    | `status_history`                               |
| SOP freshness / verification          | `portals.url_changed_at`, `markPortalVerified` |

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
  - an org-assignment table + RLS rewrite (member SELECT of global+assigned,
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
- **Overlap flag:** the panel _finds and orders_ the work; the Workbench is where
  you _do_ the fill. Keep the single-owner rule for `portal_field_maps` (MCP-only
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

- Extension rename (`minted-extension` repo). Audited 2026-07-06: **nothing
  breaks functionally** — storage keys (`minted.*` prefix), sender auth
  (`chrome.runtime.id`), and the content-script global are all name-independent.
  Complete display-string touch-point list: `public/manifest.json:3,5,7`
  (name/description/action title), `sidepanel.html:5,31,41`
  (title/brand/hint), `package.json:5`, `README.md:1`, plus user-facing
  strings in `src/background/fill.ts:167,202` and
  `src/sidepanel/main.ts:203,301,489`. Store listing + the
  `chrome-extension://<id>` CORS allowlist entry in `API_CORS_ORIGINS` are
  external to the repo.
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

| Item                                 | Status      | Reconciliation with the code                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statuses → code, not user config** | Open        | Today `status_configs` is per-org, editable in `admin.statuses.tsx` (drag reorder, add/edit modal). Move canonical status sets into code/migration; lock or remove the editor. **Risk:** semantics are matched **by label** app-wide and orgs have custom labels — needs a migration + a compatibility pass. Buckets are already fixed (4 values); this fixes the _rows_. |
| **Remove Users section (duplicate)** | Confirmed   | `admin.users.tsx` **and** `admin.settings.tsx` both handle members/invites/roles. Verify `admin.users` is the redundant one, then delete route + nav (follow the M6 delete-after-verify pattern).                                                                                                                                                                         |
| **Starter pack**                     | See Epic 1c | Not in code on this branch; ships with the catalog work, not here.                                                                                                                                                                                                                                                                                                        |
| **Providers & Cases revisit**        | Open        | Re-examine against the payer engine: surface data-gaps (3a) on the provider profile and step/task progress on cases. `PROVIDER_LIST_COLUMNS` is a partial projection and provider **edit drops facility assignments** (known warts) — fix if the payer engine reads those fields.                                                                                         |
| **Audit backlog (2026-07-06)**       | Confirmed   | Full-pass findings below — TD-1…TD-8 (panel) and EXT-1…EXT-3 (extension).                                                                                                                                                                                                                                                                                                 |

### Verified tech-debt backlog (full-repo audit, 2026-07-06)

Findings from a three-lane audit (panel frontend, panel services/server,
extension), **deduped against the Dev Guide's "Known warts"** — nothing below is
already documented there. Grouped into PR-sized clusters; each has an execution
prompt in the last section.

#### TD-1 — NewCaseModal layering + stale-cache bugs (panel, highest value)

- `NewCaseModal.tsx:88,105,493` issues **three direct `supabase.from()` queries**
  (`state_licenses`, `provider_facility_assignments`, `contracts`) from a
  component — the one layering violation of its kind in the app.
- The `state_licenses` query duplicates data the component **already loads** via
  `useStateLicensesByProvider` (redundant round-trip).
- Its ad-hoc query keys (`["state-licenses-active", …]`,
  `["provider-facility-assignments", …]`) don't match the canonical
  `queryKeys.stateLicenses` / `queryKeys.facilityAssignments`, so **license edits
  and new facility assignments never invalidate the modal's cache** — stale
  active-license and default-facility data. Two real staleness bugs.

#### TD-2 — `home_state` contradicts the PHI list contract (panel, contract integrity)

- `providers.ts:65-66`: the comment above `PROVIDER_LIST_COLUMNS` (and the Dev
  Guide) promise "no home\_\* columns" in list payloads, but **`home_state` is in
  the projection** and ships in every `GET /api/providers` response. Low
  sensitivity, but the stated invariant is false — decide (include it and fix the
  contract wording, or drop the column) and make doc + code agree.

#### TD-3 — Cache invalidation + role-guard gaps (panel, small fixes)

- `useTouches.ts:56-61` (`useLogTouch`) invalidates two touch keys but **not**
  `["touches", orgId, "latest-follow-ups"]` — Home's "Follow-ups due" queue goes
  stale after logging a touch. Fix: prefix-invalidate `["touches", orgId]`.
- `admin.audit.tsx` has **no render-time role backstop** — the only admin-group
  route with zero check; a specialist/billing user navigating directly renders
  the full audit log (read-only, RLS-backed, but inconsistent).
- `admin.templates.$id.tsx:68-79` defines a local `useSopFieldTokens` calling the
  RPC directly, duplicating `services/tokenCatalog.ts`, under a non-org-scoped
  ad-hoc key.
- `MembersPanel.tsx:82` invokes the `invite-member` edge function directly from
  the component (no service wrapper); `welcome.tsx:46-48` calls the
  `claim_invites` RPC directly.

#### TD-4 — `field_dictionary` upsert: missing audit + insert race (panel, services)

- `fieldDictionary.ts:34-90` `upsertDictionaryEntry` mutates on every token
  approval **without `writeAudit`** (its sibling `decideDictionaryEntry` audits),
  and its read-then-insert has **no `23505` handling** against
  `unique(org_id, label_normalized)` — two users first-approving the same label
  concurrently → one gets a 500 instead of converging.

#### TD-5 — Server API asymmetries + gate coverage (panel, server)

- `providerRoutes.ts:73-82`: `PATCH /api/providers/:id` returns **500 (not 404)**
  for a cross-org/nonexistent id (zero-row `.single()` throws → generic 500);
  `GET` on the same id correctly 404s. Align to 404.
- The **provider write routes have no isolation-gate assertions**
  (`verify-org-isolation.mjs` covers all reads + the two extension POSTs, not
  `POST/PATCH /api/providers`). "Every route adds assertions" — close the gap.
- `terminateProvider` (`providers.ts:534-539`) payer lookup drops the org filter
  (RLS-covered, but breaks the file's discipline).

#### TD-6 — Type & schema drift (panel, docs/types)

- `SCHEMA.md` providers section is missing **~16 live columns** (middle*initial,
  suffix, gender, ethnicity, board_certified, sub_specialty, languages,
  medicaid_attested, license*\*, dea_expiration_date, …) that ARE live token
  sources in `PROFILE_PROVIDER_COLUMNS` — material for anyone reasoning about
  the fill engine from SCHEMA.
- `types/index.ts` `Provider` omits the non-license subset (runtime-present via
  `getProvider`'s `select('*')`, invisible to TS).
- `credential_cases.case_email_token`: absent from SCHEMA.md; generated types say
  NOT NULL, domain type says `| null` — pick one.
- `Touch.source` union says `"email_webhook"` but the specced inbound-email
  writer uses `'email'` — latent mismatch to fix before the webhook ships.

#### TD-7 — Label-constant centralization (panel, fragility map)

The by-label idiom is documented, but the constants are **copy-pasted**:
`PRE_CRED_PAYER_NAME` re-declared in 6 files + the canonical
`clientProgress.ts:7`; `"In-Network"` hardcoded in 5 files;
`"Pending Fulfillment"`/`"Ready for Launch"` in `home.tsx` + `launchLocations.ts`.
Centralize into one `src/lib/statusLabels.ts` (or similar) so Epic 6's
statuses-to-code migration has exactly one place to change.

#### TD-8 — Remove `admin.users.tsx` (panel, verified duplicate)

Confirmed duplicate of `admin.settings.tsx` member management. Verify-then-delete
(route + nav), per the M6 pattern.

#### EXT-1 — Stale-response race in the side-panel pickers (extension, fill safety)

- `sidepanel/main.ts:456,623-631` (also `310,379,430`): provider `change` fires
  un-awaited `loadCases`/`loadFacilities`, which write module state and rebuild
  the dropdowns on completion **without re-checking the selection is still
  current** — fast provider switching can render provider A's cases/facilities
  under provider B. **Wrong-record fill risk; highest-priority extension fix.**

#### EXT-2 — Auth/org edge cases (extension)

- `api.ts:31-43,76-79`: `x-org-id` is attached to **every** request including
  `/api/me/orgs` — the org-discovery route that must work _before/without_ org
  context; a revoked stored org could brick recovery.
- `api.ts:46-69`: a second 401 after a **successful** refresh throws a generic
  `ApiError` instead of the sign-in-required prompt the comment promises.

#### EXT-3 — Dead code + latent hazards (extension, small)

- Dead `PING` message (`shared/fill.ts:66`, handler `content/index.ts:12-15`) —
  nothing sends it; adding a real pre-flight ping would remove the "Receiving end
  does not exist" fallback path.
- `selectedFacilityId` computed by the background (`index.ts:153`) but ignored by
  the panel, which re-derives it — drop or consume.
- `selectedCaseId`/`selectedFacilityId` require `UUID_RE` but
  `selectedProviderId` doesn't — asymmetric validation; a non-canonical id makes
  a case silently unselectable.

#### Audited clean (no action)

Token-format contract (bare/braced confined to `normalizeTokenKey`),
idempotency/replay in `fillSessions`/`submissionTouches` (including the 409
foreign-org collision path), both post-baseline migrations (guarded, additive),
CORS/envelope/guard coverage, extension wire contract (casing, idempotency ids,
`x-org-id` on org-scoped calls), zero TODO/FIXME/console.log in either repo.

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
  (Epic 1b) is the one deliberate exception — global _definitions_, never global
  _tenant data_. The **org-isolation gate is the wall** (`guard.ts` +
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

| Roadmap item                  | Code Dev Guide anchor                                                                | What changes                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Global payer/SOP catalog (1b) | Locked decision #1 (three products, per-org RLS); `portal_field_maps` global pattern | Reverses per-org payers; new `org_id NULL` rows + assignment table + RLS + gate assertions |
| Rename Templates→SOPs (1)     | `admin.templates.*`, `SOPTemplate` type, `pickTemplate` (duplicated)                 | UI/route/label rename; optional table rename                                               |
| First-class typed steps (1a)  | `sop_templates.task_definitions` shape; `sopResolver`; seed.sql legacy-shape wart    | Add `step_type` enum + email body; normalize seed shape                                    |
| Fixed buckets (1a)            | `status_configs.action_bucket`, `src/lib/actionState.ts`                             | Reused as-is; assumes Epic 6 statuses-to-code                                              |
| Starter pack (1c)             | `create_case_with_tasks`, `CreateCasesDialog` pre-check                              | New provider-create auto-attach; no code today                                             |
| Org intake + CSV (2)          | No org-creation path; `createProviderWithDetails`; launches-as-locations             | New service/route + deterministic CSV ingestion module                                     |
| Reference-only data (2e)      | Action engine, Fix-it (`fixitQueue.ts`), scorecards                                  | New flag consumers filter on                                                               |
| Form sensor (3a)              | `/api/providers/:id/profile` `unresolved`; `portal_field_maps`                       | Presentation of required-vs-available                                                      |
| Fixit / Mapping (3b/3c)       | Surfaces 1–2 (`/fix-it`, `/portals/$k/train`); single-owner rule                     | Extension-side mirror; coordinated PRs                                                     |
| "What's my…" reads (3d)       | `GET /api/cases`, `touches`                                                          | New consumer-pulled read + gate assertion                                                  |
| Gmail + PDF (4/5)             | Human-in-loop invariant ("extension never submits")                                  | New external surface; PDF filler shared with 1/5                                           |
| Remove Users (6)              | `admin.users.tsx` vs `admin.settings.tsx`                                            | Verify-then-delete route + nav                                                             |
| Statuses-to-code (6)          | `admin.statuses.tsx`, label-matched semantics                                        | Code-owned status sets + compat migration                                                  |
| Gate everywhere               | `guard.ts`, `verify-org-isolation.mjs`, "the gate is the wall"                       | Every new route + the catalog reversal adds assertions                                     |

---

## Execution prompts — copy-paste into future Claude Code sessions

The backlog trail is **this doc + these prompts** (no GitHub epics, by decision
2026-07-06). Each prompt is self-contained: paste it into a fresh session on the
named repo and it runs without extra context. Conventions baked into every
prompt: the session auto-loads `CLAUDE.md`; the bar is `npx tsc --noEmit` +
`npm run lint` + `npm test` green, plus the isolation gate
(`node scripts/verify-isolation-local.mjs`) whenever `src/server/` or
`src/services/` with a server ctx is touched; one PR per prompt. Where an open
question existed, the **recommended default is embedded** — override the
flagged ASSUMPTION line if you decide differently.

Run order: P0 prompts are independent and can run anytime (parallel lanes OK —
respect the shared-state ownership rules in CLAUDE.md). P1 must precede P2–P5
within Epic 1. Epic 2/3 prompts are independent of Epic 1 except where flagged.

### P0-a — Tech debt: NewCaseModal layering + stale caches (TD-1)

> In sonny303/mintedpanel, read AGENTS.md, CLAUDE.md, and docs/minted-panel-roadmap.md §TD-1. Fix NewCaseModal's layering violations: move its three direct supabase queries (state_licenses at src/components/cases/NewCaseModal.tsx:88, provider_facility_assignments at :105, contracts at :493) into the proper hook→service path. Delete the redundant active-licenses fetch — the component already loads licenses via useStateLicensesByProvider; derive active ones from that. Replace the ad-hoc query keys ["state-licenses-active", …] and ["provider-facility-assignments", …] with the canonical queryKeys.stateLicenses / queryKeys.facilityAssignments so license edits and facility assignments invalidate the modal's cache. Do not change any user-visible behavior. Bar: tsc, lint, vitest green. Open a PR titled "fix(cases): route NewCaseModal queries through services, fix stale caches".

### P0-b — Tech debt: PHI list contract + server asymmetries (TD-2, TD-5)

> In sonny303/mintedpanel, read AGENTS.md, CLAUDE.md, and docs/minted-panel-roadmap.md §TD-2 and §TD-5. Three fixes, one PR. (1) PROVIDER*LIST_COLUMNS in src/services/providers.ts includes home_state while its comment and CLAUDE.md promise "no home*\* columns". ASSUMPTION: keep home_state (it's needed for routing/display) and fix the comment + CLAUDE.md wording to say "no ssn_last4, date_of_birth, or home-address columns (street/city/zip); home_state is deliberately included". (2) Make PATCH /api/providers/:id return 404 (not 500) for a cross-org or nonexistent id, matching the GET handler — see src/server/providerRoutes.ts:73-82; add a handler test. (3) Add org-isolation gate assertions for POST /api/providers and PATCH /api/providers/:id (cross-org PATCH must 404, POST must land in the caller's org only) in scripts/verify-org-isolation.mjs, with pass/leak coverage in scripts/mock-api-server.mjs. Also restore the org filter on the terminateProvider payer lookup (src/services/providers.ts:534-539). Bar: tsc, lint, vitest, and node scripts/verify-isolation-local.mjs green. PR: "fix(server): provider PATCH 404 contract, write-route gate assertions, PHI contract wording".

### P0-c — Tech debt: cache invalidation + guards + layering strays (TD-3)

> In sonny303/mintedpanel, read AGENTS.md, CLAUDE.md, and docs/minted-panel-roadmap.md §TD-3. Four small fixes, one PR. (1) useLogTouch in src/hooks/useTouches.ts: replace the two specific touch-key invalidations with a prefix invalidation on ["touches", orgId] so "latest-follow-ups" (Home follow-ups queue) refreshes after logging a touch. (2) Add the render-time useIsAdmin backstop to src/routes/admin.audit.tsx, matching admin.payers.tsx's pattern. (3) Delete the local useSopFieldTokens in src/routes/admin.templates.$id.tsx and use the existing useTokenCatalog hook (services/tokenCatalog.ts) instead — note tokenCatalog appends the user._ family; verify the template editor's token list should include user._ tokens (it should — SOP steps may reference them) and keep the closed-list validation intact. (4) Wrap the invite-member edge-function call (src/components/settings/MembersPanel.tsx:82) and the claim_invites RPC in src/routes/welcome.tsx behind service functions in src/services/. Bar: tsc, lint, vitest green. PR: "fix: touch invalidation prefix, audit route guard, token-catalog reuse, service wrappers".

### P0-d — Tech debt: field_dictionary audit + race (TD-4)

> In sonny303/mintedpanel, read AGENTS.md, CLAUDE.md, and docs/minted-panel-roadmap.md §TD-4. In src/services/fieldDictionary.ts, upsertDictionaryEntry: (1) write an audit_log row via writeAudit on insert and update, matching decideDictionaryEntry's convention; (2) handle Postgres 23505 on the insert against unique(org_id, label_normalized) by re-reading and applying the update path, so concurrent first-approvals of the same label converge instead of throwing. Extend fieldDictionary's di test for both. Bar: tsc, lint, vitest green. PR: "fix(services): audit + upsert race in field dictionary".

### P0-e — Tech debt: type/schema drift sync (TD-6)

> In sonny303/mintedpanel, read AGENTS.md, CLAUDE.md, and docs/minted-panel-roadmap.md §TD-6. Documentation/type sync only — no runtime behavior change, no DDL. (1) Add the ~16 missing provider columns to SCHEMA.md's providers section (compare against src/integrations/supabase/types.ts providers Row — middle_initial, suffix, gender, ethnicity, board_certified, sub_specialty, languages, medicaid_attested, cultural_competency_training, additional_certifications, age_groups_served, dea_expiration_date, license_number, license_state, license_issue_date, license_expiration_date). (2) Add their camelCase equivalents to the Provider interface in src/types/index.ts (additive). (3) Add case_email_token to SCHEMA.md's credential_cases list; check its real nullability in the live DB via Supabase MCP (information_schema) and align src/types/index.ts caseEmailToken to it. (4) Change Touch.source's "email_webhook" literal to "email" to match the specced inbound-email writer, and grep for any usage of the old literal first. Bar: tsc, lint, vitest green. PR: "docs(schema): sync SCHEMA.md and domain types with live provider/case columns".

### P0-f — Tech debt: centralize status/payer label constants (TD-7)

> In sonny303/mintedpanel, read AGENTS.md, CLAUDE.md, and docs/minted-panel-roadmap.md §TD-7. Create src/lib/statusLabels.ts exporting the shared label constants: PRE_CRED_PAYER_NAME ("Pre-Credentialing Setup"), IN_NETWORK_LABEL ("In-Network"), PENDING_FULFILLMENT_LABEL, READY_FOR_LAUNCH_LABEL, LIVE_LABEL, and the NOT_REQUIRED/OON owner-mapping labels. Replace every copy-pasted occurrence — PRE_CRED_PAYER_NAME is re-declared in cases.index.tsx, home.tsx, providers.index.tsx, launches.$id.tsx, ContractMatrixTab.tsx, CreateCasesDialog.tsx (canonical copy currently in clientProgress.ts:7); "In-Network" is hardcoded in cases.index.tsx:194, providers.index.tsx:218, launches.$id.tsx:242, launchReadiness.ts:33, clientProgress.ts:31; "Pending Fulfillment"/"Ready for Launch" in home.tsx:35 and launchLocations.ts:18,146. Pure refactor — zero behavior change; all existing tests must pass unmodified. Bar: tsc, lint, vitest green. PR: "refactor: single source for status/payer label constants".

### P0-g — Tech debt: remove admin Users section (TD-8)

> In sonny303/mintedpanel, read AGENTS.md, CLAUDE.md, and docs/minted-panel-roadmap.md §TD-8. Remove the duplicate member-management surface: first verify src/routes/admin.users.tsx offers nothing admin.settings.tsx's MembersPanel doesn't (diff their capabilities: list, invite, role change, remove); if it has a unique capability, port it into MembersPanel first. Then delete admin.users.tsx, its nav entry in the Sidebar, and any links to /admin/users (grep for "admin/users" and "admin.users"). Follow the M6 delete-after-verify pattern (docs/m6-handoff.md). Bar: tsc, lint, vitest green + confirm /admin/users now 404s to the app not-found page. PR: "chore(admin): remove duplicate Users section".

### P0-h — Extension: picker race + auth edges + dead code (EXT-1/2/3)

> In sonny303/minted-extension, read the README and docs/minted-panel-roadmap.md (in the sonny303/mintedpanel repo) §EXT-1..3. Three fixes, one PR. (1) Fill-safety race: in src/sidepanel/main.ts, the provider change handler fires un-awaited loadCases/loadFacilities that write module state and rebuild dropdowns without re-checking the current selection — add a request-generation counter (or compare the selected provider id when the response lands) so a stale response for a previously-selected provider is discarded; apply the same pattern to every loader (lines ~310, 379, 430, 456, 623-631). (2) Auth: in src/background/api.ts, suppress the x-org-id header for /api/me/orgs (org discovery must work without org context); and when a request 401s again after a successful token refresh, surface the sign-in-required error path (the same one thrown when forceRefresh fails) instead of a generic ApiError. (3) Dead code: remove the unused PING message and handler (src/shared/fill.ts:66, src/content/index.ts:12-15) OR wire it as a real pre-flight ping before APPLY_FILL — prefer wiring it, since it removes the "Receiving end does not exist" fallback; and either consume the background's selectedFacilityId in loadFacilities or stop computing it. Bar: tsc + lint green; manually reason through the fill flow for regressions (no test harness exists). PR: "fix(panel): stale-response race in pickers, auth edge cases, PING pre-flight".

### P1 — Epic 1 opener: rename Templates → SOPs (UI/labels)

> In sonny303/mintedpanel, read AGENTS.md, CLAUDE.md, and docs/minted-panel-roadmap.md Epic 1. Rename the admin Templates surface to SOPs, UI-level only. ASSUMPTION: keep the sop_templates table name and the SOPTemplate type; this is routes/labels/nav only. Rename routes admin.templates.tsx / admin.templates.index.tsx / admin.templates.$id.tsx to admin.sops.\* (keep a redirect from /admin/templates to /admin/sops — the URL may be bookmarked), update the Sidebar nav label to "SOPs", update all user-facing strings ("Template" → "SOP") on those pages and in create/edit modals, and update hook/service names only where they're template-specific and cheap (useTemplates → useSops is fine; do NOT touch sop_templates DB identifiers or the sopResolver contract). Bar: tsc, lint, vitest green + Playwright-render the renamed routes with the mocked-Supabase harness from CLAUDE.md if feasible. PR: "feat(admin): rename Templates to SOPs".

### P2 — Epic 1 core: global payer/SOP catalog + org assignment (schema + RLS + gate)

> In sonny303/mintedpanel, read AGENTS.md, CLAUDE.md, docs/minted-panel-roadmap.md Epic 1b, and docs/migration-baseline.md. Build the global-catalog data layer, no UI yet. ASSUMPTIONS (override if decided otherwise): assignment is a join table org_payer_assignments (org_id, payer_id, starter boolean default false, unique(org_id, payer_id)); global rows are payers/sop_templates with org_id NULL, per the portal_field_maps precedent; SOP resolution scope stays payer+state+group. Work repo-first: one new migration in supabase/migrations/ (guarded for repo-only rebuild per the migration-baseline rules) making payers.org_id and sop_templates.org_id nullable if needed, creating org_payer_assignments with RLS (member SELECT own-org, admin INSERT/DELETE own-org), and updating payers/sop_templates RLS to member SELECT of (own-org OR global-and-assigned) while writes stay own-org-only. Apply the identical SQL to hosted via Supabase MCP apply_migration, regenerate types.ts via generate_typescript_types + prettier, and update SCHEMA.md. Update the payer/template services so list queries return own-org + assigned-global rows. Add gate assertions: a global payer visible to both demo orgs, org-scoped payers never leaking cross-org. Do NOT convert existing org payers to global rows — data migration is a separate, human-supervised step. Bar: tsc, lint, vitest, migration dry-run (Gate 0.4), node scripts/verify-isolation-local.mjs all green. PR: "feat(catalog): global payer/SOP catalog with per-org assignment".

### P3 — Epic 1: first-class typed steps

> In sonny303/mintedpanel, read AGENTS.md, CLAUDE.md, and docs/minted-panel-roadmap.md Epic 1a. Depends on P2 being merged. Promote SOP steps to typed, first-class objects. ASSUMPTION: keep steps embedded in sop_templates.task_definitions (no new table yet) but formalize the shape: each step gains step_type ('draft_email' | 'online_form' | 'pdf', default 'online_form') and, for draft_email, an emailTemplate field (subject + body with {{token}} placeholders from the closed catalog). Update src/lib/sopResolver.ts to carry step_type/emailTemplate through into created tasks (tasks likely need a step_type column — if so, new guarded migration + hosted apply + types regen + SCHEMA.md, per the migration rules). Normalize the legacy seed.sql task_definitions shape to the canonical one while you're in there (known wart). Update the SOP editor UI to set a step's type and author the email template with a token picker over useTokenCatalog. Bar: tsc, lint, vitest (extend sopResolver tests for both step types), migration dry-run green. PR: "feat(sops): typed steps with draft-email templates".

### P4 — Epic 1: starter pack (auto-attach common cases)

> In sonny303/mintedpanel, read AGENTS.md, CLAUDE.md, and docs/minted-panel-roadmap.md Epic 1c. Depends on P2 (org_payer_assignments.starter exists). When a provider is created (src/routes/providers.new.tsx → createProviderWithDetails), auto-create cases for every org payer flagged starter=true: for each, resolve MSO routing + SOP template exactly as CreateCasesDialog does (reuse, don't re-copy, the pickTemplate logic — centralize the currently-duplicated pickTemplate from NewCaseModal/CreateCasesDialog into src/lib/ as part of this), skip (provider, payer, state) combos that already exist, create via createCase → create_case_with_tasks so SOP tasks and audit rows are included. Show the result in the success toast ("Provider created · 6 starter cases attached"). Admin > Payers gains a "Starter" toggle per assigned payer (admin-only write). State selection: use the provider's home_state license if present, else skip that payer and note it in the toast. Bar: tsc, lint, vitest green (unit-test the starter-case derivation as pure logic in src/lib/). PR: "feat(providers): starter-pack case auto-attach on provider create".

### P5 — Epic 1: case wizard + payer scorecard (two PRs, run sequentially)

> In sonny303/mintedpanel, read AGENTS.md, CLAUDE.md, and docs/minted-panel-roadmap.md Epics 1d/1e. Depends on P3. PR 1 — wizard: on the case detail page, add a step-by-step wizard view (tab-to-tab, one tab per task in due order; advancing completes the task). A draft_email step renders the resolved email (tokens filled from the provider/case data the page already loads; unresolvable tokens highlighted) with a copy-to-clipboard action. No sending — copy only (Gmail hand-off is Epic 4). PR 2 — scorecard: a per-payer quality view under /admin/payers/$id/scorecard (or a tab) computing, client-side from existing caches/queries: field coverage (portal_field_maps mapped vs proposed for the payer's portal), avg time-in-bucket from status_history, first-pass rate from fill_sessions where available. Pure derivation in src/lib/payerScorecard.ts with tests. Bar per PR: tsc, lint, vitest green. Titles: "feat(cases): step wizard with draft-email copy" / "feat(payers): quality scorecard".

### P6 — Epic 2: org intake + CSV bulk onboarding (three PRs, run sequentially)

> In sonny303/mintedpanel, read AGENTS.md, CLAUDE.md, and docs/minted-panel-roadmap.md Epic 2. PR 1 — org intake: a create-organization flow (admin-only; decide placement — recommend a route under /admin/settings for now) writing organizations + the creator's membership, org-track status seeding matching the existing per-org seed set (Prospect→…→Live + Inactive for the location track — copy what the demo orgs have), and audit rows. PR 2 — reference-only flag: new guarded migration adding reference_only boolean default false to providers and facilities (hosted apply + types regen + SCHEMA.md per the migration rules); action engine (actionState.ts), Fix-it queue (fixitQueue.ts), and Home queues skip reference_only rows; work views show them under a "Reference" chip. PR 3 — CSV packages: deterministic in-app ingestion (this is app logic — no LLM): a wizard at /admin/import accepting the three-file package (facilities.csv, providers.csv, provider_facility_assignments.csv), with a pure parser/mapper in src/lib/csvImport.ts (+tests: header mapping, type coercion, row-level validation with line-number errors), a preview table of parsed rows + errors, and a commit step writing through the existing services (createProviderWithDetails etc.) so org-scoping and audit hold. Imported rows default reference_only=true with a per-import toggle. If the import touches the demo orgs, update the gate's expected provider counts in the same PR (CLAUDE.md shared-state rule 3). Bar per PR: tsc, lint, vitest, migration dry-run (PR 2), isolation gate local run green. Titles: "feat(orgs): in-app organization intake" / "feat(data): reference-only providers and facilities" / "feat(import): CSV onboarding packages".

### P7 — Epic 3: Workbench rename + form-sensor data-gap view (two PRs)

> Two repos. PR 1 (sonny303/minted-extension) — rename to "Minted Panel Workbench": update exactly the touch points listed in docs/minted-panel-roadmap.md (mintedpanel repo) Epic 3 code-deps — public/manifest.json:3,5,7, sidepanel.html:5,31,41, package.json:5, README.md:1, and the user-facing strings in src/background/fill.ts:167,202 and src/sidepanel/main.ts:203,301,489. Storage keys, chrome.runtime.id auth, and the content global are name-independent — do not touch them. PR 2 (sonny303/minted-extension) — form sensor: after a fill plan is computed (src/background/fill.ts planFill), render a coverage panel in the side panel: fields the portal form wants (from the field maps) vs fields we can supply (profile tokens with values), the gap list with per-field reasons from the profile's unresolved array, and a count line ("20 of 50 fields available"). Read-only; no new API surface needed — both inputs already arrive in the existing profile + field-maps responses. Bar: tsc + lint green per PR. Titles: "chore: rename to Minted Panel Workbench" / "feat(sensor): fill coverage and data-gap panel".

### P8 — Epic 3: "what's my reference number / latest note" (two repos, panel first)

> Two PRs, panel first — the API is consumer-pulled and the Workbench is the consumer. PR 1 (sonny303/mintedpanel): add GET /api/cases/:id/context returning { referenceNumbers, latestNote, latestTouch } for one org-owned case — reuse the guard + envelope patterns from src/server/extensionRoutes (thread a service ctx, never a second query copy; cross-org case id → 404; PHI-minimal projection — never the full touch history). Add gate assertions (cross-org 404) in scripts/verify-org-isolation.mjs + mock coverage in scripts/mock-api-server.mjs, and handler/di tests. PR 2 (sonny303/minted-extension): after case selection, fetch and render the context block (reference number, latest note) in the side panel. Bar: PR 1 — tsc, lint, vitest, node scripts/verify-isolation-local.mjs green; PR 2 — tsc + lint green. Titles: "feat(api): case context endpoint for the Workbench" / "feat(panel): show case reference and latest note".

### P9 — Epic 4: Gmail hand-off v1 (deep-link, human-in-loop)

> In sonny303/minted-extension, read the README and docs/minted-panel-roadmap.md (mintedpanel repo) Epic 4. Depends on the panel's draft-email steps existing (P3/P5 PR 1). ASSUMPTION: v1 is a Gmail compose deep-link, no Gmail API/OAuth. From a draft_email step surfaced in the Workbench: open https://mail.google.com/mail/?view=cm with su (subject) and body prefilled from the resolved template (URL-encode; if the body exceeds a safe URL length ~1500 chars, fall back to opening compose with subject only and copying the body to the clipboard with a toast telling the user to paste). Any attachment/PDF is downloaded locally via chrome.downloads — never attached automatically; the human sends. Log a fill-event-style record only if the panel adds an endpoint for it — otherwise no tracking in v1 (tracking is an open roadmap question). Bar: tsc + lint green. PR: "feat(mail): Gmail compose hand-off for draft-email steps".

### P10 — Epic 5: roster export + PDF form filler (two PRs)

> In sonny303/mintedpanel, read AGENTS.md, CLAUDE.md, and docs/minted-panel-roadmap.md Epic 5. PR 1 — roster export: an "Export roster" action on the providers work view and launch detail generating a CSV client-side (providers + facilities + case statuses for the current filter; reuse the existing caches — no new queries; PHI-minimal: no ssn_last4/DOB/home address). Pure row-builder in src/lib/rosterExport.ts with tests. PR 2 — PDF filler groundwork: ASSUMPTION pdf-lib, client-side. A "Generate PDF" action on a pdf-type SOP step (depends on P3) taking an uploaded fillable PDF (AcroForm), mapping form field names to catalog tokens via the same normalizeFieldLabel/field_dictionary machinery the portal mapper uses, filling from the provider profile data the page already has, and downloading locally (human in the loop — never auto-sent). Pure mapping logic in src/lib/pdfFill.ts with tests; the pdf-lib dependency must not enter the server bundle. Bar per PR: tsc, lint, vitest green. Titles: "feat(export): provider roster CSV" / "feat(pdf): local PDF form filler for pdf steps".

### P11 — Epic 6 finale: statuses to code (run LAST, after P0-f)

> In sonny303/mintedpanel, read AGENTS.md, CLAUDE.md, and docs/minted-panel-roadmap.md Epic 6 + open question 3. Depends on P0-f (label constants centralized). ASSUMPTION: option (b) — ship a code-owned canonical status set with a label-compat shim; do NOT force-relabel existing org rows. Define the canonical per-track status sets in src/lib/canonicalStatuses.ts (labels, buckets, sort orders, colors — copy the currently-seeded set from the live DB via Supabase MCP as the canonical truth). New-org seeding (from P6 PR 1, if merged) reads from it. Admin > Statuses becomes read-mostly: reordering and recoloring stay, add/delete and label editing are removed (grep for who mutates status_configs first and confirm nothing else depends on label edits). The by-label matching now goes through the P0-f constants against canonical labels, with a compat map for any live org labels that differ (query the live DB for the actual distinct labels per track first — do not guess). Bar: tsc, lint, vitest green; verify the Home action engine and launch sections still classify correctly by rendering with the mocked-Supabase Playwright harness. PR: "feat(statuses): code-owned canonical status sets with label compat".
