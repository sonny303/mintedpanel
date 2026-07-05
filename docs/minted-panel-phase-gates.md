# Minted Panel — Phase Gates

_Source of truth for the CI bar. The gate defined here is what
`.github/workflows/ci.yml` implements; if the two disagree, this doc wins and the
workflow is brought back into line._

Later gates are stubbed as `## Gate N — TBD` with no invented content. Fill them
in when the phase they guard is actually scoped — do not pre-invent criteria.

Grounding: this repo is a **TanStack Start** app (nitro, SSR-capable) on React 19,
Vite, Tailwind v4, shadcn/ui, with Supabase (Postgres + RLS) as the backend. The
browser still talks straight to Supabase under RLS for essentially everything; the
one exception is the Chunk 3 pilot (PR #19) — the `/api/*` provider routes in
`src/server/` now run on the nitro server behind a shared org/role guard, though no
frontend hook consumes them yet. The live Supabase project is the source of truth
for schema, and `supabase/migrations/` is a single squashed baseline verified to
rebuild it. See `docs/phase-0-audit.md` and `docs/migration-baseline.md` for the
full picture the gates below assume.

---

## Gate 0 — CI green on every PR

The minimum bar for any change to merge. Every check runs on `pull_request` (and
on push to `main`). A red check blocks the merge. Nothing here talks to a hosted
Supabase project, a Supabase branch, or prod data — Gate 0 is hermetic.

### 0.1 Typecheck

- **What:** `npx tsc --noEmit` over the `tsconfig.json` program (`src/**`, plus
  `vite.config.ts` and `eslint.config.js`).
- **Green when:** zero type errors. `vite build` does not typecheck, so this is the
  type gate.
- **CI:** the `Typecheck` step of the existing `build` job. Already present — not
  duplicated.

### 0.2 Lint

- **What:** `npm run lint` → `eslint .` (flat config, typescript-eslint +
  react-hooks + react-refresh; `no-restricted-imports` bans the Next-style
  `server-only` package).
- **Green when:** zero errors. Pre-existing warnings are tolerated but should not
  grow.
- **CI:** the `Lint` step of the existing `build` job. Already present — not
  duplicated.

### 0.3 Test (unit)

- **What:** `npm test` → `vitest run`. Unit tests live under `src/**` (e.g. the
  pure launch/action-state/work-view logic in `src/lib/*.test.ts`). Vitest is
  scoped in `vite.config.ts` to `src/**/*.{test,spec}.{ts,tsx}` so it never picks
  up the Playwright e2e specs.
- **Green when:** all specs pass.
- **CI:** the `Test` step of the existing `build` job. Already present — not
  duplicated.

> The existing `build` job also runs `Format check` (`prettier --check .`) and
> `Build` (`vite build`). Those stay as-is. Gate 0 additionally requires the
> Prettier check to be green repo-wide (§0.6).

### 0.4 Migration dry-run (throwaway Postgres)

- **What:** a dedicated CI job that spins up a `postgres:16` service, seeds only the
  Supabase-provided prerequisites, then applies **every** file in
  `supabase/migrations/` in filename order (baseline first, then anything newer).
- **Prerequisite bootstrap** (the exact setup the Chunk 1 PG16 verification used,
  which applied clean and fingerprint-matched live): create roles `anon`,
  `authenticated`, `service_role`; create schema `auth` with `auth.users` and
  `auth.uid()`; install `pgcrypto` and `uuid-ossp`. Bare Postgres has none of these,
  and the baseline grants to those roles and FKs to `auth.users`, so a raw apply
  without the bootstrap fails on "role/relation does not exist."
- **Green when:** every `psql -v ON_ERROR_STOP=1 -f <file>` exits `0`. Red if any
  apply step exits nonzero.
- **Not a Supabase branch, not prod.** The baseline is built for an **empty** DB.
  A Supabase branch is a clone of prod that already has these tables, so applying
  the baseline there collides ("already exists"). This job reads the migration
  files and writes only to its own disposable container; it never touches any
  hosted DB.
- **CI:** new `migrations` job in `ci.yml`.

### 0.5 Playwright smoke skeleton

- **What:** a dedicated CI job that installs Playwright + Chromium, boots the app
  via the Vite dev server (`npm run dev`) with dummy Supabase env vars, and runs
  the specs in `e2e/`. Config: `playwright.config.ts`.
- **Honest scope.** This is a runnable skeleton, not passing E2E. Five specs: two
  read-only checks run; the **three write scenarios are `test.skip`** because they
  need a seeded, disposable test tenant and an authenticated session — they must
  never run against KFP prod data. Skipped specs count as pass.
  - `login.spec.ts` — minimal render check (runs). Asserts `/login` renders the
    sign-in form. No real auth. The app reaches `/login` even with an unreachable
    backend: `auth-store.init()` always resolves `initialized: true`, and
    `getSession()` reads localStorage with no network when no session is stored.
  - `dashboard.spec.ts` — route reality check (runs). There is no `/dashboard` route;
    the authenticated work view is `/cases`. Unauthenticated, the root shell redirects
    `/cases → /login`. The spec asserts that redirect (confirms the route exists and
    the guard works). The authenticated dashboard render needs the seeded tenant.
  - `case-status-update.spec.ts` — `test.skip` (write). Change a case's credentialing
    status; asserts against `credential_cases`/`status_history`.
  - `task-complete.spec.ts` — `test.skip` (write). Complete a case task; asserts
    against `tasks`/`credential_cases`.
  - `create-case.spec.ts` — `test.skip` (write). Create a case via the New Case flow;
    asserts the case + auto-seeded SOP tasks (`create_case_with_tasks` RPC).
- **Green when:** the two active specs pass and the three skipped write specs report
  as skipped (Playwright exits `0`).
- **CI:** new `e2e` job in `ci.yml`.

### 0.6 Prettier (repo-wide)

- **What:** `npx prettier --check .` — already the `Format check` step of the
  `build` job. Gate 0 requires it green across the whole repo.
- **Green when:** no files report style issues.

### YAML check — intentionally omitted

There is no domain YAML in this repo to validate (the only YAML is
`.github/workflows/ci.yml` itself; domain config lives in database tables — see the
audit's YAML inventory). No YAML-lint/schema check is added, on purpose. Revisit
only if domain YAML is ever introduced.

---

## Gate 1 — TBD

## Gate 2 — TBD

## Gate 3 — TBD
