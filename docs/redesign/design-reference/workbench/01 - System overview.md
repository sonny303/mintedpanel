# 01 — System overview

## The two products

**The web app** (`mintedpanel`) is where credentialing is managed: payers, templates, providers, groups, cases, reporting. Setup happens here; cases are tracked here.

**The extension** (`minted-extension`) is a Chrome side panel that lives beside payer portals. It holds one case in hand and helps the coordinator do the work *inside* someone else's website — the part the web app cannot reach.

The panel is not a miniature of the app. It has exactly one job: make the work in the portal faster, and make sure it gets recorded without anyone re-typing it later.

## The one loop

Every journey is this loop against a different destination:

```
Pick up work → See what this page needs → Do it → It records itself → Next
```

A coordinator in a browser only ever does three things: **read** a value, **write** a value, or **record** that something happened. The panel reads the active tab and offers the right one. That is why there are no modes to choose and no navigation inside the panel beyond two tabs.

## The three contexts

Same panel, same case in hand. What changes is the offer, because the panel knows what page it's on.

| Context | Verb | The offer |
| --- | --- | --- |
| A payer form we know | **write** | Fill it. Lead with fill; single-value copy stays available because coordinators verify anyway. |
| CAQH | **write** | Fill CAQH from our record, then record the attestation. Pulling a value back is a rare exception. |
| A form we don't know | **record** | Propose mappings from labels seen on other payers, with the payer count as evidence. Never a blank grid. |

Two guard states cut across all three: **duplicate work** (fires on pickup, never blocks) and **case mismatch** (this page belongs to a different case).

## The field catalog is the spine

One row per field, 127 fields across 7 groups. Every feature is a different column on the same list rather than a separate product:

- **Details** = field + our value, filtered to what the coordinator chose
- **The picker** = field + whether it's on the card
- **Mapping** = field + what this payer calls it
- **Attestation** = field + what CAQH last received
- **Freshness** = field + when it was last confirmed

This is why mapping stops feeling like a second job. The coordinator already lives in this list all day.

**Catalog shape** (counts are load-bearing for the picker):

| Group | Fields |
| --- | --- |
| Provider | 45 |
| Group | 39 |
| Location | 23 |
| License | 9 |
| Location assignment | 3 |
| Group insurance | 6 |
| User | 2 |
| **Total** | **127** |

Includes `SSN last 4` — see doc 07, section 4 for why, and the PHI rules below for how it must behave.

## Why the system should get cheaper with use

Today payer 60 costs the same as payer 6: every setup starts from a blank grid and the knowledge lives only in the coordinator's head. Four mechanisms change that, and they are the reason seams 4–6 exist:

1. **Every mapping teaches the next.** A label resolved once is proposed on the next payer, with the payer count as its evidence.
2. **Every drift repair hardens the form.** A selector that broke and was fixed becomes known-fragile; coverage checks watch it first.
3. **Every attestation dates the data.** Pushing to CAQH and attesting stamps every field it carried. Stale stops being invisible without a cleanup project.
4. **Every submission proves the path.** A form that filled cleanly and was accepted is evidence. First-pass rate per payer becomes the number that says which payers to trust.

## Who uses it

**Two people**, and they do everything — payer setup, template authoring, mapping, and filling. There is no separate admin or approver role, and approving a captured mapping is a training matter rather than a permissions one.

The design goal that follows: **keep them working on cases, not managing the system.** Setup work belongs inside the case flow wherever possible rather than in a separate destination. This is why capture approval is offered in the panel and the Template Editor is the secondary path.

Volume is a few submissions a week. Coordinators check every field before submitting, and confidence in autofill will be earned by outcomes over time — which is why first-pass rate matters and why fill must never silently skip something.

## Terminology

| Use | Not |
| --- | --- |
| Template | SOP |
| Auto-fill | extension_fill |
| Minted Panel Workbench | the extension, the panel (in user-facing copy) |
| Case status | (never merged with payer stage) |
| Payer pipeline stage | (never merged with case status) |

The extension still says "SOP tasks" in `sidepanel.html` and its README. That is a rename with no behavior change (doc 07, E1.5).

---

## Invariants — do not break these

**Two status machines, never merged.**
- Internal case status, 8 values: Not Started · In Progress · Submitted · In Review · Action Required · Approved · Denied · Not Pursuing
- Payer pipeline stage, 9 values: the above plus Assigned · Drafting · Out-of-Network

The repo is explicit that these stay independent. Two columns by design. Never derive one from the other.

**Templates are scoped payer + group**, never org-tier — that tier was retired app-side.

**PHI discipline.** Card values, tokens and context stay in memory. Only identifiers and the URL persist on the active-case record. A restored view may show labels and counts but **never values**. This is what makes MV3 worker restarts survivable without leaking.

**A proposed mapping never fills.** The propose/approve gate stays even though the same person does both jobs.

**CAQH is push, not sync.** Do not build bidirectional reconciliation. Coordinators update CAQH and attest; pulling a value back exists only for a field CAQH holds that we have blank.

**The panel does not invent priority.** Queue order and the per-case reason line come from the case workflow — task due dates and overdue state.

---

## Platform constraints

**Panel width is not ours.** Chrome sets the initial width; the user drags it. Observed ~530px, floor ~320px. Design a fluid column between 320 and 560. No fixed widths, no fixed heights, no viewport units — page zoom applies to the panel. **Verify every surface at 320.**

**Two stacked headers.** Chrome draws its own header above the panel content and it is not restylable or removable. The design deliberately removes the extension's second green bar: Chrome's header plus the declared icon *is* the brand surface. This is why the manifest icon work (E1.1) matters more than it looks.

**Nothing escapes the panel bounds.** Custom dropdowns, popovers and tooltips clip at the edge. Native `<select>` is the exception because the OS draws it — which is why the current selects overflow correctly and a styled listbox would not. Any styled listbox must fit inside.

**The MV3 worker restarts constantly.** No flow state can live only in memory. Combined with the PHI rule, a restored view can show labels and counts but never values.

**The portal registry is one hardcoded portal today** — `bcbs_ks_enrollment` in `src/shared/portals.ts`. Banner PNM does not exist in the extension yet. Field-map rows already carry `url_pattern` for a DB-driven registry (doc 07, E3.3).

**Portal sessions are not a pain point.** Users log in fine and session expiry is handled acceptably today. Do not design around it.
