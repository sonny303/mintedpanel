# 03 — App changes

Small, additive, all shown in the bundled screens. Their purpose is to make the return trips **visible**, so a coordinator never re-records work they already did in the panel.

None of these are redesigns. Do not restructure the screens.

---

## 3.1 Case Detail (`6 - Case Detail.dc.html`)

**A. New touchlog tag: `Workbench`**

Tag chip colors follow the existing `tone()` helper. Add:

```
Workbench → { bg: "#E7F5EF", color: "#047857" }
```

This is the only green tag in the log, and it should be — it marks the one source that recorded itself.

**B. Touchlog entry shape**

A submission from the panel appends an entry that names the fill result and the reference, and carries status evidence:

> **Workbench** — Filled and submitted the PNM enrollment from the panel — 17 of 18 fields filled, Group NPI skipped.
> Sowmya · 6d ago · Banner PNM portal · Ref 2201-4471 · *evidence for → Submitted*

The `Ref` value comes from `payer_reference`; the field counts from `fill_report`. The evidence suffix uses the existing `evidence` rendering (`#B45309`).

**C. Status timeline evidence source**

The timeline already labels transitions with their evidence ("portal touch", "email touch"). Add `workbench touch` for transitions driven by a panel submission.

**D. Launch button**

Carries the C1 payload. See doc 06 C1 and doc 07 E3.1 — **the copy must not promise to open the panel** unless the spike proves the gesture forwards. If it doesn't, this opens the portal URL and the panel picks up context on focus.

---

## 3.2 Template Editor (`4 - Template Editor.dc.html`)

The online-form step becomes the **approval queue** for captured mappings — the secondary path, since approving in the panel keeps the coordinator on the case.

**A. The capture card** (shown when a portal is registered but no fields exist)

Current design, final copy:

> **Waiting on a capture**
> Open the form, then capture it with the Workbench panel — it proposes mappings you can approve there or here. Nothing to map until a capture arrives.
>
> `[Open form]` `[Check for captured fields]`

- **"Open form"** opens the portal URL. It does **not** claim to open the panel — see doc 07 E3.1.
- **"Check for captured fields"** is a manual pull. This is the deliberate low-risk choice: no notification infrastructure needed. If a push/subscribe answer lands later (E4.4), this becomes automatic and the button becomes a refresh.

**B. Intent banner copy**

The `capture` intent banner reads:

> **Waiting on field capture** — The portal is registered, but no fields have arrived yet — a Workbench capture on the live form sends them here as proposed mappings.

**C. Mapping table intro**

> Add fields by hand, or approve the ones a Workbench capture proposes. Pick what fills each one, or leave it for the coordinator.

**D. Proposed rows**

A row with `status: proposed` renders distinctly from an approved one and **cannot be used by a fill**. Recommended treatment, consistent with the existing "Broken — the portal changed" chip pattern: a `PROPOSED` chip (`#FBF0E1` / `#B45309`, 19px, radius 4) spanning the row's first column, with the suggested source pre-selected but unconfirmed. Approving clears the chip.

Include the evidence on the row where space allows — `seen on 9 payers` at 10.5px `#9CA3AF`. It is the reason the coordinator can approve quickly.

---

## 3.3 Case Close and IDs (`5 - Case Close and IDs.dc.html`)

**Provenance strip** in the approval dialog, above the ID fields:

`#F7FAF8` background, `1px solid #C8DBD4`, radius 6, padding `10px 12px`, 14px green check, body 12.5px `#33463C`:

> Payer reference `2201-4471` arrived with the Workbench submission on Jul 21 — saved with this approval unless you change it.

The reference is pre-filled and overridable. Nothing else in the dialog changes.

**Why:** the coordinator captured this number weeks earlier, in the panel, at the moment the portal showed it. Making them read it off an approval letter again is the exact re-entry this project exists to remove.

---

## 3.4 Payer Setup (`1 - Payer Setup.dc.html`)

**Drift banner provenance.** The banner's `portal` line names where the drift report came from:

> SelectHealth provider enrollment · reported by a Workbench fill on Jul 24

No other change. The `Drift detected` KPI already counts `driftCount`; panel-reported drift feeds the same store (doc 07, E5.1). The banner CTA already deep-links to repair mode in the Template Editor.

---

## 3.5 What does *not* change

- **Payer Detail** (`3`) and **Add or Edit Payer** (`2`) — no Workbench touchpoints. Listed in the bundle for system context only.
- **Case status semantics.** The panel bumps status via a touch, exactly as an app-side touch does. No new statuses, no new transitions.
- **Payer pipeline stage.** Untouched by anything in this project.
- **Template scoping.** Still payer + group.
