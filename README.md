# Minted Panel

Credentialing operations workspace for medical groups. Track providers, payers, cases, tasks, touches, contracts, and MSO routing across states — all scoped by organization with role-based access.

## Stack

- React 19, TypeScript, Vite
- TanStack Start (file-based routing, SSR-capable via nitro) + TanStack Query
- Tailwind CSS, shadcn/ui
- Zustand (client state)
- Supabase (Postgres, Auth, RLS)

The build is TanStack Start on nitro, not a plain Vite SPA. App screens read and
write browser → Supabase under RLS; the server runtime (`src/server.ts`,
`src/start.ts`) additionally serves `/api/*` routes for the Chrome extension and
for document signing (see [`ARCHITECTURE.md`](ARCHITECTURE.md)).

Process and merge rules: [`docs/ops/repo-workflow.md`](docs/ops/repo-workflow.md).

## Setup

```bash
npm install
cp .env.example .env   # then fill in both values
npm run dev
```

Environment variables (required in dev and in deploys — see `.env.example`):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Server-only, required for the `/api/*` routes (never `VITE_`-prefixed, never
shipped to the browser):

```
SUPABASE_SERVICE_ROLE_KEY=...
API_CORS_ORIGINS=...   # comma-separated exact origins, e.g. chrome-extension://<id>
```

## Deploy

**Agreed release sequence:** PR → CI → merge to main → manually initiated staging deployment and verification → owner-approved production release.

**Current status:** hosted deployment execution is incomplete and remains blocked.
Merging code does not deploy it. `vercel.json` keeps `git.deploymentEnabled: false`
for every branch, including PR previews. A manual start does not make hosting or
build usage free; verify included allowances before running hosted work.

Environment inventory, Vercel/Supabase project IDs, code promotion, and runtime
data-flow diagrams:
[`docs/ops/environment-architecture.md`](docs/ops/environment-architecture.md).

1. Target PRs to `main`, pass CI, and obtain the owner's merge decision.
2. Once hosted execution is qualified, the operator manually starts
   [`staging-delivery.yml`](.github/workflows/staging-delivery.yml) for the exact
   successful main CI run and source SHA. Use the existing dedicated staging
   project and verify its Preview variables and runtime point to staging Supabase.
3. Verify the candidate's affected workflows, data preservation, and extension
   compatibility before moving staging aliases or requesting production release.
4. Present the tested SHA, approved database changes, verification results, and
   recovery plan. The owner approves the protected GitHub **Production** job in
   [`production-release.yml`](.github/workflows/production-release.yml) before
   production changes. See the [production runbook](docs/ops/production-release.md).

Use the existing staging/production projects. This process adds no paid service,
new account/team, automatic preview build, or recurring release job. It does not
waive the pending credential-isolation requirements. TanStack Start's nitro plugin
emits Vercel Build Output; keep `/api/*` server routing and SSR, not a SPA catch-all.

One-time, before Lovable is disconnected: the five images under `src/assets/*.asset.json` are still served from Lovable's CDN (`/__l5e/assets-v1/...`). Vendor them into the repo with `node scripts/fetch-lovable-assets.mjs https://<your-lovable-site-domain>` and commit the resulting files under `public/__l5e/` — otherwise logos and landing images 404 outside Lovable hosting.

Supabase migrations run separately (manual apply to hosted today; no automated
`dev → staging → prod` pipeline yet).
