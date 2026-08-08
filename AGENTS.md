# AGENTS.md

Instructions for AI coding agents working on Minted Panel.

Write/merge process (epic lane + 3M parallel lane): [`docs/ops/repo-workflow.md`](docs/ops/repo-workflow.md).
Epic lifecycle: [`docs/redesign/README.md`](docs/redesign/README.md).

## Project overview

Minted Panel is a credentialing operations SaaS for medical groups, tracking providers, payers, cases, tasks, touches, and contracts across states and MSOs. The stack is React 18 + TypeScript + Vite + Tailwind + shadcn/ui, with TanStack Router for routing, Zustand for client state, TanStack Query for server state, and Supabase for database, auth, and RLS. The product is feature-complete; most work is incremental UI, bug fixes, and additive backend tables.

## Architecture

- `src/routes/` — TanStack file-based routes. Parent routes only render `<Outlet />`.
- `src/components/[module]/` — feature components grouped by domain.
- `src/components/layout/` and `src/components/ui/` — shared shell and shadcn primitives.
- `src/services/` — the ONLY place Supabase is called. Each service owns one table or domain.
- `src/hooks/` — TanStack Query wrappers that call services. Components use hooks, never services directly.
- `src/types/index.ts` — every domain interface.
- `src/lib/` — pure utilities (sopResolver, audit, case helpers, auth-store).
- `src/stores/` — Zustand stores for cross-component UI state (e.g. active org).

## Protected files — do not modify without explicit instruction

- All files in `supabase/migrations/`. Add new migrations; never edit existing ones.
- `src/types/index.ts` (additive only).
- `src/lib/sopResolver.ts`.
- `tailwind.config.*` and design tokens.
- `src/components/layout/*` and `src/components/ui/*`.

## Supabase client rule

The ONLY valid Supabase client import is:

```ts
import { supabase } from "@/integrations/supabase/externalClient";
```

The auto-generated `client.ts` (dead code pointing at an abandoned database) and the `auth-attacher.ts` middleware that imported it were deleted in Jul 2026. If a generated Supabase scaffold ever reappears, delete it — never import it. `externalClient.ts` reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from the environment (see `.env.example`).

## Routing rules

- Import `useNavigate`, `Link`, `useRouter` from `@tanstack/react-router`.
- Read route params with `Route.useParams()`, never `useLoaderData` for params.
- Always use object-form navigation: `navigate({ to: '/cases/$id', params: { id } })`.
- Parent route files render only `<Outlet />`. Page content lives in the leaf route file.

## Data rules

- Never call Supabase from a component. Components → hooks → services → Supabase.
- Never hardcode arrays/mock data in components. Source from `src/data/*.ts` or services.
- For table cells with pills, badges, or two-line content, write custom table markup. Do not force everything through a generic DataTable.

## Database rules

- **NEVER rename, restructure, or delete tables or columns. Migrations are
  additive** (retain, hide, stop-write, deprecate in place). _The pre-GA
  destructive-DDL window closed at the production cut (2026-07-19); any
  future exception requires an explicit PM-approved carve-out written into
  this section._
- `touches`, `status_history`, and `audit_log` are append-only — no UPDATE, no DELETE, in code or policy.
- Providers store `ssn_last4` only in ordinary tables. The full SSN exists ONLY inside the E4.4 server-only Sensitive Identifiers Vault (PM security decision 2026-07-14): a separated, RLS-locked table with no PostgREST/client SELECT grant, encrypted at rest, accessed exclusively through the narrowly scoped audited SECURITY DEFINER RPCs the epic defines (fill-only release with `no-store`, admin reveal with justification, audited ingress). Outside those vault paths the last-4-only rule still binds absolutely: never accept, store, log, export, or render a full SSN anywhere else.
- One credentialing case per `(provider_id, group_id, payer_id, state)` — the live DB constraint since E2.1 (`UNIQUE NULLS NOT DISTINCT`, migration `20260713150000`): a provider can have parallel cases with the same payer/state under different groups (each group's TIN contracts separately), and legacy NULL-group rows stay unique at `(provider_id, payer_id, state)` because NULL = NULL under NULLS NOT DISTINCT. Credentialing only.
- Contracting status lives on `contracts` (group + payer + state). Never put contracting status on `credential_cases`.
- All access is scoped by `org_id` RLS. Every insert sets `org_id` from the active org. Every public table needs explicit `GRANT`s alongside RLS.
- Any migration that adds or supersedes a table or column updates the row in `docs/data-model/table-register.md` in the same PR.
- Follow the grain and M:N rules in `SCHEMA.md` — state/purpose/payer-varying data is a child row keyed by that dimension, never a new column; plausible many-to-many relationships get a join table from day one.
- Epics and feature specs list a table trace (tables read / tables written); reviewers reconcile it against the table register.

## Style rules

- Design tokens: primary `#1B4D3E`, border `#E8E5E0` 1px, no shadows on cards, no gradients, no decorative color backgrounds.
- Component governance (E0.9): a component not defined by the design system (`docs/redesign/design-system/`) must be stock shadcn styled by tokens only, and logged in `DESIGN-DEBT.md` in the same PR. Deferred engineering debt lives in `TECH-DEBT.md`; both registers are at the repo root and are triaged each design-review cycle.
- Border radius: `rounded-md` on cards/inputs/dropdowns; `rounded-full` for pills and avatars only.
- Rows `h-10`, card padding `p-4` max, section gaps `gap-4` max.
- Color outside the sidebar accent and chart bars is reserved for status pills and destructive states.
- Icons: 16px inline, 20px standalone.

## Anti-patterns

- No placeholder text shipped to UI.
- No `console.log`, no `TODO` / `FIXME` comments.
- No new dependencies without justification.
- No self-testing in chat — the user verifies in the preview.
- No `any`. Use `unknown` and narrow.
- Named exports only; no default exports.
