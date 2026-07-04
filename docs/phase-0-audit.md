# Phase 0 Audit — Minted Panel API layer

Date: 2026-07-04 · Branch: `claude/phase-0-api-audit-yk345v` · Read-only audit; no application code changed.

**Scope note.** This audit was run from the Phase 0 task description (framework/deploy detection,
API-home recommendation, frontend Supabase call audit, schema dump, YAML inventory). The referenced
planning docs (`minted-panel-api-layer-plan.md`, `claude-md-additions.md`, `endpoint-catalog`,
`release-plan`, `phase-gates`, planning `ARCHITECTURE`) were **not present** in the repo, on any
remote branch, or in the session environment at audit time — they still need to be added to `/docs`.
The "append Standing Rules to CLAUDE.md" step is blocked on the same missing file.

Evidence sources: repo working tree at `30cbdd4`, live hosted Supabase project `fkvuhfsqcmujywzgczmc`
(via MCP: information_schema/pg_catalog queries, `list_tables`, `list_migrations`,
`list_edge_functions`), and the Vercel MCP (`list_teams`, `list_projects`).

---

## 1. Framework and deploy target

### What the app actually is

| Aspect                | Finding                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI framework          | React 19 + TypeScript 5.8, Vite 7, Tailwind v4, shadcn/ui                                                                                                                                                                                                                                                                    |
| App framework         | **TanStack Start** (`@tanstack/react-start` plugin in `vite.config.ts`, nitro build plugin, `src/server.ts` SSR entry, `src/start.ts` `createStart(...)`), _not_ a plain Vite SPA. `src/routeTree.gen.ts` has `ssr: true`.                                                                                                   |
| Server usage today    | **Zero.** No `createServerFn` / server routes anywhere in `src/`. The server runtime is scaffolding: `startInstance` wires `attachSupabaseAuth` function-middleware and an error middleware, but nothing calls a server function. All data access is browser → Supabase PostgREST under RLS.                                 |
| Dormant server assets | `src/integrations/supabase/client.server.ts` (service-role admin client, reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, RLS-bypassing, currently unimported by app code), `src/integrations/supabase/auth-middleware.ts` (`supabase.auth.getClaims(token)` verification), `src/integrations/supabase/auth-attacher.ts`. |
| Backend               | Supabase (Postgres + GoTrue + Edge Functions), hosted project `fkvuhfsqcmujywzgczmc` ("openpanel", us-east-2). Anon key in the browser; RLS on every table.                                                                                                                                                                  |
| Docs drift            | `README.md` says "React 18 … Vite" and CLAUDE.md says "No app server of our own." Behaviorally true (nothing server-side runs), but the build is TanStack Start/nitro SSR-capable. Worth correcting when the API layer lands.                                                                                                |

### Deploy target

- **Declared target: Vercel.** `README.md` ("Connect this repo to Vercel (framework: Vite)"),
  `vercel.json` (`rewrites: [{ source: "/(.*)", destination: "/" }]` — a static-SPA fallback),
  and the `vite.config.ts` nitro comment ("Vercel CI detects itself and emits Build Output API").
  Nitro's `defaultPreset: "cloudflare-module"` only applies when no provider is auto-detected.
- **Not yet provisioned:** the accessible Vercel team (`minted` / `mintedpanel`,
  `team_230fpJ9MgCj9ssW3LiIckfyA`) has **no projects**. The deploy story is aspirational as of
  this audit — there is no live Vercel deployment to inherit constraints from.
- Tension to resolve at deploy time: the `vercel.json` rewrite-everything-to-`/` treats the build
  as a static SPA, while the nitro/TanStack Start build emits a server output. If the API moves
  in-app (below), the Vercel project must deploy the nitro Build Output (SSR/serverless) and the
  blanket rewrite must be dropped or scoped so `/api/*` reaches the server function.

### Recommendation: where the API layer should live

The plan's framing is "Next API routes vs Supabase Edge Functions." This app is not Next; the
in-framework equivalent of "Next API routes" is **TanStack Start server routes/functions on the
nitro server, deployed as Vercel functions**. That is the recommended primary API home:

1. **The plumbing already exists.** `createStart` middleware already attaches Supabase auth to
   server functions; a service-role server client (`client.server.ts`) and a JWT verification
   middleware are already written and waiting. Choosing Edge Functions would strand all of it.
2. **Shared code and types.** Server routes import the same `src/` tree: `Database` types,
   `camelizeRow`/`snakeizeRow`, `sopResolver`, validation, the domain types in `src/types`.
   Edge Functions are Deno — they cannot import the app source without a separate build/vendoring
   pipeline, and today's known duplication (`pickTemplate` copied in two components) would multiply.
3. **One repo, one deploy, one review surface.** Vercel builds app + API atomically; no CORS, no
   separate function deploy step, same env-var management, preview deployments cover the API too.
4. **Migration shape fits.** The 16 service modules in `src/services/*` are already the app's de
   facto endpoint catalog (see §2). Each service function maps 1:1 onto a server route; hooks keep
   their TanStack Query shape and swap `supabase.*` for `fetch("/api/...")` per service.

**Keep Supabase Edge Functions for the jobs already there** — they are the right tool where they
sit: `email-to-touch` (inbound webhook, `verify_jwt=false`, must be publicly addressable next to
Supabase), `fill-pdf` / `resolve-fill` (extension/portal-fill support, service-role isolated,
already Deno). `invite-member` (repo source exists, **not deployed** — see §5) should either be
deployed or folded into the new API layer as its first privileged endpoint.

Fallback option, for completeness: if the team decides to keep the deploy strictly static (SPA on
any static host), Edge Functions become the only serverless compute and the API would live there —
workable, but it costs the shared-types story, local DX, and keeps the Deno/browser code split.
Not recommended given the Vercel target and the existing Start scaffolding.

---

## 2. Frontend Supabase call audit

Every direct Supabase access in `src/` (PostgREST `.from()`, `.rpc()`, `auth.*`,
`functions.invoke`). The layering rule (services are the only Supabase callers) holds **except**
for the rows marked ⚠ (out-of-layer callers).

Read = `select`; Write = `insert` / `update` / `upsert` / `delete` / RPC with side effects.

### Services (`src/services/*` — the sanctioned callers)

| File                        | Tables touched                                                                                                                                                                                                                                       | Read/Write | Screens served (via hooks)                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/audit.ts`         | `audit_log`                                                                                                                                                                                                                                          | R          | Admin > Audit (`admin.audit.tsx`) via `useAuditLog`                                                                                                   |
| `services/cases.ts`         | `credential_cases` R/W(update); `profiles` R; `status_history` W(insert); `contracts` R; RPC `create_case_with_tasks` W                                                                                                                              | R/W        | Cases list + detail, Home, Progress, Providers list/detail, Launches, Reports (all tabs), Admin > Statuses (usage counts), global Search dialog       |
| `services/contracts.ts`     | `contracts` R/W(insert, update); `status_history` W via `appendStatusHistory`                                                                                                                                                                        | R/W        | Reports > Contracts + Contract Matrix, Home, Provider detail, Launch detail, Case detail (`useContractFor`)                                           |
| `services/invites.ts`       | `pending_invites` R/W(insert, delete — via locally-typed shim; table absent from generated types); `memberships` W(delete); RPC `claim_invites` W                                                                                                    | R/W        | Admin > Users and Admin > Settings (MembersPanel)                                                                                                     |
| `services/launches.ts`      | `facilities` R/W(insert, update); `provider_facility_assignments` R/W(upsert); creates cases via `createCase` → RPC                                                                                                                                  | R/W        | Launches list + detail, Home ("Launches at risk"), Admin > Statuses, Reports > Contract Matrix, launch modals (Edit / Assign Provider / Create Cases) |
| `services/lookups.ts`       | `state_licenses` R; `facilities` R; `provider_groups` R; `memberships` R (+`profiles` join); `mso_routing_rules` R; `notes` R/W(insert); `profiles` R                                                                                                | R/W        | Provider detail/edit, Case detail, Task detail, New Case modal, provider forms, Reports tabs, Admin > Templates                                       |
| `services/msos.ts`          | `msos` R/W(insert, update); `mso_routing_rules` R/W(insert, update)                                                                                                                                                                                  | R/W        | Admin > MSO Routing, Provider detail, New Case modal, launch Create Cases dialog                                                                      |
| `services/orgSettings.ts`   | `organizations` R/W(update); `provider_groups` R/W(insert, update); `facilities` R/W(insert, update); `memberships` R/W(update role); `group_insurance_policies` R/W(insert, update)                                                                 | R/W        | Admin > Settings (Org / Groups / Facilities / Members / per-group Insurance panels), Admin > Users; `listFacilities` reused by `useLaunches`          |
| `services/payers.ts`        | `payers` R/W(insert, update)                                                                                                                                                                                                                         | R/W        | Admin > Payers; payer names read on Home, Cases, Providers, Progress, Launches, Reports, Search, case-creation dialogs                                |
| `services/providers.ts`     | `providers` R/W(insert, update); `state_licenses` R/W(insert, update, delete); `provider_facility_assignments` W(insert); `status_configs` R; `credential_cases` R; `payers` R; `tasks` W(insert) — the last four inside the terminate-provider flow | R/W        | Providers list/new/detail/edit, Home, Cases, Progress, Launches, Reports, Search, launch dialogs                                                      |
| `services/reports.ts`       | `touches` R; `provider_facility_assignments` R; `state_licenses` R; `facilities` R                                                                                                                                                                   | R          | Reports > Summary (touch summary), Reports > Roster (aux data)                                                                                        |
| `services/statusConfigs.ts` | `status_configs` R/W(insert, update)                                                                                                                                                                                                                 | R/W        | Admin > Statuses; `useStatusConfigs` feeds status pills on essentially every work surface                                                             |
| `services/tablePrefs.ts`    | `user_table_prefs` R/W(upsert)                                                                                                                                                                                                                       | R/W        | **None — dead code.** No importers anywhere in `src/`.                                                                                                |
| `services/tasks.ts`         | `tasks` R/W(insert, update); `credential_cases` R/W(update — case status roll-forward on task completion)                                                                                                                                            | R/W        | Home, Cases list, Providers list, Task detail (`tasks.$id`), Case tasks panel, Task drawer, Reports > Summary                                         |
| `services/templates.ts`     | `sop_templates` R/W(insert, update)                                                                                                                                                                                                                  | R/W        | Admin > Templates (list + editor), New Case modal, launch Create Cases dialog (template pick)                                                         |
| `services/touches.ts`       | `touches` R/W(insert)                                                                                                                                                                                                                                | R/W        | Home (follow-ups due), Cases list (last touch), Case detail (log touch), Progress, Reports > Summary                                                  |

### Out-of-layer callers ⚠

| File                                       | Tables / calls                                                                                                                             | Read/Write | Screen                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------- |
| `src/lib/audit.ts`                         | `audit_log` insert (`writeAudit`, called from service mutations)                                                                           | W          | cross-cutting (every mutation)                                                  |
| `src/lib/auth-store.ts`                    | `auth.getSession`, `auth.onAuthStateChange`, `auth.signInWithPassword`, `auth.signOut`; `profiles` R; `memberships` R; RPC `claim_invites` | R/W        | app bootstrap, Login, org switcher                                              |
| `src/routes/welcome.tsx`                   | `auth.updateUser` (password set); RPC `claim_invites`                                                                                      | W          | Welcome (invite acceptance)                                                     |
| `src/routes/admin.templates.$id.tsx`       | RPC `get_sop_field_tokens`                                                                                                                 | R          | Admin > Template editor (token list)                                            |
| `src/components/cases/NewCaseModal.tsx`    | `state_licenses` R; `provider_facility_assignments` R; `contracts` R — direct queries bypassing the service layer                          | R          | New Case modal (provider detail)                                                |
| `src/components/settings/MembersPanel.tsx` | `functions.invoke("invite-member")`                                                                                                        | W          | Admin > Users / Settings — **function not deployed on hosted project** (see §5) |

### Call-shape inventory (for endpoint design)

- **RPCs used by the app:** `create_case_with_tasks(p_input, p_tasks)` (cases + launch kickoff),
  `claim_invites()` (auth-store, welcome, invites service), `get_sop_field_tokens()` (template
  editor). All called via the `supabase.rpc.bind(supabase)` idiom.
- **Edge functions invoked by the app:** `invite-member` only (MembersPanel).
- **Deletes are rare and enumerable:** `state_licenses` (provider-edit license sync),
  `memberships` (remove member), `pending_invites` (revoke invite). Everything else is
  insert/update-only — append-only tables (`touches`, `status_history`, `audit_log`) and
  soft-archive flags elsewhere. The future API surface needs only these three DELETE endpoints.
- **Auth surface:** password sign-in/out, session restore/refresh, `updateUser` (password), plus
  the server-side `getClaims` middleware (dormant). No OAuth, no storage API usage anywhere.

---

## 3. Schema dump (hosted project `fkvuhfsqcmujywzgczmc`, schema `public`)

27 tables, **RLS enabled on all**. Row counts as of audit. Generated types live in
`src/integrations/supabase/types.ts` (except `pending_invites`, `portal_field_maps`,
`provider_documents`, `fill_sessions` gaps noted below where relevant).

**Metadata comments: effectively absent.** Across all 27 tables there are zero table comments and
exactly two column comments (`provider_groups.billing_street` — "Street address where payers send
checks and EOBs"; `provider_groups.correspondence_street` — "Street address where payers send
credentialing and contracting mail"). If Phase 0's successor phases want the schema to be
self-describing (e.g. for endpoint generation), `COMMENT ON` statements are a green-field task.

Legend: **PK** primary key, **U** unique, → foreign key, NN not-null. All `id` columns are
`uuid PK default gen_random_uuid()` unless noted; `created_at`/`updated_at` are `timestamptz
default now()` and omitted below unless unusual.

### Core tenancy & identity

- **organizations** (2 rows) — `id` PK; `name` text NN.
- **profiles** (3) — `id` PK → `auth.users(id)` ON DELETE CASCADE (no default); `full_name` text; `email` text.
- **memberships** (5) — `id` PK; `org_id` NN → organizations (CASCADE); `user_id` NN → profiles (CASCADE); `role` text NN; **U(org_id, user_id)**.
- **pending_invites** (0) — `id` PK; `org_id` NN → organizations (CASCADE); `email` text NN; `role` text NN; `full_name` text; `invited_by` → `auth.users(id)`; **U(org_id, email)**. _Not in generated types._
- **user_table_prefs** (2) — `id` PK; `user_id` NN → `auth.users(id)` (CASCADE); `page_key` text NN; `prefs` jsonb NN default `{}`; `updated_at` NN; **U(user_id, page_key)**. _Only touched by the dead `tablePrefs.ts` service._

### Group / location / provider domain

- **provider_groups** (2) — `id` PK; `org_id` NN → organizations (CASCADE); `name` text NN; `tin`, `npi_type2` text; `states` text[]; `is_active` bool NN default true; plus 36 contact/address columns added Jun 2026: `billing_*` (street*, suite, city, state, zip, contact*name, phone, fax, email), `correspondence**`(same set),`credentialing*\*`(street, suite, city, state, zip, contact_name, phone, fax, email),`contracting_contact*{name,title,email}`, `website*url`, `tax_id_type`, `preferred_contact_method`, `contract_signer*{name,email}`. (\* = the two commented columns.)
- **facilities** (12) — `id` PK; `org_id` NN → organizations (CASCADE); `group_id` → provider_groups (SET NULL); `name` text NN; `street`,`city`,`state`,`zip`,`suite`,`county` text; `is_active` bool NN default true; contact block: `phone`,`fax`,`email`,`appointment_phone`,`contact_name` text; `accepting_new_patients` bool default true; `language_line` bool default false; `languages_offered`,`interpreter_languages` text[] default `{}`; `hours`,`ada_compliance`,`service_types`,`treating_categories` jsonb default `{}`; **launch columns:** `status_id` → status_configs, `effective_date` date.
- **providers** (10) — `id` PK; `org_id` NN → organizations; `group_id` → provider*groups; identity: `first_name`,`last_name` NN, `middle_initial`,`suffix`,`credentials`,`gender`,`ethnicity` text, `date_of_birth` date, `ssn_last4` text (PHI-minimized); contact: `email`,`phone`,`home*{street,city,state,zip}`; credentialing ids: `npi`,`caqh*id`,`dea_number`text,`caqh_last_attested_date`,`dea_expiration_date`date,`taxonomy_code`default`'225100000X'`; practice: `specialty`default`'Physical Therapy'`, `sub_specialty`, `board_certified`bool default false,`languages`text[] default`{}`, `age_groups_served`text[] default`{}`, `additional_certifications`jsonb default`[]`, `medicaid_attested`,`cultural_competency_training`bool default false; lifecycle:`start_date`,`terminated_date`,`graduation_date`date,`status`text NN default`'onboarding'`, `is_new_grad`bool default false,`degree`,`school_name`text; malpractice:`malpractice*{carrier,policy*number}`text,`malpractice_coverage*{start,end}`date; embedded primary license:`license*{number,state}`text,`license*{issue,expiration}\_date`date; **legacy:**`launch_id` → launches.
- **state_licenses** (10) — `id` PK; `org_id` NN → organizations; `provider_id` → providers; `state` text NN; `license_number`,`license_type` text; `issue_date`,`expiration_date` date; `status` text default `'active'`. (Dedupe unique index added by hosted migration `20260703000140`.)
- **provider_facility_assignments** (14) — `id` PK; `org_id` NN → organizations; `provider_id` → providers; `facility_id` → facilities; `is_primary` bool default false; `start_date` date; `practice_frequency` text; **U(provider_id, facility_id)**.

### Payer / routing / contracting domain

- **payers** (16) — `id` PK; `org_id` NN → organizations; `name` text NN; `is_active` bool default true; `avg_decision_days`,`retro_billing_window_days`,`caqh_pull_deadline_days` int; `provisional_billing_allowed`,`retro_billing_allowed` bool default false; `provisional_billing_notes`,`provider_type_path`,`prior_auth_vendor`,`payer_billing_id`,`portal_url` text. (Sentinel row "Pre-Credentialing Setup" matched by name.)
- **msos** (4) — `id` PK; `org_id` NN → organizations; `name` text NN; `portal_url` text.
- **mso_routing_rules** (4) — `id` PK; `org_id` NN → organizations; `payer_id` → payers; `state` text NN; `specialty` text NN default `'All'`; `route_type` text NN; `mso_id` → msos; `notes` text.
- **contracts** (12) — `id` PK; `org_id` NN → organizations; `group_id` → provider_groups; `payer_id` → payers; `state` text NN; `effective_date`,`expiration_date` date; `notes` text; `contracting_status_id` → status_configs; `payer_group_id` text; **U(group_id, payer_id, state)**.

### Credentialing work domain

- **credential_cases** (50) — `id` PK; `org_id` NN → organizations; `provider_id` NN → providers; `group_id` → provider_groups; `facility_id` → facilities (the launch/location link); `payer_id` NN → payers; `state` text NN; `specialty` text default `'Physical Therapy'`; `credentialing_status_id` → status_configs; `mso_id` → msos; dates: `submitted_date`,`approved_date`,`expected_effective_date`,`confirmed_effective_date`,`termination_date`; `assigned_to`,`created_by` → profiles; `case_email_token` text NN **U** default `substr(md5(gen_random_uuid()::text),1,12)` (email-to-touch routing token); **U(provider_id, payer_id, state)**.
- **tasks** (198) — `id` PK; `org_id` NN → organizations; `case_id` → credential_cases; `provider_id` → providers; `title` text NN; `description` text; `sop_content` jsonb default `[]`; `status` text NN default `'not_started'`; `sort_order` int default 0; `due_date`,`completed_date` date; `is_auto_generated` bool default false.
- **sop_templates** (19) — `id` PK; `org_id` NN → organizations; `name` text NN; `group_id` → provider_groups; `state`,`specialty` text; `payer_id` → payers; `task_definitions` jsonb NN default `[]`; `archived` bool NN default false.
- **status_configs** (44) — `id` PK; `org_id` NN → organizations; `track` text NN (credentialing/contracting/location); `label` text NN; `color` text NN (hex); `sort_order` int NN; `required_fields` jsonb default `[]`; `action_bucket` text NN default `'ours'`.
- **touches** (39, append-only) — `id` PK; `org_id` NN → organizations; `case_id` NN → credential_cases; `touch_date` date NN; `touch_type`,`outcome` text NN; `next_follow_up_date` date; `notes` text; `coordinator_id` → profiles; `source` text default `'manual'`.
- **status_history** (49, append-only) — `id` PK; `org_id` NN → organizations; `case_id` → credential_cases; `contract_id` → contracts; `track` text NN; `from_status_id`,`to_status_id` → status_configs (no FK on these two columns — plain uuid); `metadata` jsonb; `changed_by` → profiles; `changed_at` timestamptz default now().
- **audit_log** (92, append-only) — `id` PK; `org_id` NN → organizations; `ts` timestamptz default now(); `user_id` uuid; `user_name` text; `action_type`,`entity_type` text NN; `entity_id` uuid; `before`,`after` jsonb; `description` text.
- **notes** (1) — `id` PK; `org_id` NN → organizations; `entity_type` text NN; `entity_id` uuid NN; `content` text NN; `author_id` → profiles.
- **group_insurance_policies** (2) — `id` PK; `org_id` NN → organizations; `group_id` NN → provider_groups; `insurance_type`,`insurer_name`,`policy_number` text NN; `policy_start_date`,`policy_end_date` date NN; `notes` text.

### Portal-fill / extension infrastructure (hosted-only feature set; no app reads or writes)

- **portal_field_maps** (24) — `id` PK; `org_id` → organizations (CASCADE, nullable = global maps); `portal_key` text NN; `url_pattern`,`page_step` text; `map_type` text NN; `selector` text NN; `selector_fallbacks` jsonb; `source` text NN; `token`,`hardcoded_value`,`transform` text; `field_type` text NN; `notes` text; `status` text NN default `'proposed'`; `updated_at` NN.
- **provider_documents** (0) — `id` PK; `org_id` NN → organizations (CASCADE); `provider_id` → providers (CASCADE); `group_id` → provider_groups (CASCADE); `case_id` → credential_cases (SET NULL); `doc_type`,`file_path`,`file_name` text NN; `effective_date`,`expiration_date` date; `uploaded_by` uuid.
- **fill_sessions** (0) — `id` PK; `org_id` NN → organizations (CASCADE); `case_id` NN → credential_cases (CASCADE); `provider_id` → providers (SET NULL); `portal_key` text NN; `fill_mode` text NN default `'web'`; `started_at` NN default now(); `completed_at` timestamptz; `fields_filled` int NN default 0; `fields_skipped`,`docs_attached` jsonb; `performed_by` uuid.

### Legacy (retired by the launch→location pivot, retained per additive rule)

- **launches** (10) — `id` PK; `org_id`,`group_id` NN; `name` text NN; `gym_name`,`address`,`city` text; `state` text NN; `status` text NN default `'prospect'`; `target_month`,`confirmed_start_date` date; `clinic_director_provider_id` → providers; `clinic_director_name` text; `facility_id` → facilities. Nothing reads or writes it; same for `providers.launch_id`.

### Database functions (schema `public`)

| Function                 | Signature                        | Returns       | Security    | Role                                                     |
| ------------------------ | -------------------------------- | ------------- | ----------- | -------------------------------------------------------- |
| `create_case_with_tasks` | `(p_input jsonb, p_tasks jsonb)` | jsonb         | invoker     | Transactional case + status_history + tasks + audit rows |
| `claim_invites`          | `()`                             | integer       | **definer** | Converts caller's pending_invites into memberships       |
| `get_sop_field_tokens`   | `()`                             | jsonb         | **definer** | Closed token list for SOP templates                      |
| `user_org_ids`           | `()`                             | setof uuid    | **definer** | RLS helper                                               |
| `user_role`              | `(p_org uuid)`                   | text          | **definer** | RLS helper                                               |
| `handle_new_user`        | trigger                          | trigger       | **definer** | Profile bootstrap on signup                              |
| `set_updated_at`         | trigger                          | trigger       | invoker     | `updated_at` maintenance                                 |
| `rls_auto_enable`        | event trigger                    | event_trigger | **definer** | Auto-enables RLS on new tables                           |

### Edge functions (hosted)

| Function         | verify_jwt | Status           | In repo?                                  |
| ---------------- | ---------- | ---------------- | ----------------------------------------- |
| `email-to-touch` | false      | ACTIVE           | no                                        |
| `resolve-fill`   | true       | ACTIVE           | no                                        |
| `fill-pdf`       | true       | ACTIVE           | no                                        |
| `invite-member`  | —          | **NOT DEPLOYED** | yes (`supabase/functions/invite-member/`) |

### Migration drift (repo vs hosted)

Hosted tracks **23** migrations (semantic names, `20260623040255…20260704184954`); the repo has
**15** files (timestamp+uuid names, `20260610…20260704`). Names don't correspond 1:1 and several
hosted migrations have no repo file (`create_launches`, `launch_location_pivot`,
`portal_fill_infrastructure`, `member_invites_infrastructure`, `create_case_with_tasks_rpc`,
`add_action_bucket_to_status_configs`, `security_hardening_grants_delete_policies_indexes`,
`revoke_rls_auto_enable_from_anon`, …). Consistent with CLAUDE.md's "partial mirror" warning:
**the live DB, not `supabase/migrations/`, is the source of truth.**

---

## 4. YAML inventory

Exhaustive search (`**/*.yml`, `**/*.yaml`, node_modules excluded, dot-directories included):

| File                       | Purpose                                                                                 | Classification           | Target config table |
| -------------------------- | --------------------------------------------------------------------------------------- | ------------------------ | ------------------- |
| `.github/workflows/ci.yml` | GitHub Actions CI: prettier check, tsc, eslint, vitest, vite build on PRs + main pushes | **Infra — keep as YAML** | n/a                 |

That is the entire inventory: **one YAML file, zero domain YAML.** There is no YAML-encoded domain
or seed configuration to migrate — domain configuration already lives in database tables
(`status_configs` for tracks/statuses/action buckets, `sop_templates.task_definitions` for SOP
checklists, `mso_routing_rules` for routing, `portal_field_maps` for portal fill). Adjacent
non-YAML config, for completeness: `supabase/config.toml` (infra, keep), `components.json`
(shadcn codegen config, infra, keep), `vercel.json` (infra, keep — revisit rewrite per §1),
`supabase/seed.sql` (local fixture; known-stale `task_definitions` shape per CLAUDE.md).

---

## 5. Findings and risks carried into later phases

1. **`invite-member` edge function is not deployed** although the repo carries its source and
   `MembersPanel` invokes it. On hosted, every invite hits the error branch ("Invite saved but
   email failed to send…"); invites only work via the sign-in `claim_invites` fallback. Deploy it
   or make it the first endpoint of the new API layer.
2. **`src/services/tablePrefs.ts` is dead code** (no importers), yet `user_table_prefs` exists
   with rows. Decide: wire it up or drop both from the endpoint catalog.
3. **Layering violations to absorb into the API migration:** `NewCaseModal` queries
   `state_licenses` / `provider_facility_assignments` / `contracts` directly;
   `welcome.tsx` and `admin.templates.$id.tsx` call RPCs directly; `auth-store` reads
   `profiles`/`memberships` directly. When endpoints replace services, these five call sites need
   routing through the same layer or they'll keep a live PostgREST dependency.
4. **Generated-types gaps** force untyped shims (`pending_invites` in `invites.ts`, bound-`rpc`
   casts for all three RPCs). An API layer with its own DTOs removes the need, but until then any
   regeneration should confirm whether these tables/functions are exposed.
5. **DB metadata comments are missing** (2 column comments total, zero table comments) — add
   `COMMENT ON` migrations if later phases generate docs/endpoints from the schema.
6. **Docs drift:** README/CLAUDE.md describe a plain Vite SPA and React 18; the build is React 19
   TanStack Start with dormant SSR/server scaffolding. Update once the API-home decision is final.
7. **No Vercel project exists yet** in the `minted` team; the deploy pipeline (and the SPA-rewrite
   vs nitro-output question from §1) must be settled before any API route can ship.
8. **Known duplication** (`pickTemplate` in `NewCaseModal` + `CreateCasesDialog`) becomes a single
   server-side module once case-creation moves behind an endpoint — cheap consolidation win.
9. **Append-only tables** (`touches`, `status_history`, `audit_log`) and the three-delete-only
   surface (§2) keep the endpoint catalog small: the API can expose no generic DELETE and only
   three targeted ones.
