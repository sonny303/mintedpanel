# Minted Panel Workbench — engineering handoff

**For:** Devin
**From:** design (Sowmya's PM track)
**Date:** 2026-07-27
**Repos read:** `sonny303/minted-extension@main`, `sonny303/mintedpanel@main`
**Design files:** `7 - Workbench Panel.dc.html`, `8 - Index - Workbench Journeys.dc.html`, `assets/icons/`

---

## What this is

Two things: a list of **enablers** that unblock designed and undesigned journeys, and a list of **conformance/defect fixes** that need no design decisions. Nothing here invents product capability — every item is grounded in a file in one of the two repos, and each one names that file. Where the repo and production disagree, that is called out rather than resolved.

The journey inventory those items map to is `8 - Index - Workbench Journeys.dc.html` — 14 journeys, 9 of which already exist in code.

---

## Part 1 — The blocking question

**Does the extension get a write path for captured field mappings?**

Right now it does not, by locked decision. `src/shared/fixit.ts` states it plainly:

> the extension NEVER writes mappings (R6 read-only boundary)

Gaps are partitioned instead — `no_mapping` routes to `/portals/<key>/train?field=…` in the web app, `no_value` routes to `/providers/:id`. The README repeats the boundary: *"The extension stays read-only: the only writes are the existing manual touch POST and the user-scoped layout PUT."*

Meanwhile the Template Editor's online-form step has a capture mode that reads "Capture this form's fields" and names no actor. Whoever performs that has to be on the live portal page — which is the extension — and the extension can't write what it finds. That contradiction is the single thing gating journeys 10, 11, 12 and 14.

**What design needs from you, in this order:**

1. Yes or no on the boundary moving.
2. If yes: the row shape for a proposed `portal_field_maps` write, and who is authorized to make it.
3. If no: name the alternative actor, and we design capture as a web-app-side flow instead.

Designing the capture experience before this is settled means designing it twice. Everything else in Part 2 can proceed in parallel.

---

## Part 2 — Enablers, in blocking order

| # | Enabler | Detail | Blocks journey |
| --- | --- | --- | --- |
| 1 | `portal_field_maps` write path | Above. Rows arrive as `status: "proposed"`; the editor's map mode trains them to `approved`. Confirm shape + authorization. | 10, 11, 12, 14 |
| 2 | Capture session handshake | How a capture is bound to a template step + portal key. Does the app mint a token the extension presents back? Affects whether a capture can be resumed after the MV3 worker restarts. | 10, 11 |
| 3 | Portals resolve from the template, not a hardcoded list | `src/shared/portals.ts` hardcodes a single-element array (`bcbs_ks_enrollment`, BCBS KS) and matches the active tab against a literal `urlPrefix`. It must instead resolve from the portal registered on the template's online-form step — payer-scoped, keyed by the immutable portal key, matched on the row's `url_pattern`. Field-map rows already carry `url_pattern` for exactly this. See the correction note below. | 3, 4, 10 |
| 4 | Return notification | Does the editor poll, subscribe, or only refresh on revisit? This shapes the return-trip UX more than any visual decision. Answer before design. | 11 |
| 5 | Task source in the panel | `task_id` plumbing is ready — the server closes a linked task and records a `task_update` when supplied — but v1 sends none because the panel has no task source (locked decision (c)). So task completion still happens in the web app. | 5 |
| 6 | Drift ingestion | `formDrift.ts` exists and lights the **Drift detected** KPI on Payer Setup plus repair mode in the editor. Confirm what actually writes to it before repair depends on it. | 12 |
| 7 | Quick-card catalog reconcile | See Part 3, item 1 — a repo/production contradiction, not just a gap. | 9 |
| 8 | Manifest icons + self-hosted Geist | See Part 3, items 2 and 3. | brand, all |
| 9 | Payer record gaps | Carried over from the payer handoff and still open: no in-app payer-create API, no `payer_contacts` table, no archive flag or merge operation, no ID-expectation columns on the payer record. The extension work sits downstream of a working payer record. | upstream of all |

### Correction — nothing about a portal should be hardcoded in the extension

The portal a step targets is template data. It is registered on the template's online-form step, scoped to the payer, and carries an immutable key plus an optional form URL. A payer can have several — Banner Health Plans has both a PNM enrollment form and a PAR roster form, at different readiness states.

The extension currently contradicts that in three places:

- `PORTALS` is a hardcoded one-element array, so only BCBS KS exists to it.
- `matchPortal()` does `url.startsWith(portal.urlPrefix)` against that literal, so detection can only ever recognize that one form.
- `manifest.json`'s `content_scripts.matches` and `host_permissions` name the BCBS KS URL directly, so even a correctly-resolved second portal wouldn't get a content script.

All three have to move to template-driven resolution. The third is the awkward one — MV3 content-script matches are static in the manifest, so a DB-driven portal set needs either a broad host permission with runtime registration (`chrome.scripting.registerContentScripts`) or `optional_host_permissions` requested per portal. That's a real architectural choice, and it's worth making now rather than after a second portal is added: whichever way it goes changes what "open the form" can do, and journeys 3, 4 and 10 all depend on it.

Design already assumes the correct behavior — `4 - Template Editor.dc.html` shows the portal as a per-payer select over registered portals with their readiness, plus **+ Register new**. Nothing in the designs assumes a fixed portal.

**The same resolution has to hold on a case.** A case's portals are derived from its open tasks' portal steps — which the API already returns: `GET /api/cases/:id/context` carries `openTasks` with their E4.2 execution types, and `GET /api/cases?providerId=…` rows carry `portalTasks` for close-out. So the case knows its portals without any new endpoint; only the extension's matching layer is hardcoded.

Three consequences:

- **The launcher is plural.** E4.3 specifies one launcher per *resolvable* portal, hidden when the case has none. A Banner case whose template has both an online-form step for PNM enrollment and one for the PAR roster gets two launchers, each naming its portal. A single "Work in portal" button is wrong for any payer with more than one form.
- **Portal detection in the panel must accept any of the case's portals**, not one. If a coordinator launches PNM but lands on PAR, the panel should recognize PAR and say so — not report "no portal detected."
- **Readiness travels with the portal, per step.** Banner PNM reads Proven while PAR reads Registered, so on the same case one launcher is ready to fill and the other isn't. The launcher has to show that difference, or the coordinator finds out by watching a fill do nothing.

### Also needs a decision, no code blocked

**Who owns "Check coverage"?** The prove-mode synthetic fill runs against a live form (argues for the extension) but its pass/fail persists on the template (argues for the app). No handoff exists between the two products for it today. Design will follow whichever you pick.

---

## Part 3 — Fixes with no design decisions attached

### 1. The quick-card catalog contradiction — read this first

The README describes a **closed catalog**: defaults plus "up to 3" extra fields, server-owned, mirrored in `src/shared/quickCards.ts`, with `provider.ssnLast4` and vault fields **structurally absent**.

Production does not match. The shipping Customize view exposes **127 fields across 7 groups**, SSN last 4 among them:

| Group | Fields |
| --- | --- |
| Provider | 45 |
| Group | 39 |
| Location | 23 |
| License | 9 |
| Location assignment | 3 |
| Group insurance | 6 |
| User | 2 |

One of the two is wrong. Which one changes the picker design, the PHI surface, and whether `quickCards.ts` is still the mirror of anything. Please resolve before the picker is rebuilt.

### 2. Extension icons are not declared

`public/manifest.json` has **no top-level `icons` block**, and `action` carries only `default_title`. Chrome therefore renders a generated letter tile — the grey "M" in the side-panel header and toolbar.

PNGs are in `assets/icons/`. Copy to `public/icons/` and add **both** blocks — `icons` drives chrome://extensions, the side-panel header and the extension menu; `action.default_icon` drives the toolbar button. Declaring one leaves the other on the fallback.

```json
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "action": {
    "default_title": "Minted Panel Workbench",
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png"
    }
  }
```

Two variants shipped. `icon-*.png` is the mark in `#1B4D3E` on transparency — recommended, and consistent with how a side-panel header treats a brand mark (mark only, no tile). `tile/icon-*.png` is a white mark on a `#1B4D3E` rounded tile — use it instead if the dark-theme toolbar test fails, since a dark-green mark on a dark toolbar disappears. Pick one variant and ship all four sizes from it; don't mix.

### 3. Design-system conformance was never applied

`docs/design-system/README.md` and `changes.md` are in the extension repo and specify this work. Production still renders the pre-conformance values. Phase 1 alone is most of it.

| Aspect | Ships today | Target |
| --- | --- | --- |
| UI font | Instrument Sans | **Geist** |
| Primary | `#164A2F` | **`#1B4D3E`** (hover `#163F33`) |
| Panel background | `#F5F6F5` (cool) | **`#FDFDFC`** (warm) |
| Border | `#E5E8E6` | **`#E8E5E0`** |
| Muted | `#EFF1EF` | **`#F5F4F1`** |
| Ink | `#182B20 / #5B6B60 / #99A49B` | **`#1F2937 / #6B7280 / #9CA3AF`** |
| Control shadow | `shadow-sm` | **none** — 1px borders only |
| Status pill radius | `999px` | **4px** |
| Card radius | 8px | **6px** |
| Focus ring | 2px solid primary | **1px primary + 2px soft ring** `rgba(27,77,62,.18)` |

Steps: replace the `:root` block in `src/sidepanel/sidepanel.css` with `targets/minted-extension-tokens.css` (legacy aliases preserved, so every existing selector resolves), then swap the four `@font-face` blocks from Instrument Sans to Geist and ship the four woff2 weights to `/fonts`. **Geist must be self-hosted** — MV3's CSP blocks the Google Fonts CDN. Most of the rest follows automatically because the panel keys off tokens; `.pill`'s hardcoded `999px` is the one manual change.

`7 - Workbench Panel.dc.html` renders the before and after side by side at panel width.

### 4. Customize view is broken as shipped

Labels right-align outside their rows, the checkbox floats over the row rather than sitting in it, row widths are inconsistent, and the list runs past the fold with no reachable Save or Cancel. Screenshots are in `uploads/`.

Design direction: search across all fields, plus collapsible groups with per-group selected counts. Not tabs — seven group tabs truncate at 320px. Drawn in `7 - Workbench Panel.dc.html` under the Customize view tab. Blocked on item 1, since the field list may change.

### 5. Doubled credential suffix

The provider card renders "Jim Apple, PT, PT". The suffix is being appended twice somewhere in the profile projection consumed by the panel.

### 6. "Sign out" is unreadable

Green link text on the forest header — effectively invisible at real scale. Design replaces the raw email + green link with "Hi, Sowmya" and the sidebar's `#A7B5AD` nav ink, and in the conformed version moves account into an avatar menu.

---

## Part 4 — Constraints design is working under

Noting these so nothing gets built that fights the platform.

- **Panel width is not ours.** Chrome sets the initial width; the user drags it (observed at ~530px, floor around 320px). No fixed-width design, no fixed heights — page zoom applies to the panel.
- **Two stacked headers.** Chrome draws its own header above the panel content and it is not restylable or removable. Design drops the extension's second green bar and treats Chrome's as the brand surface — which is why item 2 matters.
- **Nothing escapes the panel bounds.** Custom dropdowns, popovers and tooltips clip at the edge. Native `<select>` is the exception because the OS draws it, which is why those lists overflow in the screenshots. Styled listboxes must fit inside.
- **The MV3 worker restarts constantly.** No flow state can live only in memory. Combined with the no-PHI-in-storage rule, a restored view can show labels and counts but never values — which is exactly why enabler 2 needs to cover capture resumption.
- **PHI discipline.** Card values, tokens and context stay in memory; the active-case record persists identifiers and URL only.

---

## Part 5 — Two things not to break

**Two status machines, never merged.** Internal case status (8 values: Not Started, In Progress, Submitted, In Review, Action Required, Approved, Denied, Not Pursuing) and payer pipeline stage (9 values, adding Assigned, Drafting, Out-of-Network). The repo is explicit that they stay independent. Two columns by design.

**Templates are scoped payer + group**, never org-tier — that tier was retired app-side. Terminology is "Template" everywhere, never "SOP". Note the extension still says "SOP tasks" in `sidepanel.html` and the README; that's a rename, not a behavior change.

---

## Suggested order

1. Answer Part 1. Everything greenfield waits on it.
2. Part 3 items 2, 3, 5, 6 — no decisions attached, all shippable independently, and together they close the brand gap between the two products.
3. Part 3 item 1 — resolve the catalog before the picker is rebuilt.
4. Enablers 3, 4, 5 — each unblocks a specific journey.
5. Enabler 9 — the payer record gaps, which everything else eventually sits on.

---

## Part 6 — Connection contracts (added after the full-loop prototype)

The prototype (`9 - Workbench Prototype.dc.html`) and the app screens now show both ends of every handoff. Each contract below names the payload one product sends and where the other renders it. These assume the backend work already in motion plus the three additions at the end of `10 - Consolidated Vision.dc.html` (label-learning store, per-field verified-at, portal typing).

### C1. Launch (app → panel)
Case Detail's launch button carries `{org, provider, location, case, portal_key}`. The panel opens with the case in hand — zero dropdowns. Queue pickup in the panel is the same contract self-served, ranked by SLA. **Shown:** prototype "New tab" context; Case Detail header button.

### C2. Submission (panel → app)
On Record submission the panel POSTs one `portal_submission` touch: `{case_id, task_id?, payer_reference, fill_report: {filled, skipped, skipped_fields[]}, url}`. Server bumps status (In Progress → Submitted), closes the linked task when `task_id` present, appends the touch. **Shown:** prototype Progress tab → Case Detail touchlog ("Workbench" tag, ref 2201-4471, evidence for → Submitted) and status timeline ("workbench touch").

### C3. Confirmation → Case Close (app-side reuse of C2)
The stored `payer_reference` pre-fills the approval dialog so the coordinator never retypes it. **Shown:** Case Close dialog provenance strip ("arrived with the Workbench submission… saved with this approval unless you change it").

### C4. Capture (panel → app, the enabler-1 write)
The panel POSTs `portal_field_maps` rows with `status: "proposed"`, each carrying `{portal_key, field_label, selector, suggested_source?, evidence: {payer_count}}`. Nothing fills from a proposed row. The Template Editor's online-form step is the approval queue: "Pull captured fields" pulls proposals in; approving flips `proposed → approved`. **Shown:** prototype somepayer context ("Send 19 proposed mappings") → Template Editor capture card + mapping table.

### C5. Drift (panel → app)
A fill that hits a dead selector logs `{portal_key, field, last_working_at}` to the drift store; Payer Setup's drift banner names the source ("reported by a Workbench fill on Jul 24") and deep-links to repair mode. **Shown:** Payer Setup drift banner; Template Editor repair intent.

### C6. Verify (panel → provider record)
On a reference portal (CAQH), accepted differences PATCH the provider record field-by-field and stamp `verified_at`. The panel needs read access to the full 127-field projection plus this one write. **Shown:** prototype CAQH context — accepting Group NPI immediately upgrades the next fill from 17/18 to 18/18.

### Sequencing note
C2/C3 ride existing endpoints (payer reference, touch, fill report all exist server-side — only `task_id` sourcing is open). C5 needs the drift-ingestion answer (enabler 6). C1 is UI plumbing. C4 and C6 are the two genuinely new write paths — C4 is Part 1's question; C6 is new since the consolidation and should be scoped with it.

---

## Part 7 — Product answers that changed the design (2026-07-27)

1. **Approval is not a separate role.** Two people use the app and the panel; approving a proposed mapping is a training matter, not a permissions one. The panel offers "Approve all" inline, with the Template Editor as the whole-form alternative. Keep the propose/approve *gate* (a proposed row never fills) but do not build an approver role.
2. **CAQH is a destination, not a source.** Coordinators update CAQH and complete attestation. The compare/accept design is replaced: the panel fills CAQH from our record and records the attestation. Pulling a value back exists only for a true gap and is expected to be rare. **Do not build bidirectional sync.**
3. **Catalog resolved in favor of production** — 127 fields, SSN last 4 included. The "up to 3 extras" cap is dropped.
4. **Queue ranking comes from the case workflow** — task due dates and overdue state. The panel surfaces that order; it does not compute its own.
5. **Trust in autofill is earned by outcomes over time** — first-pass rate per payer is the signal that matters, so the prove/evidence path stays.
6. **Both people should stay on cases, not on system management.** Setup work belongs inside the case flow wherever possible rather than in a separate admin destination. This is why capture approval is offered in the panel.

---

## Part 8 — Launch-direction risk (flagged, needs a spike)

**The web app cannot open the extension's side panel directly.** A page has no API for it. The only route is `externally_connectable` → `chrome.runtime.sendMessage` → the service worker calls `chrome.sidePanel.open()`. Since Chrome 116 that call requires a user gesture, and a gesture that originated on a *web page* may not satisfy it.

This affects two places:

- **C1 launch (app → panel).** Case Detail's launch button may not be able to open the panel; it can only open the portal URL and rely on the coordinator opening the panel from the toolbar. If so, C1 degrades to "pass context to an already-open panel," which still removes the four dropdowns — the panel picks up the context on its next focus.
- **Template Editor capture card.** Now worded honestly: "Open form" opens the portal URL; the coordinator captures in the panel. Do not restore "Open with Workbench" unless the spike proves the gesture forwards.

**Spike first, before building either.** If `sidePanel.open()` from a forwarded message works in the target Chrome versions, both flows get one click shorter. If it doesn't, the designs above already work — no redesign needed, just don't promise the launch in copy.

**Related:** capture proposals arrive in the editor via a manual "Check for captured fields" pull. That is the deliberate low-risk choice (no notification infrastructure). Approving in the panel is the primary path precisely because it avoids the round trip — see Part 7 item 6.
