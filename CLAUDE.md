# Minted Panel

Healthcare credentialing SaaS. React 19 + TanStack Start (nitro server) + Supabase
(Postgres + RLS), multi-tenant by `org_id`, roles admin/specialist/billing.

## Customers

- Kansas Fitness Physio (KFP)
- South Park Physician Group

## Architecture

Payer → SOP template → Case → Tasks. The browser reads Supabase directly under
RLS; `/api/*` routes (guard + service-role client) serve the Chrome extension.

## Core concepts

- **Case key:** provider × group × payer × state
- **Activity spine:** `touches` — one entry model (touchpoint / note / system_event / task_update)
- **User:** Sowmya, credentialing coordinator
- **Extension:** Minted Panel Workbench, Chrome MV3, `sonny303/minted-extension`

## Read before working

- `AGENTS.md` — binding rules (protected files, data rules, anti-patterns)
- `docs/SYSTEM-MAP.md` — full system map, `/api` contracts, repo-vs-hosted schema rules, epic history
- `SCHEMA.md`, `ARCHITECTURE.md`, `docs/VERIFY.md`

## Environments

`main` → production (Vercel); feature branches → preview deploys. Hosted Supabase
project `fkvuhfsqcmujywzgczmc`.

## Skills

- `minted-m3-audit` — Lean 3M health check (Muda/Mura/Muri) on a current-state feature
- `chrome-devtools-minted` — DevTools debugging patterns
- `chrome-extension-minted` — Chrome Extension MV3 architecture
- `adhd` — output shaping

## Notes

- Every provider-profile `/api` read writes an `audit_log` READ row
- The `/api` org-isolation gate is the wall — a red gate is stop-ship
- Keep `docs/SYSTEM-MAP.md` current at session end
