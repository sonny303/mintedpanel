# Luna-scale synthetic org: staging runbook (MINT-82 / RC-07)

One synthetic organization, **Luna Demo (synthetic)**, at Luna scale: about 3,500
providers in 50 groups, 200 locations and 25 states, with 7 payers and about 6,100
credentialing cases. It exists so staging can exercise everything that breaks
past PostgREST's 1,000-row cap (MINT-14). It is fully synthetic and fully
reversible.

**Never run it against production.** The runner and the SQL both refuse the
production project and the production cluster, whatever the environment says.

## What it creates

`npm run seed:luna-scale -- --dry-run` prints the plan without connecting.
Default parameters, anchored on the apply day:

| Table                           |   Rows | Notes                                                  |
| ------------------------------- | -----: | ------------------------------------------------------ |
| `organizations`                 |      1 | upserted; never deleted (see Teardown)                 |
| `status_configs`                |     22 | the canonical set `create_organization` seeds          |
| `payers`                        |      7 | **org-scoped** (`org_id` = the Luna org), not global   |
| `org_payer_assignments`         |      7 |                                                        |
| `provider_groups`               |     50 | state LLCs, `00xxxxxxx` TINs                           |
| `facilities`                    |    200 | every one of the 25 states has at least one            |
| `payer_network_targets`         |    536 | group × state × payer covering that state              |
| `providers`                     |  3,500 |                                                        |
| `provider_group_assignments`    |  3,500 | one primary each                                       |
| `provider_facility_assignments` |  4,188 | one primary each; 20% have a second location           |
| `state_licenses`                |  3,877 |                                                        |
| `credential_cases`              |  6,106 | one per (provider, group, payer, state)                |
| `case_facilities`               |  6,316 | primary row for every case, plus later-added locations |
| `tasks`                         |  6,106 | one per case                                           |
| `touches`                       | 10,631 | touchpoints and notes                                  |
| `case_status_history`           | 22,122 | full chain per case, from the system seed row          |
| `enrollment_facts`              |  1,600 | approved, effective, not terminated                    |
| `memberships`                   |  0 – n | only from `--member-email`                             |
| `audit_log`                     |      1 | one receipt per apply (and one per teardown)           |
| **total**                       | 68,770 | one transaction, about 16 MiB of SQL                   |

The organization insert also fires `roster_engine_seed_org_templates`, which adds
three `roster_templates` rows. That table is append-only by trigger.

The mix:

- **Provider Onboarding funnel** (MINT-81's four stages):
  - Profile incomplete, 420: 70 each with no NPI, no CAQH ID, no date of birth,
    no SSN last 4, no license, and no license for the state they work in.
  - Submitted, 348: 87 each with an unverified license, an expired
    license (status still `active`), CAQH attested more than 120 days ago, and a
    record pending verification.
  - Ready for credentialing, 280.
  - Credentialing, 2,417.
  - 35 terminated providers, which the funnel does not count.
- **Case status**:
  - approved 2,127 (1,675 effective, 452 awaiting an effective date);
  - submitted 977, not started 893, in review 831, in progress 589;
  - denied 405, action required 284.
- **Billing Readiness change feed** (approval transitions, terminations,
  license expirations):
  - last 7 days: 110, 3, 13;
  - last 30 days: 407, 14, 51;
  - last 90 days: 939, 47, 124.

  There are no "location linked" events: the feed needs
  `case_facilities.created_by`, which references `auth.users`, so the seed
  leaves it null rather than invent an actor.

- **Follow-ups** on open cases (`touches.next_follow_up_date` on the latest
  touch): 897 overdue, 265 due today, 1,519 upcoming.

Every count is a flag: `--providers`, `--groups`, `--locations`, `--states`,
`--payers`, and `--seed` (the PRNG seed). The ticket text says "one national
group". The planning session asked for about 50 groups, so 50 is the default;
`--groups 1` gives the single national group.

## What makes it safe

- **Synthetic by construction.**
  - Names come from a seeded PRNG over invented surnames.
  - NPIs pass the CMS Luhn check, using the `80840` prefix, the same rule as
    `isValidNpi` (MINT-7). Synthetic prefixes: `2999…` for individuals and
    `2998…` for groups. Real NPIs start with 1 or 2, and NPPES has issued the
    1-series. These were not checked against NPPES, because lookups are not
    allowed, so a collision is unlikely but not proven.
  - Addresses are on Example Way, Synthetic Ave, Placeholder Rd, Fixture Ln and
    Sample St, with `000nn` ZIPs.
  - Phones are `(555) 555-01nn`, and emails are `@example.test`.
  - Date of birth is always `1970-01-01` and SSN last-4 is always `0000`. The
    schema does not require them, but the funnel's "Profile incomplete" stage
    checks for their presence, so without them no provider could reach a later
    stage.
- **Tagged.**
  - Every row's id is self-certifying: its last 12 hex digits are a salted hash
    of its first 20 (`isLunaOwnedId`, and `pg_temp.luna_owned` in SQL). The
    teardown and the verifier recognise seed rows from the id alone.
  - Every row also carries `org_id` = the Luna org, including the payers.
  - The receipts carry the `minted_luna_scale_fixture` marker, the same shape
    as the UAT fixture's `minted_uat_fixture`.
- **Nothing outside its org.**
  - The payers are org-scoped, so no other org's catalog grows.
  - No row in another organization is read or written. The isolation-gate
    expected counts (Kansas / South Park providers) are untouched.
  - `--member-email` refuses the UAT personas (`@minted.invalid`) and the
    isolation-gate logins, which are hard-coded (`testkansas@minted.com`,
    `testsouthpark@minted.com`), plus `KANSAS_EMAIL`, `SPVIEW_EMAIL` and anything
    in `LUNA_SCALE_PROTECTED_EMAILS` when set. The gate's single-org assertions
    fail the moment one of those logins joins a second org.
  - The SQL refuses a member of a UAT org, always. It also refuses a member who
    already belongs to any other org, unless you pass `--allow-multi-org-member`
    (your own staging login usually does belong to other orgs).
- **Target guards**, all before any connection:
  - `SUPABASE_URL` and `LUNA_DATABASE_URL` must name the same project.
  - That project must be in `LUNA_SCALE_ALLOWED_PROJECT_REFS`.
  - The production ref is refused even if it is listed.
  - `LUNA_DATABASE_URL` is parsed strictly: exactly one `@` (percent-encode an
    `@` in the password as `%40`), no `,` anywhere in the host part (no libpq host
    lists), a plain hostname or IPv4 host, path `/postgres`, and at most
    `sslmode=require|verify-full`. Routing overrides (`host=`, `hostaddr=`) are
    refused.
  - psql never receives the URL. The validated host, port, user, password and
    database are passed one by one as `PG*` variables, after every inherited
    `PG*` variable is stripped, so libpq cannot read the URL differently.
  - `--confirm` must be the exact token for the action and the project.
- **Database identity.** Before writing, the runner reads `pg_control_system()`:
  - pinned staging must be cluster `7662742571317219726`;
  - any other allowlisted project must match `LUNA_SCALE_EXPECTED_DATABASE_IDENTITY`;
  - production (`7642734024280108049`) is refused.

  The SQL repeats the check inside the transaction, against the identity and
  token the runner passes, so pasting the SQL into an editor fails before it
  writes anything.

- **All or nothing.** The SQL is one transaction, and it commits only when:
  - every table holds exactly the planned number of seed rows; and
  - no trigger added a row the seed does not own.

  It also refuses to run over a seed built from different parameters or another
  fixture version.

## Why a psql transaction, not batched PostgREST writes

It is the pattern `scripts/uat/seed-staging-uat.mjs` already uses: pure SQL fed
to `psql` with `ON_ERROR_STOP` and an identity guard. It is also better on every
axis that matters here:

- **Atomic.** About 69k rows over the REST API would be about 140 separate
  500-row requests. One failure midway would leave a half-built org that needs
  its own cleanup.
- **No caps.** The 1,000-row read cap and the request-body limits do not apply.
- **No service-role key.** The REST path needs a service-role key; this only
  needs the database URL the UAT seed already uses.

Inserts are batched 500 rows per statement, each well under 1 MB. Each one
inserts only the rows whose id is missing (`WHERE NOT EXISTS`, with
`ON CONFLICT (id) DO NOTHING` as a backstop), so a repair run takes no
`credential_cases_case_number_seq` values for cases that already exist.

One cost remains: sequences never roll back. An apply that fails after the case
insert, for example on the final count check, has still used one case number per
case it tried to add, about 6,100 on a first apply. Case numbers stay unique; the
range just has a gap.

## Prerequisites

- Node 22 and `psql` 15 or later on the operator machine.
- The staging database URL: the direct host
  `db.vmznysvietfaddakkegt.supabase.co:5432`, user `postgres`, or the session
  pooler `aws-0-ca-central-1.pooler.supabase.com:5432`, user
  `postgres.vmznysvietfaddakkegt`. Keep it out of shell history.
- For `--member-email`: the login must already exist on staging, with a
  `profiles` row. Create it through the app first.

```sh
export SUPABASE_URL=https://vmznysvietfaddakkegt.supabase.co
export LUNA_DATABASE_URL='postgresql://postgres.vmznysvietfaddakkegt:<password>@aws-0-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require'
export LUNA_SCALE_ALLOWED_PROJECT_REFS=vmznysvietfaddakkegt
```

## Apply

```sh
# 1. Plan: no connection, nothing written. Check the target line says "staging vmznysvietfaddakkegt".
npm run seed:luna-scale -- --dry-run --member-email you@yourdomain.com

# 2. Apply, and give your own staging login access (admin by default; --member-role specialist|billing).
#    Add --allow-multi-org-member if that login already belongs to another org.
npm run seed:luna-scale -- --apply \
  --confirm "SEED LUNA SCALE ON vmznysvietfaddakkegt" \
  --member-email you@yourdomain.com

# 3. Verify, strictly: read-only; every table against the regenerated plan, and no
#    row in the org the seed did not create.
npm run verify:luna-scale -- --strict
```

Sign in as that user and switch to **Luna Demo (synthetic)**.

- **Re-running** with the same parameters is a repair. It inserts only missing
  rows, never duplicates, and never changes rows that exist.
- **Adding another member later**: run step 2 again with only a new
  `--member-email`.
- **Dates are relative to the apply day.** A re-apply does not move them. To
  refresh the 7/30/90-day windows and the follow-up buckets, tear down and
  apply again.
- **Different counts or seed**: tear down first. The apply refuses to mix
  parameter sets.

## Teardown

```sh
npm run seed:luna-scale -- --dry-run --teardown        # what it would remove
npm run seed:luna-scale -- --teardown --confirm "TEAR DOWN LUNA SCALE ON vmznysvietfaddakkegt"
npm run verify:luna-scale -- --strict                  # only the inactive shell may remain
```

The teardown deletes only seed-owned rows (`pg_temp.luna_owned(id)`) in the Luna
org, children first:

1. `enrollment_facts`, `case_status_history`, `touches`, `tasks`,
   `case_facilities`, `credential_cases`;
2. `state_licenses`, the two assignment tables, `providers`;
3. `payer_network_targets`, `facilities`, `provider_groups`,
   `org_payer_assignments`, `payers`, `status_configs`;
4. `memberships`.

It then sets the organization `inactive` and writes a receipt.

Before it deletes anything it checks two things, and lists what it finds:

1. **Dependents: always refused.** It finds every foreign key, in any schema,
   that points into a table the teardown deletes from (`pg_constraint`, all
   actions: cascade, set null, set default, restrict, no action). If any row the
   seed did not create references a seed row, the teardown refuses. A reviewer's
   case history, upload, field verification or SSN-vault row would otherwise be
   cascaded away or nulled out. Remove or re-point those rows first.
   `--allow-unowned` does **not** override this. If the role cannot read a table
   whose foreign key cascades, sets null or sets a default (no privilege, or forced
   row security), it refuses too; a restricting foreign key blocks the delete by
   itself, which rolls the whole teardown back.
2. **Other rows in the org: refused unless `--allow-unowned`.** These are rows in
   any public table with an `org_id`, whatever its key, that the seed did not
   create and that reference no seed row (a reviewer's note, say). Review them,
   then re-run with `--allow-unowned` to keep them and remove only seed rows.

**What stays, by design:**

- The organization row: `inactive`, with no members, so nobody sees it.
- Its three `roster_templates` rows. The roster ledger is append-only by
  trigger, with `ON DELETE RESTRICT` to `organizations`, so no seed can ever
  delete an organization row once it exists. The UAT fixture's organizations
  stay for the same reason.
- `audit_log` rows, which are never deleted.

A later apply reactivates the same org.

## Local mode and the CI job

`--local-rehearsal` is a closed mode, for a loopback Supabase
(`supabase start`) only:

- Both `SUPABASE_URL` and `LUNA_DATABASE_URL` must be on `127.0.0.1` or
  `localhost`. Anything else is refused in this mode, even an allowlisted
  staging project.
- Production's ref is refused on either URL.
- Hosted staging's cluster identity is refused.
- The tokens are `SEED LUNA SCALE ON local` and `TEAR DOWN LUNA SCALE ON local`.

The CI job **Luna-scale seed (local Supabase)** (`luna-scale-seed` in
`.github/workflows/ci.yml`) proves the SQL on every run:

1. It starts and resets local Supabase the way the UAT seed job does, including
   the duplicate-timestamp workaround.
2. It seeds the UAT fixture as pre-existing data, and creates a member login and
   a login that belongs to a UAT org.
3. It fingerprints every public row outside the Luna org (`verify:luna-scale
--fingerprint outside`, one md5 per table).
4. It runs `--dry-run`, `--apply` (with a member), and `verify:luna-scale
--strict`. The verifier regenerates the plan from the receipt's parameters
   and fails on any per-table mismatch, and on any row in the org the seed did
   not create.
5. It runs a second `--apply` and checks it is a no-op repair: the
   `--fingerprint seed` md5s are identical, and a second receipt is written.
6. It checks that a member of a UAT org is refused and that the transaction
   rolls back (the seed fingerprint is unchanged).
7. It runs `--teardown`, then `verify --strict`. Only the inactive org row, its
   3 roster templates and the receipts may remain.
8. It checks that the outside fingerprint is unchanged after the applies and
   after the teardown, then re-seeds and tears down once more.

There is no DB-backed Playwright step. The paging spec mocks the network by
design. Pointing it at a real stack would need a real sign-in and session, the
nitro `/api` routes running with a service-role key (access context, the
Explorer), a `private.internal_staff` row for the staff Explorer, and
network-quiet tracking from page events instead of the stand-in. That is more
than a flag.

## Known limits

- **Enrollment Explorer cells stay empty.** The Explorer reads payer products,
  group product targets and enrollment scopes from `private.*` ledgers. Those
  are append-only, so a seed could never remove them, and this seed does not
  write them. On staging the Explorer shows the active cohort (about 2,400
  providers, in 50-provider pages) with the "No payer products are configured"
  note.
- **The Explorer's staff report checks `private.internal_staff`.** That manifest
  is written outside this seed, so a member added here may need that row before
  the staff Explorer serves them.

## Part 2: local paging checks and timings (MINT-14)

The opt-in Playwright spec `e2e/luna-scale-paging.spec.ts` serves the same
generated dataset through an in-memory PostgREST stand-in
(`e2e/fixtures/luna-scale-postgrest.ts`) with db-max-rows 1000, `offset`/`limit`
and `Range`, and `count=exact`. It logs every read and flags each read the cap
cut short with no follow-up page.

```sh
LUNA_SCALE=1 npx playwright test e2e/luna-scale-paging.spec.ts   # results: test-results/luna-scale/results.json
```

It is skipped unless `LUNA_SCALE=1`, so CI time does not change. On main the
roster, Cases list and Matrix checks fail on purpose: those are the MINT-14 gaps
listed below.

See "Results" below for the latest numbers.

### Results (2026-10-31, `main` at d4be2fb0)

> **Client-side, mocked network.** The reads come from the in-memory PostgREST
> stand-in, so these times include **no database time, no network latency and
> no server work**. They measure the browser alone: fetch, derive, render.
>
> - **Setup:** headless system Chrome driven by Playwright on an Apple M5 Max,
>   Vite dev server, `TZ=UTC`.
> - **Timer:** from navigation start to the later of the last response and the
>   last change to the screen's DOM metric, within ±50 ms.
> - **Repeats:** median of 3 runs, all three listed.
> - **Patched column:** "main + #544" is a local, uncommitted patch of PR #544's
>   `src/` changes onto `main`, applied to show which gaps it closes.

**Completeness**:

- **Provider roster**
  - `main`: 991 of 3,465 rows. 717 rows show no group and 751 show no license
    (70 expected).
  - Silently capped reads: `providers`, `provider_group_assignments`,
    `state_licenses`.
  - `main` + #544: 3,465 rows, 0 without a group, 70 without a license.
- **Cases list** (Flat)
  - `main`: the total (6,106) and the KPI are right, but 4,330 cases show
    "Unknown provider".
  - Silently capped reads: `providers` (the name lookup). The touchpoints
    (Last touch), tasks, queue providers and readiness facts (the default
    deadline sort) and touchpoints (follow-ups) are capped too.
  - `main` + #544: 0 unknown providers. Last touch, ranking and follow-ups are
    still capped.
- **Matrix**
  - `main`: 679 of 2,321 provider rows, 1,041 of 3,574 open cases.
  - Silently capped reads: `providers` (row membership). Tasks (the
    overdue-task flag) and touchpoints (the follow-up in the popover) are
    capped too.
  - `main` + #544: 2,321 rows, 3,574 open. Tasks and touches are still capped.
- **Enrollment Explorer**
  - `main`: 2,417 of 2,417 cohort providers over 48 pages, served by the mocked
    `/api` route.
  - Silently capped reads: the staff workspace's `providers` and
    `provider_group_assignments`.
  - `main` + #544: not rerun; #544 pages exactly those two reads.

**Timings** (median of 3, ms):

| Screen (navigation → complete render)                          | `main`                                    | `main` + #544                               |
| -------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| Cases list (Flat): all reads settled, "Showing 1–10 of 6,106"  | **665** (963, 665, 605)                   | **774** (1,112, 771, 774)                   |
| Matrix: every section rendered                                 | **1,276** (1,321, 1,182, 1,276), 679 rows | **2,652** (2,664, 2,652, 2,626), 2,321 rows |
| Enrollment Explorer, first 50-provider page                    | **570** (746, 570, 553)                   | n/a                                         |
| Enrollment Explorer, all 2,417 providers (48 scripted clicks)  | **7,171** (7,621, 7,171, 7,157)           | n/a                                         |
| Enrollment Explorer as seeded (no products), first / all pages | **547** / **7,287**                       | n/a                                         |

- The Matrix on `main` is fast only because it drops 71% of its rows. At full
  size it takes 2.7 s and mounts 12,388 cells, each a Radix popover trigger.
  TD-52 already registers this board as past its cliff (about 500 providers,
  8k cells); this run measured render only, not hover.
- The Explorer "all pages" time is mostly the 48 scripted "Load next 50
  providers" clicks.

**Which open PR closes each gap:**

- **#544** closes the provider list (`listProviders`, used by `useProviders`),
  `listProviderGroupAssignments` and `listOrgStateLicenses`. That covers the
  roster, the Cases list names, the Matrix rows and the Explorer's staff
  workspace. The first three were verified above; the Explorer was not rerun
  with #544, and its two capped reads are the ones #544 pages.
- **#546** fixes `/api/cases?q=` and the open-case dropdown. Those are extension
  routes on the nitro server, which a browser-side PostgREST stand-in cannot
  reach, so this harness does not exercise them.
- **No open PR** covers the rest:
  - `getLastTouchDates` and `getLatestTouchFollowUps` (touches);
  - `listQueueTaskRows` and `listQueueProviderRows` (the next-best-action
    queue);
  - `listProviderReadinessFacts`.

  Commit `ca6c4b5a` on branch `claude/confident-newton-y5df7k` pages the
  readiness reads and registers the queue reads as TD-55, but it has no PR.

The real numbers need staging. After an apply, time the same screens there.
