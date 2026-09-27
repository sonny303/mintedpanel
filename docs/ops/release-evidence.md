# Read-only staging release evidence

This slice adds authenticated, read-only provider collectors for the fixed
staging target. It does not deploy, move aliases, apply migrations, create a
lease, or qualify a release.

| Collector                                        | Fixed readback                                                                                                                                                      | Output                                                                                                                                                         | Explicit limit                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/delivery/staging-supabase-evidence.mjs` | Supabase Management API project identity plus `/v1/projects/vmznysvietfaddakkegt/database/query/read-only`                                                          | Sanitized project identity, public relation/column/constraint/index/policy/grant/trigger/function metadata digest, ordered migration ledger and lineage digest | SQL selects structural metadata only; enum/domain definitions, sequences, schema ACLs and extension versions remain a separate alignment manifest; migration ledger rows are not source-file hashes |
| `scripts/delivery/staging-vercel-evidence.mjs`   | Vercel team/project, Preview env metadata, shared env inheritance, domain inventory, both fixed staging aliases, served deployment and bounded deployment inventory | Exact project/alias/source SHA observations, sanitized env update metadata, CORS-origin-set digest, deployment/runtime metadata and configuration digest       | Pre-cutover alias/source/env mismatches are returned as `BLOCKED`; runtime database identity and native extension proof remain `UNVERIFIED`                                                         |

Both collectors use `releaseTarget("staging")`; callers cannot override team,
project, ref, environment, branch, host, alias, or API path. Provider response
errors are converted to closed static `DeliveryError` codes. Returned objects
exclude environment values, tokens, private provider blobs, function bodies,
policy expressions and other row contents. The Supabase catalog hashes
security-relevant definitions (RLS/force-RLS, ACLs, defaults, constraints,
indexes, policy predicates/roles, function bodies/ACL/config) inside the
database response before returning them.

The collectors perform bookend reads and reject catalog, project, deployment,
or environment drift during the bounded collection window. Vercel alias and
source mismatches are preserved as sanitized observations and produce a
`BLOCKED` qualification so the pre-cutover state remains reviewable. The
shared `assertFreshStagingEvidence` helper compares the collector timestamp to a
trusted composition clock; stale observations are rejected. A fixed SHA is
required for Vercel collection and must match the deployment's trusted staging
metadata. HTTP health or a Vercel environment binding cannot be promoted to
runtime database proof or native extension proof.

The read-only entrypoint is
`node scripts/delivery/collect-staging-evidence.mjs --source-sha <40-hex-sha>`
with an optional `--candidate-deployment-id <dpl_...>`. It reads credentials
only from `SUPABASE_ACCESS_TOKEN` and `VERCEL_TOKEN`; provider URL, project,
team, target, and transport overrides are rejected. Its versioned stdout is
always `status: "BLOCKED"`, carries the union of observed static blocker codes,
and includes an `artifactDigest` over the complete artifact excluding that
field. Qualification fields are stripped from nested observations. It exits
nonzero on collection rejection. No artifact from this command authorizes a
release.

## Composition seam

The future trusted `snapshot({ target: "staging" })` adapter can call both
collectors, bind `observedAt`, `schemaDigest`, `lineageDigest`, deployment ID,
configuration digest, and aliases into the existing `record.context` and
`observed` contract, then enforce `snapshotMaxAgeSeconds`. The ledger remains
separate from the admitted source migration inventory until a source collector
binds exact migration paths and SHA-256 values. The controller must keep the
collector's `qualification.status === "BLOCKED"` until a real runtime identity
endpoint and owner-observed installed extension receipt are available.

No workflow, controller, or hosted mutation is wired by this slice. Tests use
transport-injected synthetic responses only and cover wrong identities, source
SHA mismatch, bookend drift, stale evidence, provider-error redaction,
definition-digest changes, incomplete environment inventory, CLI override
rejection, and the absence of native extension proof.
