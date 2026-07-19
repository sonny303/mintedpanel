# Payer Setup

_Updated for: pre-E6 baseline (2026-07-19). Pages describe the shipped app; target-state notes are marked with their epic._

Journey A — payer readiness: catalog + SOPs with embedded form setup.
Global: authored once, inherited by every org.

## Today (pre-E6)

Payer administration spans the Payer Setup tabs, Forms & Portals, the
training deck, the test runner, MSO Routing, and Fix-it.

## Target state _(lands with E6.5)_

- Two tabs: **Catalog** and **SOPs**; open to everyone for now.
- Portals fold into the SOP form step: register/pick portal → capture →
  train → dry run → publish, all in place.
- The dry run uses masked MOCK data, once per payer, never per org.
- Drift repair (ex-Fix-it) reopens the same editor.
- MSO routing retires as an org rules engine — delegation becomes a payer
  fact (catalog) and SOP content.
