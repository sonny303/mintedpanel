# Payer catalog reference data (E1.6 prep — built without the Stedi API)

Compiled 2026-07-12 on PM direction: gather the identity data the Stedi payer
directory would have provided (E1.6 F1.6.2) ourselves, plus the market and
MSO context a robust payer-selection table needs. This dataset is the
**seed source** for the E1.6 global payer catalog: the epic's schema
(`payer_kind`, `aliases[]`, `states[]`, `payer_slug`, `status`) is
unchanged — only the feed behind F1.6.2 changes from an API sync to this
curated table. Credentialing fields (`portal_url`, `avg_decision_days`, etc.)
remain Minted-curated and are NOT sourced here, per the epic's locked
"identity spine only" rule.

**Scope:** medical payers only — dental-only, vision-only, standalone Part D,
supplemental/indemnity, workers' comp, and stop-loss carriers are excluded by
rule.

## Files

| File                          | Grain                    | Rows | What it is                                                                                                                                                                                                     |
| ----------------------------- | ------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state_payer_rankings.csv`    | state × rank             | 491  | Top-10 medical payers per state (all 50), ranked by total in-state covered lives across commercial (fully-insured + ASO), Medicare Advantage, and managed Medicaid                                             |
| `payers.csv`                  | canonical payer entity   | 270  | One row per operating payer (the E1.6 `payers` global-row grain): kind, LOBs, states, aliases, clearinghouse payer ID (retained but ignored per the 2026-07-12 PM decision; `payer_slug` is the canonical key) |
| `mso_delegations.csv`         | MSO × payer relationship | 14   | Delegated-network/credentialing layers (ASH, Optum Physical Health, Carelon…) + UM-only vendors explicitly flagged — feeds `mso_routing_rules` curation                                                        |
| `medicare_macs.csv`           | state                    | 50   | Medicare A/B MAC jurisdiction + contractor per state (the universal implicit payer's enrollment route)                                                                                                         |
| `state_medicaid_programs.csv` | state                    | 50   | Medicaid program name, delivery model (managed_care / ffs / hybrid), MCO contract notes                                                                                                                        |

## How it was built (methodology)

- Twelve parallel research passes (ten of five states each, one MSO landscape,
  one clearinghouse payer IDs), each web-verifying against 2023–2026 sources:
  the AMA _Competition in Health Insurance_ study, KFF state data, NAIC/state
  DOI market-share reports, state Medicaid agency MCO lists, payer provider
  manuals, and the Availity Essentials 837 payer list.
- **No invented numbers.** `approx_share_pct` is null unless a source stated
  it; `share_basis` names the source, year, and what the figure measures
  (bases differ — commercial-only, individual-market-only, all-lines — read it
  before comparing rows). Rows resting on model knowledge rather than a
  fetched source say `unverified: model knowledge` in `share_basis`.
- **Honest market sizes.** Thin states are not padded to ten: AK and WY list
  7 real payers, VT 6 — the structural reason is noted in-row.
- **Ranking `payer_kind`** is the payer's dominant line **in that state**
  (`commercial | medicare_advantage | medicaid_mco | tricare`); the same
  carrier can be `commercial` in one state and `medicaid_mco` in another.
- Cross-state name variants were folded to one canonical entity per operating
  payer (e.g. twelve spellings of Aetna → `Aetna (CVS Health)`); the
  `as_reported` column in the rankings preserves the original in-state
  wording. State subsidiaries that are distinct enrollment targets (BCBS
  licensees, Centene/Molina/CareSource state plans, Kaiser regional plans,
  per-state Anthem licensees) deliberately stay separate entities — that is
  the catalog grain E1.6 stores.

## Mapping to the E1.6 `payers` columns (TE-2)

| CSV column                           | E1.6 column             | Notes                                                                                                                  |
| ------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `payers.csv name`                    | `name` (global row)     |                                                                                                                        |
| `aliases` (pipe-separated)           | `aliases text[]`        | Includes former names, dba brands, Medicaid product names                                                              |
| `states` (pipe-separated)            | `states text[]`         | States where the payer ranked top-10; a payer can operate in more states than it ranks in                              |
| `payer_kind`                         | `payer_kind`            | Pipe-joined union of per-state dominant lines; collapse per seeding policy (diversified carriers default `commercial`) |
| `clearinghouse_payer_id`             | ignored (PM 2026-07-12) | Professional 837P ID as observed at a clearinghouse — retained but unused; see caveats below                           |
| `stedi_slug` / `enrollment_required` | (Stedi mirror fields)   | Sparse: Stedi's site was bot-blocked during collection; captured only where a slug surfaced in search results          |

Government payers (`medicare`, `medicaid`, `tricare` kinds) exist in this
dataset because they are real credentialing targets; the R2 directory UI still
filters to commercial by default per the epic.

## The two universal implicit payers

Original Medicare and state Medicaid FFS are enrollment targets in **every**
state but are not ranked rows (they would occupy two identical slots
everywhere). Their enrollment routes live in `medicare_macs.csv` (MAC
jurisdiction + contractor; PECOS enrollment universally required) and
`state_medicaid_programs.csv` (program name + model). The one exception:
Wyoming's rankings include a combined direct-government row because its
market is FFS-dominant with no MCOs.

## MSO table semantics (read before creating routing rules)

`function` distinguishes `network_delegation` / `credentialing_delegation`
(provider must credential **with the MSO**, e.g. ASH for Cigna in delegated
markets, Optum Physical Health for UHC therapy/chiro, Carelon Behavioral for
Anthem BH) from `um_only` (eviCore, Cohere, Evolent/NIA — prior-auth vendors;
the provider still credentials with the payer). **`um_only` rows must never
become MSO credentialing-routing rules.** TRICARE regional contractors
(Humana Military East / TriWest West, current T-5 map incl. the six states
that moved West in 2025) are in `payers.csv` + the delegation file's TRICARE
block. `confidence` is `verified` (source fetched during collection) or
`established` (well-known, not re-verified) — re-verify `established` rows
before acting on them.

## Payer ID caveats

- IDs are the **professional (837P)** payer ID as seen at a specific
  clearinghouse (mostly the Availity Essentials 837 list, plus Claim.MD pages
  and payer EDI manuals — `id_source` names the source per row). IDs can
  differ across clearinghouses; verify against your clearinghouse before
  wiring anything.
- Known conflicts are left **blank with the conflict noted** rather than
  guessed (Kaiser WA, Kaiser Mid-Atlantic, Kaiser GA, Security Health Plan).
- Centene consolidates most state plans on `68069` (WellCare-branded plans
  differ); CareSource and Anthem use per-state IDs — both patterns are split
  per entity where the source enumerated them.
- Medicare claims route per-MAC (one CMS contractor ID per jurisdiction) —
  build that map from each MAC's payer list when it's needed; it is not
  reproduced here.

## Refresh process (replaces the F1.6.2 Stedi sync)

Quarterly + on-demand, matching the epic's locked cadence: re-verify the
volatile layers (Medicaid MCO contract lineups, TRICARE regions, M&A,
market exits — the things that changed most in this collection), record
changes as `payer_catalog_changes` diffs once E1.6 ships that table, and
never silently overwrite curated fields. Recent-churn rows already carry
their event + date in `notes` (e.g. Georgia's CMO turnover live 2026-07-01,
Nevada statewide managed care 2026-01-01, UCare receivership, Health
Alliance wind-down) — start refreshes there.

## Known limits

- Ranks 1–5 are well-anchored; ranks 6–10 in fragmented or thin markets rest
  partly on model knowledge (always labeled in `share_basis`).
- Self-funded ASO books are not publicly reported at state grain — national
  administrators (Cigna, Aetna, UMR) may be under- or over-ranked in ASO-heavy
  states.
- Share percentages are sparse by design and their bases differ row to row —
  never compare `approx_share_pct` across rows without reading `share_basis`.
- Snapshot date 2026-07-12; Medicaid MCO lineups in flux (GA, NV, ID duals,
  MS, LA, VA, RI, IN, KS) are captured as of that date.
