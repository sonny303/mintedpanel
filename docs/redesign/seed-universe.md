# Seed Universe — Redesign Test Data & Fixture Strategy

Target path: `mintedpanel/docs/redesign/seed-universe.md`

Status: requirements and fixture strategy only, not yet executed. This artifact defines the synthetic test universe used to validate the green-field redesign requirements without relying on messy live demo data.

## Why this exists

The redesign needs stable, recognizable, repeatable data before Stage 0 epics are built. Without a seed universe, Claude Code and Playwright tests will either use messy existing records or create ad hoc examples that drift across epics.

The seed universe gives us one shared fixture set for requirements, build validation, demos with Sowmya, and future Stage 1+ workflows. It is intentionally TV-inspired so the data is memorable, but the product logic comes first: state coverage, payer/SOP hooks, portfolio scale, duplicate risk, multi-operator support, owner-link readiness, and future provider/case scenarios.

## Fixture principles

- Use synthetic data only. No real PHI, no real patient data, no real provider credentials.
- TV inspiration is allowed for recognizability, but fixture names should remain clean and demo-safe.
- Use `.test` email addresses so no seeded email can route externally.
- Seed baseline data directly into the database or test fixture layer; use Playwright to validate flows, not to manufacture the entire universe.
- Keep the fixture stable across epics. Later specs should reference these names rather than inventing new org examples.
- Map every seeded actor back to the scoped persona list. Do not introduce new product personas.
- Stage 0 should seed only what Stage 0 needs; later stages can expand the same universe with groups, facilities, providers, payers, cases, and outcomes.

## Scoped personas used by the fixture

| ID  | Persona                                   | Seed usage                                                       |
| --- | ----------------------------------------- | ---------------------------------------------------------------- |
| P1  | Credentialing Manager                     | Primary working user across the seed universe                    |
| P2  | Credentialing Coordinator / Specialist    | Multi-operator support on one org; execution user later          |
| P5  | Practice / Organization Owner             | Owner captured on each org; link-ready for E0.5                  |
| P6  | Office Manager                            | Reserved for Stage 1 facility intake                             |
| P7  | Provider                                  | Reserved for Stage 1 provider roster and Stage 2 case generation |
| P8  | Practice Biller                           | Reserved for Stage 4 go-live / billable-status views             |
| P9  | Payer Enrollment / Provider-Relations Rep | Reserved for Stage 3 payer follow-up scenarios                   |
| P10 | Payer Portal / System Boundary            | Reserved for Stage 3 portal-fill scenarios                       |

P3 Contracting Specialist and P4 Company Owner / Ops Lead are not required for the first Stage 0 seed. They may be added later when contracting and ops views are specified.

## Seed users and parties

| Seed party       | Persona                                   | Email                           | Purpose                                                                    |
| ---------------- | ----------------------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| Sowmya Seed      | P1 Credentialing Manager                  | `sowmya.seed@example.test`      | Primary Credentialing Manager across the full portfolio                    |
| Coordinator Seed | P2 Credentialing Coordinator / Specialist | `coordinator.seed@example.test` | Second internal party on Shelby Sports Rehab for multi-operator validation |

Owners are seeded per organization using the pattern `owner.<org-slug>@example.test`.

## Core 11-org universe

| \#  | State | Show-world inspiration   | Seed org name                | Lifecycle | Primary purpose                                  |
| --- | ----- | ------------------------ | ---------------------------- | --------- | ------------------------------------------------ |
| 1   | NC    | Outer Banks              | Outer Banks Rehab Group      | Active    | Baseline active NC org                           |
| 2   | NC    | One Tree Hill            | Tree Hill Sports Therapy     | Prospect  | Single prospect; NC same-state overlap           |
| 3   | NC    | Eastbound & Down         | Shelby Sports Rehab          | Active    | Multi-operator org; NC same-state overlap        |
| 4   | NC    | Outer Banks variant      | Outer Banks Therapy Group    | Inactive  | Duplicate-risk pair with Outer Banks Rehab Group |
| 5   | SC    | The Righteous Gemstones  | Gemstone Family Rehab        | Active    | South Carolina payer/SOP coverage                |
| 6   | SC    | Southern Charm           | Lowcountry Charm PT          | Prospect  | Second SC org; prospect scenario                 |
| 7   | CO    | South Park               | South Park Physical Therapy  | Active    | Colorado payer/SOP coverage                      |
| 8   | TX    | Friday Night Lights      | Dillon Sports Medicine       | Active    | Texas sports/PT scenario                         |
| 9   | TX    | 9-1-1: Lone Star         | Lone Star Rehab Group        | Prospect  | Texas same-state overlap; link-pending candidate |
| 10  | WI    | That ’90s Show           | Point Place Physical Therapy | Active    | Wisconsin payer/SOP coverage                     |
| 11  | OR    | Portlandia / Oregon hook | Rose City Rehab Collective   | Prospect  | Oregon hook; portfolio scale                     |

## Owner fixture table

| Org                          | P5 owner name     | Owner email                      | Stage 0 note             |
| ---------------------------- | ----------------- | -------------------------------- | ------------------------ |
| Outer Banks Rehab Group      | Owner Outer Banks | `owner.outer-banks@example.test` | Baseline owner captured  |
| Tree Hill Sports Therapy     | Owner Tree Hill   | `owner.tree-hill@example.test`   | Prospect owner captured  |
| Shelby Sports Rehab          | Owner Shelby      | `owner.shelby@example.test`      | Multi-operator org owner |
| Outer Banks Therapy Group    | Owner OB Therapy  | `owner.ob-therapy@example.test`  | Duplicate-risk owner     |
| Gemstone Family Rehab        | Owner Gemstone    | `owner.gemstone@example.test`    | SC owner captured        |
| Lowcountry Charm PT          | Owner Lowcountry  | `owner.lowcountry@example.test`  | Prospect owner captured  |
| South Park Physical Therapy  | Owner South Park  | `owner.south-park@example.test`  | CO owner captured        |
| Dillon Sports Medicine       | Owner Dillon      | `owner.dillon@example.test`      | TX owner captured        |
| Lone Star Rehab Group        | Owner Lone Star   | `owner.lone-star@example.test`   | Link-pending candidate   |
| Point Place Physical Therapy | Owner Point Place | `owner.point-place@example.test` | WI owner captured        |
| Rose City Rehab Collective   | Owner Rose City   | `owner.rose-city@example.test`   | OR owner captured        |

## CRM contact fixtures (E0.2)

Added by the reviewer (Devin, 2026-07-08, PM-approved) to close the E0.2 FR-5 gap. Same fixture principles: synthetic only, `.test` emails, 555 phone numbers, TV-inspired but demo-safe.

### Sales rep (every org)

| Field   | Value                                              |
| ------- | -------------------------------------------------- |
| Name    | Zeb Loewenstine                                    |
| Role    | `sales_rep` (default on every seeded org)          |
| Email   | `zeb@mintedpanel.example.test`                     |
| Phone   | 704-555-0100                                       |
| Address | 101 S Tryon St, Suite 400, Charlotte, NC 28280, US |

### Customer contact per org

| Org                          | Customer contact  | Email                              | Phone        | Address                                               |
| ---------------------------- | ----------------- | ---------------------------------- | ------------ | ----------------------------------------------------- |
| Outer Banks Rehab Group      | Sarah Cameron     | `contact.outer-banks@example.test` | 252-555-0111 | 12 Figure Eight Rd, Kill Devil Hills, NC 27948, US    |
| Tree Hill Sports Therapy     | Haley James       | `contact.tree-hill@example.test`   | 910-555-0112 | 44 Rivercourt Ln, Wilmington, NC 28401, US            |
| Shelby Sports Rehab          | April Buchanon    | `contact.shelby@example.test`      | 704-555-0113 | 210 Stadium Dr, Shelby, NC 28150, US                  |
| Outer Banks Therapy Group    | Rose Cameron      | `contact.ob-therapy@example.test`  | 252-555-0114 | 8 Lighthouse Rd, Nags Head, NC 27959, US              |
| Gemstone Family Rehab        | Judy Gemstone     | `contact.gemstone@example.test`    | 843-555-0115 | 1 Salvation Center Blvd, Charleston, SC 29401, US     |
| Lowcountry Charm PT          | Cameran Eubanks   | `contact.lowcountry@example.test`  | 843-555-0116 | 77 East Bay St, Charleston, SC 29401, US              |
| South Park Physical Therapy  | Sharon Marsh      | `contact.south-park@example.test`  | 719-555-0117 | 260 Avenue de los Mexicanos, South Park, CO 80440, US |
| Dillon Sports Medicine       | Coach Eric Taylor | `contact.dillon@example.test`      | 432-555-0118 | 500 Panther Field Rd, Dillon, TX 79714, US            |
| Lone Star Rehab Group        | Owen Strand       | `contact.lone-star@example.test`   | 512-555-0119 | 126 Firehouse Way, Austin, TX 78701, US               |
| Point Place Physical Therapy | Kitty Forman      | `contact.point-place@example.test` | 414-555-0120 | 416 Marie Dr, Point Place, WI 53511, US               |
| Rose City Rehab Collective   | Candace Devereaux | `contact.rose-city@example.test`   | 503-555-0121 | 3550 N Mississippi Ave, Portland, OR 97227, US        |

All address fields split per schema (`line1`, optional `line2`, `city`, `state`, `postal_code`, `country`). Customer contacts are P5-side practice people distinct from the seeded P5 owners.

## Party / role assignment matrix

| Org                          | P1 Credentialing Manager | P2 Coordinator   | P5 owner          | Notes                         |
| ---------------------------- | ------------------------ | ---------------- | ----------------- | ----------------------------- |
| Outer Banks Rehab Group      | Sowmya Seed              | —                | Owner Outer Banks | Baseline active org           |
| Tree Hill Sports Therapy     | Sowmya Seed              | —                | Owner Tree Hill   | Single prospect test org      |
| Shelby Sports Rehab          | Sowmya Seed              | Coordinator Seed | Owner Shelby      | Multi-operator org            |
| Outer Banks Therapy Group    | Sowmya Seed              | —                | Owner OB Therapy  | Duplicate-risk / inactive org |
| Gemstone Family Rehab        | Sowmya Seed              | —                | Owner Gemstone    | SC active org                 |
| Lowcountry Charm PT          | Sowmya Seed              | —                | Owner Lowcountry  | SC prospect org               |
| South Park Physical Therapy  | Sowmya Seed              | —                | Owner South Park  | CO active org                 |
| Dillon Sports Medicine       | Sowmya Seed              | —                | Owner Dillon      | TX active sports org          |
| Lone Star Rehab Group        | Sowmya Seed              | —                | Owner Lone Star   | E0.5 link-pending candidate   |
| Point Place Physical Therapy | Sowmya Seed              | —                | Owner Point Place | WI active org                 |
| Rose City Rehab Collective   | Sowmya Seed              | —                | Owner Rose City   | OR prospect org               |

## State coverage and future payer/SOP hooks

This artifact does not define exact payer configuration yet. It reserves state coverage so later Stage 1+ specs can attach payer sets, SOP templates, portal support, and case-generation scenarios consistently.

| State | Fixture orgs                                                                                      | Future use                                                       |
| ----- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| NC    | Outer Banks Rehab Group, Tree Hill Sports Therapy, Shelby Sports Rehab, Outer Banks Therapy Group | Same-state payer overlap, duplicate risk, multi-operator support |
| SC    | Gemstone Family Rehab, Lowcountry Charm PT                                                        | South Carolina payer/SOP coverage                                |
| CO    | South Park Physical Therapy                                                                       | Colorado payer/SOP coverage                                      |
| TX    | Dillon Sports Medicine, Lone Star Rehab Group                                                     | Texas same-state payer overlap, sports/PT scenarios              |
| WI    | Point Place Physical Therapy                                                                      | Wisconsin payer/SOP coverage                                     |
| OR    | Rose City Rehab Collective                                                                        | Oregon hook and scale portfolio coverage                         |

## Stage 0 scenario mapping

| Scenario ID | Requirement scenario          | Fixture mapping                                                                                         | Expected validation                                              |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| TS-0        | Cold start                    | Separate test Credentialing Manager with zero orgs                                                      | First-run Portfolio state appears                                |
| TS-1        | Single prospect               | Tree Hill Sports Therapy only                                                                           | Prospect metric appears; no active-work conflation               |
| TS-2        | Single active                 | Outer Banks Rehab Group only                                                                            | In-motion metric appears                                         |
| TS-3        | Small mixed portfolio         | Outer Banks Rehab Group active + Tree Hill Sports Therapy prospect + Outer Banks Therapy Group inactive | Prospects and in-motion shown separately; inactive excluded      |
| TS-4        | Multi-org all active          | Outer Banks Rehab Group + Shelby Sports Rehab + South Park Physical Therapy                             | Org switcher works across active orgs                            |
| TS-5        | Scale portfolio               | All 11 orgs assigned to Sowmya Seed                                                                     | Portfolio remains legible at scale                               |
| TS-6        | Duplicate risk                | Outer Banks Rehab Group + Outer Banks Therapy Group                                                     | E0.1 duplicate soft warning can be tested                        |
| TS-7        | Owner captured / link pending | Lone Star Rehab Group with owner email captured and link status pending                                 | E0.5 capture-link readiness                                      |
| TS-8        | Multi-operator org            | Shelby Sports Rehab with Sowmya Seed + Coordinator Seed                                                 | Full Party relationship model supports multiple internal parties |

## Recommended seed layers

| Layer                      | Seed method                           | Scope                                                                      |
| -------------------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| L0 — Baseline fixture      | Database seed script or Supabase seed | Creates orgs, lifecycle states, parties, roles, owner emails               |
| L1 — UI-created validation | Playwright through UI                 | Validates E0.1 create-org flow by creating one additional test org         |
| L2 — Scenario mutation     | Playwright helper or test utility     | Changes active org, attempts duplicate create, triggers pending-link state |
| L3 — Future expansion      | DB seed + UI validation               | Adds groups, facilities, providers, payers, cases, outcomes                |

Rule: seed baseline data directly; validate user workflows through UI. Do not require Playwright to create the full fixture universe from scratch.

## Initial seed scope by epic

| Epic                                   | Needs seeded now? | Seed dependency                                                                                 |
| -------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| E0.0 App shell & nav                   | Yes               | TS-0 through TS-5                                                                               |
| E0.1 Create org                        | Yes               | Duplicate-risk pair, owner capture, one UI-created org                                          |
| E0.2 Seat Credentialing Manager to org | Yes               | Sowmya Seed assigned across orgs                                                                |
| E0.3 Full Party model                  | Yes               | Sowmya Seed + Coordinator Seed on Shelby Sports Rehab                                           |
| E0.4 First-run next action             | Yes               | TS-0 cold-start user and active portfolio user                                                  |
| E0.5 Secure one-time capture link      | Partial           | Lone Star Rehab Group with owner email captured; link state may be added when E0.5 is specified |
| E0.6 Portfolio view                    | Yes               | Full 11-org universe                                                                            |

## What gets seeded now vs later

### Seed now for Stage 0

- Organizations with lifecycle state.
- Parties for P1, P2, and P5 owners.
- Role assignments between parties and orgs.
- Owner name and email on every org.
- Multi-operator relationship on Shelby Sports Rehab.
- Duplicate-risk pair: Outer Banks Rehab Group and Outer Banks Therapy Group.
- Link-pending candidate: Lone Star Rehab Group.

### Reserve for later stages

- Provider groups.
- Facilities / locations.
- Provider rosters.
- Insurance policies.
- Payer sets.
- SOP templates and tasks.
- Cases.
- Fill sessions.
- Owner-facing outcomes.
- Recredentialing / expiration data.

## Builder tasks this fixture enables

| Task                | Expected output                                                                   |
| ------------------- | --------------------------------------------------------------------------------- |
| Baseline seed file  | Repeatable creation of the 11-org universe in dev/test                            |
| Reset command       | Clears and reloads the fixture safely                                             |
| Playwright fixtures | Can load TS-0, TS-3, TS-5 and other scenario states predictably                   |
| E0.0 smoke tests    | Validate sidebar, org context, portfolio metrics, org switching, responsive shell |
| E0.1 smoke tests    | Validate create-org and duplicate warning against known fixture data              |
| E0.3 smoke tests    | Validate party/role relationships, especially Shelby Sports Rehab                 |
| Demo script         | Gives Sowmya a clean, recognizable portfolio of orgs in motion                    |

## Guardrails for implementation

- Do not seed into production.
- Do not use real payer credentials or real provider identifiers.
- Do not create new product personas beyond the scoped list.
- Do not use Playwright as the source of truth for baseline fixture creation.
- Do not overload Stage 0 with Stage 1+ entities. Seed placeholders only when the stage requires them.
- Keep names stable once adopted. If fixture names change, update every spec that references them.

## Open items before implementation

- Confirm exact table/column names for org lifecycle state and party/role relationships against the repo/schema before implementation.
- Decide whether Oregon remains a Stage 0 seed-only hook or becomes a future payer/SOP state.
- Decide whether P4 Company Owner / Ops Lead needs a seed row before Stage 4.
- Decide exact link-state model for E0.5 when that epic is specified.

## Reviewer notes (Devin, 2026-07-08)

Not an epic — fixture strategy doc; no frontmatter/lifecycle. Answers and corrections against the live repo:

- **Lifecycle column confirmed (open item 1, partial):** `organizations.lifecycle_state` exists as of E0.0 (`text NOT NULL DEFAULT 'active' CHECK IN ('prospect','active','inactive')`, migration `20260708120000_org_lifecycle_state.sql`, repo + hosted). Seed inserts must set it explicitly per the Core 11-org table. Party/role tables do NOT exist yet — see the open `[e0.1 + e0.2]` entry in `CLARIFICATIONS_NEEDED.md` for the proposed `parties` / `org_party_roles` model E0.3 will formalize.
- **TS-6 correction:** E0.1 F0.1.4 defines the duplicate guard as a **hard block, no override** — not a "soft warning" as written above. Also, "Outer Banks Rehab Group" vs "Outer Banks Therapy Group" have different normalized names and will coexist as seeds; TS-6 must be exercised by attempting to create an org with the _same_ case-/space-insensitive name as an existing one.
- **Existing local fixture:** `supabase/seed.sql` is the legacy 2-org demo fixture (BEST PT / KS FIT PT) with fixed UUIDs. The 11-org universe should be a **separate, additive** fixture layer (e.g. `supabase/seed-redesign.sql` or a test-fixture module) rather than an edit of the legacy file, keeping both loadable independently.
- **E0.2 gap:** this doc has no per-org customer-contact fixtures and no Zeb Loewenstine row, which E0.2 FR-5 requires — flagged in `CLARIFICATIONS_NEEDED.md` for ChatPRD to extend.
- **Epic-list drift:** the "Initial seed scope by epic" table calls E0.2 "Seat Credentialing Manager to org", but the delivered E0.2 is "Org CRM Contact Fields (Customer & Sales Rep)". Update the table when the Stage 0 epic list is final.
