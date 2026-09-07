# S1 — Client identity and scope model

**Status:** spike complete; product confirmation required before build  
**Persona:** client owner / executive sponsor; provider self-view is out of scope  
**Recommendation:** use Supabase Auth for login, but keep client authorization
out of `memberships`; add explicit client-access and group-grant records and
serve a dedicated client DTO surface through the API core.

## Answer

1. **Identity:** the person remains an `auth.users` identity, but is represented
   for authorization by a new client-access record, not by an internal
   `memberships` row. A person may independently hold an internal membership
   and client access.
2. **Scope:** one active access context is `(user, org, set of provider groups)`.
   The set may contain one or many groups. No provider-level grants are needed
   for v1. `providers.group_id` is a frozen primary-group mirror, so provider
   scope must resolve through `provider_group_assignments`; case scope uses the
   case's four-part grain and `credential_cases.group_id`.
3. **Enforcement:** a new `authenticateClient()`/client context behind
   `src/server/api.ts` resolves active access and grants on every request. Client
   routes use the service-role client but constrain every read by both
   `org_id` and the server-resolved group set. Existing internal routes and
   `authenticate()` remain unchanged.

This is option B below. It changes **zero of the 155 current RLS policies and
zero current internal-frontend role decisions**. It does require new API
routes, additive access/grant tables, invite/provisioning work, and positive,
negative, and deliberate-leak assertions in the API isolation gate.

## Evidence status

| Marker             | Meaning                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repo-confirmed** | Read from this branch's code, generated schema, or migration replay on 2026-09-02.                                                                                              |
| **Brief-live**     | Supplied in the spike brief as queried from hosted Supabase on 2026-09-02. Supabase MCP required authentication in this run, so these counts could not be independently re-run. |
| **Recommendation** | Proposed design; not current behavior or an approved product decision.                                                                                                          |
| **Assumption**     | Must be confirmed before implementation.                                                                                                                                        |

No production data was written. No live cross-tenant leak was found. The
cross-group exposure described below is a design incompatibility with a future
below-org caller, not a leak under the current org-only identity model.

## Verified current state

| Fact                                                                                       | Evidence                                                                                                                                               | Status         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| Membership identity is unique per `(org_id, user_id)` and carries one role.                | `src/integrations/supabase/types.ts` (`memberships`); `supabase/migrations/20260704210000_baseline_live_schema.sql` (`memberships_org_id_user_id_key`) | Repo-confirmed |
| Membership and pending-invite role checks allow only `admin`, `specialist`, and `billing`. | baseline migration constraints `memberships_role_check` and `pending_invites_role_check`                                                               | Repo-confirmed |
| The TypeScript role union is duplicated in three places.                                   | `src/types/index.ts`, `src/lib/auth-store.ts`, `src/server/guard.ts`                                                                                   | Repo-confirmed |
| Current authorization scope is an org, never a group set.                                  | `src/server/guard.ts`; all `AuthContext` service calls carry `orgId` but no granted groups                                                             | Repo-confirmed |
| Current memberships: 6, all admin.                                                         | S1 brief's live query                                                                                                                                  | Brief-live     |
| Current org/group counts: 3 orgs and 7 groups.                                             | S1 brief's live query                                                                                                                                  | Brief-live     |
| Public RLS final state: 155 policies over the brief's 62 public tables.                    | `node scripts/benchmarks/audit-rls-policy-snapshot.mjs --expect=155`; table count is brief-live                                                        | Mixed          |

Seven groups across three orgs proves that org is coarser than group. It does
**not**, by itself, prove which groups belong to one client. An authoritative
client-to-group ownership source does not exist in the repository; that missing
business mapping is what prevents literal zero-touch client provisioning.

## How the current API guard works

`src/server/api.ts` owns the complete `/api` prefix.

1. `authenticateUser()` extracts a bearer token, verifies it with
   `getAuthClient(token).auth.getClaims(token)`, and returns the JWT subject,
   email, display metadata, and a service-role database client. It does not
   resolve an org.
2. User-scoped `/api/me/*` and shared-training routes stop there. Their services
   must filter by the verified `userId` or global-row semantics because the
   database client bypasses RLS.
3. Every org route reads `x-org-id`, falling back to `?orgId`, then calls
   `authenticate()`.
4. `authenticate()` reads `memberships` by verified `user_id`, optionally
   narrowed to the requested org. No membership returns 403. More than one
   membership without an explicit org returns 400; it never guesses the first
   org.
5. The selected row becomes `AuthContext { userId, orgId, role, ... }`.
   Services must explicitly add `org_id = ctx.orgId` because `ctx.db` is the
   service-role client.
6. `isWriter()` allows `admin|specialist`; billing is read-only. Global payer
   form writes use a stricter admin-only check.

The multi-org selector is correct for internal users but cannot represent a
group subset. Adding group IDs supplied by the browser would also be unsafe:
the server must resolve grants by verified user ID and intersect every optional
group filter with that set.

## Client read-path inventory

The minimum v1 read model is a scope bootstrap, a paged matrix/summary, filter
facets, and one-provider drill-down. Existing extension routes are not safe
client DTOs.

| Client need                                   | Current route                     | Finding                                                                                                                                                                                                                           |
| --------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discover permitted client contexts and groups | `GET /api/me/orgs`                | **Partial.** It returns internal memberships and roles only. It cannot return a client access or group grants.                                                                                                                    |
| Group/facility/payer filter facets            | None                              | **Build.** Existing browser services are direct-RLS paths and there are no client API routes for groups, facilities, contracts, or payers.                                                                                        |
| Executive readiness totals                    | None                              | **Build.** No API DTO combines credentialing, contracting, and effective-date readiness.                                                                                                                                          |
| Provider × payer matrix                       | `GET /api/cases`                  | **Not present.** This route requires `providerId` or `q`; blank bulk reads are rejected. Search is capped and designed for the extension.                                                                                         |
| Provider roster search                        | `GET /api/providers`              | **Structurally partial, unsafe to reuse.** It is paged, but omission of caller-controlled `groupId` returns the whole org. It includes CAQH ID/date, email, and home state, and its group filter reads the frozen primary mirror. |
| Provider drill-down                           | `GET /api/providers/:id`          | **Never reuse.** It returns `getProvider()`'s full row, including DOB, SSN last four, home address, DEA, and other fields.                                                                                                        |
| Provider's open cases                         | `GET /api/cases?providerId=`      | **Unsafe to reuse.** Org-only ownership; includes latest internal note and open portal-task details.                                                                                                                              |
| Case milestones                               | `GET /api/cases/:id/context`      | **Unsafe to reuse.** Org-only ownership; includes SOP tasks, projected steps, touch details, latest internal note, and coordinator identity.                                                                                      |
| Contract/effective readiness                  | None                              | **Build.** Contracts have no `/api` route.                                                                                                                                                                                        |
| Facility geography                            | No list route                     | **Build.** Case context returns locations, but within an internal DTO.                                                                                                                                                            |
| Payer names/catalog                           | None                              | **Build.** `/api/portals` is a portal registry, not a payer read.                                                                                                                                                                 |
| Client-safe status labels                     | None                              | **Build.** Raw status/config values must map server-side to the S2 vocabulary.                                                                                                                                                    |
| Documents                                     | `GET /api/documents/:id/download` | **Decision blocked.** It signs any org-owned document for any current member. It has no group-grant check and documents are out of the v1 allowlist pending product approval.                                                     |
| Audit history                                 | None                              | **Correct as-is for clients.** Clients must never read `audit_log`.                                                                                                                                                               |

Recommended minimum route shape:

- `GET /api/client/session` — user-scoped access contexts and safe group labels.
- `GET /api/client/matrix` — server-side filters, provider cursor, at most 50
  providers × the payer set, normalized client DTO, summary/facets in metadata.
- `GET /api/client/providers/:id` — the S2 allowlist plus all payer cells for one
  provider.

These are proposed shapes, not locked wire contracts. They should live under a
distinct prefix so no client request can accidentally dispatch to an internal
extension handler.

## RLS blast-radius classification

`scripts/benchmarks/audit-rls-policy-snapshot.mjs` lexicographically replays
every checked-in `CREATE POLICY`/`DROP POLICY` and classifies the final
expressions.

| Classification                                                                 |     Policies |
| ------------------------------------------------------------------------------ | -----------: |
| Total public policies                                                          |          155 |
| SELECT                                                                         |           58 |
| INSERT / UPDATE / DELETE                                                       | 46 / 37 / 14 |
| Membership-dependent                                                           |          145 |
| Uses `user_org_ids()`                                                          |          144 |
| References `memberships` directly                                              |            1 |
| Role-aware (`user_role()` or admin-anywhere helper)                            |           94 |
| Uses `user_role()`                                                             |           93 |
| Not membership-dependent                                                       |           10 |
| SELECT policies that grant org reads through membership with **no role check** |       **51** |
| Membership-dependent non-SELECT policies without a role check                  |        **0** |

The dangerous option-A blast radius is the **51 SELECT policies**, not all 155.
A new `client` membership would immediately satisfy these org-wide reads,
including `providers`, `provider_documents`, `tasks`, `touches`, `audit_log`,
and `status_history`. The 93 role-aware writes already enumerate admin and/or
specialist, so an unknown client role usually fails closed; reads fail open to
the whole org.

## Existing frontend role assumptions

Production route/component code contains **51 executable role decisions across
38 files, verified by
`node scripts/benchmarks/audit-frontend-role-sites.mjs --expect=51`:

- 19 `useCanWrite()` calls;
- 23 `useIsAdmin()` calls;
- 2 `useRole()` calls;
- 7 direct role comparisons.

There is one additional client-derived service decision in
`src/services/cases.ts` (`currentUserRole() !== "admin"`), for 52 browser-side
decisions across 39 files. That service check is a UX/business-rule check; RLS
remains the write wall.

| Usage                                | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useCanWrite()` routes               | `routes/tasks.$id.tsx`, `providers.index.tsx`, `providers.$id.index.tsx` (2), `groups.$groupId.index.tsx`, `cases.index.tsx`, `cases.$id.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `useCanWrite()` components           | `reports/ContractsTab.tsx`, `providers/SsnVaultField.tsx`, `documents/CaseRequiredDocuments.tsx`, `documents/DocumentsPanel.tsx`, `cases/TaskDrawer.tsx`, `cases/StepArtifactsPanel.tsx`, `onboarding/ProviderRosterSection.tsx`, `onboarding/ProviderGroupSection.tsx`, `cases/ManualCaseModal.tsx`, `cases/CaseTasksPanel.tsx`, `groups/GroupFacilitiesContent.tsx`, `generation/GenerationGrid.tsx`                                                                                                                                                                                                                                                                                                          |
| `useIsAdmin()` routes                | `routes/import.$runId.tsx`, `routes/cases.$id.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `useIsAdmin()` components            | `templates/TemplateWizard.tsx`, `settings/OrgPanel.tsx`, `settings/MembersPanel.tsx`, `settings/GroupsPanel.tsx`, `settings/FacilitiesPanel.tsx`, `reporting/AuditLogReport.tsx`, `providers/SsnVaultField.tsx`, `portals/PortalsRegistry.tsx`, `payer-admin/PayerSetupPage.tsx`, `payer-admin/PayerOverviewTab.tsx`, `payer-admin/PayerManageTab.tsx`, `payer-admin/PayerDetailPage.tsx`, `payer-admin/PayerContactsCard.tsx`, `onboarding/SectionUploadCard.tsx`, `cases/ManualCaseModal.tsx`, `import/ImportPreviewContent.tsx`, `groups/GroupFacilitiesContent.tsx`, `groups/PayerNetworkBoardContent.tsx`, `groups/GroupFactsCard.tsx`, `import/SectionImportPreview.tsx`, `generation/GenerationGrid.tsx` |
| Direct `useRole()` consumers         | `routes/providers.new.tsx`, `components/payer-admin/PayerScorecardPanel.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Direct comparisons                   | `providers.new.tsx` (3 billing checks), `MembersPanel.tsx` (specialist/billing badge fall-through), `PayerScorecardPanel.tsx` (admin/billing allowlist)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Role model/display/mutation plumbing | `src/types/index.ts`, `src/lib/auth-store.ts`, `src/lib/permissions.ts`, `src/routes/account.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/settings/MembersPanel.tsx`, `src/services/orgSettings.ts`, `src/services/invites.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Under option B none of these current call sites changes. Under option A the
three role unions, labels/descriptions, member editor, badge fall-through, and
the `providers.new` denylist require direct edits; all 52 decisions require
review because denylist checks can accidentally treat a fourth role as a
writer or internal reader.

## Billing is not a client role

Billing write restrictions are not merely hidden UI:

- Browser mutations are backed by role-aware RLS/RPC checks.
- `/api` mutations call `isWriter()` or an admin-only gate.
- The provider-create route's hard-load guard is imperfect by itself, but RLS
  still rejects the write.

Billing **reads**, however, are generally org-wide. The 51 role-agnostic SELECT
policies allow it to read provider PHI, internal tasks/touches, document
metadata, and even `audit_log`. `AuditLogReport` hides its query behind
`useIsAdmin()`, but `audit_log_select` itself is membership-only. Therefore
renaming or reusing billing as a client role would be a privacy failure.

## Below-org leakage in current API routes

If a future caller were promised a subset of groups but passed through today's
`authenticate()`, the following reads could return another group in the same
org:

- provider list/detail/profile;
- provider-case search and case context;
- next-best-action;
- portal and field-map registries;
- provider-document download;
- any provider/case filters whose group ID is omitted or supplied by the
  caller.

The current guard verifies org ownership only. A group filter in a query string
is a filter, not an entitlement. Global payer-form and shared-training reads are
global by design and are a separate concern.

## Option scorecard

Score: 1 = worst, 5 = best. “Blast radius” scores higher when fewer current
surfaces change.

| Option                                                       | Blast radius | Isolation testability | Onboarding effort | Auth simplicity | Revocation |  Total |
| ------------------------------------------------------------ | -----------: | --------------------: | ----------------: | --------------: | ---------: | -----: |
| A — add client role/scope to `memberships`, enforce with RLS |            1 |                     2 |                 3 |               4 |          4 |     14 |
| **B — new client access + grant table, API-only**            |        **5** |                 **5** |             **4** |           **4** |      **5** | **23** |
| C — separate portal app and separate auth                    |            4 |                     4 |                 2 |               1 |          3 |     14 |
| D — tokenized magic links                                    |            5 |                     3 |                 5 |               2 |          2 |     17 |

### Why B wins

- It cannot inherit the 51 membership-only SELECT policies.
- Isolation is concentrated in one client guard, DTO services, and the existing
  deliberate-leak gate pattern.
- It reuses Supabase JWT verification without giving clients the internal app's
  organization membership.
- Revocation is immediate when the access/grant row is read on each request;
  no stale role claim needs to expire.
- It does not widen or change any extension wire contract.

Separate deployment is orthogonal. The client UI may be a separate app or a
chromeless route bundle later; authorization still follows option B.

## Work implied by the recommendation

All database work is additive and must be designed after product confirms this
spike:

1. Add a service-only client-access record keyed by verified auth user and org,
   with explicit lifecycle/revocation fields.
2. Add child group grants with database-enforced org/group coherence. Do not
   put group IDs into user-editable JWT metadata.
3. Add a client invite/claim path. Existing `pending_invites` creates
   `memberships`, so it cannot be reused unchanged.
4. Add `authenticateClient()` and a client context containing only verified
   `userId`, `orgId`, and granted group IDs.
5. Add dedicated client DTO services/routes. Every query applies both org and
   group scope; provider membership resolves through
   `provider_group_assignments`.
6. Add API-isolation positive, cross-org, cross-group, revoked-grant, empty-
   grant, and deliberate-leak cases before routes merge.
7. Keep client DTOs `no-store` where they carry person-level data; never log
   bodies.

## Open risks, ranked

| Rank | Risk / decision                                                         | Why it matters                                                                                                                                                            |
| ---: | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    1 | **No authoritative client → group mapping exists.**                     | “Zero manual configuration” is impossible at first access unless a CRM/contract source supplies this mapping. Product must define who grants groups and from what source. |
|    2 | **Existing internal routes are org-only and PHI/internal-data rich.**   | A route-reuse shortcut would defeat both S1 scope and S2 allowlists.                                                                                                      |
|    3 | **A provider may belong to several groups.**                            | Filtering on frozen `providers.group_id` would omit valid rows and can mis-scope results.                                                                                 |
|    4 | **Grant revocation and caching semantics are undefined.**               | Cache TTL must not outlive the promised revocation SLA; safest v1 is a grant check per request.                                                                           |
|    5 | **Mixed internal/client identities need product-entry disambiguation.** | A user with both capabilities must choose context; the server must never infer broader access.                                                                            |
|    6 | **Group ownership may cross org boundaries.**                           | Recommended context is one org plus groups; cross-org clients need multiple explicit contexts, not one widened query.                                                     |
|    7 | **Invite lifecycle is missing.**                                        | Email verification, expiry, replay, removal, and last-owner safeguards need decisions and audit coverage.                                                                 |

## What S2 and S4 must establish

- **S2:** the exact source-column allowlist; derived client status vocabulary;
  mandatory test/reference/terminated exclusions; whether tracking IDs,
  documents, and provider contact data are ever client-visible.
- **S4:** that all matrix/filter/drill-down queries accept a server-resolved
  group set; payload/page limits; RLS-versus-service-role cost; the index and
  browser-window strategy.

S2 and S4 do not need to wait on S1 to investigate content and scale, but build
order is **S1 authorization contract → S2 DTO contract → S4 query/page
implementation**. No epic, user story, or build acceptance criteria should be
written until product confirms all three decision documents.
