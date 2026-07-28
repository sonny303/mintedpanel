repo: sonny303/minted-extension
branch: main

Secondary source read this turn: sonny303/mintedpanel (branch main) — the web app.

## Last sync

date: 2026-07-27T16:46:48Z

### Updated in this project

- All six payer/case screens re-shelled to the **production** sidebar IA: Workspace (Cases · Payer Setup · Reporting Center) / Organization tile + Org Detail · Groups · Providers, 2px mint inset bar on the active item, contained user card. Top-bar org chip removed — the switcher now lives in the sidebar.
- Real logo installed. The mark previously used was the inline asterisk SVG from `sidepanel.html`; the actual brand mark (`uploads/MPC-Logo-Final.png`) is now knocked out to transparency as `assets/logo-mark.png` / `assets/logo-mark-white.png` and used in all seven screens.
- New screen 7 — Workbench Panel: the shipping side panel beside the same panel in design-system values, four real states, with token deltas and the non-token defects.
- Extension icon set generated (`assets/icons/`, two variants + manifest patch in its README). `public/manifest.json` declares **no icons at all** — no top-level `icons` block, and `action` carries only `default_title` — which is why Chrome renders a generated "M" tile.
- Workbench panel restyled per the reference treatment: the second (green) header is gone — Chrome's own header carries the brand — replaced by a quiet context row (org switcher, search, account). Card fields now grouped by section (Provider / License / Group), and Customize view rebuilt as search + collapsible groups over the real 127-field catalog.
- Confirmed the extension's design-system conformance (`docs/design-system/`) is **not yet applied** in production: still Instrument Sans, `#164A2F`, cool `#F5F6F5`, round pills, shadowed controls.

## Screen map

| Screen | Built from |
| --- | --- |
| 1 - Payer Setup | mintedpanel: payer list + `formDrift.ts` KPI |
| 2 - Add or Edit Payer | mintedpanel: payer record (no create API yet — open item) |
| 3 - Payer Detail | mintedpanel: payer record, portals, templates |
| 4 - Template Editor | mintedpanel: template steps, `portal_field_maps`, `/portals/:key/train` |
| 5 - Case Close and IDs | mintedpanel: case close + ID expectations |
| 6 - Case Detail | mintedpanel: case context, tasks, `WorkInPortalButton` (E4.3) |
| 7 - Workbench Panel | minted-extension: `sidepanel.html`, `src/sidepanel/sidepanel.css`, `docs/design-system/README.md`, `docs/design-system/changes.md`, `src/shared/fixit.ts`, `src/shared/portals.ts`, `README.md` |

## Findings that constrain design

- **Extension is read-only by locked decision.** `src/shared/fixit.ts` + README R6: it never writes `portal_field_maps`. Gaps are partitioned `no_mapping` → `/portals/:key/train?field=…` (app) and `no_value` → `/providers/:id`. **Capture-to-proposed-maps requires a new write path from Devin before it can be designed.**
- **Prove / "Check coverage" has no cross-product handoff.** The panel has a coverage panel + "I fixed a mapping — refresh and re-check", but nothing bridges to the app's prove mode.
- **All four case-fill returns already exist**: payer reference / tracking ID, `portal_submission` touch (server closes the linked task), WIP note, per-field fill report. `task_id` plumbing is ready but the panel sends none — no task source in v1.
- **Portal registry is one hardcoded portal** (`bcbs_ks_enrollment`, `src/shared/portals.ts`). Banner PNM does not exist in the extension yet.
- **Terminology split**: extension says "SOP tasks" and `extension_fill`; the app says "Template" and "Auto-fill". Product name is **Minted Panel Workbench**.
- **Nav divergence**: production ships Workspace (Cases · Payer Setup · Reporting Center) + Organization (Org Detail · Groups · Providers). The extension's `docs/design-system/changes.md` Phase 3 specifies Workspace (Home · Cases) / Payers (Payer Management) / Reporting Center + Account Detail · Facilities · Providers. **Production wins here** — screens follow the production screenshot; the DS doc is stale.
- **Catalog contradiction**: README says `provider.ssnLast4` and vault fields are structurally absent from the quick-card catalog and that users may add "up to 3" fields. Neither holds — the shipping Customize view exposes **127 fields across 7 groups** (Provider 45, Group 39, Location 23, License 9, Location assignment 3, Group insurance 6, User 2), SSN last 4 among them. `src/shared/quickCards.ts` needs re-reading against the real catalog before anyone relies on the README.
- **No icons declared** in `public/manifest.json` (see `assets/icons/README.md`).
- **Panel width is not ours**: Chrome sets the initial width and the user drags it (observed at ~530px). Design must hold from ~320px up. Fonts must be self-hosted — MV3 CSP blocks the Google Fonts CDN, so Geist ships as woff2 like Instrument Sans does today.

## Decided this turn

- Capture direction: **ask Devin to open a write path** so the extension can propose `portal_field_maps` rows. Not designed yet.
- Customize view: search + collapsible groups (not tabs — 7 group tabs truncate at 320px).
- Card: grouped by section, no field cap.
- Header: drop the green bar; Chrome's header is the brand surface.
- Next: finish the workbench look before picking a seam to build.
