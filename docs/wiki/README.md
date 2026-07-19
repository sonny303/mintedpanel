# Minted Panel Wiki

User-facing documentation for the app. **Owner: Devin** (PM directive
2026-07-19, `ROADMAP-STATUS.md` jobs item 6). Home and mechanism: in-repo
under `docs/wiki/` so every E6.x build PR updates its own impacted pages as
part of the merge (Devin verifies at review), with a final sweep at E6.6.

## Pages

Walkthroughs — one per sidebar item (the E6.1 six-item model), journey-
oriented per `DECISION-RECORD-2026-07-19-simplification.md`:

| Page                                         | Sidebar item            | Journey                          | Primary epic |
| -------------------------------------------- | ----------------------- | -------------------------------- | ------------ |
| [cases.md](./cases.md)                       | Cases (default landing) | D — casework                     | E6.0, E6.1   |
| [payer-setup.md](./payer-setup.md)           | Payer Setup             | A — payer readiness              | E6.5         |
| [reporting-center.md](./reporting-center.md) | Reporting Center        | reporting                        | E6.6         |
| [org-detail.md](./org-detail.md)             | Org Detail              | B — org reality                  | E6.1         |
| [groups.md](./groups.md)                     | Groups                  | B/C — payer network + generation | E6.2, E6.3   |
| [providers.md](./providers.md)               | Providers               | B — people record                | E6.4         |

Reference:

- [data-definitions.md](./data-definitions.md) — plain-English definitions
  of the data the app shows and stores: entities, the eight case statuses,
  derived pills/rollups, enrollment facts, generation dispositions, gap
  pills, and the append-only ledgers.
- [where-did-it-go.md](./where-did-it-go.md) — the retirement map: every
  pre-E6 surface, where its job moved, and the redirect that covers old
  links. Derived from the E6.1 retirement ledger/redirect table.

## Update rules

- Each page carries an `Updated for:` line naming the last epic merged into
  it. A build PR that changes a page's surface updates the page in the same
  PR; Devin's review checks this alongside the FR trace.
- Pages describe the SHIPPED app on `redesign` — not planned behavior. Until
  an epic merges, its target-state notes are marked _(lands with E6.x)_.
- Seed material: the PM's E6 Training/UAT workbook (per-menu walkthroughs,
  journey map, coverage matrix — maintained by the review session) feeds the
  walkthrough pages as epics land.
