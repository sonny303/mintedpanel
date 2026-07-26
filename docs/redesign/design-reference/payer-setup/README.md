# Handoff: Payer Setup page

## Prompt for Claude Code

> Implement the **Payer Setup** page per this README. `Payer Setup - Improved.dc.html` is a design reference — a prototype of the intended look and behavior, **not production code to copy**. Rebuild it in this codebase using the existing components and design tokens. Scope is this one page only: do not touch the sidebar, Payer Detail, the Template Editor, Cases, or Provider pages. Where this design diverges from what's in `main` today, the divergences are listed below and were approved by the product owner — implement the design, not the current behavior.

---

## What this page is

The operating home for payer configuration in the Minted Panel credentialing app (React + TanStack Router + Supabase/PostgREST). It answers two questions:

1. **Which payers do we work with?** → the Catalog tab (browse the full catalog, add/remove from your network)
2. **How close is each one to usable?** → the My network tab (readiness of every payer you've added)

Real routes today: `/admin/payer-admin/catalog` and `/admin/payer-admin/sops`. This design replaces that tab pair with **My network / Catalog** (see Divergences).

---

## Fidelity

High-fidelity. Final colors, type, spacing, radii, and states. Use existing design-system tokens wherever a value matches; the literal values are listed under Design tokens so you can confirm the match.

---

## Page structure (top to bottom)

1. **Header** — `Payer Setup` (24px/600, −.015em) + a live count line beneath it.
   - My network: `"7 payers in your network"`
   - Catalog: `"137 payers in catalog"`, or `"14 of 137 payers"` when any filter or search is active
2. **Divider** — 1px `#E8E5E0`, 20px margin block
3. **KPI cards** — 4-up on My network, 3-up on Catalog. Each is a **filter toggle**, not a static stat.
4. **Toolbar** — one row: segmented tabs · search · filters (· `+ Add payers` on Catalog only)
5. **Table** — the active tab's table
6. **Default template card** — My network only
7. **Footer** — rows-per-page + count on the left, pagination on the right

Content is capped at `max-width: 1200px`, centered, with `28px 32px 64px` page padding.

---

## My network tab

### KPI cards (4)
Each card filters the table; the active one is highlighted (bg `#F0F5F2`, border `#1B4D3E`, forest label + number). Clicking the active card again should clear the filter.

| Card | Counts payers where |
| --- | --- |
| **Ready for business** | published template, and a proven form when the template fills one |
| **Needs template** | no published template names this payer |
| **Form not proven** | template exists, but the portal form isn't registered/trained/proven yet |
| **Drift detected** | a previously-working form now has broken field mappings |

### Filters
- **Search** — placeholder `"Search payers…"`, matches payer name
- **State** — "All states" + the distinct states across your network
- **Kind** — "All kinds" + `Commercial` / `Medicare Advantage` / `Medicaid`

### Table columns
`Payer · State(s) · Kind · Template status`

- **Payer** — 14px/600, links to that payer's detail page. This is the only link in the row.
- **State(s)** — 13px `#6B7280`
- **Kind** — 13px `#6B7280`
- **Template status** — badge: `Published` (green) or `Needs template` (amber)

Table min-width 840px inside an `overflow-x:auto` wrapper, in a 6px-radius card with `overflow:hidden`. Header row bg `#FBFBF9` with a 1px bottom border; rows separated by 1px `#F0EEEA`.

> **Removed deliberately — do not re-add:** a "Next step" column with per-row CTAs, a meta subtitle under the payer name, the drift-alert banner above the table, and the "Drafts in progress" strip. All were cut to get this page down to a reviewable first slice.

### Default template card
Sits below the table because the default template has **no payer**, so it can't live under one. Shows the template name (links to the editor), a `Default template` chip, the line `"Used when no payer template matches · 4 tasks · updated <date>"`, and an `Edit` button. It is **edit-only** — there's no create path for a payerless template (noted under Open questions).

---

## Catalog tab

### KPI cards (3)
`In network` · `Not added` · `Inactive` — each filters the table by membership.

### Filters
Search (placeholder `"Search by name or alias…"`, matches name **or** alias) · State · Kind · Membership · **`+ Add payers`** primary button.

### Table columns
`Payer · Kind · States · Manage`

- **Payer** — name links to detail; aliases on a second line, 12px `#9CA3AF`, single-line ellipsis, max-width 520px
- **States** — first few states, then a **`+N more`** button that **expands the cell inline** to the full list and toggles to `Show less`. Not a link, not a modal.
- **Manage** — one of three states:
  - already in network → `✓ In my network` (forest, 600) + a quiet `Remove`
  - inactive → `Reactivate` (secondary button)
  - not added → `+ Add to my network` (primary button)

Paginated the same way as My network — the catalog is 137 rows and must not render them all.

---

## Pagination (both tabs)

- **Rows per page** select: `5 / 10 / 25 / 50 / 100`, default **10**
- Live count: `"Showing 1–10 of 137 payers"`
- Prev / numbered pages / Next; the current page is filled forest. Hide the pager when there's only one page.
- Changing any filter, search term, or page size resets to page 1.

---

## Interactions & state

```
view:        'network' | 'catalog'          // default 'network'
netFilter:   'all' | 'ready' | 'needssop' | 'formnotproven' | 'drift'
catMemFilter:'' | 'in' | 'out' | 'inactive'
search:      string                          // per-tab semantics above
stateFilter: string                          // '' = all
kindFilter:  string                          // '' = all
expandedStates: Record<payerId, boolean>     // the "+N more" disclosure
page:        number
pageSize:    number                          // default 10
```

Switching tabs clears that tab's filters and resets to page 1. Filtering, sorting, and pagination should be **server-side** for the real catalog; the prototype does it client-side.

---

## Data — where each column comes from

Everything on this page maps to real columns:

- **Payer name, kind, states, status, aliases** — `payers`
- **Template status** — resolved per payer from `sop_templates` (a published template naming this payer)
- **Readiness buckets** — the existing readiness funnel logic (`src/lib/payerReadinessFunnel.ts`); the four KPI cards are its states rolled up
- **Membership (in network / not added / inactive)** — the org's payer assignments

> The prototype's rows are **sample fixtures** — payer names, states, and counts are invented for layout purposes. Do not port them.

---

## Design tokens

**Surfaces** — Primary forest `#1B4D3E` (hover `#163F33`) · Page bg `#FDFDFC` · Card `#FFFFFF` · Muted `#F5F4F1` · Border `#E8E5E0` · Hairline `#F0EEEA` · Table header `#FBFBF9` · Active-filter tint `#F0F5F2`
**Text** — Primary `#1F2937` · Secondary `#6B7280` · Tertiary `#9CA3AF` · Separator dots `#C9C5BE`
**Badges** (22px tall, 4px radius, 12px/500, `white-space:nowrap`) — green `#E7F5EF`/`#047857` · amber `#FBF0E1`/`#B45309` · teal `#E4F3F7`/`#0E7490` · red `#FBEAEA`/`#B91C1C` · neutral `#F1F1EF`/`#6B7280`
**Type** — **Geist** for UI, **Geist Mono** for IDs and counts; `font-variant-numeric: tabular-nums` globally. Page title 24/600 · KPI number 26/700 · column header 11/600 `.05em` uppercase `#9CA3AF` · body 13–14
**Radius** — 4px controls (buttons, inputs, selects, badges) · 6px cards and the segmented track
**Elevation** — none. 1px borders only, no shadows, no gradients. Light mode.
**Controls** — inputs/selects/buttons 36px (30–32px for pagination and inline actions); 1px `#E8E5E0`; focus `border-color:#1B4D3E` + `outline:2px solid rgba(27,77,62,.18)`. Selects hide the native arrow and draw a CSS chevron. Segmented control: `#F1F1EF` track, active item white with a 1px border and a count pill.
**Accessibility** — every select and input has an `aria-label`; tabs use `role="tablist"` + `aria-selected`; KPI cards use `aria-pressed`; pagination uses `aria-current="page"`.

---

## Divergences from `main` (approved — implement the design)

1. **Tabs are My network / Catalog**, not Catalog / SOPs. The readiness funnel that used to sit stacked above the catalog is now its own tab; the SOPs library is gone from this page (templates are reached from a payer, or from the default-template card).
2. **Terminology is "Template" throughout** — no user-facing "SOP" strings. Internal identifiers can stay as they are.
3. **No per-row "Next step" CTA.** The funnel's next-action still drives the KPI buckets, but the table only reports status. Acting on a payer happens from its detail page.
4. **"Configure credentialing scope"** is not in this design; it was removed at the product owner's request.

---

## Out of scope

Sidebar / left nav · Payer Detail · Template Editor · Cases · Provider pages · the browser extension · any schema change.

---

## Open questions for the team

1. **Payerless templates have no create path.** The default template can be edited but never created from this page. Is it seeded, or does it need a create entry point?
2. **Does the funnel count org-tier templates?** Today a payer whose only template is an org override reads "Needs template". If that's wrong, the KPI counts are wrong with it.

---

## Files

- `Payer Setup - Improved.dc.html` — the design reference
- `support.js` — runtime that lets the reference open in a browser; **not for production**
- `screenshots/01-my-network.png`, `screenshots/02-catalog.png`

Fonts load from Google Fonts (Geist, Geist Mono) in the prototype — use the codebase's font setup.
