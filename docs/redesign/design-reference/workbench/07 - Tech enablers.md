# 07 — Tech enablers

Everything engineering needs to build or decide, fully scoped. Includes every item previously handed to Devin, with its current status marked — nothing from that brief was dropped.

**Status key**
`READY` — no decisions, no dependencies, buildable now
`DECIDED` — the product decision is made; needs scoping and building
`SPIKE` — technically uncertain; investigate before designing the ticket
`CONFIRM` — needs someone to check the current implementation before work depends on it
`DEFERRED` — real, but out of this scope; noted so it isn't rediscovered

---

## 1. Tech debt — `READY`

No decisions, no dependencies, all in the extension repo. Ships the brand.

### E1.1 — Extension icons are not declared · `READY`

**Symptom:** Chrome renders a generated grey letter tile ("M") in the side-panel header and toolbar instead of the brand mark.

**Cause:** `public/manifest.json` has no top-level `icons` block, and `action` carries only `default_title`.

**Fix:** copy `assets/icons/*.png` to `public/icons/` and add **both** blocks — `icons` drives chrome://extensions, the side-panel header and the extension menu; `action.default_icon` drives the toolbar button. Declaring one leaves the other on the fallback.

```json
"icons": {
  "16": "icons/icon-16.png",
  "32": "icons/icon-32.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png"
},
"action": {
  "default_title": "Minted Panel Workbench",
  "default_icon": { "16": "icons/icon-16.png", "32": "icons/icon-32.png" }
}
```

**Variant:** `assets/icons/icon-*.png` is the mark in `#1B4D3E` on transparency — **recommended**, and correct for how a side-panel header treats a brand mark (mark only, no tile). `assets/icons/tile/icon-*.png` is a white mark on a `#1B4D3E` rounded tile — use if the dark-theme toolbar test fails, since a dark-green mark disappears on a dark toolbar. Ship all four sizes from **one** variant; never mix.

**Why it matters more than it looks:** the design removes the extension's second green header, making Chrome's header plus this icon the entire brand surface.

### E1.2 — Design-system conformance was never applied · `READY`

Specified in the extension's own `docs/design-system/README.md` and `changes.md`. Production still renders pre-conformance values. This is most of the perceived brand gap between the two products.

| Aspect | Ships today | Target |
| --- | --- | --- |
| UI font | Instrument Sans | **Geist** |
| Primary | `#164A2F` | **`#1B4D3E`** (hover `#163F33`) |
| Panel background | `#F5F6F5` (cool) | **`#FDFDFC`** (warm) |
| Border | `#E5E8E6` | **`#E8E5E0`** |
| Muted surface | `#EFF1EF` | **`#F5F4F1`** |
| Ink | `#182B20 / #5B6B60 / #99A49B` | **`#1F2937 / #6B7280 / #9CA3AF`** |
| Control shadow | `shadow-sm` | **none** — 1px borders only |
| Status pill radius | `999px` | **4px** |
| Card radius | 8px | **6px** |
| Focus ring | 2px solid primary | **1px primary + 2px soft ring** `rgba(27,77,62,.18)` |

**Steps:**
1. Replace the `:root` block in `src/sidepanel/sidepanel.css` with doc 09's token set. Keep legacy aliases so existing selectors resolve unchanged.
2. Swap the four `@font-face` blocks from Instrument Sans to Geist; ship woff2 weights 400/500/600/700 to `/fonts`.
3. **Geist must be self-hosted** — MV3's CSP blocks the Google Fonts CDN. Do not add a `<link>`.
4. Most of the rest follows because the panel keys off tokens. `.pill`'s hardcoded `999px` is the one manual change.

**Verify against:** `7 - Workbench Panel.dc.html`, which renders before and after side by side at panel width.

### E1.3 — Doubled credential suffix · `READY`
The provider card renders "Jim Apple, PT, PT". The suffix is appended twice in the profile projection the panel consumes.

### E1.4 — "Sign out" is unreadable · `READY`
Green link on the dark forest header — effectively invisible at real scale. Replace with the avatar menu in doc 02 §2.1. If any text treatment stays on dark, use `#A7B5AD`.

### E1.5 — Terminology rename · `READY`
The extension says "SOP tasks" and `extension_fill`; the app standardized on **"Template"** and **"Auto-fill"**. Rename in the extension. No behavior change.

### E1.6 — Remove the second header · `READY`
The panel's own green bar duplicates Chrome's header. Remove it; Chrome's header plus E1.1's icon is the brand surface. Frees ~50px of vertical space in a panel that has none to spare.

---

## 2. The decision that was blocking everything — `DECIDED`

**Does the extension get a write path for captured field mappings?** **Yes — propose-only.**

The extension is read-only by locked decision. `src/shared/fixit.ts`:

> the extension NEVER writes mappings (R6 read-only boundary)

Gaps are partitioned instead — `no_mapping` routes to `/portals/<key>/train?field=…` in the app, `no_value` routes to `/providers/:id`. The README repeats it: *"The extension stays read-only: the only writes are the existing manual touch POST and the user-scoped layout PUT."*

Meanwhile the Template Editor's online-form step has a capture mode reading "Capture this form's fields" that names no actor. Whoever performs it must be on the live portal page — which is the extension — and the extension couldn't write what it found. That contradiction gated four journeys.

**Resolution:** the boundary moves, narrowly. The panel may write rows with `status: "proposed"`. It may **never** write an approved row, and a proposed row never fills. Approval is a user action, available in the panel and in the Template Editor.

**What this unblocks:** C4, C6, and the whole compounding loop.

---

## 3. Enablers in blocking order

### E3.1 — Side-panel launch gesture · `SPIKE` — **do this first**

A web page cannot open a Chrome side panel. Route: `externally_connectable` → `chrome.runtime.sendMessage` → worker calls `chrome.sidePanel.open()`. Since Chrome 116 that needs a user gesture; a gesture originating on a web page may not satisfy it.

**Outcome A (works):** C1 launch is one click. **Outcome B (doesn't):** the app opens the portal URL, the panel picks up context on focus — the design already works, but copy must not promise the launch.

Affects C1 and the Template Editor capture card. Cheap to spike, and it changes two pieces of copy either way.

### E3.2 — Capture session handshake · `DECIDED`, needs scoping

How a capture binds to a template step + portal key. Does the app mint a token the panel presents back? Determines whether a capture survives an MV3 worker restart — which, combined with the PHI rule, means labels and counts can be restored but never values.

Blocks C4.

### E3.3 — DB-driven portal registry · `READY`

`src/shared/portals.ts` is one hardcoded portal (`bcbs_ks_enrollment`, BCBS KS). **Banner PNM does not exist in the extension.** Field-map rows already carry `url_pattern` for this.

No UI work at all — but every journey caps at one payer form until it lands. Blocks C1's portal matching, C4, C5, and any realistic demo.

### E3.4 — Return notification: pull or push · `DECIDED` (pull)

Does the editor poll, subscribe, or refresh on revisit? **Shipping answer: manual pull** — "Check for captured fields". Deliberate low-risk choice, no notification infrastructure. If push lands later, the button becomes a refresh.

This is why approving in the panel is the primary path: it avoids the round trip entirely.

### E3.5 — Task source in the panel · `CONFIRM`

`task_id` plumbing is ready — the server closes a linked task and records a `task_update` when supplied — but v1 sends none because the panel has no task source (locked decision (c)). Task completion therefore still happens in the app.

**Without this, Progress cannot complete a step**, which makes it a read-only duplicate of Case Detail and not worth its tab. Blocks C2's task closure and the Progress tab's reason to exist.

### E3.6 — Drift ingestion · `CONFIRM`

`formDrift.ts` exists and already lights the `Drift detected` KPI on Payer Setup plus repair mode in the editor. **Confirm what actually writes to it today** before repair depends on panel reports. Blocks C5.

---

## 4. Catalog contradiction — `DECIDED` (resolved)

The repo README describes a **closed catalog**: defaults plus "up to 3" extra fields, server-owned, mirrored in `src/shared/quickCards.ts`, with `provider.ssnLast4` and vault fields **structurally absent**.

Production does not match — the shipping Customize view exposes **127 fields across 7 groups**, SSN last 4 among them.

**Production wins.** Build the picker against the full 127-field catalog, SSN last 4 included. Update the README and `quickCards.ts` to match rather than the reverse, and **drop the "up to 3" cap** — the card groups by section now, so length no longer matters.

`SSN last 4` obeys the same in-memory-only PHI rule as every other value.

---

## 5. The three additions the current API set doesn't cover

### E5.1 — Label-learning store · `DECIDED`, needs design
A mapping made on one payer proposed on another, with payer count as evidence. **Without this, C4 is just a nicer blank grid** — this is the mechanism that makes payer 60 cheaper than payer 6.

### E5.2 — Per-field `verified_at` · `DECIDED`
Turns freshness from an inference into a state. Required for the stale treatment in Details (doc 04 §4.8) and for C6's stamping.

### E5.3 — Attestation write · `DECIDED`
`caqh_last_attested_date` plus per-field stamps from one attestation event. Without it, UC-8 has nowhere to land.

---

## 6. Upstream, out of this scope — `DEFERRED`

Carried from the payer handoff and still open. The extension work sits downstream of a working payer record, so these will surface eventually.

- No in-app payer-create API
- No `payer_contacts` table
- No archive flag or merge operation on payers
- No ID-expectation columns on the payer record

**Needs design when you're ready**, not just engineering. Flagged so it isn't rediscovered as a blocker mid-epic.

---

## 7. Product answers that shaped this (2026-07-27)

Recorded because they overturn earlier design work — if you find a contradiction in an older file, these win.

1. **Approval is not a separate role.** Two people use both products; approving a captured mapping is a training matter, not a permissions one. Keep the propose/approve *gate*; do not build an approver role.
2. **CAQH is a destination, not a source.** Coordinators update CAQH and complete attestation. The earlier compare/accept design is replaced by fill-then-attest. Pulling a value back exists only for a true gap and is rare. **Do not build bidirectional sync.**
3. **Catalog resolved in favor of production** — 127 fields, SSN last 4 included, no "up to 3" cap.
4. **Queue ranking comes from the case workflow** — task due dates and overdue state. The panel surfaces that order; it never computes its own.
5. **Trust in autofill is earned by outcomes over time.** First-pass rate per payer is the signal, which is why the prove/evidence path stays and why silent skips are unacceptable.
6. **Keep both people on cases, not managing the system.** Setup belongs inside the case flow wherever possible. This is why capture approval is offered in the panel.
7. **Portal sessions are not a pain point.** Do not design around session expiry.

---

## 8. Summary table

| ID | Enabler | Status | Blocks |
| --- | --- | --- | --- |
| E1.1 | Manifest icons | `READY` | brand |
| E1.2 | Tokens + self-hosted Geist | `READY` | brand |
| E1.3 | Doubled credential suffix | `READY` | — |
| E1.4 | Sign-out contrast | `READY` | — |
| E1.5 | Terminology rename | `READY` | — |
| E1.6 | Remove second header | `READY` | vertical space |
| E3.1 | Side-panel launch gesture | `SPIKE` | C1 copy, capture card copy |
| E3.2 | Capture session handshake | scoping | C4 |
| E3.3 | DB-driven portal registry | `READY` | C1 matching, C4, C5, any demo |
| E3.4 | Return notification | `DECIDED` (pull) | C4 ergonomics |
| E3.5 | Task source in the panel | `CONFIRM` | C2 task closure, Progress tab |
| E3.6 | Drift ingestion | `CONFIRM` | C5 |
| §4 | Catalog reconcile | `DECIDED` | the picker |
| E5.1 | Label-learning store | design | C4's value |
| E5.2 | Per-field `verified_at` | `DECIDED` | stale state, C6 |
| E5.3 | Attestation write | `DECIDED` | C6 |
| §6 | Payer record gaps | `DEFERRED` | everything, eventually |
