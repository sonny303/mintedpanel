# Minted Panel — Design System

The single visual source of truth for **Minted Panel**, a credentialing operations platform for physical therapy organizations. One system spans two products: the **web app** and a **Chrome extension side panel**. It is used by credentialing coordinators who live in the tool eight hours a day, so it must read as a real working instrument — dense, calm, and precise — not a marketing showcase.

> **Personality:** Competent, calm, precise. The tool you trust to keep 200 moving pieces organized without drama. Not flashy, not clinical, not startup-trendy.
> **Aesthetic references:** Linear, Vercel, Stripe. Restrained, geometric, confident. Dense and data-first.

## Sources

This system was distilled from a design handoff brief and an approved reference artifact:

- `uploads/claude-design-handoff-minted-panel.md` — the original product/brand brief (voice, color roles, type scale, component + state inventory, sample data).
- `Minted Panel Design System copy.dc.html` — the approved, iterated reference sheet the tokens and components were lifted from (the ground-truth values).
- `assets/logo-forest.png`, `assets/logo-white.png` — the brand mark (forest for light surfaces, white for the dark sidebar).

The eventual coded library (`packages/ui`, React + Tailwind + shadcn/ui) is built *from* this system.

---

## CONTENT FUNDAMENTALS

How Minted Panel writes.

- **Name:** always two words — "Minted Panel". Never "MintedPanel" or "MP" in prose.
- **Voice:** plain, declarative, operational. Short noun phrases and direct verbs. It states facts and the next step; it never sells or exclaims.
- **Person:** address the coordinator's work, not the coordinator. Prefer the task ("Needs action", "Clear filters", "Add a note…") over "you" or "we". No first person.
- **Casing:** Sentence case for headings, buttons, and body ("Change case status", "Save changes"). UPPERCASE only for the small letter-spaced field labels and column headers ("PROVIDER STATUS", "NPI"). Never Title Case a sentence.
- **Action-first framing:** every screen opens with what needs a human now. Copy names the state and the reason: "License expired — upload a renewal to continue.", "Three payers still need action before month end."
- **Numbers & IDs:** real, tabular, monospaced. NPIs are 10 digits (1841293756), CAQH is 8 (14237788), licenses carry their prefix (KS-PT-009214). Never lorem, never "John Doe".
- **Empty & error copy:** say what's absent and the next move — "No cases match these filters" + "Try clearing a filter or widening the date range." Calm, never blaming.
- **Emoji:** none. Ever. Status is carried by tone + dot, not glyphs.
- **Sample vocabulary:** Org *Kansas Fitness Physio* (KS / MO); providers *Brian Hershberger, PT* · *Sarah Nguyen, DPT* · *Marcus Bell, PT, DPT*; payers *BCBS Kansas, Aetna, Cigna, UnitedHealthcare / Optum, Humana Military*; coordinator *Sowmya*; statuses *Submitted, Under review, Info requested, Approved, In-network, Not started*.

---

## VISUAL FOUNDATIONS

- **Mode:** light only. There is no dark theme.
- **Color:** a warm-neutral base (off-white `#FDFDFC` app bg, white cards, `#F5F4F1` muted fills) with a single **forest-green** primary (`#1B4D3E`, hover `#163F33`) and a **dark forest** navigation/sidebar (`#0C2A1D`). Text is one warm neutral in three values — `#1F2937` / `#6B7280` / `#9CA3AF`. Status is a six-tone system, each tone a **solid** dot/fill plus a **soft tint pair** (tinted bg + readable fg) for badges: green active, blue under-review, amber pending, red overdue, teal submitted, gray not-started. Color is used sparingly and only to carry meaning.
- **No gradients. Anywhere.** Flat fills only.
- **No shadows.** Structure is carried entirely by **1px borders** in warm gray (`#E8E5E0`), with two lighter divider depths (`#F0EEEA`, `#F3F1ED`) for rows nested inside cards.
- **Type:** **Geist** for UI, **Geist Mono** for every number and ID. Tabular figures are on globally so columns of numbers align. Scale is tight and product-sized: page title 16/600, section 14/600, body 12/400, control text 13/500, labels 12/600 uppercase (letter-spacing .05em), meta 11px. Titles carry slight negative tracking (-.01em).
- **Spacing:** tight, functional, 4-based — 4 / 8 / 12 / 16 / 24. Controls are 34px tall (32 in toolbars), badges 22px, dense table rows ~40px.
- **Radius:** two values only — **4px** on controls (buttons, inputs, badges, chips) and **6px** on tiles (cards, panels). Count badges are fully round (9px at 18px tall).
- **Cards:** white fill, 1px `#E8E5E0` border, 6px radius, no shadow. Section headers inside a card sit above a 1px divider; card padding is 16–20px.
- **Hover states:** subtle. Rows/list items shift to `#FAFAF8`; secondary buttons to `#F5F4F1`; primary/destructive darken one step; links darken to dark forest and underline. Sidebar items lift to a translucent white overlay.
- **Press / active:** the darker hover shade holds; no scale or bounce.
- **Focus:** 1px forest border **plus** a soft 2px outline ring (`rgba(27,77,62,.18)`), zero offset. Error swaps the border to red (`#DC2626`) with a red message line.
- **Motion:** minimal and functional only — a 0.7s spinner for loading, a 1.4s opacity pulse for skeletons, and ~0.12–0.15s transitions on hover/expand. No entrance animations, parallax, or decorative motion.
- **Transparency / blur:** none on light surfaces; the only alpha use is white overlays on the dark sidebar and the dimmed dialog backdrop.
- **Layout:** fixed 200–216px dark sidebar, a 56px top header with an org picker, then a dense work area. The extension mirrors the same language on a ~380px surface. Content is left-aligned and information-dense; whitespace is earned, not generous.
- **Imagery:** effectively none — this is a data tool. The only brand image is the logo mark. Status and progress are drawn with dots, pills, and bars, never illustration.

---

## ICONOGRAPHY

- **Restrained and geometric.** Icons are rare; meaning is usually carried by tone, dots, and type rather than glyphs.
- **CSS-drawn primitives** do most of the work: chevrons/carets are 7px rotated bordered squares; status uses 5–7px filled circles; the spacing "square" bullet is a 7px filled square. These need no icon font.
- **The one inline SVG** in the product is a 14px search glyph (1.5px stroke, `#9CA3AF`) in the toolbar. If a broader icon set becomes necessary, use a thin-stroke set (~1.5px) such as **Lucide** to match — flag any addition here.
- **No emoji, no unicode symbol fonts** as UI icons.
- **Logo:** the abstract layered-jack mark. Use `logo-forest.png` on light surfaces and `logo-white.png` on the dark forest sidebar/header, paired with the "Minted Panel" wordmark in Geist 600. Do not recolor, rotate, or add effects to the mark.

---

## NAVIGATION

The approved app shell (reference: `Sidebar Nav.dc.html`):

- **Rail:** 232px, dark forest `#0C2A1D`, logo (white mark + "Minted Panel" 14/600) top-left.
- **IA, top to bottom:** **Workspace** (Home, Cases) · **Payers** (Payer Management) · **Reporting Center** (standalone — section labels only appear over groups of 2+) · generous break + divider · **Org zone** · user footer. Tasks roll up under Cases — never a separate menu item.
- **Items:** 13px, Lucide icons 16px, 4px radius. Active = `rgba(255,255,255,.10)` fill + a 2px mint (`#C8DBD4`) inset bar. Hover = `rgba(255,255,255,.05)`. Counts use CountBadge (translucent white on the rail; tabular figures).
- **Org zone:** no "Org space" label — the switcher is the header: a contained tile (white/6 fill, white/8 border, 6px radius) with a tiny ORGANIZATION eyebrow and the org name as headline. Children: Account Detail, Facilities, Providers. No org selected → dashed-border prompt tile.
- **Org switcher menu:** grouped by lifecycle (Active / Prospects / Inactive), check on the active org, footer = Add organization + View all organizations. **Scale rules:** ≤10 orgs plain grouped list; 10–30 add a search field + scroll (~6 rows); 100+ recents-only + search, "View all" exits to the portfolio directory. Orgs are also findable in the ⌘K search.
- **User footer:** avatar + name + role; menu (opens upward) = identity header, Settings, Sign out.
- **Focus on the dark rail:** the app's soft green ring is invisible on forest — nav items use a white-alpha ring (`outline: 2px solid rgba(255,255,255,.35)`).
- **Future (not day 0):** role-based item visibility (admin vs operator), urgency treatment on counts (solid forest chip when attention needed).

---

## COMPONENT GOVERNANCE

When a build needs a component this system doesn't define: use the closest approved primitive; if truly new, add the stock shadcn primitive styled by tokens only, and log it in the repo's `DESIGN-DEBT.md` register (component, where used, why, owner, date) in the same PR. Design review triages the register each cycle — approve into this system or prescribe a replacement. Unlogged deviations are review blockers; logged ones never block.

**Adopt-as-stock (dev-alignment, intentionally not specced here):** DropdownMenu, Separator, Collapsible, Skeleton — they inherit correctly from tokens; no separate visual spec.

---

## Index / manifest

**Root**
- `styles.css` — the single entry point consumers link (imports only).
- `readme.md` — this guide.
- `SKILL.md` — portable skill wrapper (for Claude Code / download).

**`tokens/`** — the shipped CSS custom properties + fonts.
- `colors.css` · `typography.css` · `spacing.css` · `animations.css` · `fonts.css`

**`components/`** — reusable React primitives (`<Name>.jsx` + `.d.ts` + `.prompt.md`, one specimen card per group).
- `core/` — **Badge, CountBadge, ActionBadge, Button, CopyButton, ProgressBar**
- `surfaces/` — **Card** (+ Header / Title / Description / Content / Footer)
- `forms/` — **FormField, Input, Select, Textarea, Checkbox, Switch**
- `feedback/` — **Dialog, EmptyState, Toast, Tooltip**
- `navigation/` — **Tabs**
- `layout/` — **PageHeader** (+ the approved sidebar spec, `Sidebar Nav.dc.html` at the project root)
- `data/` — **Table, GroupedList**
- `filters/` — **SummaryChips**

**`guidelines/`** — foundation specimen cards (Colors, Type, Spacing, Brand).

**`ui_kits/minted-panel/`** — full-screen recreations: `index.html` (Providers page) + `extension.html` (side panel).

**`assets/`** — `logo-forest.png`, `logo-white.png`.

---

### Intentional additions

The source brief names Badge with a "count" use and lists the forward-looking primitives (SummaryChips, ActionBadge, GroupedList, ProgressBar). Two small primitives were factored out for a clean contract, both drawn directly from the source: **`CountBadge`** (the number chip shown under Badge) and treating **`ActionBadge`** as its own component built on Badge (the brief calls out its distinguishing leading dot). No other components were invented.
