# Spike: global provider search and NPI lookup

**Status:** Approach A is the shell lookup (Find a provider, Ctrl+K / ⌘K). The analysis below is unchanged.
**Branch:** `cursor/global-provider-search-spike-31a4`
**Hosted check:** project `fkvuhfsqcmujywzgczmc`, read-only, 2026-09-21.

The review document is this file. The lookup it describes is the shell palette: **Find a provider**, or Ctrl+K / ⌘K, from any signed-in page. `/dev/global-search` still opens the same dialog directly.

---

## Recommendation

Ship the lookup as **one PostgREST read under the caller's existing RLS**, with no org filter in the query. Membership is already the authorization boundary. Do not add Elasticsearch, OpenSearch, or a second search index.

That is what the prototype does. A SQL function (Approach B) is the upgrade if ranking has to move into the database or the extension needs the same lookup. It is not required to go to production on the panel.

---

## The premise this corrects

The spike asked about querying "across tenant partitions" and about "cross-schema SQL joins" versus a centralized index. Neither shape exists here.

There is one `public.providers` table. Tenancy is an `org_id` column plus row-level security, not a schema per customer. Every org's providers are already in the same table the panel queries today.

The 4-to-10 step workflow is an **application convention**, not a database wall. Services call `requireActiveOrg()` and then `.eq("org_id", orgId)`. The database does not require the active org. It requires membership.

`src/services/portfolio.ts` already relies on that distinction: it is cross-org on purpose, skips `requireActiveOrg()`, and lets `organizations` SELECT (`id IN user_org_ids()`) do the filtering. Provider lookup is the same kind of read.

---

## Permissions audit

Verified on hosted, not only in the repo migration.

| Control              | What it actually allows                                                                              | Evidence                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_org_ids()`     | The org ids in `memberships` for `auth.uid()`. Nothing else.                                         | `SECURITY DEFINER`, `supabase/migrations/20260704210000_baseline_live_schema.sql`                                                                                |
| `providers_select`   | `SELECT` where `org_id IN (SELECT user_org_ids())`. Role is irrelevant for read; `billing` can read. | Hosted `pg_policy` on 2026-09-21: `providers_select`, using-expression `org_id IN (SELECT user_org_ids())`. Repo: baseline migration, policy `providers_select`. |
| `orgs_select_member` | Org name embed resolves only for member orgs.                                                        | Baseline policy `orgs_select_member`: `id IN (SELECT user_org_ids())`.                                                                                           |
| Active org           | A UI choice in the Zustand auth store. Not an authorization input.                                   | `src/lib/auth-store.ts` `activeOrgId`                                                                                                                            |
| Service-role `/api`  | Bypasses RLS. A query with no org filter on `ctx.db` would return every tenant.                      | `src/server/guard.ts`                                                                                                                                            |

What "authorized" means for this lookup: **a row in `memberships` for that user and that org.** There is no second grant, no platform role, and no "support can see everything" flag. A customer-success lead sees a provider if and only if they are a member of that provider's org. Creating that membership is the existing invite path (`claim_invites`); this spike does not add one.

The prototype applies a second, client-side narrowing (`restrictToAuthorizedOrgs`) against the membership list already loaded into the auth store. That narrowing is not the wall. A modified browser that skipped it would still be unable to read a non-member org, because PostgREST runs as `authenticated` and RLS still applies. The narrowing exists so a policy regression shows up as a missing row, and so the org label comes from the caller's own membership list.

**The guarantee breaks in exactly one direction:** moving this query onto the service-role client. RLS is off there. The prototype therefore has **no `/api` route**. If a later change adds one, the route must resolve the caller's memberships from the JWT user id and filter with `.in("org_id", memberOrgIds)` before the read. Accepting an org-id list from the request body would let the caller name an org they do not belong to. `scripts/verify-org-isolation.mjs` would have to grow assertions for that route in the same change; there is nothing to add while the route does not exist.

---

## Approaches

### A — RLS read, no org filter (recommended, prototyped)

`searchProvidersAcrossOrgs` selects a fixed column list from `providers`, applies an `or` filter built from the sanitized term, and does not send `org_id`. Postgres applies `providers_select`. The service then narrows to the known membership set, ranks, and returns at most 8 rows.

| For                                                                                     | Against                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No migration, no new store, no new trust boundary                                       | `ILIKE '%term%'` is a sequential scan. Harmless at today's size; see Indexing.                                                                                        |
| The wall is a policy that already exists and was re-checked on hosted                   | Ranking happens in the browser over a fetch cap of 60. A term matching more than 60 rows can hide a better match that sorted later by `last_name`. Latent at 23 rows. |
| PHI never leaves Postgres and never enters a second index                               | No typo tolerance (`smyth` does not find `Smith`).                                                                                                                    |
| Same pattern reviewers already accepted for Portfolio                                   | Must never be copied onto `ctx.db` unchanged.                                                                                                                         |
| The extension needs no contract change, because the panel UI does not go through `/api` |                                                                                                                                                                       |

### B — SQL function, caller's JWT, membership filter written in the function

`search_my_providers(p_term text)` as `SECURITY INVOKER`. The function filters `org_id IN (SELECT user_org_ids())` itself, ranks with `pg_trgm` similarity, `LIMIT`s inside SQL, and returns the same narrow projection.

| For                                                                                   | Against                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The cap and the rank happen where the index lives, so the 60-row truncation goes away | A migration, a types regen, and a function that must stay in lockstep with the projection                                                                                                                |
| The authorization predicate is visible in one place instead of "we omitted a filter"  | `SECURITY INVOKER` on the service-role client is broken: `auth.uid()` is null and RLS is off. The function is callable only with the caller's JWT. `CLAUDE.md` already forbids invoker RPCs on `ctx.db`. |
| The extension could call it later without a service-role query                        | Still no typo tolerance beyond what trigram similarity gives, and trigram is not installed (see Indexing).                                                                                               |

Choose B when the fetch cap becomes a real miss, or when the extension needs the lookup. Not before.

### C — External index (Elasticsearch, OpenSearch, or a hosted search product)

Rejected.

| For                                                              | Against                                                                                                                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typo tolerance, highlighting, stable latency at millions of rows | A second copy of provider names and NPIs, with its own sync lag. A provider saved in the wizard is invisible until the index catches up.                          |
|                                                                  | A vendor boundary. The projection is not PHI today; the moment a column like email or address is "useful" in the index, it is a PHI store outside Postgres.       |
|                                                                  | Operational surface (index jobs, rebuilds, failure mode where search and the record disagree) for a table that held **23 providers across 3 orgs** on 2026-09-21. |

Revisit C only if Approach A plus a trigram index misses a measured latency target. There is no target miss to respond to yet.

---

## Security review

Users can search providers only inside organizations they have a `memberships` row for. That is the hosted `providers_select` policy, confirmed 2026-09-21, and it does not depend on which org is active in the UI.

The prototype's tests pin the query shape that keeps it that way:

- The read hits `providers` and sends **no** `org_id` predicate (`src/services/globalProviderSearch.di.test.ts`). Naming an org would re-impose the silo; omitting it does not widen past RLS.
- The select list is `id, org_id, first_name, last_name, credentials, npi, status, organizations(name)`. It is not `*`. `date_of_birth`, `ssn_last4`, home address, phone, email, and `dea_number` are in `FORBIDDEN_SEARCH_COLUMNS` and the test fails if any of them appears. NPI is a public NPPES identifier; the payload is name, credentials, NPI, status, and org.
- A row whose `org_id` is not in the caller's membership map is dropped, including the case where the caller has no memberships at all. A caller with no memberships issues no query.
- The term is sanitized before it becomes a PostgREST `or` filter. Commas, parentheses, quotes, backslashes, and `ILIKE` wildcards are stripped, so a typed value cannot rewrite the filter or turn into a broader match. Covered by `src/lib/globalSearch.test.ts` and the service test that feeds `smith),or(ssn_last4.not.is.null`.

Audit posture, as a decision rather than an accident: do **not** write an `audit_log` row per keystroke. The profile endpoint audits because that response is the PHI-dense fill payload. This one is not, and a row per debounced request would bury the log. Opening the record is ordinary navigation inside an org the user already belongs to. If compliance later wants a trail of lookups, log one `READ` per distinct term when the result set comes back, and do it inside Approach B — the browser cannot be trusted to write it. Default for v1 is no lookup audit.

---

## Indexing and search tooling

Checked on hosted 2026-09-21.

| Fact                   | Value                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Indexes on `providers` | `providers_pkey` on `id`. `idx_providers_pending_verification` on `org_id` where `verification_state = 'pending_verification'`. No name index. No NPI index. |
| `pg_trgm`              | Not installed. Extensions present that we asked about: `pgcrypto` only.                                                                                      |
| Scale                  | 23 provider rows, 3 distinct orgs.                                                                                                                           |

`ILIKE '%smith%'` cannot use a btree. At 23 rows the plan is a sequential scan, and that is the right plan. Adding an index or a search cluster now would be machinery in front of a table that fits on a page.

**No third-party search tooling.** Postgres is the index.

When the table is large enough that a lookup is actually slow (order of magnitude: tens of thousands of providers, or a measured p95 the coordinator can feel), add one additive migration and stop there:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_providers_last_name_trgm
  ON public.providers USING gin (last_name gin_trgm_ops);
CREATE INDEX idx_providers_first_name_trgm
  ON public.providers USING gin (first_name gin_trgm_ops);
CREATE INDEX idx_providers_npi
  ON public.providers (npi) WHERE npi IS NOT NULL;
```

Trigram GIN supports the substring match the palette uses. The partial btree supports the NPI prefix match (`1234567890` and the first digits of one). Neither index changes the authorization story. Do not ship them in the first production change; the table does not need them, and an unused GIN index is write cost on every provider save.

A btree on `(org_id, last_name)` would help the existing per-org roster sort. It does nothing for a leading-wildcard `ILIKE`. It is a separate change.

---

## Prototype

| Piece                                                              | Where                                                                                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Term sanitizing, filter, projection, membership narrowing, ranking | `src/lib/globalSearch.ts`, tests in `src/lib/globalSearch.test.ts`                                                      |
| The one read                                                       | `src/services/globalProviderSearch.ts`, query-shape tests in `src/services/globalProviderSearch.di.test.ts`             |
| Typeahead hook                                                     | `src/hooks/useGlobalProviderSearch.ts` (debounced, user-scoped cache key, previous rows kept while the next term loads) |
| Palette                                                            | `src/components/search/GlobalProviderSearchDialog.tsx`                                                                  |
| Mount                                                              | App shell (Find a provider, Ctrl+K / ⌘K). `/dev/global-search` opens the same dialog.                                   |

Behavior worth reviewing in the UI:

- Two or more characters searches every org in the signed-in user's membership list. One character searches nothing.
- Each row shows name, credentials, organization, and NPI. **Copy** puts the NPI on the clipboard and does not change org.
- Enter, or clicking the name, opens `/providers/$id`. If that provider's org is not the active one, the palette switches org first. The lookup itself never switches org.
- Arrow keys move the highlight. A terminated provider stays in the list and sorts last.
- The same person in two member orgs is two rows. "Which org" is half the answer.

`src/components/layout/SearchDialog.tsx` is the earlier in-org search. It filters providers and cases already loaded for the **active** org, it has no NPI, and nothing mounts it. The shell palette does not replace that file; v1 is the provider lookup alone. The palette is logged in `DESIGN-DEBT.md` (stock `Dialog`, no `cmdk`). The rail control is a button, so the six primary nav links are unchanged.

---

## From spike to production

The prototype is the production read. What is left is product wiring, not a new design.

1. **PM ack** of Approach A, of "membership is the only grant," and of "no per-keystroke audit."
2. **Mount the palette in the shell.** Done: Find a provider on the rail, a search button on the mobile header, and Ctrl+K / ⌘K. The six-item nav is unchanged.
3. **Decide the in-org case search.** `SearchDialog` also finds cases in the active org. The global lookup does not, on purpose: a case is org work, an NPI answer is a lookup. Shipping both means the palette grows a second section; shipping only the lookup means case search stays where it is (the cases list). Recommend the lookup alone for v1.
4. **Watch the 60-row cap.** No code change at 23 rows. The day a common surname can match more than 60 providers, move ranking into Approach B instead of raising the cap.
5. **Browser test.** `e2e/global-provider-search.spec.ts`: a user in two orgs types a name that exists only in the other org, sees that org's name and NPI, copies it without switching org, and on open lands in the provider's org. A provider row the mock returns from a non-member org stays off the list.
6. **Isolation gate.** No change for v1, because there is no new `/api` route. Adding a route without the assertions in `scripts/verify-org-isolation.mjs` is stop-ship: non-member org absent from results, both member orgs present, response body free of the forbidden columns.

No schema change, no new dependency, no extension contract, no `types.ts` regen for v1.
