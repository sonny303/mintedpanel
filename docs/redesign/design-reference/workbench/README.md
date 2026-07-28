# Minted Panel Workbench — design handoff

**For:** Claude Code
**Task:** review these designs, then write the development epic.
**Products:** `sonny303/minted-extension` (Chrome MV3 side panel) · `sonny303/mintedpanel` (web app)
**Date:** 2026-07-27

---

## What this package is

A credentialing coordinator keeps a Chrome side panel open while working inside payer portals. The panel holds one case, shows the provider values portals ask for, fills forms it knows, and records what happened back onto the case.

Two products have to feel like one. Today they don't — the extension never received the design-system conformance that lives in its own repo, and there are no handoffs built between the two. This package specifies both: the visual conformance, and the six seams that connect them.

**Everything here is grounded in the two repos.** Where the repo and production disagree, that is stated rather than silently resolved. Where a decision is still open, it is marked as open with the consequence named.

## About the design files

The `.dc.html` files are **design references** — HTML prototypes showing intended look and behavior. They are not production code and their markup should not be copied.

Recreate them in each target codebase's existing environment: the extension's React + Vite MV3 setup, and the web app's existing stack, using established patterns there. The prototypes are inline-styled single files because that is how the design tool works — that is **not** a styling instruction. Both targets use CSS custom properties and component files; stay with those.

To view: open any `.dc.html` directly in a browser. `support.js` and `assets/` must sit beside them.

## Fidelity

**High fidelity.** Colors, typography, spacing, radii, and interaction states are final and exact. Every hex and px value in these documents is authoritative — prefer it over anything sampled from a screenshot.

Two things are illustrative, not specified: the prototypes' simulated data (fill results, recognized field counts, CAQH gaps), and the sample provider record. The contracts in doc 06 are what's real.

---

## Read in this order

| # | Document | What it answers |
| --- | --- | --- |
| — | **`11 - Handoff Map.dc.html`** | *Start here.* All six seams drawn — panel side, what crosses, which app screen shows it. Five minutes. |
| 01 | System overview | What the product is, the one loop it runs, terminology, and the invariants you must not break. |
| 02 | Panel specs | Every panel surface at exact values. The main implementation reference. |
| 03 | App changes | The additive changes to app screens 1–6 that make returns visible. |
| 04 | States and edge cases | The full state matrix per surface, including failure and restore. |
| 05 | Use cases | Ten end-to-end walkthroughs with expected system behavior. |
| 06 | Integration contracts | C1–C6: payloads, both ends, what exists and what's new. |
| 07 | Tech enablers | Fully scoped enabler review, including everything previously handed to Devin. |
| 08 | Epic and stories | Dev-ready breakdown with acceptance criteria and dependency order. |
| 09 | Design tokens | The token set, type scale, spacing scale, control sizes. |

## Design files

**Panel**
- `9 - Workbench Prototype.dc.html` — the working panel. All six journeys clickable, width switcher (320/380/530), 7-step demo script. **Primary reference for doc 02.**
- `7 - Workbench Panel.dc.html` — shipping panel vs. conformed panel, side by side at panel width, four states. The visual diff for the token work.

**Connections and context**
- `11 - Handoff Map.dc.html` — the six seams, drawn.
- `8 - Index - Workbench Journeys.dc.html` — the journeys, what exists in code, what each blocks on.
- `10 - Consolidated Vision.dc.html` — where this goes once the backend ships: one loop, three contexts, the field catalog as the spine.

**App screens**
`1 - Payer Setup` · `2 - Add or Edit Payer` · `3 - Payer Detail` · `4 - Template Editor` · `5 - Case Close and IDs` · `6 - Case Detail`

**Supporting**
- `support.js` — required runtime for the `.dc.html` files. Keep beside them.
- `assets/icons/` — extension icons, both variants, with a README on the variant choice.
- `assets/logo-mark.png` / `-white.png` — brand mark, dark and light.
- `github.md` — repo provenance, screen map, and the repo findings that constrain the design.
- `BACKEND - contracts and enablers.md` — the running engineering brief this package supersedes. Kept for history.

**Not included:** Geist woff2 files. Source and self-host them (doc 07, E1.2).

---

## The three things most likely to trip you up

1. **Panel width is not ours.** Chrome sets it; the user drags it. Observed ~530px, floor ~320px. No fixed widths, no fixed heights, no viewport units. Verify every surface at 320.
2. **A web page cannot open a Chrome side panel.** This constrains the launch seam. Spike it before building either end — doc 07, E3.1.
3. **The extension is currently read-only by locked decision.** Two of the six seams need that boundary to move. That is a deliberate product decision, already made (doc 07, section 2), not an oversight to route around.

## Where to start building

Doc 08 has the full order. Short version: **E1 (brand + tech debt) has no dependencies and no open decisions — start there.** It is also what makes the two products finally look like one, which is the thing stakeholders can see.
