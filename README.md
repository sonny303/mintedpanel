# Minted Panel

Credentialing operations workspace for medical groups. Track providers, payers, cases, tasks, touches, contracts, and MSO routing across states — all scoped by organization with role-based access.

## Stack

- React 19, TypeScript, Vite
- TanStack Start (file-based routing, SSR-capable via nitro) + TanStack Query
- Tailwind CSS, shadcn/ui
- Zustand (client state)
- Supabase (Postgres, Auth, RLS)

The build is TanStack Start on nitro, not a plain Vite SPA. Today all data access
runs browser → Supabase under RLS; the server runtime (`src/server.ts`,
`src/start.ts`) is wired but not yet used for data. See `docs/phase-0-audit.md`.

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

## Deploy

1. Connect this repo to Vercel. Vercel auto-detects the build; the TanStack Start
   nitro plugin emits the Vercel Build Output when it detects Vercel CI.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Vercel project's environment variables.
3. Deploy. `vercel.json` currently rewrites every route to `/` (static-SPA fallback);
   revisit this if/when in-app server routes ship (see `docs/phase-0-audit.md` §1).
4. One-time, before Lovable is disconnected: the five images under `src/assets/*.asset.json` are still served from Lovable's CDN (`/__l5e/assets-v1/...`). Vendor them into the repo with `node scripts/fetch-lovable-assets.mjs https://<your-lovable-site-domain>` and commit the resulting files under `public/__l5e/` — otherwise logos and landing images 404 outside Lovable hosting.

Supabase migrations run separately via the Supabase CLI.
