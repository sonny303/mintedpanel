# Payer Setup

_Updated for: catalog list (2026-08-13); E6.5 plus 3M payer-setup cleanup slices 1–3 (2026-08-10); Form Setup / Train capture notes (2026-08-11)._

Journey A — payer readiness: catalog + SOPs with embedded form setup.
Global: authored once, inherited by every org.

## Grain

**Payer Setup lists the global catalog.** There is no org↔payer assignment.
A newly created payer appears here immediately. The operational attach is
**payer↔group** on Groups → [group] → Payer Network (`+ Attach payers`,
a multi-select).
Generation, attach pickers, and the manual-case door still read payers a
group already works with (`activeOrgPayers` over live `payer_network_targets`).

## Shipped (E6.5)

- **Two real tabs** at `/admin/payer-admin/catalog` and `/admin/payer-admin/sops`
  (shareable URLs; every legacy `?tab=` spelling redirects). Open to all
  signed-in users for now — the module carries a persistent governance note;
  platform roles arrive with R7.
- **Ready-for-business funnel** heads the Catalog tab: one row per selected
  payer with honest, separate dimensions (Global SOP · Form state · Drift) and
  ONE next step — author SOP → register portal → train → repair drift → mock
  dry test → ready. A no-online-form SOP is ready with a note.
- **Portal setup lives inside the SOP editor** (the online_form step's "Form
  setup" panel): register or pick the portal (global or org tier by the
  template), train captured mappings in the **field registry** (every row
  stays listed and editable; token / fixed value / human-fills decisions),
  and run the mock dry run — register → capture (extension) → train → prove.
  Only capture leaves the editor: "Open form" opens the portal page, where
  the extension does the capture (granting site access on the first visit to
  a non-BCBS portal); the proposed mappings then appear back in Form setup.
  Token pickers are searchable (fuzzy) over the served catalog.
- **Stale mappings** (field missing on the last real fill) keep their
  controls and use fill-time copy — staleness is information, not a lock
  _(lands with panel #289)_. Re-capturing a page refreshes presentation
  (`sort_order` / labels) without resetting an existing decision _(lands
  with panel #290 + extension capture order PRs)_.
- **Ghost portals stay out of pickers.** Browser portal lists apply the same
  D6.4 filter the API already used: global rows with no workable payer
  (null / retired / merged / archived) do not appear _(lands with #282)_.
- **The dry run uses SYNTHETIC mock data** (versioned profile, never a
  provider row, never PHI), once per payer — a pass means every captured field
  has a decided auto-fill mapping and stamps the portal **Proven**.
- **Drift repair (ex-Fix-it)** reopens the same editor: the Sidebar badge is
  the drift count, and a retrained mapping clears the badge
  (repaired-pending-verification until the next real fill).
- **Train in the extension** (paired Work/Train shell): URL match binds
  which form capture writes to; a sticky dropdown selection that does not
  match the open tab shows mismatch copy and disables capture _(lands with
  extension #40)_. Capture skips hidden controls, orders fields by page walk,
  and identifies a real second page instead of always reusing page 1
  _(lands with extension #43 / #44 / #46)_.
- **SOP Actions editor** _(lands with #297)_: Auto-fill steps lint for a
  linked portal (“needs form follow-up”), inert execution types stay out of
  the picker, collapsed Action rows stay readable, and Add action offers
  presets/seeds.
- **MSO routing retired** as an org rules engine — delegation is a curated
  payer fact on the catalog row (`Delegated: …`) plus SOP content.
- **Org settings moved out**: resolution-ID labels live on Org Detail (org
  data stays with the org). The denial word-list and queue ranking are FIXED
  defaults since E6.6 — no editors anywhere; changes are a platform change.

## 3M cleanup — payer setup is one deliberate path

The cleanup removes two sources of friction from the shipped journey:

- **Set up payer** is one intent: enter the payer details and create it. A
  successful create writes the global catalog row. It does **not** assign
  the payer to the org — attach a group from Groups → Payer Network when
  that group credentials with it.
- **Network membership is group attach** (active `payer_network_targets`).
  The dormant `org_payer_assignments` table is **not dropped**. Hosted
  migration apply stays an operator step.
- **The catalog is curated, not a seed inventory.** The retired catalog-sync
  rows that are not referenced by cases, targets, enrollment facts, SOPs,
  portals, generation records, contacts, settings, or other payer links are
  removed by an operator-run cleanup. Human-created payers, organization
  records, merged payers, and every referenced payer remain available.
- **SOP All-states (3M Slice 3):** Template Basics can author `state = 'All'`
  so one checklist covers every case state. Resolution ranks state
  specificity, then group specificity, then ownership (`pickTemplate`
  D3.3-G). Ready remains checklist presence (#277), not per-state coverage.

The cleanup migration is intentionally separate from the code fix and is not
considered complete until the hosted database operator applies it. Until then,
the application may still show the retired catalog rows even though the setup
flow itself is functional. The platform-authoring follow-up also depends on
the Slice 3 read-path work and the paired SOP read-widening migration; those
dependencies must be complete before the adoption split is treated as live.

## Global authoring

Global SOPs, portals, and field mappings are `org_id NULL` rows written
through SECURITY DEFINER RPCs (`author_global_sop`, `upsert_global_portal`,
`set_global_portal_flags`, `train_global_field_map`, and the reissued publish
RPC). Authored once, inherited by every organization; the generic fallback
SOP stays platform-managed and read-only.
