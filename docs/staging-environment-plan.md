# Staging environment plan — pinned

**Status: APPROVED WITH REVISIONS — pinned 2026-07-10.** The architecture below
is the locked decision. The four must-fix prerequisites in section 3 are
**blockers**: none of the staging infrastructure gets created until they are
done. Companion doc on the extension side:
`minted-extension/docs/STAGING.md`.

## 1. The architecture (locked)

One **parallel staging spine**, mirroring production shape exactly:

1. **Staging Supabase project** — a second free project in the "openpanel"
   org, built from the repo migration set at the deployed staging SHA, seeded
   with synthetic data only. Never a clone of production.
2. **Staging Vercel project** — a second project on the "minted" team, same
   repo, whose **production branch is `redesign`** (the long-lived integration
   branch). Its production alias is the stable, unauthenticated staging URL.
3. **Staging extension build** — a separately built, separately loaded
   unpacked extension with its own output dir, manifest, name, ID, and host
   permissions, pointing only at the staging Supabase + staging API.

### Rejected alternatives (do not revisit without new facts)

- **Supabase branching** — Pro-only; the org is on the free plan (verified
  2026-07-10 via the management API). Revisit on upgrade; the repo migration
  files are exactly what branching would replay, so nothing here forecloses it.
- **Vercel preview URLs as the staging surface** — Deployment Protection (SSO)
  blocks the extension's Bearer fetches and the isolation gate; documented in
  `verify-org-isolation.yml` itself.
- **A "staging tenant" org inside the production DB** — staging exists to
  rehearse schema/guard/API changes, which are per-database, not per-org.
- **Cloning production data into staging** — production carries PHI (DOB,
  SSN last-4, home addresses). Staging is synthetic-only, always.

## 2. Verified facts this plan rests on (checked 2026-07-10)

- Supabase org `jjuqzunkppsdehcoadww` ("openpanel") is on the **free plan**;
  a second project costs $0/month (`get_cost` confirmed). Existing project:
  `fkvuhfsqcmujywzgczmc`.
- Vercel team "minted" (`team_230fpJ9MgCj9ssW3LiIckfyA`) has one project,
  `mintedpanel`, framework `tanstack-start`, domains `mintedpanel.vercel.app`
  / `mintedpanel.com` / `www.mintedpanel.com`.
- **`main` has 11 migration files; `redesign` has 24** (the same 11 plus 13
  redesign-only: party model, org RPC v2/v3, capture links, inbound leads,
  report shares, and the 2026-07-10 hardening set). Any staging provision must
  use the migration set at the deployed staging SHA, never a count copied
  from `main`.
- The baseline (`20260704210000_baseline_live_schema.sql`) contains the RPCs
  (`create_case_with_tasks`, `claim_invites`, `get_sop_field_tokens`,
  `handle_new_user`) **but NOT the `on_auth_user_created` trigger on
  `auth.users`**. That trigger exists on hosted (verified via pg_trigger) and
  in `supabase/migrations_archive/20260610035319_*.sql` only — which the CLI
  ignores. `memberships.user_id` FKs `profiles(id)`, and `handle_new_user()`
  is the only signup-time writer of `profiles`, so a fresh rebuild breaks
  signup → membership.
- The gate workflow's guard is
  `contains(github.event.deployment.environment, 'production')`
  (case-insensitive) — it WILL match a second Vercel project's
  `Production – <slug>` environment string.
- Extension config is hardcoded prod (`src/shared/config.ts`:
  `SUPABASE_URL`, anon key, `API_BASE_URL`); `manifest.json` host_permissions
  allow only prod hosts; builds are two Vite invocations into one `dist/`.
  `INSTALL.md`/`README.md` treat `API_CORS_ORIGINS=chrome-extension://<id>` as
  a required part of the install contract.
- `supabase/config.toml` pins `project_id = "fkvuhfsqcmujywzgczmc"`
  (production) and declares the `invite-member` edge function — every staging
  CLI command must explicitly link/target the staging ref.

## 3. Must-fix prerequisites (blockers — in order, before any provisioning)

### 3.1 Auth bootstrap trigger as a forward migration

Add a new migration (never edit the baseline or archive) that safely recreates:

```sql
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

Guard it for idempotence and for environments where `auth.users` privileges
differ (exception-guarded `DO` block, `DROP TRIGGER IF EXISTS` first — the
same guarding style the baseline rule already requires). Apply to production
via MCP `apply_migration` per the repo-first rule (it is a no-op-with-guard
there since the trigger exists), and verify on production that a newly created
user still receives a `profiles` row. This migration is what makes "fresh
rebuild = working auth" true for staging and any future environment.

### 3.2 Fail-closed gate routing

Do **not** guess the second project's environment string. Sequence:

1. First, tighten the existing `verify-org-isolation.yml` guard so the
   production lane fails closed: require the exact observed production
   environment name AND `github.event.deployment.ref` (or sha lineage) on
   `main`, instead of `contains(..., 'production')`.
2. Create the staging Vercel project, deploy once, and **capture the real
   `deployment_status` payload** (the existing `deployment-context` job exists
   for exactly this).
3. Add a staging lane routed on project identity + deployment target + Git
   ref — with its own `API_BASE`, test credentials, and fixture env block
   (staging fixture UUIDs come from `seed.sql`, which uses fixed UUIDs).
4. Prefer Vercel's `repository_dispatch` events (`vercel.deployment.success`,
   payload carries project + deployment metadata) over display-name parsing if
   enabled for the team.
5. Do NOT attach a GitHub Actions `environment:` named production/staging to
   this post-deploy job without testing the event graph — Actions environments
   emit their own deployment statuses and can recurse the workflow. Separate
   repo secrets are simpler.

Deliberately prove cross-wiring is impossible: each lane must reject the other
lane's credentials and fixture IDs (a staging deploy must never trigger a
prod-targeted verify, and vice versa).

### 3.3 Extension dual-build with distinct identity

`--mode staging` must be passed to **both** Vite invocations (main +
`vite.content.config.ts`), and mode alone is not enough:

- Separate output dirs: `dist/` (prod) and `dist-staging/`.
- Generated per-target manifests: distinct `name` (suffix "(Staging)"), each
  with ONLY its own API/Supabase/portal host permissions.
- Build-time validation that fails loudly when a required URL/key is missing.
- Stable, distinct IDs: loading two builds from the same directory updates one
  unpacked install rather than creating a second. Different paths produce
  different unpacked IDs; for a predictable `API_CORS_ORIGINS` allowlist,
  assign stable distinct `key` values in each manifest (or explicitly register
  each tester's two IDs).
- Keep the `API_CORS_ORIGINS` contract: add the staging extension origin to
  the staging Vercel project's env. Do not rely on Chrome host_permissions
  alone without an end-to-end test.

### 3.4 Runbook updates

Update `docs/migration-baseline.md` (and CLAUDE.md's schema-work section) to
the three-step policy in section 5 before the first staging-first migration
ships, so no lane applies straight to production out of habit.

## 4. Provisioning (after section 3 is done)

### 4.1 Staging Supabase

- Create the project in org "openpanel" (name suggestion:
  `mintedpanel-staging`).
- Provision from the **deployed staging SHA**, preserving migration history:

  ```
  git checkout <deployed redesign SHA>
  supabase link --project-ref <staging-ref>
  supabase db push --include-seed
  ```

  Never apply the baseline to the existing production project.
- Deploy the `invite-member` edge function with an explicit
  `--project-ref <staging-ref>`.
- Auth config: set Site URL + allowed redirect URLs to the staging Vercel
  domain; verify invite email links land on `/welcome`.
- Create synthetic test users via GoTrue (dashboard/admin API) — `seed.sql`
  creates neither auth users nor memberships — then insert memberships against
  the seed orgs and verify `profiles` rows appeared via the 3.1 trigger.
- Treat staging logs/screenshots/exports as sensitive test artifacts even
  though the seed is synthetic (it resembles regulated data).
- Free-project caveats: auto-pause on inactivity (no durable interval
  guarantee — add a pre-test availability check, e.g. `/api/health` +
  a trivial DB read, rather than assuming "one week"), and **no automated
  backups** — before risky production migrations take a logical export or
  write down the forward-recovery plan first.

### 4.2 Staging Vercel

- Second project on team "minted", same repo, production branch = `redesign`.
  Restrict builds to that branch where possible so feature branches don't
  double-build across both projects and burn shared quotas.
- Env vars (all three, staging values): `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, server-only `SUPABASE_SERVICE_ROLE_KEY` — plus
  `API_CORS_ORIGINS` with the staging extension origin(s).
  `src/server/env.ts` resolves these already; no app code change.
- Confirm the project's production domain is stable and **unauthenticated**
  before distributing the staging extension.
- Verify: `/api/health`, login, one authenticated API request, and capture the
  deployment event payload for gate lane routing (3.2 step 2).
- "$0" is no fixed additional charge, not unlimited: builds, functions,
  transfer, and Supabase usage still draw from plan quotas.

### 4.3 Staging extension

- Build `dist-staging/`, load side-by-side with prod, confirm it is visually
  distinct and coexists.
- Verify it authenticates only against staging GoTrue and calls only the
  staging API/Supabase hosts (network panel check, plus a fill against the
  seeded portal fixture).

## 5. Migration + promotion policy (supersedes two-step repo-first, once staging exists)

```
repo migration
→ fresh/local rebuild passes
→ apply to STAGING (MCP apply_migration / supabase db push, staging ref)
→ staging API + isolation + extension tests green
→ production backup or recovery checkpoint
→ apply backward-compatible migration to PRODUCTION
→ deploy production app
→ production isolation gate green
```

Vercel rollback does not roll back Supabase: migrations must stay
backward-compatible and preferably additive, with a forward-fix (or explicit
rollback) procedure documented before production promotion. All existing
AGENTS.md database rules (additive-only, append-only tables, RLS + GRANTs)
bind in staging exactly as in production.

## 6. Rollout order (checklist)

1. **Repo prerequisites** — 3.1 auth trigger migration · 3.2 fail-closed gate
   · 3.3 extension build modes/dual dist/manifests · 3.4 runbooks.
2. **Provision staging Supabase** — migrate from deployed `redesign` SHA →
   seed → `invite-member` → Auth URLs → synthetic users/memberships → verify
   signup bootstrap, login, RLS, invite claiming, function invocation.
3. **Provision staging Vercel** — track `redesign` → staging env vars →
   verify health/login/authed API/stable public access → capture the real
   deployment event payload.
4. **Enable the two isolation lanes** — prod: prod project + `main` + prod
   fixtures; staging: staging project + `redesign` + staging fixtures; prove
   each lane rejects the other's credentials and fixture IDs.
5. **Distribute + test the staging extension** — `dist-staging/`, coexistence,
   staging-only hosts end-to-end.

## 7. Platform references

- Supabase environments: https://supabase.com/docs/guides/deployment/managing-environments
- Supabase migrations and remote seeds: https://supabase.com/docs/guides/deployment/database-migrations
- Supabase free-plan projects: https://supabase.com/docs/guides/platform/billing-on-supabase
- Supabase Auth redirects: https://supabase.com/docs/guides/auth/redirect-urls
- Supabase user profile trigger: https://supabase.com/docs/guides/auth/managing-user-data
- Supabase Edge Function deployment: https://supabase.com/docs/guides/functions/deploy
- Vercel Git integration: https://vercel.com/docs/git/vercel-for-github
- Vercel environments: https://vercel.com/docs/deployments/environments
- Vercel limits: https://vercel.com/docs/limits
- Chrome extension cross-origin requests: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- Chrome extension stable IDs: https://developer.chrome.com/docs/extensions/reference/manifest/key
