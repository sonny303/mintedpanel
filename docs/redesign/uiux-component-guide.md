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

## Pending: UX design system alignment

The PM will supply the target UX design system separately. When received, the
reviewer will:

1. Map its tokens (color, type scale, spacing, radius, elevation) onto the
   current Tailwind v4 token set and document deltas here.
2. Audit the primitive inventory against the design system's component
   catalog; list additions/replacements as technical enablers on the affected
   epics.
3. Update the composition patterns above where the design system prescribes
   different behavior (e.g. navigation model, density, feedback patterns).

Until then, the tokens and rules above are the binding baseline; epics should
not assume any visual language beyond them.
