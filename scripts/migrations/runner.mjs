import { canonicalDigest } from "../release/contract.mjs";
import { assertUnique, requireMigration } from "./inventory.mjs";

export const CLI_VERSION = "2.117.0";
const same = (a, b) => canonicalDigest(a) === canonicalDigest(b);

export function validatePlan(plan, inventory) {
  requireMigration(plan.status === "reconciled", "RECONCILIATION_REQUIRED");
  assertUnique(inventory);
  requireMigration(same(plan.inventory, inventory), "PLAN_INVENTORY_MISMATCH");
  requireMigration(
    Array.isArray(plan.baselineVersions) && plan.baselineVersions.length > 0,
    "BASELINE_REQUIRED",
  );
  requireMigration(
    same(
      plan.baselineVersions,
      inventory.slice(0, plan.baselineVersions.length).map((item) => item.id),
    ),
    "BASELINE_NOT_PREFIX",
  );
  for (const value of [plan.baselineSchemaDigest, plan.resultSchemaDigest]) {
    requireMigration(
      typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
      "SCHEMA_DIGEST_REQUIRED",
    );
  }
  requireMigration(
    typeof plan.systemIdentifier === "string" && /^\d{10,30}$/.test(plan.systemIdentifier),
    "DATABASE_IDENTITY_REQUIRED",
  );
}

/** Adapter boundary: the hosted entrypoint owns credentials and release authority.
 * No repair/reset/include-all, seed, Vault, or automatic rollback operation exists.
 * The enclosing release lease and workflow concurrency serialize this operation.
 */
export async function runMigrations({ plan, inventory, database, sourceSha }) {
  validatePlan(plan, inventory);
  requireMigration(/^[a-f0-9]{40}$/.test(sourceSha), "SOURCE_SHA_REQUIRED");
  requireMigration((await database.version()) === CLI_VERSION, "CLI_VERSION_MISMATCH");
  const versions = inventory.map((item) => item.id);
  const before = await database.snapshot();
  requireMigration(before.systemIdentifier === plan.systemIdentifier, "DATABASE_IDENTITY_MISMATCH");
  const complete = same(before.versions, versions);
  requireMigration(
    complete || same(before.versions, plan.baselineVersions),
    "MIGRATION_HISTORY_MISMATCH",
  );
  requireMigration(
    before.schemaDigest === (complete ? plan.resultSchemaDigest : plan.baselineSchemaDigest),
    "SCHEMA_DRIFT",
  );
  if (!complete) {
    await database.push({ dryRun: true });
    // Recheck after planning, before the first write. External superuser writes
    // are prohibited by policy; they cannot be prevented by a CI runner alone.
    requireMigration(same(await database.snapshot(), before), "DATABASE_CHANGED_DURING_PLAN");
    await database.push({ dryRun: false });
  }
  const after = await database.snapshot();
  requireMigration(after.systemIdentifier === plan.systemIdentifier, "DATABASE_IDENTITY_MISMATCH");
  requireMigration(same(after.versions, versions), "MIGRATION_POSTCHECK_FAILED");
  requireMigration(after.schemaDigest === plan.resultSchemaDigest, "SCHEMA_POSTCHECK_FAILED");
  return {
    status: complete ? "ALREADY_APPLIED" : "APPLIED",
    sourceSha,
    planDigest: canonicalDigest(plan),
    inventoryDigest: canonicalDigest(inventory),
    schemaDigest: after.schemaDigest,
    versions: after.versions,
  };
}
