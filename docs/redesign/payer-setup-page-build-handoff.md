---
title: Payer Setup page redesign — design review + Claude Code build handoff
status: review-complete, PM decisions pending
owner: devin
design-reference: ./design-reference/payer-setup/
reviewed-against: E6.5-payer-setup-consolidation.md, E6.1-sidebar-surface-restructure.md, main @ 1b1f047
---

# Payer Setup page — review of "Payer Setup - Improved" and build handoff

The PM-supplied bundle (`design-reference/payer-setup/`: the `.dc.html` prototype,
its `support.js` runtime, and the design README) is a **high-fidelity redesign of
`/admin/payer-admin`**: the tab pair becomes **My network / Catalog**, KPI cards
become filter toggles, and both tables paginate.

This document is the review of that bundle against the code on `main` and the
approved E6.5 epic, plus the build-ready spec for the Claude Code session. It does
not change any product code.

Read order for the build session: this file → the design README → the prototype.
Where this file and the design README disagree, **this file wins** (it is the one
reconciled against the database and the live routes); where the design README and
the prototype disagree, the README wins (see §2).

---

## 1. Decisions the PM must make before the build starts

Each of these is a place where the design, as written, cannot be implemented
as-is — not a preference.

### B1 — "My network" makes the module org-scoped, which E6.5 forbids

Membership lives in `org_payer_assignments` (org-scoped, RLS). E6.5 F6.5.1's
acceptance criteria say **"No org data anywhere in the module"**, and E6.1 puts
Payer Setup in the sidebar's cross-org **Workspace** zone
(`src/components/layout/Sidebar.tsx`), above the org switcher.

The design is the better operating model — "which payers do we work with" is an
org question — but it changes the module's zone contract.

**Recommendation:** accept the design; amend E6.5 F6.5.1's AC to "no org data on
the Catalog tab; My network is explicitly org-scoped"; add a **no-active-org**
state on the My network tab (mirror the sidebar's "select an organization"
prompt) since the page is reachable with no org selected. Catalog stays
org-independent apart from the membership column.

### B2 — Dropping the SOPs tab orphans five live redirects and the template library

These all currently redirect to `/admin/payer-admin/sops`:
`/admin/portals`, `/admin/templates`, `/admin/sops`, `/fix-it`,
`/portals/$portalKey/train`, `/admin/payer-admin/forms/$payerId`, plus the legacy
`?tab=templates|forms|needs-attention` mapper in
`src/routes/admin.payer-admin.index.tsx`. `e2e/legacy-routes.spec.ts` asserts
them. The template library itself (`TemplatesList` + the `+ New Template` wizard
entry) has no other home, and the design's default-template card links "to the
editor" — an editor whose list page would no longer exist.

**Recommendation:** *keep the route, drop the tab.* Rename the segment
`/admin/payer-admin/sops` → `/admin/payer-admin/templates` (terminology
divergence 2), keep it rendering `TemplatesList`, point every legacy redirect and
the default-template card at it, and simply do not list it in the segmented
control. Nothing user-facing advertises it; nothing dead-ends.

### B3 — Drift loses its landing surface while the sidebar still points here

The sidebar Payer Setup entry carries a count chip labelled *"N broken form
mappings"*, and E6.5 F6.5.4's AC requires the badge **and** a route into the
owning step. The design deliberately removes the drift banner and the per-row
next step, leaving only the **Drift detected** KPI card.

Verified: Payer Detail (`src/components/payers/PayerDetailContent.tsx`) lists the
payer's templates (linking `/admin/templates/$id`, where the form step queues
broken mappings) and its portals with a verification pill — but it shows **no
drift signal at all**. So after this page ships, the only thing that says "this
payer's mappings are broken" is the KPI card; from the row onward the user is
navigating blind.

**Recommendation:** make the sidebar chip deep-link to
`/admin/payer-admin/network?filter=drift` (the KPI filter becomes the landing),
and add a drift indicator to Payer Detail as a small follow-up PR (out of this
page's scope, but a go-live gate — see §7).

### B4 — The default template cannot be edited (answers README open question 1)

The generic fallback SOP is a **seeded, locked singleton**
(`00000000-0000-4000-a000-00000000e17b`). Both `author_global_sop` and
`publish_sop_template_version` raise `fallback_sop_locked` for `authenticated`
JWTs (migration `20260719170000_e65_global_authoring.sql`); only service-role /
direct SQL can touch it. So: it is seeded, it is singleton, and there is no
create path *by design* — but the design's **Edit** button would fail for every
real user.

**Recommendation:** render the card read-only — `View` + a `Platform-managed`
chip and the same "Used when no payer template matches · N tasks · updated
<date>" line. An editable fallback is an R7 platform-role carve-out, not this
slice.

### B5 — The interim-governance note is in the ACs but not in the design

E6.5 F6.5.6's AC: the "authored once, inherited by every org / authoring is open
to all signed-in users for now" note **renders in the module**
(`PayerAdminTabs`). The design has no such element.

**Recommendation:** keep it, restyled to the new tokens (neutral, not amber), on
the Catalog tab only — or the PM explicitly waives the AC in writing.

### D1 — What "Published" means when a payer spans six states

`sop_templates` has no `published` boolean; the head row plus
`sop_template_versions` are the model, and an active **global** template is
required to carry `payer_id` **and** `state` (`author_global_sop` raises
`global_sop_match_key_incomplete`). Resolution matches payer **and** state
exactly (`src/lib/pickTemplate.ts`).

So a payer listed in six states with one NM template would show a green
`Published` badge while five of its six states resolve to the generic fallback.

**Recommendation:** three-value badge — `Published` (every state in the payer's
`states` has an active global template), `Partial` (amber, "3 of 6 states"),
`Needs template` (none). The KPI card keeps counting `Needs template` only.
Alternative, if the PM wants the two-value badge to stand: define `Published` as
"≥1 active global template" and accept the overstatement, in writing.

### D2 — Do org-tier templates count? (answers README open question 2)

Today they do not: `buildPayerReadinessFunnel` skips every template with
`orgId !== null`, so a payer whose only template is an org override reads *Needs
template* even though generation resolves it correctly (org override beats
global — `resolutionTier`). Under B1 the tab is now explicitly org-scoped, which
makes the current behaviour wrong for this page.

**Recommendation:** on My network, count org overrides for the active org
alongside global templates. This changes the KPI numbers, so it is a PM call, not
a build-time one.

---

## 2. Prototype vs README conflicts (build session: follow the README)

| # | README says | Prototype does | Call |
| --- | --- | --- | --- |
| C1 | Active KPI card = `#F0F5F2` bg, `#1B4D3E` border, forest label + number | `cardStyle()` fills the card solid `#1B4D3E` with white text | **Follow the README** — the screenshots that would settle it were not delivered |
| C2 | Rows per page `5 / 10 / 25 / 50 / 100` | `[10, 25, 50, 100]` | **Follow the README** (add 5) |
| C3 | Next step column, drift banner, drafts strip, meta subtitle all cut | The script still carries a third `SOPs` view, `sopsAll` fixtures, `ACTION_LABEL`/`JOB`/`intentSlug` next-step machinery | Dead code in the prototype — the rendered markup never uses it. **Do not port** |
| C4 | Kind filter = Commercial / Medicare Advantage / Medicaid | Hardcodes two or three values per tab | `PayerKind` has six members with labels in `src/lib/payerDirectory.ts` (`PAYER_KIND_LABELS`). **Derive the options from the data**, never hardcode |
| C5 | `screenshots/01-my-network.png`, `02-catalog.png` | not in the bundle | Not blocking; the prototype renders |

Also missing from the design, and needed: the catalog's **retired / merged**
payers. `catalogAction` returns an `unavailable` action that renders
*"Merged — can't be added · use <successor>"*. The design's Manage column has
three states and no home for these; keep the existing fourth state rather than
lose the successor guidance (**D3**).

---

## 3. What the build reuses (do not rebuild)

| Need | Existing seam |
| --- | --- |
| Catalog rows | `useGlobalPayers` → `listGlobalPayers` (`list_global_payers` RPC) |
| Membership + add/remove/reactivate | `useOrgPayerAssignments`, `useAddAssignment`, `useArchiveAssignment`, `useReactivateAssignment`, `catalogAction`, `isActiveAssignment` |
| "The org's payers" inclusion rule | `activeOrgPayers` (`src/lib/payerSetup.ts`) — excludes the `PRE_CRED_PAYER_NAME` sentinel; the header count must use it |
| Readiness buckets | `usePayerReadinessFunnel` → `buildPayerReadinessFunnel` (`FunnelNextAction`) |
| Drift counts | `useFormDrift` |
| Catalog filtering (name **or** alias, state, kind) | `filterDirectoryRows` (`src/lib/payerDirectory.ts`) |
| Template library + wizard | `TemplatesList`, the existing `/admin/templates/$id` editor routes |
| Fallback template row | `isFallbackTemplate` (`src/lib/pickTemplate.ts`) |

**Bucket derivation (D4).** The four My network cards must be mutually exclusive
so they sum to the network count. Map the existing `FunnelNextAction`:
`author_sop` → Needs template · `repair_drift` → Drift detected · `ready` →
Ready for business · everything else (`register_portal`, `train_mappings`,
`run_dry_test`) → Form not proven. The prototype does exactly this; the README
does not say it.

**Bucket legibility (D5).** With per-row detail cut, filtering to *Form not
proven* or *Drift detected* returns rows whose only badge says `Published` —
nothing on screen explains why they are in that bucket. Either add a second
badge column (`Form`: Not registered / Trained / Proven / Drift) or accept it
knowingly. Recommend the column; it costs one cell and the data is already in
`FunnelRow`.

**Pagination (D6).** `list_global_payers` returns the whole catalog and has no
paginated signature; adding one is a new (additive) migration. At 137 rows,
paginate **client-side** over the cached query for this slice and revisit at
~1k rows. The README's "should be server-side" is a direction, not a slice-1
requirement.

---

## 4. Build slices

1. **Shell + routes** — `/admin/payer-admin/network` (default) and
   `/admin/payer-admin/catalog`; segmented control with count pills; header +
   live count line; `/admin/payer-admin/sops` → `/admin/payer-admin/templates`
   (B2) with every legacy redirect retargeted; index mapper updated.
2. **My network** — 4 KPI filter cards, search/state/kind, the four-column
   table, default-template card (read-only per B4).
3. **Catalog** — 3 KPI cards, search (name **or** alias) / state / kind /
   membership, `+ Add payers`, the Manage column including the retired/merged
   state, inline `+N more` states disclosure.
4. **Pagination** — shared footer for both tables; any filter, search, or page
   size change resets to page 1.
5. **Tests + gates** — unit tests for the bucket mapping and pagination reset;
   update `e2e/legacy-routes.spec.ts` and `e2e/admin-payers.spec.ts` for the new
   URLs and tab labels.

## 5. Gates and repo rules the build must respect

- `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run test:e2e`.
- Branch off `main`, PR targets `main` (CLAUDE.md branch policy, 2026-07-21).
- `AGENTS.md` binds: components → hooks → services → Supabase (never Supabase in
  a component); no hardcoded mock rows (the prototype's payer fixtures are
  invented — do not port); no `any`; named exports only; no `console.log`/`TODO`;
  tokens only, no shadows or gradients.
- `src/components/payer-admin/moduleBoundary.test.ts` is machine-enforced: nothing
  outside `components/payer-admin/*` and `routes/admin.*` may import the module,
  and the module may not import specialist feature directories (it reaches them
  through `lib`/`services`/`hooks`/`types`). The new page composes
  `@/components/payers/*` — keep the shared pieces where they are or move them
  behind a lib/hook seam rather than importing across the boundary.
- Design-system governance (E0.9): any component not in
  `docs/redesign/design-system/` must be stock shadcn styled by tokens only and
  logged in `DESIGN-DEBT.md` in the same PR.
- Out of scope, unchanged: sidebar, Payer Detail, template editor, Cases,
  Providers, the extension, and any schema change. Note the consequence of
  divergence 2 plus that scope: "Template" wording lands on this page only, while
  Payer Detail still says "SOP templates for this payer" and the template editor
  keeps its own wording. Product-wide terminology is a separate sweep.

## 6. Prompt for the Claude Code session

> Implement the Payer Setup page redesign. Read, in order:
> `docs/redesign/payer-setup-page-build-handoff.md` (this review — it carries the
> PM decisions and the codebase mapping and overrides the design README where
> they differ), then
> `docs/redesign/design-reference/payer-setup/README.md`, then the
> `.dc.html` prototype in that folder (a design reference, not production code —
> rebuild it with the existing components, hooks, and tokens; its rows are
> invented fixtures). Scope is this one page: do not touch the sidebar, Payer
> Detail, the template editor, Cases, or Provider pages, and make no schema
> change. Build the slices in §4, respect the gates and repo rules in §5, and
> branch off `main` with the PR targeting `main`.

## 7. Open items tracked to go-live

- [ ] PM decisions B1–B5, D1, D2 recorded here before the build starts.
- [ ] Drift indicator added to Payer Detail (B3) — separate PR, before go-live.
- [ ] Screenshots `01-my-network.png` / `02-catalog.png` supplied or waived (C5).
- [ ] `DESIGN-DEBT.md` entry if the build introduces a non-system component.
- [ ] E6.5 ACs F6.5.1 (org data) and F6.5.6 (governance note) amended or upheld.
