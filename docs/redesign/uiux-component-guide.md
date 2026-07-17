# UI/UX Component Guide & Build Requirements

Component selection and build requirements for redesign implementation PRs
(Claude Code) targeting the `redesign` branch. This guide reflects the current
design language; it will be reconciled with the PM's UX design system when that
is shared (see "Pending: UX design system alignment" below).

## Design tokens (binding — from AGENTS.md)

- Primary: `#1B4D3E` (sidebar accent). Border: `#E8E5E0`, 1px.
- No shadows on cards, no gradients, no decorative color backgrounds.
- Radius: `rounded-md` for cards/inputs/dropdowns; `rounded-full` only for
  pills and avatars.
- Density: table rows `h-10`, card padding `p-4` max, section gaps `gap-4` max.
- Color outside the sidebar accent and chart bars is reserved for status pills
  and destructive states.
- Icons: lucide-react, 16px inline, 20px standalone.
- Fonts: Inter (UI), Geist Mono (tabular/code). Loaded via `@fontsource`.
- Tailwind v4; `tailwind.config.*` and design tokens are protected files — no
  edits without explicit PM instruction.

## Approved component inventory

### Layout shell — `src/components/layout/` (protected)

| Component      | Use                                                                        |
| -------------- | -------------------------------------------------------------------------- |
| `AppShell`     | Global frame: sidebar + content area. Every routed page renders inside it. |
| `Sidebar`      | Primary navigation, org switcher, user display.                            |
| `PageHeader`   | Page title, description, actions row. Required on every page.              |
| `SearchDialog` | Global search (⌘K-style dialog).                                           |

Layout files are protected. Redesign epics that change the shell must say so
explicitly in `## 5. Technical Considerations & Enablers`; that is the only
authorization to touch `src/components/layout/*`.

### shadcn/ui primitives — `src/components/ui/` (protected)

Available today: `badge`, `button`, `card`, `checkbox`, `collapsible`,
`dialog`, `dropdown-menu`, `input`, `label`, `select`, `separator`,
`skeleton`, `sonner` (toasts), `switch`, `table`, `tabs`, `textarea`,
`tooltip`.

Selection rules:

1. Use an existing primitive whenever one fits. Do not restyle a primitive
   inline; compose it inside a feature component.
2. If a needed primitive is missing (e.g. `popover`, `command`, `sheet`,
   `calendar`, `avatar`, `radio-group`, `accordion`, `alert-dialog`), add it
   via the shadcn generator into `src/components/ui/` in its own commit, and
   list it under the epic's technical enablers. Radix packages already in use
   are preferred; any brand-new dependency needs written justification in the
   PR (AGENTS.md rule).
3. Feature components live in `src/components/[module]/`, never in `ui/` or
   `layout/`.

### Composition patterns

- **Tables:** use the `table` primitive for structure, but write custom cell
  markup for pills/badges/two-line content — no generic DataTable abstraction.
- **Status pills:** `badge` with `rounded-full`; colors come from status
  semantics only.
- **Forms:** `label` + `input`/`select`/`textarea`/`checkbox`/`switch`;
  validation messages inline under the field; no placeholder-only labels.
- **Feedback:** `sonner` toasts for mutation results; `skeleton` for loading;
  empty states are designed (icon + one-line explanation + primary action),
  never blank or placeholder text.
- **Overlays:** `dialog` for focused create/edit; `dropdown-menu` for row
  actions; `tooltip` for icon-only buttons (mandatory for a11y).

## Build requirements for implementation PRs

1. **One epic per PR**, targeting `redesign`, titled `EX.X: <title>` and
   referencing the epic file (`docs/redesign/EX.X-<slug>.md`). FRs must be
   traceable in the diff.
2. **Layering:** components → hooks (`src/hooks/`) → services
   (`src/services/`) → `externalClient`. No Supabase in components; no mock
   arrays in components.
3. **Routing:** TanStack Router imports only; object-form navigation; parent
   routes render `<Outlet />` only.
4. **State:** TanStack Query for server state (org-scoped keys via
   `queryKeys`); Zustand only for cross-component UI state.
5. **TypeScript:** no `any` (use `unknown` + narrowing); named exports only;
   `npx tsc --noEmit` clean.
6. **A11y:** interactive elements keyboard-reachable; visible focus states;
   `aria-label` on icon-only buttons; dialogs trap focus (Radix default —
   don't defeat it).
7. **Responsiveness:** pages usable at 1280px and 1024px; tables may scroll
   horizontally below that; the sidebar behavior at narrow widths follows the
   e0.0 shell epic.
8. **Quality gates before merge:** `npm run lint`, `npm run test`,
   `npx tsc --noEmit`; `npm run test:e2e` where touched surfaces have
   coverage. No `console.log`, no TODO/FIXME, no shipped placeholder text.

## UX design system alignment (received 2026-07-10)

The PM-approved design system landed at `docs/redesign/design-system/`
(README + `changes.md` phased plan + `design-system-reference/` + drop-in
token targets). It is now the visual source of truth and supersedes the token
values above where they differ. Headline deltas from the shipped code:

- UI font: Instrument Sans → **Geist** (Geist Mono unchanged).
- Primary `#1B4D3E` / hover `#163F33`; warm neutrals (`#FDFDFC` app,
  `#E8E5E0` border, `#F5F4F1` muted, `#1F2937/#6B7280/#9CA3AF` ink).
- Status pills: fixed tint + darker ink pairs (no `color-mix`), **4px**
  radius, no border. Cards/panels 6px; controls 4px.
- No shadows on inputs/buttons/cards (overlays keep a soft shadow); focus =
  2px soft primary ring.
- Sidebar IA v2 per `design-system-reference/Sidebar Nav.dc.html` + the
  NAVIGATION section of its readme (supersedes the E0.6 segmented nav and
  the E0.8 `Org space` label).
- Component governance: unspecced components must be stock shadcn styled by
  tokens only and logged in `DESIGN-DEBT.md` (see COMPONENT GOVERNANCE in
  the reference readme).

The conformance build follows `docs/redesign/design-system/changes.md`.
