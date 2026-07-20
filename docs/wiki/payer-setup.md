# Payer Setup

_Updated for: E6.5 (2026-07-19)._

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
  prove without leaving the editor.
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

## Global authoring

Global SOPs, portals, and field mappings are `org_id NULL` rows written
through SECURITY DEFINER RPCs (`author_global_sop`, `upsert_global_portal`,
`set_global_portal_flags`, `train_global_field_map`, and the reissued publish
RPC). Authored once, inherited by every organization; the generic fallback
SOP stays platform-managed and read-only.
