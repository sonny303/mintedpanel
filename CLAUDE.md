# CLAUDE.md — Minted Panel

Current-state orientation for AI coding sessions. **`AGENTS.md` holds the
binding rules** (protected files, data rules, style, anti-patterns) — read it
first. `ARCHITECTURE.md` and `SCHEMA.md` are the deeper references;
`docs/VERIFY.md` is what to run before you push.

This file describes the system **as it is now**. Build history lives in
`docs/redesign/` (one doc per epic) and in git — don't reconstruct it here.

## What this is

Credentialing-operations SaaS for medical groups. Credentialing is the process
of getting a provider approved to bill an insurance payer; it is slow, per-state,
per-payer, and drowning in paperwork. Minted Panel tracks that work end to end:
providers, groups, facilities, payers, credentialing cases, SOP-driven task
checklists, follow-up touches, contracts, and document/credential expiry — plus
a Chrome extension (`sonny303/minted-extension`) that autofills payer portal
forms from the same data.

Users are credentialing coordinators at or on behalf of medical groups.
Multi-tenant throughout (`org_id` + RLS, roles `admin` / `specialist` /
`billing`; billing is read-only).

**Status: pre-launch.** Hosted carries demo/UAT orgs, not real patient data.
The data rules below are still absolute — they are what makes going live safe.

## Stack

React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui, **TanStack Start**
(file-based routing on a nitro server, SSR-capable) + TanStack Query, Zustand
for auth/org state, Supabase (Postgres + GoTrue + Storage) for everything
server-side. `src/server.ts` and `src/start.ts` are a real server runtime — this
is not a plain Vite SPA.

Hosted Supabase project: `fkvuhfsqcmujywzgczmc` ("openpanel", us-east-2).
Deployed on Vercel at `https://mintedpanel.vercel.app`.

## How work arrives

The E0–E6 redesign program is **finished**. Work now arrives as user-feedback
waves, design handoffs, and bug fixes — not epics. Branch off `main`, PR targets
`main`, never self-merge.

`docs/redesign/` is historical reference (plus `BUILD-PROMPT.md` /
`README.md` if a genuinely new feature area ever warrants an epic again).
Cross-repo work with the extension happens with **both repos attached in one
session** — the wire contracts live in one context, not two sessions
coordinating through PR descriptions.

## Non-negotiables

1. **Additive schema only.** Columns and tables are deprecated in place
   (stop-write, frozen mirror), never dropped. Destructive migrations need
   explicit PM sign-off.
2. **The isolation gate is the wall.** `/api` runs on the service-role client,
   which bypasses RLS — `src/server/guard.ts` is the only tenant isolation
   there. Every new `/api` resource route adds assertions to
   `scripts/verify-org-isolation.mjs` before merge. A red gate is stop-ship.
3. **Never change a locked wire contract unilaterally.** Every `/api` shape has
   an extension consumer. Contract changes are panel-first, mirrored in the
   extension's `src/shared/apiTypes.ts` in the same coordinated change.
4. **PHI discipline.** Never `select('*')` in a list payload. PHI-dense
   responses set `Cache-Control: no-store` and are never logged. Full SSN lives
   only in the vault; `ssn_last4` is what every ordinary read returns.
5. **Verify the object, not the filename**, before assuming a migration is
   applied. See the `supabase-migrations` skill.
6. **Never call a SECURITY INVOKER RPC on `ctx.db`** — under the service key,
   RLS, `auth.uid()` and `user_role()` all break at once.

## Layering (enforced)

```
Component (src/routes/*, src/components/<module>/*)
  → hook (src/hooks/*, TanStack Query; keys in src/hooks/queryKeys.ts)
    → service (src/services/* — the ONLY Supabase callers)
      → src/integrations/supabase/externalClient.ts  (the ONLY valid client import)
```

- **Services** org-scope every query with `requireActiveOrg()` (`src/lib/audit.ts`),
  set `org_id` on inserts, write `audit_log` via `writeAudit` on mutations, and
  convert snake↔camel at the boundary with `camelizeRow`/`snakeizeRow`
  (`src/lib/case.ts`).
- **Hooks** — one file per domain, keys org-scoped via `queryKeys`, mutations
  invalidate by key **prefix** (`["facilities", orgId]` catches all variants).
- **Auth/org** — `src/lib/auth-store.ts` (Zustand, persisted `activeOrgId`);
  `useActiveOrgId()` / `useRole()` / `useCanWrite()` / `useIsAdmin()`
  (`src/lib/permissions.ts`). Switching org calls `queryClient.removeQueries()`.
- **Domain types** — `src/types/index.ts`, one interface per table, additive only.
- **Pure logic lives in `src/lib/*` with tests.** Derivations (readiness,
  rollups, generation buckets, ranking) are computed, never stored. If you find
  yourself adding a status/flag column for something derivable, don't.

**Gotcha:** `supabase.rpc` must be called bound. Extracting the method throws
`Cannot read properties of undefined (reading 'rest')` at call time. Use
`supabase.rpc.bind(supabase)`.

## Data access: two paths, deliberately

The **bulk of data access is browser → Supabase PostgREST under RLS.** A slice
runs as `/api/*` routes on the nitro server behind `guard.ts` using the
service-role client, consumed by the **Chrome extension**.

**No frontend hook calls `/api`** — with one sanctioned exception, now covering
two file surfaces: the browser documents and payer-forms services call their
`/api/*` signing endpoints, because a signed Storage URL cannot be minted
client-side. Metadata reads (and the payer-form soft retire) stay on RLS.

Routes get built only when a real consumer pulls them. Don't migrate existing
screens to `/api`.

### Locked decisions

1. Three products, one backend — API core, Chrome extension, future workflow
   UI. The current app UI stays on direct Supabase + RLS.
2. Consumer-pulled API surface.
3. Dual data paths are accepted: current UI guarded by RLS, `/api` guarded by
   `guard.ts` + the gate.
4. Server misconfig returns **500, never 401**.
5. Portal field maps are a **shared catalog** — `org_id NULL` = global,
   org rows = overrides.
6. **The extension never submits portal forms.** The human submits; the
   extension logs. No implicit status change from the extension.
7. Case selection is required before a fill (the sandbox test-provider path is
   the one exception — it attaches to no case by construction).
8. Profile endpoint reads are audited: one `READ` audit row per read, never the
   body.

## Server API layer (`src/server/*`)

`src/server.ts` intercepts the whole **`/api` prefix** and delegates to
`src/server/api.ts` before SSR — this TanStack Start version ships no
file-based server routes. Unknown `/api/*` is a JSON 404, not SSR. Keep the
`src/server.ts` check and `isApiRequest` in sync.

**Envelope:** every response is `{ data, error, meta }` via `ok()` / `fail()`.
List meta carries `{ total, page, pageSize }`; `meta.notes` carries non-fatal
resolution notes.

**Guard:** `authenticate()` verifies the JWT, resolves membership
(`x-org-id` header or `?orgId` — **required** for multi-org callers; omitting
it is a loud 400, never a guess), and returns a ctx scoped to that org with a
`writeAudit` closure. `isWriter(ctx)` = admin|specialist. `authenticateUser()`
is the JWT-only step, used by routes that carry no org.

**Service reuse via DI:** services take an optional ctx defaulting to
`browserCtx()` (anon client + `requireActiveOrg()`). Server routes inject a
service-role ctx. **Never duplicate a query between layers** — thread a ctx.

**Server-only:** `src/server/serviceClient.ts` and its graph. Vite's
`**/server/**` import protection blocks browser bundles. `api.ts` lazy-imports
route modules so `/api/health` stays free of the Supabase graph.

**CORS:** env allowlist `API_CORS_ORIGINS` (exact origins; must include
`chrome-extension://<id>`). Default empty = no CORS headers. Allowed headers:
`authorization, content-type, x-org-id`.

### The routes

Org-scoped (full `authenticate()`):

| Route                                                                                                        | Notes                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                                                                                            | public                                                                                                                                                                                                |
| `GET/POST /api/providers`, `GET/PATCH /api/providers/:id`                                                    | list uses `PROVIDER_LIST_COLUMNS`; **excludes `terminated` by default** (`excludeStatus`, overridable via `?status=`); list sets `withGroups: true` → `groups[]` (current memberships, primary first) |
| `GET /api/providers/:id/profile?state=&facilityId=`                                                          | the fill payload — most PHI-dense response in the system. `no-store`, never logged, one `READ` audit row per read                                                                                     |
| `GET /api/providers/:id/ssn-release?caseId=`                                                                 | fill-only full-SSN release, writer-only, audited                                                                                                                                                      |
| `POST /api/providers/:id/caqh-attestation`                                                                   | future date = 422; narrow response, never the PHI row                                                                                                                                                 |
| `GET /api/cases?providerId=` or `?q=`                                                                        | open cases for the popup, or org-scoped case search (ids + display fields only; blank `q` → `[]`)                                                                                                     |
| `POST /api/cases/:id/touches`                                                                                | the business log — see below                                                                                                                                                                          |
| `GET /api/cases/:id/context`                                                                                 | panel context; `no-store` + one `READ` audit row                                                                                                                                                      |
| `GET /api/next-best-action`                                                                                  | queue top/ranked list via the **same pure reducer** as the browser queue                                                                                                                              |
| `GET /api/portals`, `GET/POST /api/portal-field-maps`                                                        | registry + shared catalog; POST is **propose-only**                                                                                                                                                   |
| `PATCH /api/tasks/:id/steps`                                                                                 | the one task-state write                                                                                                                                                                              |
| `POST /api/fill-events`                                                                                      | client-generated `id` is idempotency key **and** row PK                                                                                                                                               |
| `POST /api/documents/upload-intent`, `POST /api/documents/finalize`, `GET /api/documents/:id/download`       | the Storage signing boundary; cross-org id 404s **before** signing or inserting                                                                                                                       |
| `POST /api/payer-forms/upload-intent`, `POST /api/payer-forms/finalize`, `GET /api/payer-forms/:id/download` | the same signing boundary for GLOBAL payer forms. Writes are **admin-only**; reads are open to any member — the rows carry no `org_id`, so the wall is role, not tenancy                              |

User-scoped (`authenticateUser()`, no org resolution):

| Route                                                                                                                         | Why no org                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /api/me/orgs`                                                                                                            | it's how a multi-org caller learns what `x-org-id` to send                                        |
| `GET/PUT /api/me/view-prefs`                                                                                                  | quick-card layout follows the user across orgs                                                    |
| `GET/POST /api/shared-field-maps`, `GET /api/shared-portals`, `POST /api/shared-portals/prove`, `POST /api/shared-test-fills` | the shared training tier belongs to **no org**; global rows only, so there is nothing to widen to |

### Contracts worth knowing before you touch them

- **Token keys are BARE** (`provider.firstName`), not braced. The **server**
  normalizes braced forms at its read boundary (`src/lib/tokenFormat.ts`
  `normalizeTokenKey`), so the field-map → profile-token join is a literal
  string match. The extension never strips braces. Pinned by
  `src/server/profileFieldMapJoin.test.ts`.
- **Touches body is snake_case** (locked); fill-events is camelCase. Do not
  "fix" either.
- **`bump_status: true` on a touch does not perform a transition.** A DB
  trigger fires on the touch and moves the case; the route only reads back and
  reports what the trigger did, via `meta.status_bump`. Calling
  `set_case_status` here can never succeed — the trigger already moved it, and
  the RPC rejects a same-state transition.
- **Profile facility selection never guesses.** `?facilityId` must be in the
  provider's set (else 404); sole facility auto-selects; several with no param
  → facility/assignment tokens come back null with `meta.needs_facility`.
- **Quick-card catalog is schema-derived**, not a hand list — `get_sop_field_tokens()`
  plus two exclusion rules in `src/lib/quickCardCatalog.ts`. Its drift test
  reconstructs the RPC output from `types.ts` and diffs against a pinned
  snapshot, so a new column fails the suite **by name** until classified.
  **Do not delete that test to make a build pass.**
- **`{{user.*}}` resolves from the caller's own `profiles` row** (scoped by
  `ctx.userId`), falling back to auth metadata then the JWT email claim. Five
  keys: `name` (the composite — there is deliberately no `user.fullName`
  synonym), `firstName`, `lastName`, `title`, `email`. Keep
  `quickCardCatalog.ts` `USER_TOKEN_FIELDS`, `services/tokenCatalog.ts`
  `USER_TOKENS`, and `resolveUserTokens` **in lockstep** — a key offered but
  not resolved maps a payer field to a permanent blank.

## Database

`supabase/migrations/` = squashed baseline + post-baseline migrations. **The
live DB is the source of truth.** Full workflow, verification recipes, and the
incident-derived rules are in the **`supabase-migrations` skill** — read it
before any schema work.

**Repo-only migrations awaiting an operator apply** (a starting hint only —
**always verify the object on hosted**, never trust this list. As of
2026-08-25, object-verified applied and dropped from this list:
`20260824170000_payer_forms.sql`, `20260812130000_payer_contacts_select_opa_retire.sql`,
`20260812140000_sop_template_multi_state.sql`, `20260813120000_e610_control_options.sql`,
`20260814180000_author_global_sop_returns_jsonb.sql`,
`20260825120000_e611_pdf_field_maps.sql`):

- `20260810120000_purge_unreferenced_catalog_payers.sql` — **needs a second PM
  sign-off. Never agent-apply.**
- `20260809120000_slice6_create_payer_assign_flag.sql.superseded` — retired,
  never applied. Do not resurrect.

Because some are unapplied, a `types.ts` regen may **delete** types for columns
the repo just added. Check before regenerating.

### Key RPCs

All are repo migrations unless noted.

- **`create_case_with_tasks(p_input jsonb, p_tasks jsonb)`** — transactional
  case + initial status history + tasks + audit rows. Threads
  `generation_run_id` and per-task `sop_template_id` / `sop_version` /
  `execution_type` / `sop_resolution_tier`. **Not replay-idempotent** — batch
  safety is per-row transactionality + skip-on-23505.
- **`set_case_status(...)`** — the ONE case-status transition path. Evidence
  rules, admin corrections, optimistic concurrency, append-only history with
  `reason_code_id`. At Approved, each **expected** payer ID must be supplied or
  explicitly acked missing. Exactly one overload; never add a defaulted arg.
- **`create_organization(...)`** — SECURITY DEFINER bootstrap (the org's first
  member can't satisfy RLS). Inserts org + admin membership + the 22 canonical
  `status_configs` + audit row. Sales rep is **optional** — omitting it creates
  no party.
- **`create_payer` / `update_payer` / `archive_payer` / `reactivate_payer` /
  `merge_payer`** — the ONLY payers write path. The table itself is
  INSERT/UPDATE-locked for org roles.
- **`author_global_sop`**, **`publish_sop_template_version`**,
  **`upsert_global_portal`**, **`train_global_field_map`**,
  **`propose_shared_field_map`**, **`update_shared_field_registry`** — the
  global/shared authoring tier.
- **`commit_import_run(p_run_id, p_plan jsonb)`** — transactional staged import
  commit. The RPC owns its audit rows; the service must not also `writeAudit`.
- **`stage_import_rows`** — batched staging, `ON CONFLICT DO NOTHING` +
  recomputed counts in one round trip.
- **`store_ssn` / `reveal_ssn` / `release_ssn_for_fill`** — the vault. No client
  table grant exists; the RPCs are the only access.
- **`get_sop_field_tokens()`** — the token **catalog** (which fields exist and
  where), not values. **Not curated** — it reads `information_schema.columns`
  over nine tables, so any new column on a card-eligible table becomes a token
  automatically.
- `claim_invites()`, `set_default_party_role`, `set_primary_assignment`,
  `archive_org_payer_assignment`, `advance_payer_pipeline` (dormant).

## Domain model

```
organizations
├── memberships (user + role)
├── parties + party_role_assignments   — people/contacts, org-scoped
├── provider_groups                    — the billing entity (TIN, Type 2 NPI)
│   ├── facilities                     — a.k.a. locations; go-live = effective_date
│   ├── group_insurance_policies       — malpractice; one primary per type
│   └── provider_group_assignments     — M:N, exactly one primary per provider
├── providers                          — PHI-minimized (ssn_last4 only)
│   ├── state_licenses (+ PSV trail)
│   ├── provider_facility_assignments  — one primary per provider
│   ├── provider_documents             — immutable versions; "current" is derived
│   └── enrollment_facts               — live = expired_at IS NULL
├── payers (GLOBAL catalog) + payer_contacts + payer_network_targets
├── payer_forms                        — GLOBAL blank payer PDFs, per SOP template
├── credential_cases → case_facilities, tasks → touches
└── contracts, status_configs, audit_log
```

### Grains you must not get wrong

- **The case key is 4-part:** `UNIQUE NULLS NOT DISTINCT (provider_id,
group_id, payer_id, state)` on `credential_cases`. Legacy NULL-group rows
  keep the 3-part behavior because NULL = NULL under that clause.
- **A case can hold several locations.** `case_facilities` (case × facility,
  `UNIQUE (case_id, facility_id)`, at most one `is_primary = true` per case
  via a partial unique index) is the full set. `credential_cases.facility_id`
  is unchanged in shape and is now a PRIMARY MIRROR of whichever row is
  primary — every existing reader keeps working untouched.
  `resolveCaseFacilityId` (creation-time stamp) still stamps exactly one
  location; everything past that is additive via `src/services/cases.ts`'s
  `addCaseFacility`/`removeCaseFacility`/`setPrimaryCaseFacility`, which keep
  the mirror in lockstep in the same call as the child-row write. Eligibility
  is the same rule as `setCaseFacility` (provider must be assigned to the
  facility under the case's group), enforced app-side, not by RLS.
  **UI:** the case Details card's old single-value Facility row
  (`CaseFacilityField`, retired) is now `CaseLocationsSection` — every
  location listed, primary badged (`StatusPill`), Add/Remove/Make-primary for
  a writer, billing stays read-only. Hooks: `useCaseFacilities` (query) +
  `useAddCaseFacility`/`useRemoveCaseFacility`/`useSetPrimaryCaseFacility`
  (`src/hooks/useCases.ts`), keyed by `queryKeys.caseFacilities` and
  invalidated alongside `cases`/`case` so the list and the `facility_id`
  mirror refresh together. `setCaseFacility`/`useSetCaseFacility` (the old
  single-value overwrite) are untouched and kept — `resolveCaseFacilityId` at
  `/generation` still stamps through `create_case_with_tasks`' `facilityId`
  input, not through this function, so as of this UI swap neither has a
  caller; left in place rather than removed, since case creation is out of
  scope for the multi-location work.
- **`payer_network_targets`** = group × payer × state — "this group works with
  this payer here." Distinct from the (now largely vestigial)
  `org_payer_assignments` subscription layer.
- **"In my network" = ≥1 active `payer_network_targets` row**, not an
  assignment row. `listPayers`/`usePayers()` now means **the whole global
  catalog** — every global payer is readable.
- **`enrollment_facts`** = provider × group × payer × state. Expiry is a flip
  (`expired_at`), which re-opens the candidate.
- **Documents:** "current version" is the family row with no successor —
  **derived, never a flag.** Replacement is a new INSERT; there is no update or
  delete grant.

### Frozen mirrors and deprecated columns (read, never write)

| Column / table                                                                | State                                                                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `providers.group_id`                                                          | frozen mirror of the primary group assignment — no new readers                |
| `sop_templates.state`                                                         | frozen mirror of `states[0]`; resolution goes through `templateStates()`      |
| `profiles.full_name`                                                          | frozen mirror composed from first/last on save                                |
| `credential_cases.credentialing_status_id`, `payer_pipeline_state`            | read-only dual-write mirrors of `case_status`                                 |
| `payers.payer_slug`, `last_synced_at`, `avg_decision_days`, `resolution_id_*` | deprecated in place — no writer                                               |
| `launches` table, `providers.launch_id`                                       | legacy; nothing reads or writes them                                          |
| `notes` table                                                                 | dormant for case/task (moved to `touches`); **still live for provider notes** |
| `msos`, `mso_routing_rules`                                                   | dormant — routing engine deleted app-side                                     |
| `org_payer_settings`, `next_best_action_configs`, `payer_catalog_changes`     | dormant                                                                       |
| `org_payer_assignments.starter`                                               | dormant                                                                       |

## Cross-cutting subsystems

### Case status

One canonical, **code-owned** 8-status set in `src/lib/caseStatus.ts` (list,
spine edges, evidence-bump rules, legacy mapping). Every transition goes
through `set_case_status` or the auto-transition triggers.
`src/lib/caseRollups.ts` is the derived layer above it — fulfillment,
per-provider progress, denial rows. Render them; never set them.

### Statuses (`status_configs`)

Per-org rows, `track ∈ {credentialing, contracting, location}`, with an
`action_bucket` (`ours | waiting_payer | waiting_provider | complete`).
The canonical 22 rows are code-owned in `src/lib/canonicalStatuses.ts`, which
**mirrors the `create_organization` SQL seed by hand — keep the two in sync.**

**Semantics are matched by LABEL, not id.** Every label constant lives in
`src/lib/statusLabels.ts` — import from there, never re-hardcode a literal (a
one-char drift silently breaks matching everywhere). Matchers route labels
through `canonicalLabel()`, which applies `STATUS_LABEL_COMPAT` — currently
empty, and the single edit point if a divergent org ever appears.

### SOP templates and resolution

Templates are authored org-level (Payer Setup → Templates) with a versioned,
immutable history; publishing goes through `publish_sop_template_version`
(admin-only for org rows, optimistic concurrency).

**`src/lib/pickTemplate.ts` is an explicit tier ranking**, not `Array.find` —
org exact-group → org any-group → global-payer exact-group → global-payer
any-group → generic fallback → null, with a deterministic within-tier tiebreak.
A template authored for a _different_ group never resolves. Array order is not
load-bearing.

A template targets a **set of states** (`states text[]`); `'All'` is a
one-element **sentinel that is never expanded to 50 codes** — expanding it
would make it rank as an exact-state match and silently outrank genuinely
targeted templates. Overlap (no two active templates for the same org/payer/group
sharing a state) is enforced by a BEFORE trigger holding a transaction-scoped
advisory lock, not by a unique index.

Every SOP-resolving creation surface **stamps** its tasks with
`(sop_template_id, sop_version, sop_resolution_tier)` via `src/lib/sopStamp.ts`
— the head-row snapshot the resolver consumed, never a re-read that could race
a publish. Missing/invalid version → NULL/NULL, never a guessed version.

`src/lib/sopResolver.ts` resolves tokens against a closed catalog. Contact-family
tokens (`billingContact.*` etc.) are deliberately **absent** from `buildTokenMap`
— a token in a SOP body is baked into `tasks.sop_content` at case creation and
would go stale.

### Case generation — the ONE door

`/generation` is the only case-creation path (plus `ManualCaseModal` on
`/cases` as an escape hatch). Starter cases and launch-driven creation are
retired; `src/lib/oneDoor.test.ts` greps the source tree to keep it that way.

Candidates = active `payer_network_targets` × group roster, filtered to
providers with a facility assignment **and a footprint in the target state**.
Buckets (candidate / enrolled / existing / excluded) are pure
(`src/lib/generationGrid.ts`), and the confirm bar states a sum invariant —
every candidate is accounted for.

Confirm writes an immutable per-candidate disposition ledger
(`case_generation_run_rows`, INSERT-only by policy **and** grant). Run counts
**derive from those child rows at read time**; the stored plan counts are a
flagged fallback. Exclusions are reasoned and voided-not-deleted.

### Touchlog

`touches` is the single case-activity spine: `entry_type ∈ {touchpoint, note,
system_event, task_update}`, append-only. **Corrections are appends, never
edits.** Only touchpoints carry `touch_type`/`outcome`; seven canonical touch
types. `src/lib/touchOutcomes.ts` is the channel→outcome source of truth.

Follow-up cadence uses a **carry-forward reducer** (`src/lib/followUps.ts`):
latest-first, a date-less touch carries the prior follow-up forward, and only
`clears_follow_up` ends it.

### Readiness, queue, and reporting — all derived

`src/lib/enrollmentReadiness.ts` (advisory only — never gates anything, never
creates tasks), `src/lib/nextBestActions.ts` (fixed shipped ranking; the config
seam was removed), `src/lib/providerGaps.ts`, `src/lib/reports.ts` (grouped
index — adding a report is one registry entry + one route).

All date math is date-only against a passed-in `today` — **never a clock read
inside a pure lib.**

The readiness service reads DOB / ssn_last4 / home-address columns **only to
reduce them to presence booleans in the service** — values never enter the
cache or render.

### Documents

`src/lib/documents.ts` owns the kind metadata map (labels, owner grains,
expiration requirements, expiring-soon thresholds) — a policy change is one
edit there. Private Storage bucket with a path contract
`org/{orgId}/{provider|group}/{ownerId}/{familyId}/{version}/{file}`; policies
validate the path's org. Member read / writer insert / **no update or delete.**

A SOP step's `requiredArtifacts` can hold pointers to vault documents
(`SOPStep.attachments`). There is exactly **one** document, it lives in the
provider or group vault, and a step only ever holds a pointer — never a copy.
Attach appends (a second file under one artifact name sits alongside the
first); detach unlinks only. Replace is ordered **attach-new then detach-old**,
so a half-completed swap leaves both versions visible rather than a step
pointing at nothing.

### Payer PDF

Payer-specific blank forms (e.g. "PT Credentialing Supplement") attached to a
SOP template in the Template Editor's **Actions** step, auto-attached to cases
at generation.

- **`payer_forms` is a GLOBAL table** (no `org_id`) with its own private
  `payer-forms` bucket. Not the `provider_documents` vault: that is org-scoped
  and provider/group-owned, and a payer's blank form is neither.
- **Two grains.** A template action points at a form **family**; a generated
  case task points at a concrete **row**, baked at generation. Replacing a file
  therefore reaches newly generated cases with no republish, while a case
  already created keeps the file it was generated with. "Current" is derived
  (highest live version), never a flag. Rules in `src/lib/payerForms.ts`.
- **Stored as `stepType: "pdf"` + a `payerForm` pointer**, reusing a value
  already in `SOPStepType`. That is deliberate: no `/api` wire contract widens,
  so the extension needs no coordinated change, and `projectTaskSteps`
  whitelists its keys so `payerForm` never reaches the extension at all. A
  legacy `pdf` step carrying NO pointer is an ordinary step and round-trips
  untouched — **the pointer's presence, not the step type, is what makes an
  action a Payer PDF action.**
- **Payer and states are read-only context from the template**, never tagged per
  form. A form that applies to only some of a multi-state template's states
  belongs on its own single-state template.
- **Attached at `/generation` only.** `ManualCaseModal` and Reapply attach SOP
  tasks as before. An action whose family has no live form is DROPPED rather
  than generated empty, and `hydratePayerFormTasks` must therefore run AFTER
  both stamps — they pair tasks with definitions by index.
- **Removal is per case and permanent by construction**: the task is marked
  `blocked` and a `removedAt` marker is appended to its own `sop_content`;
  `CaseTasksPanel` filters marked tasks out before anything derives from the
  list. Nothing re-adds it — a case is generated once.
- **Mark sent** completes the action and writes a touch, in that order (the
  evidence outlives a failed status write). It never bumps the case status.
- **Writes are admin-only, and the wall is ROLE, not tenancy** — one org's admin
  changes what every org sees. Gate assertions 28/28b/28c/29 pin that, including
  29's _positive_ assertion that a cross-org read succeeds, so a future change
  narrowing global reads fails loudly instead of silently breaking other orgs.

### Payer governance

Orgs **select** canonical payer identities; they never create or rename them
directly. `payers` is member-SELECT-only — every write goes through the RPCs.
`src/lib/payerGovernance.test.ts` enforces this at the source level, including a
**final-state policy sweep**: it resolves the last definition of every policy
across all migrations and fails if any policy on another table still gates
through `org_payer_assignments`. Don't weaken it.

### Field registry (payer form training)

`src/lib/fieldRegistry.ts` `classifyFieldMap` is **exhaustive over
(status, source) and fails closed.** Order matters: retired → stale, explicit
stale → stale, **`proposed` → undecided before any source check** (capture's
canonical shape is `proposed + manual`), then approved × token / manual_partial
/ hardcoded / manual.

Only `approved` maps fill. A proposed row is an unreviewed observation.
Stale rows keep their controls — staleness is information, not a lock.
Re-capture is drift **repair**, not a reset: it refreshes presentation columns
and leaves decisions untouched.

## Known warts — don't rediscover these

- `PROVIDER_LIST_COLUMNS` is a **partial projection**; list rows are typed
  `Provider` but omit unlisted columns. `getProvider` selects `*`.
- `provider_facility_assignments.practice_frequency` is never written.
- `beforeLoad` role guards read the Zustand store, which is **empty during a
  hard-load `beforeLoad`** (init runs after route load) — they only guard
  client-side navigation. Guarded routes need a render-time `useRole()` backstop.
- MSO routing matching was exact and case-sensitive; the engine is deleted
  app-side and the tables are dormant.
- `supabase/seed.sql` pre-resolved `tasks` rows carry `sop_content` in a legacy
  shape (not what `SOPStep` expects) — cosmetic on local rebuild.
- `Touch.source` includes `"email"` in TS, but the live
  `touches_source_check` constraint does **not**. No current path writes it —
  an inbound-email writer must ship a constraint migration **before** inserting.
- The Pre-Credentialing sentinel payer workflow code is intact but unreachable
  (no creatable payer carries the name).
- The extension's picker is driven from the served `catalog`;
  `src/shared/quickCards.ts` holds only the default layout and projection
  helpers, not a field-list mirror. (An older note here claimed otherwise —
  it was stale.)

## UI conventions

- **Create/edit modals:** mount-when-editing (`{modal ? <Modal/> : null}` with
  `<Dialog open onOpenChange={(o) => !o && onClose()}>`), nullable entity prop
  switches create/edit, `"__none__"` sentinel for empty selects.
- **Dates:** `fmtDate` / `fmtDateTime` (`src/lib/format.ts`) → "MMM d, yyyy"
  everywhere. No month-only display.
- **Toasts:** `import { toast } from "sonner"`; `Toaster` mounted once in
  `__root.tsx`.
- **Status pills:** never hand-roll. `statusToneClasses`
  (`src/components/StatusPill.tsx`) is the shared tone map; the triage pill maps
  a DB hex through `hexToStatusColor`. Neutral _tag_ chips are the exception.
- **`+ Add` is the one add affordance** (`AddButton` in
  `src/components/providers/RecordSectionCard.tsx`).
- Design tokens `var(--mp-*)`; `src/styles/tokens.css` is a byte-identical
  drop-in from the design-system bundle and is prettier-ignored to keep parity.
  **Never edit `docs/redesign/design-system/`.**
- Unspecced components must be stock shadcn, token-styled, and logged in
  `DESIGN-DEBT.md`.
- **Public (no-session) routes:** `/`, `/login`, `/dev*`, `/privacy`, plus the
  chromeless token routes (`/capture/$token`, `/share/$token`,
  `/ssn-intake/$token`, `/contact`). The list lives in `__root.tsx`.
  `/privacy` is the Chrome Web Store policy URL — it mirrors
  `docs/privacy-policy.md` and is a business document; don't reword it.
- **`TemplateTaskRow` is `React.memo` and every handler passed to it is a
  `useCallback`.** Keep both, or typing in any Step 3 field re-renders every
  task card (measured ~270ms per keystroke vs ~50ms). Pinned by a latency e2e.

## Running and verifying

`npm run dev` / `build` / `lint` / `test` (vitest) / `format` /
`test:e2e` (playwright). `npx tsc --noEmit` is the type gate — `vite build`
does **not** typecheck.

**Read `docs/VERIFY.md`** for the bootstrap one-liner, the verification tier
table (what to run for a given diff), measured costs, and the route→spec map.

**Cloud sandboxes block egress to `*.supabase.co`.** Database work goes through
the Supabase MCP tools; browser verification goes through the Playwright mock
harness — see the **`e2e-harness`** skill.

## Skills reference

- **`supabase-migrations`** — schema/migration workflow and verification; read
  before any schema work.
- **`api-isolation-gate`** — `/api` org-isolation gate coverage and
  verification; read before adding a resource route.
- **`e2e-harness`** — Playwright + Supabase-mock harness for browser
  verification in cloud sandboxes.
- **`adhd`** — ADHD-friendly response shaping (next action first, numbered
  steps, concrete estimates, visible wins).
- **`minted-m3-audit`** — Lean 3M (Muda/Mura/Muri) health-check audit of a
  live feature plus coordinator workflow efficiency.
- **`chrome-devtools-minted`** — DevTools recipes for panel/extension
  debugging.
- **`chrome-extension-minted`** — MV3 architecture notes and common bugs for
  the extension repo.

## Shared state ownership (parallel lanes)

1. `portal_field_maps` rows change via Supabase MCP only, never in code
   sessions — code and DB `url_pattern` change together, one actor, same day.
2. **CLAUDE.md is edited by at most one lane per day** — the last to close.
3. Gate expected-count env values are owned by whichever lane changes demo-org
   data, in the same PR.

## Keep this file honest

At the end of a session that changes this repo, before the final push:

1. Update anything the session made stale — new tables/columns/RPCs (and
   repo-vs-hosted drift), new services/hooks/routes, moved responsibilities,
   new gotchas found while debugging, retired code paths.
2. Keep `SCHEMA.md` in step with applied migrations; regenerate `types.ts`
   after DDL (mind the unapplied-migration trap above).
3. **Write current state, not history.** Describe what is true now; the epic
   narrative belongs in `docs/redesign/` and git. If a section reads like a
   changelog entry, rewrite it as a fact.
4. Don't duplicate `AGENTS.md` rules — change them there.
5. If nothing changed structurally, leave the file alone.
