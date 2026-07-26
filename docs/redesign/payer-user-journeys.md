---
title: Payer user journeys — consolidated list
status: reference, current as of 2026-07-26
owner: devin
sources: DECISION-RECORD-2026-07-19-simplification.md, E1.5, E1.6, E4.0–E4.3, E6.2, E6.5, payer-setup-page-build-handoff.md
---

# Payer user journeys — the consolidated list

One list of every payer-touching journey in the product, so both AIs (design
and build) work from the same roadmap. Grouped by the decision-record model:
**Journey A** (payer readiness, global) · **Journey B** (org reality) ·
**Journey C** (generation) · **Journey D** (casework). Items marked
**[REDESIGN]** are changed by the 2026-07 Payer Setup redesign; items marked
**[OPEN]** are being redesigned right now and are not settled.

## Journey A — make a payer workable (global; authored once, inherited by every org)

| #   | Journey                                                                                                                                                     | Where it lives today                                   | Redesign direction                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Browse the payer catalog and see curated facts (states, kind, aliases, delegation)                                                                          | Payer Setup → Catalog tab                              | **[OPEN]** Catalog browse slated for removal — replaced by manual payer setup (fill fields from schema) + duplicate guard. New API enabler epic required (in-app payer creation does not exist)                          |
| A2  | See how close each payer is to "ready for business" (template published → portal registered → mappings trained → proven → no drift)                         | Readiness funnel atop the Catalog tab                  | **[REDESIGN]** Becomes the My network tab: 4 KPI filter cards (Ready / Needs template / Form not proven / Drift) over a paginated table                                                                                  |
| A3  | Author a payer's template (SOP): tasks, steps, publish a version                                                                                            | Payer Setup → SOPs tab → template wizard/editor        | **[REDESIGN]** SOPs tab leaves the page; library reached via the default-template card / payer detail. Interim unlisted `…/templates` route so nothing dead-ends. Long-term home: the payer-detail-style view **[OPEN]** |
| A4  | Set up the payer's portal form inside the template's online-form step: register/pick portal → capture fields → train mappings → mock-data dry run → publish | Template editor form step (E6.5 F6.5.2)                | Unchanged; entry points move with A3                                                                                                                                                                                     |
| A5  | Prove a form once with the masked mock-data dry run (never per org, never real PHI)                                                                         | Template editor (E6.5 F6.5.3)                          | Unchanged                                                                                                                                                                                                                |
| A6  | Repair drift when a real fill reports broken mappings                                                                                                       | Sidebar badge + drift banner on SOPs tab → owning step | **[REDESIGN]** Banner removed; Drift KPI card becomes the landing. Gap: Payer Detail has no drift signal — follow-up PR required before go-live (handoff B3)                                                             |
| A7  | Maintain the default (fallback) template used when no payer template matches                                                                                | Seeded, locked singleton; edit is platform-only        | **[REDESIGN]** Rendered as a read-only card on My network (Edit is impossible for app users — `fallback_sop_locked`)                                                                                                     |
| A8  | Record delegation/MSO knowledge as payer facts + SOP content (rules engine retired)                                                                         | Catalog entry + SOP content (E6.5 F6.5.5)              | Unchanged in substance; surface follows A1's fate                                                                                                                                                                        |

## Journey B — org reality (which payers does this org work with)

| #   | Journey                                                                | Where it lives today                                | Redesign direction                                                                                                               |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Add a payer to the org's network / remove (archive) / reactivate       | Catalog tab Manage column (`org_payer_assignments`) | **[REDESIGN]** My network is the home; add moves to `+ Add payers` → **[OPEN]** "+ Set up payer" manual flow if the catalog goes |
| B2  | See the org's payers and their readiness at a glance                   | Readiness funnel (org's active payers)              | **[REDESIGN]** The My network table + KPI cards; PM decision D2: org-tier template overrides count                               |
| B3  | Attach a payer at the working grain: group × payer × state             | Groups → Payer Network board (E6.2)                 | Unchanged; out of the Payer Setup page's scope                                                                                   |
| B4  | Track fulfillment per group (Targeted → In Progress → Active, derived) | Group payer-network board                           | Unchanged                                                                                                                        |
| B5  | View a payer's detail: facts, templates, portals, scorecard            | Catalog → payer detail; scorecard route             | **[OPEN]** The "payer-detail-style view" being designed — becomes the destination for A3/A6/D1 detail work                       |

## Journey C — generation (the only door cases come through)

| #   | Journey                                                                                                               | Where it lives            | Redesign direction                          |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------- |
| C1  | Candidates derive from group-grain targets − enrollment facts − existing cases − exclusions; wait in a visible buffer | Generation grid (E6.3)    | Unchanged                                   |
| C2  | Case creation stamps the resolved template (org override → global payer → generic fallback)                           | Generation confirm (E2.2) | Unchanged; the fallback warns, never blocks |

## Journey D — casework against a payer

| #   | Journey                                                                                   | Where it lives                                | Redesign direction                       |
| --- | ----------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| D1  | Work a case's payer tasks; extension fills the proven form; humans always submit          | Case detail + extension workbench (E4.3)      | Unchanged (extension contract is locked) |
| D2  | Log payer interactions as structured touches (call/portal/fax…)                           | Add touch (E4.1/E6.6)                         | Unchanged                                |
| D3  | Denial → reason required → reapply continues the SAME case; denials roll up for reporting | Unified status (E6.0) + denials report (E6.6) | Unchanged                                |
| D4  | Mid-flight drift: casework continues manually (warn, never block) while A6 repairs        | Case task + drift telemetry                   | Unchanged                                |

## The three open workstreams (2026-07-26)

1. **Payer Setup page rebuild** — spec'd and ready for Claude Code:
   `payer-setup-page-build-handoff.md` + `design-reference/payer-setup/`
   (PR #235). Catalog slice sequenced last pending #2.
2. **Catalog removal / manual payer setup** — Claude Design is producing the
   bundle (prompt issued 2026-07-26); requires the payer-create API-enabler
   epic before build.
3. **Payer-detail-style view** — being designed; the destination for the
   template library, drift repair, per-payer next steps, and template-status
   detail that the Payer Setup page deliberately stopped showing. Nothing
   deferred to it may be deleted from its current home until it ships.
