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

1. Connect this repo to Vercel. Vercel auto-detects the build; the TanStack Start
   nitro plugin emits the Vercel Build Output when it detects Vercel CI.
2. Set the environment variables above in the Vercel project (both the `VITE_`
   pair and the server-only pair, on Production and Preview).
3. Deploy. `vercel.json` holds no rewrites — the nitro output routes `/api/*` to
   the server handler and everything else to SSR; a static-SPA catch-all rewrite
   would break `/api`.
4. One-time, before Lovable is disconnected: the five images under `src/assets/*.asset.json` are still served from Lovable's CDN (`/__l5e/assets-v1/...`). Vendor them into the repo with `node scripts/fetch-lovable-assets.mjs https://<your-lovable-site-domain>` and commit the resulting files under `public/__l5e/` — otherwise logos and landing images 404 outside Lovable hosting.

Supabase migrations run separately via the Supabase CLI.
