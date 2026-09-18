# P01 — Close vault authorization (DB-01)

Approved work order: audit Session #2 / DB-01, scope checkpoint A approved
2026-09-18. PR target and base: `staging` at `dffc60a322da8f233fce2ab097629abbcf9ef4b9`.
The user explicitly selected staging instead of the repository default main; the
P01 branch starts from staging so it contains none of the unrelated main changes.

An authenticated nonmember can pass the nullable role rejection in
`store_ssn`, `reveal_ssn`, and `create_ssn_intake_link`. The provider lookup runs
inside SECURITY DEFINER functions; ordinary table RLS does not close this path.
This is an authorization defect, not evidence of a breach.

| Requirement | Acceptance                                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR1         | Anonymous, missing-membership and disallowed-role operator calls are denied.                                                                                         |
| FR2         | The trusted `auth.uid()` caller must hold the permitted role in the target provider's organization; unrelated and mixed multi-org roles cannot authorize it.         |
| FR3         | Admin/specialist store and issue links; only admin reveals, with nonblank justification. Preserve existing signatures and responses.                                 |
| FR4         | Valid public-token intake remains usable without membership. Fill remains service-role-only, with matching case/provider/org and the authenticated API writer guard. |
| FR5         | Preserve private helpers, vault table isolation, encryption, audit actor attribution, purpose restrictions and response protections.                                 |
| FR6         | Unauthorized operator attempts leave vault, provider, intake-link and successful audit state unchanged. Existing token-denial throttle logging remains permitted.    |

## Scope and compatibility

- One forward migration replaces only the three operator authorization predicates
  with NULL-safe checks; no historical migration or shared membership-helper edit.
- Real SQL regression tests reproduce the old bypass and exercise allowed and
  denied paths under `anon`, `authenticated`, and `service_role`.
- Existing service/API and mocked UI regressions remain separate evidence from SQL.
- One draft PR; no hosted access, hosted migration, deployment, merge, extension
  changes, score change, or subsequent work-order execution.

The current SQL, UI and table register permit specialists to issue intake links.
The older E4.4 feature prose says an admin issues them; P01 preserves the current
writer policy explicitly approved in this work order.

| Table trace                                 | Access                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `memberships`, `providers`, `organizations` | Read for target organization, caller role and response context.        |
| `provider_ssn_vault`                        | Existing encrypted writes and justified reads through restricted RPCs. |
| `providers`                                 | Existing last-four synchronization only.                               |
| `provider_ssn_intake_links`                 | Existing authorized revoke/reissue and bearer-token consumption.       |
| `credential_cases`                          | Existing service-only fill context validation.                         |
| `audit_log`, `public_rpc_attempts`          | Existing successful-action attribution and token-throttle events.      |

No table or column is added or changed by the repair.

## Verification and recovery

The isolated runner creates its own network-disabled container and synthetic
databases. It must never accept an existing database URL, mount recovery data, or
read a hosted key. Assertions emit labels and booleans only. The reviewed fixture
loads the real SQL dependencies, including the latest private key helper; it does
not mock membership or encryption. Hosted Auth/PostgREST and live ACL parity are
separate checks.

Apply the new migration only through a separately authorized hosted process after
reviewing the target's effective definitions and grants. The change is compatible
with existing callers and requires no data backfill or key rotation. It takes
effect when the migration commits. Do not recover by restoring the known-open
predicates: retain denial and correct forward if a regression is found.

Existing issued bearer tokens keep their current lifecycle. P01 does not inspect
or revoke customer tokens. Token concurrency, sensitive UI state lifetime, source
history reconciliation and hosted environment qualification remain separate work.

The companion [PR review and future promotion handoff](./p01-pr-review-handoff.md)
records commands, results, review feedback, the exact reviewed revisions, and the
operator sequence for a separately authorized deployment. Preparation does not
authorize promotion, merge, or hosted application.
