# Payer Setup

_Updated for: E6.5 plus 3M payer-setup cleanup slices 1–2 (2026-08-10)._

Journey A — payer readiness: catalog + SOPs with embedded form setup.
Global: authored once, inherited by every org.

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
  template), train captured mappings in place (broken-on-last-fill rows queue
  FIRST), and run the mock dry run — register → capture (extension) → train →
  prove. Only capture leaves the editor: "Open form" opens the portal page,
  where the extension does the capture (granting site access on the first visit
  to a non-BCBS portal); the proposed mappings then appear back in Form setup.
- **The dry run uses SYNTHETIC mock data** (versioned profile, never a
  provider row, never PHI), once per payer — a pass means every captured field
  has a decided auto-fill mapping and stamps the portal **Proven**.
- **Drift repair (ex-Fix-it)** reopens the same editor: the Sidebar badge is
  the drift count, the SOPs tab banners deep-link the owning SOP, and a
  retrained mapping clears the badge (repaired-pending-verification until the
  next real fill).
- **MSO routing retired** as an org rules engine — delegation is a curated
  payer fact on the catalog row (`Delegated: …`) plus SOP content.
- **Org settings moved out**: resolution-ID labels live on Org Detail (org
  data stays with the org). The denial word-list and queue ranking are FIXED
  defaults since E6.6 — no editors anywhere; changes are a platform change.

## 3M cleanup — payer setup is one deliberate path

The cleanup removes two sources of friction from the shipped journey:

- **Set up payer** is one intent: enter the payer details and create it. The
  old “Also add to my network” choice is not part of this flow; a successful
  create adds the payer to the active organization and the confirmation says
  so. The backend performs the identity insert and organization assignment in
  one transaction.
- **The catalog is curated, not a seed inventory.** The retired catalog-sync
  rows that are not referenced by cases, targets, enrollment facts, SOPs,
  portals, generation records, contacts, settings, or other payer links are
  removed by an operator-run cleanup. Human-created payers, organization
  records, merged payers, and every referenced payer remain available.

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
