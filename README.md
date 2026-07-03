# Minted Panel

Credentialing operations workspace for medical groups. Track providers, payers, cases, tasks, touches, contracts, and MSO routing across states — all scoped by organization with role-based access.

## Stack

- React 18, TypeScript, Vite
- Tailwind CSS, shadcn/ui
- TanStack Router (file-based), TanStack Query
- Zustand (client state)
- Supabase (Postgres, Auth, RLS)

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

1. Connect this repo to Vercel (framework: Vite).
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Vercel project's environment variables.
3. Deploy. `vercel.json` rewrites every route to `/` so the router can resolve client-side.
4. One-time, before Lovable is disconnected: the five images under `src/assets/*.asset.json` are still served from Lovable's CDN (`/__l5e/assets-v1/...`). Vendor them into the repo with `node scripts/fetch-lovable-assets.mjs https://<your-lovable-site-domain>` and commit the resulting files under `public/__l5e/` — otherwise logos and landing images 404 outside Lovable hosting.

Supabase migrations run separately via the Supabase CLI.
