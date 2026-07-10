# changes.md — file-by-file conformance steps

Two repos, three phases. Phase 1 delivers most of the visual conformance by
swapping tokens only. Phases 2–3 touch component styles. Nothing here renames a
token, so downstream references keep resolving.

Legend: 🟢 token-only (safe) · 🟡 component edit · 🔵 optional.

---

## Repo A — `mintedpanel` (React + Tailwind v4 + shadcn/ui)

### Phase 1 — Tokens + font 🟢

1. **Replace** `src/styles/tokens.css` with `targets/mintedpanel-tokens.css` from this bundle. Same `--mp-*` names, design-system values.

2. **Swap the UI font import** in `src/styles/tokens.css`'s consumer, `src/styles.css`:
   - Remove the Inter imports:
     ```
     @import "@fontsource/inter/400.css";
     @import "@fontsource/inter/500.css";
     @import "@fontsource/inter/600.css";
     @import "@fontsource/inter/700.css";
     ```
   - Add Geist:
     ```
     @import "@fontsource/geist/400.css";
     @import "@fontsource/geist/500.css";
     @import "@fontsource/geist/600.css";
     @import "@fontsource/geist/700.css";
     ```
   - Keep the two `@fontsource/geist-mono` imports.
   - Install the package: `npm i @fontsource/geist`.

3. In `src/styles.css`, the `@theme inline` block sets `--font-sans` to an
   `"Instrument Sans", "Inter", …` stack. Change the first family to `"Geist"`
   (drop Instrument Sans/Inter):
   ```
   --font-sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
   ```

✅ After Phase 1: Geist renders, warm neutrals, `#1B4D3E` primary, DS status
tints. Controls still carry shadow and pills are still round — that's Phase 2.

### Phase 2 — Control conformance 🟡

4. **Remove control/card shadows.** In `src/components/ui/`, drop the Tailwind
   `shadow` / `shadow-sm` utility from the base class strings of `button.tsx`,
   `input.tsx`, `select.tsx` (trigger), `textarea.tsx`, `switch.tsx`,
   `checkbox.tsx`, and `badge.tsx`. **Keep** shadows on floating overlays:
   `dropdown-menu.tsx` (`shadow-md`), `tooltip.tsx`, and `sonner.tsx`
   (`shadow-lg`). `card.tsx` is already `shadow-none` — leave it.

5. **Status pills → 4px rounded rect.**
   - `src/components/StatusPill.tsx`: change the wrapper from `rounded-[20px]`
     to `rounded-[4px]`.
   - `src/components/triage/StatusPill.tsx`: change
     `rounded-[var(--mp-radius-pill)]` to `rounded-[var(--mp-radius-control)]`.
   - `src/components/ui/badge.tsx` uses `rounded-md` (= 4px) — already correct.

6. **Card radius → 6px.** `src/components/ui/card.tsx` uses `rounded-md` (4px).
   Change to `rounded-[var(--mp-radius-sm)]` (6px). Apply the same to any other
   hand-rolled card containers you find (e.g. tiles in `home/`, `reports/`).

7. **Status-pill text → design-system ink.**
   - `src/components/StatusPill.tsx` hardcodes a `statusStyles` map. Replace each
     tone's bg/text with the DS token pair, e.g.
     `green: "bg-[var(--mp-ok-tint)] text-[var(--mp-ok-ink)] border-transparent"`,
     and likewise `blue→info`, `amber→warn`, `red→danger`, `teal→pending`,
     `gray/neutral→neutral`, `brand→brand`, `violet→violet` (tokens now exist for
     brand + violet). Drop the per-tone borders (DS pills have no border).
   - `src/components/triage/StatusPill.tsx` takes a raw `color` prop and builds
     `color-mix(... 12%, white)`. Map the DB hue to a tone instead and use the DS
     tint/ink pair (reuse the `hexToStatusColor` switch already in
     `StatusPill.tsx`). If you must keep the prop-driven path, at least set the
     text to the darker DS ink rather than the raw hue.

8. **Focus ring → 2px soft.** In `src/styles.css` `@layer base`, the
   `*:focus-visible` rule is `outline: 2px solid var(--mp-primary); outline-offset: 2px;`.
   Change to the DS soft ring:
   ```
   *:focus-visible { outline: 2px solid rgba(27,77,62,.18); outline-offset: 0; }
   ```
   For shadcn controls that focus with `focus-visible:ring-1 ring-ring`, either
   leave them (they'll read the primary `--ring`) or switch to `ring-2` with a
   softened ring color; the DS shows a 1px primary border **plus** the soft ring.

### Phase 3 — Navigation restructure 🟡 (approved spec: `design-system-reference/Sidebar Nav.dc.html`)

Edit `src/components/layout/Sidebar.tsx` (+ `AppShell.tsx` where noted). Protected
files — this handoff is the explicit authorization.

- **IA:** top nav becomes three groups — `Workspace` (Home; Cases with a CountBadge
  of open cases), `Payers` (Payer Management), `Reporting Center` (standalone item,
  no section label — labels only over 2+ items). Remove reserved Tasks (rolls up
  under Cases), remove SOP (folds into Payer Management), remove the Setup/Config
  group.
- **Break:** ~40px gap + divider between the work nav and the org zone.
- **Org zone:** drop the "Org space" label. The switcher is a contained tile
  (white/6 fill, white/8 border, 6px radius) with a 9.5px ORGANIZATION eyebrow and
  the org name; children below: Account Detail, Facilities, Providers. No-org
  state: dashed-border prompt tile.
- **Switcher menu:** group orgs by `lifecycle_state` (Active / Prospects /
  Inactive), check on active, footer = Add organization + View all organizations.
  At 10+ orgs add a search field + max-height scroll; at 100+ show recents only.
- **Active item:** `bg-white/10` + 2px mint inset bar (`box-shadow: inset 2px 0 0 #C8DBD4`).
- **Focus:** nav items get a white-alpha focus ring (`focus-visible:outline-2
  outline-white/35`) — the app's green ring is invisible on the forest rail.
- **User menu:** add a Settings item above Sign out (links to the settings page).

### Phase 4 — Component adoption + renames 🟡

- Restyle `ui/card` (6px radius), `ui/tabs` (active = white + 1px border, no
  shadow), `ui/tooltip` (dark ink, 12px), `sonner` toasts (border, no shadow),
  `ui/checkbox` / `ui/switch` (forest fill when on, soft focus ring) per the
  specs in `design-system-reference/components/`.
- Rename `triage/FilterCards.tsx` → `triage/SummaryChips.tsx` (component
  `SummaryChips`); align other triage names with the spec where they differ.
- Keep standalone `ui/skeleton` + `TableSkeletonRows` AND the designed
  `EmptyState` — both are approved.
- DropdownMenu, Separator, Collapsible, Skeleton remain stock shadcn, styled by
  tokens only — no spec, no custom visuals.

### Phase 5 — Governance 🟢

- Copy `design-system-reference/DESIGN-DEBT.md` to the repo root.
- Add to AGENTS.md style rules: "A component not defined by the design system
  must be stock shadcn styled by tokens only, and logged in DESIGN-DEBT.md in
  the same PR."

### Phase 6 — Type scale 🔵 (optional; larger blast radius)

9. The `targets` token file already caps `--mp-text-xl` to 16px and
   `--mp-text-3xl` to 22px (design-system page-title / H2). If you'd rather not
   shrink existing headings, restore `--mp-text-xl: 18px`, `--mp-text-2xl: 20px`,
   `--mp-text-3xl: 25px`. Either way, replace hardcoded sizes with tokens where
   you see them — e.g. `src/components/layout/PageHeader.tsx` uses `text-[20px]`
   for the title; the DS page title is 16px (`--mp-text-xl`).

---

## Repo B — `minted-extension` (vanilla TS + `sidepanel.css`)

### Phase 1 — Tokens + font 🟢

1. **Replace the `:root { … }` token block** in
   `src/sidepanel/sidepanel.css` with `targets/minted-extension-tokens.css`. The
   legacy aliases are preserved, so every existing selector resolves to DS
   values.

2. **Swap the self-hosted UI font.** At the top of `sidepanel.css`, replace the
   four `@font-face { font-family: "Instrument Sans"; … }` blocks with Geist, and
   ship the four weights to `/fonts`:
   ```css
   @font-face { font-family："Geist"; font-weight:400; font-display:swap;
     src:url("/fonts/geist-latin-400-normal.woff2") format("woff2"); }
   /* repeat for 500, 600, 700 */
   ```
   (Grab the woff2 files from `@fontsource/geist` or Google Fonts.) `--mp-font`
   in the new token block already points at `"Geist"`.

✅ After Phase 1 the panel is on Geist, warm neutrals, `#1B4D3E`, DS tints. Most
of the rest is automatic because the panel keys off tokens:
- Inputs/selects/buttons lose their shadow (they use `--mp-shadow-sm`, now `none`).
- Focus becomes the 2px soft ring (they use `--mp-focus`).
- Cards/notices go to 6px (they use `--mp-r-card`, now `--mp-radius-sm`).

### Phase 2 — Control conformance 🟡

3. **Status pills → 4px.** `.pill` in `sidepanel.css` is `border-radius: 999px`.
   Change to `border-radius: var(--mp-radius-control);` (4px) to match the DS
   status Badge. (If you want the fill-report count pills to stay round, scope
   the 999px to those with a `.bucket .pill` override.)

4. **Sanity-check the notices.** `.error`, `.gap-flag`, `.dup-warn`, `.logged`,
   `.banner`, `.blocked-hint` are the design system's Alert family. Their
   hardcoded hexes (`#FEF2F2/#FCA5A5/#B91C1C`, `#FEF3C7/#FDE68A/#92400E`) match
   the DS danger/warning tones — leave them, or point them at the tint/ink
   tokens for consistency. The mint `.logged`/`.banner.detected` now read the
   warm `--mp-primary-tint` automatically.

### Phase 3 — Type scale 🔵

5. The panel hardcodes most sizes in px already and its ramp is close to the DS.
   Optional: nudge the few 14px CTA/heading values toward the DS scale if you
   want exact parity. Low priority.

---

## Acceptance checklist (both repos)

- [ ] UI font is **Geist**; numbers/IDs still **Geist Mono**, tabular.
- [ ] Primary `#1B4D3E`, hover `#163F33`; app bg `#FDFDFC`; border `#E8E5E0`.
- [ ] Status pills use DS tint + **darker ink**, **4px** radius, no border.
- [ ] **No shadow** on inputs, buttons, or cards; overlays (menu/tooltip/toast) keep a soft shadow.
- [ ] Cards/panels are **6px**; controls **4px**.
- [ ] Focus shows the **2px soft primary ring**.
- [ ] App screens and the side panel match `design-system-reference/ui_kits/minted-panel/*.html`.
- [ ] Existing lint/build/tests pass.
