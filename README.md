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
npm run dev
```

Environment variables (production deploy only — dev uses the values currently hardcoded in `src/integrations/supabase/externalClient.ts`):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

## Deploy notes

- Vercel single-page-app deploy. `vercel.json` rewrites every route to `/` so TanStack Router can resolve client-side.
- Set the two `VITE_SUPABASE_*` env vars in the Vercel project before deploying.
- Supabase migrations run separately via the Supabase CLI.
