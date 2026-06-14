# AGENTS.md

Instructions for AI coding agents working on OpenPanel.

## Project overview

OpenPanel is a credentialing operations SaaS for medical groups, tracking providers, payers, cases, tasks, touches, and contracts across states and MSOs. The stack is React 18 + TypeScript + Vite + Tailwind + shadcn/ui, with TanStack Router for routing, Zustand for client state, TanStack Query for server state, and Supabase for database, auth, and RLS. The product is feature-complete; most work is incremental UI, bug fixes, and additive backend tables.

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
import { supabase } from '@/integrations/supabase/externalClient';
```

`src/integrations/supabase/client.ts` is auto-generated dead code pointing at an abandoned database. Never import it. `externalClient.ts` currently hardcodes the URL and publishable key; the production fix is env-based config wired in at deploy time — do not refactor it speculatively.

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

- NEVER rename, restructure, or delete tables or columns. Migrations are additive.
- `touches`, `status_history`, and `audit_log` are append-only — no UPDATE, no DELETE, in code or policy.
- Providers store `ssn_last4` only. Never store or accept a full SSN.
- One credentialing case per `(provider_id, payer_id, state)`. Credentialing only.
- Contracting status lives on `contracts` (group + payer + state). Never put contracting status on `credential_cases`.
- All access is scoped by `org_id` RLS. Every insert sets `org_id` from the active org. Every public table needs explicit `GRANT`s alongside RLS.

## Style rules

- Design tokens: primary `#1B4D3E`, border `#E8E5E0` 1px, no shadows on cards, no gradients, no decorative color backgrounds.
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
