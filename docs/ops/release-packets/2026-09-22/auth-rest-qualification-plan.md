# Local Auth/REST recovery qualification — review packet

Status: IMPLEMENTED; the full local Auth/REST qualification succeeded on the
fresh isolated workspace. The recovery suite passed 321/321 tests. The result is
`LOCAL_AUTH_REST_VERIFIED_ONLY` with `releaseAdmission: BLOCKED`; hosted
service/configuration parity and production recovery remain unverified. The
successful run used the existing encrypted capture and old backup method only.
Existing recovery copies remain untouched.

| Authorized isolated run           | Outcome                                                                              | Cleanup                                                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full qualifier `89414b39111817b9` | `LOCAL_AUTH_REST_VERIFIED_ONLY`; `releaseAdmission: BLOCKED`; recovery suite 321/321 | `DESTROYED`, remaining[]; success receipt `/Users/ar/Codex-Minted/recovery-qualify-core-20260923-Ki8PJ9/auth-rest.json`; cleanup receipt `/Users/ar/Codex-Minted/recovery-qualify-core-20260923-Ki8PJ9/auth-rest-89414b39111817b9-cleanup.json` |

Production and hosted service writes remain blocked. This packet does not claim
hosted version/configuration parity, production recovery, or complete G0
qualification.

## Findings and prerequisites

Read-only checks on 2026-09-23 validated baseline run `db698c2326fe3f03` with the
existing strict local-target collector. Its pinned DB image contains
`/usr/bin/curl` and `/usr/bin/wget`; no fourth probe container is needed.
The source backup has 82 Auth migration ledger versions. Official GoTrue
`v2.188.1`, selected by installed CLI 2.84.2, contains 69 distinct `.up.sql`
version prefixes. All 69 appear in the capture; 13 captured versions are absent
from that tagged inventory:

- Historical: `20171026211738`, `20171026211808`, `20171026211834`,
  `20180103212743`, `20180108183307`, `20180119214651`, `20180125194653`.
- Later: `20260625000000`, `20260821000000`, `20260821010000`,
  `20260824000000`, `20260824000001`, `20260831180000`.

**Updated candidate: GoTrue v2.197.0** (official release 2026-09-09).
Its 75 migration prefixes are all present in the captured ledger, including all
six later entries. There are zero unapplied candidate migrations. The seven
remaining historical entries are explained by upstream bootstrap SQL, which
explicitly inserted those exact seven versions. Upstream commit `557c345` moved
that initial schema into migration `00`; therefore literal ledger/file equality
would incorrectly reject this legacy database.

This establishes migration-inventory compatibility. The successful bounded local
run used the pinned v2.197.0 Auth and v14.7 REST images; it does not establish
hosted service/version/configuration parity. Require unchanged ledger/schema on
explicit `auth serve` startup. Do not remove historical records or run
migrations to force a pass.

Fixed staging public Auth health returned HTTP 401 without an API key; hosted
version remains unverified. No keys were printed or persisted. CLI image versions
are provenance candidates, not evidence of the hosted versions.

| Candidate                                                                             | Registry index digest                                                   | Linux ARM64 manifest digest                                             |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| supabase/gotrue:v2.197.0 — local Auth qualification passed; hosted parity unverified  | sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b | sha256:3439d5affb9e96395d1348521f4c675eea7096d8d76d18d4e31fcc08df802116 |
| postgrest/postgrest:v14.7 — local REST qualification passed; hosted parity unverified | sha256:8b53afca2e239bc90a0facdb880710232886c38dae5743a57d66056e96d5596a | sha256:ba586907588f4c03fc1d7e5c57732cec80c396a164199ceeddfc8a89b24412f0 |

These exact digest pins were used by the local qualifier. Hosted image/version
parity remains unverified.

## Bounded implementation scope

| Files                                              | Requirement                                                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| scripts/recovery/local-services.mjs and tests      | Fixed socket, pinned service manifests, owned three-container topology, generated credentials, bounded lifecycle and cleanup |
| scripts/recovery/service-contract.mjs and tests    | Separate closed topology/receipt contract; do not relax existing single-container collector                                  |
| scripts/recovery/auth-rest-qualifier.mjs and tests | Synthetic fixture provisioning, real login/refresh and REST checks, sanitized evidence                                       |
| docs/ops/staging-recovery.md                       | Exact qualification scope and unresolved recovery gaps                                                                       |

1. Restore a third disposable clone from the sealed capture. Preserve baseline
   `db698c2326fe3f03` and cleanup-rehearsal copy `f4a0e042347029a4` untouched.
2. Obtain strict DB-only verification before adding peers. Separate service
   collector requires exactly DB, Auth and REST on one owned internal bridge,
   exact labels/digests, no published ports, host binds, socket mounts, host
   namespaces, privileged mode, or external network attachments. Inspect before
   and after probes. Use DB-container curl via stdin; no secret request argv.
3. Generate local signing material, service token, fixture passwords and DB
   service-role passwords. Change passwords only in the new clone. No source
   admin/JWT secrets or captured configuration values become runtime credentials.
   Docker Config.Env persists generated local credentials in daemon metadata.
   Permit this only for the owned disposable lifetime: suppress container logs,
   sanitize inspection before output, never serialize raw inspection, and verify
   container/resource removal. HTTP response secrets stay in coordinator memory;
   requests enter curl through stdin. Disable outbound integrations, mail, hooks,
   telemetry and cron; internal network isolation remains mandatory.
4. Start compatible Auth with explicit `auth serve`; the default root command
   runs migrations before serving. Verify unchanged schema and migration ledger
   after startup. Configure REST for the reviewed public schema and roles only.
5. Provision run-specific synthetic identities and two organizations. Do not
   rerun broad UAT seeding or use existing identities. Admin token is provisioning
   only; access probes use JWTs from actual password logins.
6. Finally stop/remove exact owned peers and disposable resources, then prove
   absence. Uncertain cleanup fails qualification; never delete another run.

## Closed configuration and fixture write contract

Only allowlisted configuration keys are supplied; inherit no host service, PG,
proxy or telemetry environment. No config/reload directory or signal reload.

| Component           | Fixed settings                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth command        | `auth serve`, no `--config-dir`                                                                                                                                                                                                            |
| Auth DB principal   | `supabase_auth_admin`, generated clone-only password; DB `minted_recovery` on exact owned DB peer                                                                                                                                          |
| Auth workers        | `GOTRUE_INDEX_WORKER_ENSURE_USER_SEARCH_INDEXES_EXIST=false`; `GOTRUE_INDEX_WORKER_MAX_USERS_THRESHOLD=0`; `GOTRUE_DB_CLEANUP_ENABLED=false`; `GOTRUE_MAILER_TEMPLATE_RELOADING_ENABLED=false`; `GOTRUE_DB_ADVISOR_ENABLED=false`          |
| Auth token rotation | `GOTRUE_SECURITY_REFRESH_TOKEN_ALGORITHM_VERSION=1`; `GOTRUE_SECURITY_REFRESH_TOKEN_UPGRADE_PERCENTAGE=0`; `GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true` (fixed legacy algorithm makes token-table/sequence effects deterministic) |
| Auth identity       | `GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated`; `GOTRUE_JWT_AUD=authenticated`; fresh local signer; admin-confirmed fixture email/password users; signup disabled                                                                           |
| REST DB principal   | `authenticator`, generated clone-only password; no superuser/service-role DB connection                                                                                                                                                    |
| REST overrides      | `PGRST_DB_CONFIG=false`; `PGRST_DB_PRE_CONFIG=`; `PGRST_DB_PRE_REQUEST=`; `PGRST_DB_CHANNEL_ENABLED=false`                                                                                                                                 |
| REST exposure       | `PGRST_DB_SCHEMAS=public`; `PGRST_DB_EXTRA_SEARCH_PATH=public,extensions`; `PGRST_DB_ANON_ROLE=anon`; generated local JWT verifier                                                                                                         |
| Probe authority     | Anonymous requests use `anon`; login JWTs carry `authenticated`. Admin token only provisions Auth users. No BYPASSRLS probes or new/permissive test policies.                                                                              |

The four Auth worker keys are confirmed by v2.197.0 configuration structs with
split-word names under the GOTRUE prefix. Disabling REST database configuration
is mandatory: restored authenticator settings must not replace JWT or schema
configuration. Empty pre-config/pre-request hooks and disabled notification
reload prevent hidden database callbacks/configuration changes.

Use exactly two newly generated fixture users A/B, two organizations, two admin
memberships, and `public.notes` as the existing application resource. The captured
catalog has **no non-internal triggers** on auth.users, public.profiles,
organizations, memberships or notes; therefore create profiles explicitly, not
by assuming the repository's handle_new_user function is attached. Recheck this
captured trigger/constraint/policy manifest before execution.

| Table                  | Exact permitted operations and row binding                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| auth.users             | Admin API adds A/B only; login/refresh may update only these two new rows                                                                                                                                                                                                                                                                                                       |
| auth.identities        | Two email identities linked exactly to A/B                                                                                                                                                                                                                                                                                                                                      |
| public.profiles        | SQL INSERT exactly A/B IDs, synthetic email/full_name; no ON CONFLICT or existing-row updates                                                                                                                                                                                                                                                                                   |
| public.organizations   | SQL INSERT two fresh IDs and synthetic names                                                                                                                                                                                                                                                                                                                                    |
| public.memberships     | SQL INSERT exactly (orgA,A,admin), (orgB,B,admin), fresh membership IDs                                                                                                                                                                                                                                                                                                         |
| public.notes           | REST A INSERT noteA with orgA, entity_type=provider, run-specific synthetic entity_id, author_id=A; own PATCH content once. B cross-org SELECT/PATCH/DELETE return zero rows, cross-org INSERT rejects. A own DELETE of a second temporary note proves DELETE routing; final noteA only. No provider row is needed: captured entity_id is polymorphic, with no FK to providers. |
| auth.sessions          | Two sessions, one per successful password login; refresh A updates only its new session                                                                                                                                                                                                                                                                                         |
| auth.refresh_tokens    | Three new tokens: two login tokens plus one A refresh replacement; revoke/update only the new A parent token. Bind every token to the exact new user/session lineage.                                                                                                                                                                                                           |
| auth.mfa_amr_claims    | Exactly two password-method claims, one for each new session; refresh reuses existing AMR                                                                                                                                                                                                                                                                                       |
| auth.audit_log_entries | Exactly six events: two user_signedup, two login, one token_refreshed and one token_revoked. Bind actor/target to A/B or the generated local provisioning principal and exact expected action/payload. Invalid-password failure adds zero audit rows. Require database audit persistence enabled; no silent count fallback.                                                     |
| public.audit_log       | Zero additions: no captured notes/profile/member/org audit trigger exists                                                                                                                                                                                                                                                                                                       |

Use exactly two successful password logins and one refresh, no retries or extra
health authentication. Pinned Auth handlers/models produce the exact six audit events and two AMR rows
above with token algorithm v1 and upgrades disabled. Review these exact paths in
implementation before starting services. Unexpected rows or
cardinality fail; do not expand a whitelist to match observed output.

Sequence contract: captured `auth.refresh_tokens_id_seq` has increment=1,
cache=1; exactly three allocations expected, reconciled with inserted token IDs
and original last_value/is_called semantics. `realtime.subscription_id_seq`
remains unchanged. All other fixture IDs are explicit UUIDs. Any unexpected
sequence advance fails even when a transaction rolled back.

Stop Auth and REST and verify zero service sessions **before** final quiescent
comparison. For every original physical row in every captured table, require
identical multiplicity/content hashes: no original row updates/deletes. Compare
all schema objects, grants, role attributes, policies and migration ledgers
unchanged (generated clone passwords are the explicitly scoped non-captured
credential delta). Match every added row to the exact manifest, including all
Auth/session/audit/profile/member/application side effects. No table-wide
exclusions or generic fixture-table allowlist. Destroy the whole clone afterward.

## Acceptance

- Password login, identity lookup and refresh succeed; invalid password/signature
  fail. All tokens are generated for this local run.
- Organization A can read/write its fixture. B and anonymous callers cannot read
  it. Cross-tenant insert fails; update/delete affect zero rows, independently
  verified in SQL. A successful own-tenant write rules out broken routing.
- No unexpected schema, ledger or non-fixture data changes. Explicitly account
  for fixture/session/audit writes; never silently exclude tables from proof.
- Wrong image, extra peer, open port, foreign label, failed startup, timeout,
  unexpected schema change and cleanup uncertainty fail closed in behavioral tests.
- Receipt binds capture, DB proof, source revision, manifests and check results;
  contains no credentials, raw rows or HTTP response bodies.
- Outcome is `LOCAL_AUTH_REST_VERIFIED_ONLY`, with `releaseAdmission: BLOCKED`.
  Do not automatically qualify all recovery scopes or substitute this for G0.

## Remaining coverage

Hosted service/configuration parity; complete managed Auth schema recovery;
OAuth/SSO/MFA/email; Storage API/object bytes; Vault external decryption keys;
gateway/TLS; Realtime/Edge Functions; browser/extension flows; production recovery;
and immutable repository-to-database migration lineage remain unproven.

## Review checkpoint

Review v2.197.0 schema expectations and the separate three-container collector
and credential lifecycle before any future requalification or promotion. No
additional hosted maintenance window is requested.

## Official sources

- [CLI 2.84.2 image selections](https://github.com/supabase/cli/blob/v2.84.2/pkg/config/templates/Dockerfile)
- [Auth v2.188.1 migration inventory](https://github.com/supabase/auth/tree/v2.188.1/migrations)
- [Auth root command: migrate then serve](https://github.com/supabase/auth/blob/v2.188.1/cmd/root_cmd.go)
- [Auth image executable and runtime](https://github.com/supabase/auth/blob/v2.188.1/Dockerfile)
- [Supabase platform-to-self-hosted restore guidance](https://supabase.com/docs/guides/self-hosting/restore-from-platform)

- [Auth v2.197.0 release](https://github.com/supabase/auth/releases/tag/v2.197.0)
- [Auth v2.197.0 migrations](https://github.com/supabase/auth/tree/v2.197.0/migrations)
- [Initial-schema migration introduction](https://github.com/supabase/auth/commit/557c345f94a428f51eb036af608de48dbf99756e)
- [Historical bootstrap with the seven exact ledger inserts](https://github.com/supabase/auth/blob/154f968e295beef964833c51cb383085ceab33fe/hack/init_postgres.sql)

- [Auth v2.197.0 worker/mailer/database configuration](https://github.com/supabase/auth/blob/v2.197.0/internal/conf/configuration.go)
- [Auth v2.197.0 admin provisioning](https://github.com/supabase/auth/blob/v2.197.0/internal/api/admin.go)
- [Auth v2.197.0 token handlers](https://github.com/supabase/auth/blob/v2.197.0/internal/api/token.go)
- [PostgREST 14 in-database configuration and channel controls](https://docs.postgrest.org/en/v14/references/configuration.html)

- [Pinned token service: refresh auditing and AMR](https://github.com/supabase/auth/blob/v2.197.0/internal/tokens/service.go)
- [Refresh swap token_revoked audit](https://github.com/supabase/auth/blob/v2.197.0/internal/models/refresh_token.go)
- [AMR per-session claim insertion](https://github.com/supabase/auth/blob/v2.197.0/internal/models/amr.go)
