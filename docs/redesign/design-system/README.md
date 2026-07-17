# Handoff: Conform Minted to the Minted Panel Design System

## Overview

The **Minted Panel Design System** is the source of truth for the product's visual language. Over time the shipped code has **drifted** from it — a different UI font, a cooler/darker green, cool-gray neutrals, `color-mix` status tints, shadowed controls, fully-round pills. This handoff brings the two codebases **back into conformance with the design system**.

Two target repos:
- **`sonny303/mintedpanel`** — React + Vite + TanStack Router + Tailwind v4 + shadcn/ui (the web app).
- **`sonny303/minted-extension`** — vanilla TS + a single hand-written `sidepanel.css` (the Chrome side panel).

The goal is **not** a redesign. It is a **token + component migration**: make production render in the design-system values.

## About the design files

The files in `design-system-reference/` are the **authoritative design system** — the intended look, expressed as CSS custom properties, small React primitives, HTML specimen cards, and two full-screen HTML recreations. They are **references**, not drop-in production code: recreate their *values and rules* using each repo's existing environment (shadcn/Tailwind in the app; hand-written CSS in the extension). Do **not** paste the reference React components into the app — the app already has its own component library; you are changing its **tokens and a handful of component styles** to match.

The one exception: `targets/` contains **ready-to-apply token files** written in each repo's own token vocabulary. Those *are* meant to replace the corresponding files (see below).

## Fidelity

**High-fidelity.** Every value in `design-system-reference/tokens/` is final. Match hex, spacing, radius, and type values exactly — do not round or re-interpret. When the design system and the current code disagree, **the design system wins** (that is the entire point of this task).

## Source of truth — where each value lives

- `design-system-reference/tokens/colors.css` — palette, status hues, tint+ink pairs, focus ring.
- `design-system-reference/tokens/typography.css` — font stacks + type scale.
- `design-system-reference/tokens/spacing.css` — spacing, radius, control heights.
- `design-system-reference/tokens/animations.css` — the only motion (spinner + skeleton pulse).
- `design-system-reference/readme.md` — the written foundations (voice, color, type, shadow, radius, focus, motion rules). **Read this first.**
- `design-system-reference/ui_kits/minted-panel/` — `index.html` (Providers page) and `extension.html` (side panel) show the **target look** for each surface. Open them in a browser as your visual reference.
- `design-system-reference/components/` — the component contracts (`.d.ts`) and reference implementations for each primitive, with per-directory specimen cards.

## The magnitude (read before starting)

This pulls production back to the approved reference design. Expect visible change:

| Aspect | Current (production) | Target (design system) |
|---|---|---|
| UI font | Instrument Sans | **Geist** |
| Primary | `#164A2F` / hover `#1D5C3C` | **`#1B4D3E`** / hover **`#163F33`** |
| App bg | `#F5F6F5` (cool) | **`#FDFDFC`** (warm) |
| Border | `#E5E8E6` | **`#E8E5E0`** |
| Muted | `#EFF1EF` | **`#F5F4F1`** |
| Ink | `#182B20 / #5B6B60 / #99A49B` | **`#1F2937 / #6B7280 / #9CA3AF`** |
| Status tints | `color-mix(hue 12–14%, white)`, raw-hue text | **fixed tint + darker ink pairs** |
| Control shadow | `shadow-sm` on inputs/buttons | **none** (1px borders only) |
| Status pill radius | `999px` (round) | **4px** (rounded rect) |
| Card radius | 4px | **6px** |
| Focus ring | 1px primary | **2px soft primary ring** (`rgba(27,77,62,.18)`) |

Status **hues** (green/blue/amber/red/teal/gray) are already correct — only their tint/text treatment changes.

## How to apply

Work in phases (details in **`changes.md`**). Recommended order — each phase is shippable on its own:

1. **Phase 1 — Tokens + font** (highest impact, lowest risk): swap the two token files from `targets/`, swap the font import. ~90% of the visual conformance, no component logic touched. NOTE: the font and token files are **protected files** in AGENTS.md — this handoff is the explicit PM instruction authorizing the change.
2. **Phase 2 — Control conformance**: remove control/card shadows, status pills → 4px, cards → 6px, focus ring → 2px soft, pill text → DS ink.
3. **Phase 3 — Navigation restructure** (approved spec: `design-system-reference/Sidebar Nav.dc.html` + the NAVIGATION section of the reference readme): re-group the sidebar to Workspace (Home, Cases + count) / Payers (Payer Management) / Reporting Center; org switcher becomes the labeled tile (no "Org space" heading) with lifecycle-grouped menu + search-at-10+ scale rules; user menu gains Settings; active items get the 2px mint inset bar; nav focus ring becomes white-alpha. Tasks fold under Cases — remove the reserved Tasks item. SOP folds into Payer Management.
4. **Phase 4 — Component adoption + renames**: adopt the Tier-1 specs (Card, Tabs, Tooltip, Toast, Checkbox, Switch — already in `src/components/ui/`, restyle to spec); rename `triage/FilterCards` → `SummaryChips` and align other triage names to the spec; keep standalone Skeleton AND the designed EmptyState. DropdownMenu / Separator / Collapsible / Skeleton stay stock (token-styled, no spec).
5. **Governance**: add `DESIGN-DEBT.md` (template included) to the repo root; unapproved components must be logged there per the COMPONENT GOVERNANCE section of the reference readme.
6. **Type scale** (optional, larger blast radius): cap display sizes to the DS ramp (page title 16, H2 22).

## Verify

- Diff the app's `/home`, `/providers`, `/reports` and the extension side panel against `design-system-reference/ui_kits/minted-panel/*.html`.
- Confirm: Geist renders; primary is `#1B4D3E`; no shadow on inputs/buttons/cards; status pills are 4px; focus shows the 2px soft ring; numbers still use Geist Mono + tabular figures.
- Run each repo's existing lint/build; no token name was renamed, so nothing should break structurally.

## Files in this bundle

- `README.md` — this document.
- `changes.md` — phased, file-by-file instructions for both repos.
- `targets/mintedpanel-tokens.css` — drop-in replacement for `mintedpanel/src/styles/tokens.css`.
- `targets/minted-extension-tokens.css` — drop-in `:root` block for `minted-extension/src/sidepanel/sidepanel.css`.
- `design-system-reference/` — the full design system (tokens, components incl. the new Card/Tabs/Toast/Tooltip/Checkbox/Switch/PageHeader, guidelines, UI kits, assets, readme with NAVIGATION + COMPONENT GOVERNANCE sections, `DESIGN-DEBT.md` template, and the approved `Sidebar Nav.dc.html` — open it in a browser for the sidebar spec + org-switcher/user-menu overlay states). The source of truth.

Demo data note: use the seed-universe org names (`docs/redesign/seed-universe.md`) in any UI validation — the approved sidebar mock uses Outer Banks Rehab Group + the 11-org switcher.
