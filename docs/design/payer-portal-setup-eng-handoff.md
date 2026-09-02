# Engineering handoff — Payer Setup & Portal Setup

Build package for the front-end-only redesign. Design source of truth:
`docs/design/payer-portal-setup-ux-review.md`. Domain source of truth:
`docs/design/payer-portal-setup-ux-review-brief.md`. Interactive reference:
this project's `/wireframes` routes (toggle High — product chrome for pixel intent).

## 0. Ground rules

- No schema, migration, RPC, `/api`, or Chrome-extension protocol changes. Every control below
  maps to a write path that already ships.
- Capture, mock dry run, and Mark proven stay in the Minted Workbench extension. Panel never
  submits a payer form and must never imply it did.
- Portal keys are immutable. Global portals (`org_id null`) are inherited by every org.
- Changing a portal URL clears verification and `proven_at` — surface this before the write, do
  not work around it.
- Payer catalog membership and group Payer Network attachment stay separate concepts.
- Visual system: primary `#1B4D3E`, border `#E8E5E0`, `rounded-md`, no shadows or gradients,
  status colour only in pills, 40px table rows with `px-3` cells, headers
  `text-xs uppercase tracking-wider`.

## 1. Ticket list

Ordered for delivery. Each ticket is independently shippable behind the existing routes.

### MP-1 — Portal drawer: update URL (Priority 1)

- **Files:** new `src/components/portals/PortalDrawer.tsx`; reuse patterns from the unmounted
  `src/components/portals/PortalsRegistry.tsx`.
- **Write path:** `updatePortalUrl` (org tier) / `upsertGlobalPortal` with `id` (global tier)
  from `src/services/portals.ts`. No new mutation.
- **UI:** key (read-only, with "keys cannot be renamed" helper), URL field, tier pill,
  status pill, last proven, reference list, Save (primary) / Cancel.
- **Guard:** on dirty URL, show the reset warning inline before Save is enabled:
  "Saving a new URL clears verification. This portal must be re-captured and re-proven in
  Minted Workbench."
- **After save:** portal reads `Needs capture`; offer `Re-capture in Workbench` deep link
  (`?intent=register`) and keep the drawer open on the updated row.
- **AC:** URL update reachable in 3 clicks from Payer Detail; proof state visibly resets;
  key field is not editable; global-tier edit states inheritance blast radius.

### MP-2 — Portal drawer: stop using this portal (Priority 2)

- **Depends on:** MP-1.
- **Semantics:** hide-from-pickers + unlink references. **Not** a row delete and **not** a new
  soft-delete column. See §3 — this needs PM sign-off before merge.
- **UI:** `Stop using this portal` (destructive-outline, not primary) → confirm dialog listing
  every referencing template step ("Used by 2 template steps"). Confirm is disabled until the
  operator chooses `Unlink and stop using`; referenced steps drop to a `Needs a portal` state.
- **Write path:** existing flag RPCs + existing step-portal unlink path. No new mutation.
- **AC:** retirement in 4 clicks; never silently succeeds while references exist; retired
  portals disappear from pickers but remain visible in the payer inventory with a
  `Retired` pill.

### MP-3 — Portals tab on Payer Detail (Priorities 1–2 home)

- **Files:** `src/components/payer-admin/PayerDetailPage.tsx` (add tab),
  new `src/components/payer-admin/PayerPortalsTab.tsx`.
- **Table:** key | URL | tier | status | used by (count) | last proven. Row click opens the
  drawer. Read path only — all writes live in the drawer.
- **Scope:** payer-scoped inventory only. Do not re-mount `/admin/portals` as a top-level nav
  destination in this pass.
- **AC:** every portal referenced by this payer's templates is listed, including inherited
  global portals, marked as such.

### MP-4 — Form readiness row + intent deep links (Priority 3)

- **Files:** `src/components/payer-admin/PayerTemplatesTab.tsx`,
  `src/components/templates/FormStepPanel.tsx`.
- **Add:** a form-readiness row per template on the Templates tab with a direct action
  (`Train form` / `Repair drift` / `Prove in Workbench`) that deep links into Form setup with
  the existing `?intent=train|repair|register|prove` params, bypassing
  Editor → Actions → step.
- **Form setup:** open pre-expanded and scrolled to the step named by the intent; `repair`
  opens the repair queue directly.
- **AC:** form training reachable in 3 clicks from Payer Detail; drift repair in 2–3 from the
  drift pill; no new route is introduced.

### MP-5 — Next action on list and Detail (Priority 4)

- **Files:** `src/components/payer-admin/PayerSetupPage.tsx`, `PayerDetailPage.tsx`.
- **List:** one `Next action` cell per payer replacing passive KPI-only diagnosis; the cell is
  the CTA and routes to the surface that resolves it.
- **Detail:** one next-step banner and one primary button — never two competing CTAs.
- **Resolution order (first unmet wins):** identity incomplete → checklist unpublished →
  no portal → fields untrained → not proven → drift present → not attached to a group → ready.
- **Email/paper payers:** read `Ready — no online form`, not a warning.
- **AC:** every row has exactly one next action; the Detail banner and the list cell agree.

### MP-6 — Honest extension handoff block (Priority 5)

- **Files:** `src/components/templates/FormStepPanel.tsx`.
- **Block states:** what Workbench will do, what the operator does there, and the return deep
  link back into this exact Form setup state.
- **Copy:** state plainly that Panel does not submit payer forms. Relabel `Open form` so it
  never reads as capture (`Open portal in a new tab`).
- **AC:** no affordance implies Panel captured, submitted, or proved anything; the return link
  restores the same intent state.

## 2. Sequencing

```text
MP-3 ──> MP-1 ──> MP-2        maintenance parity (the core gap)
MP-4                          depth reduction, independent
MP-5                          readiness, independent
MP-6                          honesty pass, independent
```

MP-1..3 land together as the maintenance release. MP-4..6 can ship in any order.

## 3. Decisions taken for this build

1. **Retire semantics.** Hide-from-pickers + unlink (no schema). Hidden portals
   get a `[hidden] ` name prefix (see `src/lib/portalRetirement.ts`); pickers
   filter them out; the Portals inventory keeps them with a **Hidden from
   pickers** pill.
2. **Referenced-step policy.** Retirement requires explicit **Unlink and stop
   using**; referencing steps are published with `portalKey` cleared (Needs a
   portal).
3. **Global-tier edit rights.** Org admins may edit inherited global portal
   URLs via `upsertGlobalPortal`; the drawer states the inheritance blast
   radius.
4. **Role permissions.** Write controls (URL save, stop using) are admin-gated,
   matching existing portal authoring surfaces. Billing/specialist see read-only.
5. **Global portal edit surface.** Editable from any payer context that lists
   the portal (Portals tab or Form setup → Edit URL), with the global warning.

## 4. Out of scope (do not build in this pass)

- Hard deletion, schema or migration changes, new mutations or RPCs.
- Renaming portal keys.
- Moving capture or prove into the panel.
- Changing publish or resolution semantics.
- Automatically attaching payers to groups.
- Re-mounting `/admin/portals` as a global admin app.

## 5. Definition of done

- Click budgets met: URL update 3, retire 4, form training 3, drift repair 2–3, first-time
  setup 10–12.
- No new backend surface introduced; diff touches components, routes, and copy only.
- Every new control renders in the shipped visual system (§0) and has exactly one hover state.
- Keyboard reachable: drawer traps focus, confirm dialog is escapable, table rows are
  activatable.
- Empty, loading, error and permission-denied states specified for the Portals tab and drawer.
