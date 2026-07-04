# Migration baseline & the repo-first rule

_Last updated 2026-07-04._

## What happened

The repo's `supabase/migrations/` was a **partial mirror** of the hosted database:
15 repo files versus 23 migrations actually applied to the live project
`fkvuhfsqcmujywzgczmc`. Several hosted migrations (launches, the launch→location
pivot, portal-fill infra, member-invites infra, `create_case_with_tasks`, the
security-hardening grants/policies pass, and more) were applied directly and had
no repo file. A fresh rebuild from the repo could not reproduce the live schema.

This baseline fixes that. The live database — the source of truth — was dumped in
full and squashed into a single migration:

    supabase/migrations/20260704210000_baseline_live_schema.sql

It contains, for `schema public`: every table, column, default, and NOT NULL;
all primary/unique/foreign-key/check constraints; all indexes; the one trigger;
RLS enabled on all 27 tables plus all 79 policies; all 8 functions; the two
column comments; and the table/function grants for `anon` / `authenticated` /
`service_role`. It ends with a guarded `CREATE EVENT TRIGGER ensure_rls` so a
repo-only rebuild that lacks elevated privileges skips it gracefully rather than
failing (the additive-guard convention from CLAUDE.md).

The 15 previous repo migrations were moved verbatim to
`supabase/migrations_archive/`. They are kept for history (the additive rule —
nothing is deleted) but are **outside** the `migrations/` directory so the
Supabase CLI no longer runs them. Nothing in the app or build reads that folder.

## Verification (fresh DB built from the baseline matches live)

A throwaway Postgres 16 cluster was created locally, seeded only with the
Supabase-provided prerequisites (roles `anon`/`authenticated`/`service_role`, the
`auth` schema + `auth.users` + `auth.uid()`, and the `pgcrypto`/`uuid-ossp`
extensions), then the baseline was applied. A structural fingerprint —
newline-joined, sorted, then hashed — was computed over 996 elements (columns,
constraints, indexes, policies, functions by body hash, triggers, RLS flags,
grants, comments) on both the fresh local DB and the live project using the
identical query.

    fresh local build : md5 = e7a20dd90a7939c3f8479dd6a74ba381  (996 elements)
    live project      : md5 = e7a20dd90a7939c3f8479dd6a74ba381  (996 elements)

The hashes match: **a database built from the baseline alone is structurally
identical to the live schema.** (Extension-owned functions were excluded from the
comparison; the local harness installs `pgcrypto`/`uuid-ossp` into `public`
whereas Supabase keeps them in a dedicated `extensions` schema — a hosting
artifact, not a schema difference.)

## The 23 hosted migrations this baseline squashes

Recorded so the lineage isn't lost (hosted `supabase_migrations.schema_migrations`
version → name):

| #   | version        | name                                                      |
| --- | -------------- | --------------------------------------------------------- |
| 1   | 20260623040255 | add_provider_license_columns                              |
| 2   | 20260623043555 | create_group_insurance_policies                           |
| 3   | 20260623044459 | create_get_sop_field_tokens_rpc                           |
| 4   | 20260623045446 | add_billing_and_correspondence_address_to_provider_groups |
| 5   | 20260629221752 | add_provider_demographic_fields                           |
| 6   | 20260629221759 | add_facility_operational_fields                           |
| 7   | 20260629221807 | add_provider_group_contacts_addresses                     |
| 8   | 20260629221812 | add_assignment_detail_fields                              |
| 9   | 20260629221816 | add_contract_payer_group_id                               |
| 10  | 20260630161911 | expand_sop_field_tokens_rpc                               |
| 11  | 20260702234455 | create_user_table_prefs                                   |
| 12  | 20260702235958 | security_hardening_grants_delete_policies_indexes         |
| 13  | 20260703000140 | dedupe_state_licenses_unique_index                        |
| 14  | 20260703013326 | create_case_with_tasks_rpc                                |
| 15  | 20260703032642 | member_invites_infrastructure                             |
| 16  | 20260703060040 | portal_fill_infrastructure                                |
| 17  | 20260703122125 | harden_get_sop_field_tokens                               |
| 18  | 20260703220928 | add_action_bucket_to_status_configs                       |
| 19  | 20260703220952 | action_bucket_not_null                                    |
| 20  | 20260703231222 | create_launches                                           |
| 21  | 20260704041358 | launch_location_pivot                                     |
| 22  | 20260704054522 | action_bucket_default                                     |
| 23  | 20260704184954 | revoke_rls_auto_enable_from_anon                          |

(The repo's 15 archived files carried Lovable-style `timestamp_uuid` names and did
not correspond 1:1 to these — another reason the mirror drifted.)

The baseline is **not** meant to be re-applied to the already-migrated hosted
project (its objects already exist there). It represents the current hosted state
for fresh rebuilds — new local stacks, new Supabase projects, CI. If the hosted
migration history is ever squashed to match, do it with `supabase migration repair`
against the remote (record the baseline version as applied, mark the 23 old
versions reverted); do not run the baseline SQL against the live DB.

## The repo-first rule (going forward)

The mirror drifted because schema changes were applied straight to hosted with no
repo file. From now on, **every schema change lands in the repo and hosted in the
same change**, and the repo is authoritative for _new_ migrations:

1. Write the change as a new file in `supabase/migrations/`
   (`YYYYMMDDHHMMSS_<slug>.sql`). Never edit the baseline or an archived file.
2. Apply the **identical** SQL to hosted — via the Supabase MCP `apply_migration`
   (which also records it in the hosted migration history) or `supabase db push`.
   Same SQL both places; do not hand-edit hosted so it diverges from the file.
3. Guard statements that depend on hosted-only objects or elevated privileges so a
   clean repo-only rebuild still passes — `to_regclass('public.x')`,
   `ADD COLUMN IF NOT EXISTS`, `CREATE ... IF NOT EXISTS`, exception-guarded event
   triggers (see the baseline's `ensure_rls` block).
4. After any DDL, regenerate `src/integrations/supabase/types.ts` via the MCP
   `generate_typescript_types`, overwrite the file, and run prettier on it. It is
   generated, never hand-edited.
5. Keep `SCHEMA.md` in step, and re-verify with the fingerprint recipe above when a
   change is large enough to warrant it.

The additive rule still holds: don't drop or rewrite existing objects; layer new
migrations on top. If the live DB and the repo ever disagree again, the live DB is
truth — regenerate a baseline from it rather than trusting stale files.
