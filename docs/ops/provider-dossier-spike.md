# Spike: cross-org provider dossier

**Status:** Prototype on `/dev/global-search`. The shell palette is unchanged. Conflict rule accepted 2026-09-21: list every org's value.
**Branch:** `cursor/provider-dossier-spike-0495` (stacked on the global-search spike, PR 388).
**Hosted check:** project `fkvuhfsqcmujywzgczmc`, read-only `EXPLAIN ANALYZE`, 2026-09-21.

The shallow lookup (name, NPI, org) stays the typeahead. This document is the deep read: everything the caller is allowed to see about one Type-1 NPI, loaded when they inspect a row.

---

## Recommendation

Ship the expansion as **one embedded PostgREST read under the caller's existing RLS**, fired only when the inspector opens. Aggregate licenses in the browser. Do not add `get_provider_dossier`. The inspector stays off the shell palette until the remaining items in "From spike to production" are accepted.

That is what the prototype does. A SQL function is the upgrade if compliance wants the open audited in a place the browser cannot skip, or if a measured payload gets too large. Neither is true at today's size.

---

## What hosted actually holds

`public`, 2026-09-21. Counts are `pg_stat_user_tables.n_live_tup` for `public` only (backup schemas excluded).

| Table                           | Rows |
| ------------------------------- | ---: |
| `providers`                     |   23 |
| `state_licenses`                |   27 |
| `provider_group_assignments`    |   33 |
| `provider_groups`               |    7 |
| `provider_facility_assignments` |   29 |
| `facilities`                    |   40 |

18 distinct NPIs. **2 NPIs appear in more than one org** (6 provider rows, max 3 orgs). Across those two NPIs: 8 license rows collapse to 7 keys, **1 key is stored in more than one org and that key disagrees**, 8 group assignments, 5 distinct TINs.

There is no index on `providers.npi`. Equality is a sequential scan of 23 rows. Child tables are reached by `provider_id`, which is the leading column of `uq_state_licenses_provider_state_number` and `provider_group_assignments_provider_id_group_id_key`. The planner still sequential-scans the child tables, because they are a page each.

SELECT policies, confirmed on hosted the same day, are the same predicate on every table this read touches:

`org_id IN (SELECT user_org_ids())`

`organizations` is `id IN (SELECT user_org_ids())`. Role does not appear in any of these USING expressions. `billing` can read what an admin can read.

---

## Benchmark

Each statement below was `EXPLAIN (ANALYZE, BUFFERS)` against the NPI that spans the most orgs. The statement also spends about 0.12–0.15 ms choosing that NPI. An inspect already has the NPI, so the scan times are the part that matters. All of them are noise next to an HTTP round trip.

| Shape                                                                                  |                       SQL time | Plan                                                                                |
| -------------------------------------------------------------------------------------- | -----------------------------: | ----------------------------------------------------------------------------------- |
| Approach 1 — providers by NPI                                                          | 0.96 ms (scan itself ~0.16 ms) | Seq scan, 23 rows, 3 kept                                                           |
| Approach 1 — licenses for those provider ids                                           |                        0.35 ms | Seq scan of all 27 licenses, hash join, 5 rows                                      |
| Approach 1 — group assignments plus groups                                             |                        0.42 ms | Seq scan of 33 assignments, then 6 primary-key lookups, 6 rows                      |
| Approach 2 — one statement, correlated child aggregates (licenses, groups, facilities) |                        4.23 ms | Seq scan of providers, then per matching row a seq scan of each child table, 3 rows |

Approach 1 in the browser is two round trips if the children run in parallel after the provider ids come back, or three if they are serial. Approach 2 is one request. The embedded statement costs more SQL (the correlated scans repeat per provider row) and less network. At 3 rows and 4 ms, the network wins.

Approach 3, a `SECURITY INVOKER` function that returns one jsonb document, would also be one round trip, and Postgres would do the dedup. The dedup here is 8 license rows and 1 conflict. That is a unit test, not a migration. The function would also be unusable on the service-role client: `CLAUDE.md` already forbids invoker RPCs on `ctx.db`, because `auth.uid()` is null and RLS is off.

No NPI index in this change. The search spike already records the btree to add when the table leaves "fits on a page." That same index serves this equality. Adding it now is write cost on every provider save for a scan of 23 rows.

---

## Dedup rules the prototype uses

The anchor is a 10-digit NPI. Anything else does not open a footprint, and the service does not issue a query.

| Grain                             | Rule                                                                                                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Affiliation (the `providers` row) | Never merged. One row per org, so "where do I manage this" stays a list.                                                                                                                                                                                                                        |
| License                           | Collapse on state + number + type when a number is present. A blank number does not collapse: two empty numbers are not one license.                                                                                                                                                            |
| Conflict                          | Accepted 2026-09-21. Expiration, status, or verified status can disagree across copies. The inspector lists every org's value. A summary line may show the latest expiration; the per-org lines are the record. No copy is dropped. Status is shown on the summary only when every copy agrees. |
| Group                             | One row per assignment. A TIN that matches another group in the footprint is badged "Shared TIN" and still listed twice.                                                                                                                                                                        |
| Facility                          | One row per assignment. Name, city, state. No street, phone, or email.                                                                                                                                                                                                                          |
| Name                              | The header is the row that was inspected. Any other name on the same NPI is shown as "also recorded as."                                                                                                                                                                                        |

A row whose `org_id` is not in the caller's membership list is dropped, children included. That is the same defense-in-depth narrowing as the palette. RLS is the wall; the map is the caller's own membership list and cannot widen the read.

---

## Security boundary

The prototype has **no `/api` route** and does not call the service-role client. The select list is `PROVIDER_DOSSIER_COLUMNS`. It embeds `state_licenses`, `provider_group_assignments` → `provider_groups`, and `provider_facility_assignments` → `facilities`. It is not `*`.

Left out, and pinned by `FORBIDDEN_DOSSIER_COLUMNS` in the service test: `date_of_birth`, `ssn_last4`, `dea_number`, `dea_expiration_date`, home address, `phone`, `email`, `fax`, facility `street`, group billing email and phone. DEA and SSN are omitted rather than role-gated. There is no new surface that reveals them to a writer and hides them from billing, because the existing SELECT policies do not distinguish those roles. A later product decision to show DEA on this inspector has to add a role check in the client and still must not put the full SSN anywhere outside the vault.

Group TIN is included. It is the value the copy action exists to put on the clipboard, and it is already readable on the group record under the same SELECT policy.

No `audit_log` row per inspect. The palette decision was the same: this is not the fill payload, and a row per open would bury the log. The provider page the coordinator already opens is not audited as a special read either. If compliance later wants a trail, log one `READ` when the inspector opens, inside Approach 3, so the browser cannot skip it. Default for this spike is no audit.

---

## Prototype

| Piece                                 | Where                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Aggregation, conflict rule, copy text | `src/lib/providerDossier.ts`, tests in `src/lib/providerDossier.test.ts`                               |
| The one read                          | `src/services/providerDossier.ts`, query-shape tests in `src/services/providerDossier.di.test.ts`      |
| Hook                                  | `src/hooks/useProviderDossier.ts`, key `queryKeys.providerDossier` (user id + NPI, not the active org) |
| Inspector                             | `src/components/search/ProviderDossierPanel.tsx`, inside the palette dialog                            |
| Mount                                 | `/dev/global-search` passes `enableDossier`. The shell dialog does not.                                |

Behavior worth reviewing on the harness:

- Type a name. The request is still the shallow palette (no licenses, no groups).
- The footprint icon, or Shift+Space on the highlighted row, opens the pane. Space still types, because "first last" is a search. The brief said Space; that key is already taken by the palette.
- The pane lists organizations, groups (name, group NPI, TIN, primary, shared-TIN), facilities (name, city, state), and licenses. A conflicting license is badged and each org's date is listed.
- Copy all licenses and Copy group TINs stay on the page and do not switch org.
- "Manage in {org}" is the action that switches org and opens `/providers/$id`.
- A provider row the mock returns from a non-member org does not appear, and neither do its license, group, or facility.

`e2e/provider-dossier.spec.ts` covers that path and asserts the shell palette has no inspect control and issues no NPI-equality dossier request.

The inspector is logged in `DESIGN-DEBT.md`. It is a pane inside the existing stock `Dialog`, not a new drawer primitive.

---

## From spike to production

1. **Conflict rule — accepted 2026-09-21.** List every org's value. The summary may show the latest expiration; the per-org lines are the record, and no copy is dropped.
2. **Still open:** no audit row per inspect; group TIN is copied and DEA, SSN, and home address stay out of the select; the inspector stays off the shell palette. Turning it on is passing `enableDossier` from `AppShell`. No second query shape.
3. **Do not add a `/providers/npi/$npi` route in the same change.** The inspector answers the question without a new navigation model. A route is worth it only if the footprint needs a URL to hand to someone.
4. **No migration.** Revisit Approach 3 when an inspect must be audited server-side, or when the embedded payload is measured slow. Revisit an NPI index on the same day the search spike's trigram indexes become worth adding.
5. **Isolation gate.** No change while there is no `/api` route. A route that runs this select on the service-role client without `.in("org_id", memberOrgIds)`, and without new assertions in `scripts/verify-org-isolation.mjs`, is stop-ship.
