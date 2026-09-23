import { canonicalDigest, releaseTarget } from "../release/contract.mjs";
import { requireMigration, readInventory, checkHistory } from "./inventory.mjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDatabase, validateDestination } from "./database.mjs";
import { runMigrations, validatePlan } from "./runner.mjs";

// Only the authenticated provider factory may call this, after source admission
// and reconciliation. executeDelivery owns authority, rehearsal and the lease.
export async function createHostedMigrationExecutor({
  root,
  sourceSha,
  bundle,
  reconciliation,
  connectionString,
}) {
  requireMigration(sourceSha === bundle.record.context.source.sha, "SOURCE_MISMATCH");
  const target = bundle.record.context.target;
  requireMigration(
    canonicalDigest(target) === canonicalDigest(releaseTarget(target.environment)),
    "TARGET_MISMATCH",
  );
  validateDestination(connectionString, target.supabaseRef);
  const inventory = await readInventory(root);
  checkHistory(
    inventory,
    JSON.parse(await readFile(join(root, "scripts/migrations/history-lock.json"), "utf8")),
  );
  validatePlan(reconciliation, inventory);
  const database = await createDatabase({ root, inventory, connectionString });
  try {
    return {
      applyMigration: createMigrationExecutor({ bundle, reconciliation, inventory, database }),
      close: database.close,
    };
  } catch (error) {
    await database.close();
    throw error;
  }
}

/** Install as services.applyMigration in the existing leased release controller.
 * The provider factory must authenticate the bundle, database and reconciliation
 * before constructing this adapter. This is not an operator-supplied PASS file.
 */
export function createMigrationExecutor({ bundle, reconciliation, inventory, database }) {
  const bound = structuredClone(bundle);
  const plan = structuredClone(reconciliation);
  const files = structuredClone(inventory);
  const context = bound.record.context;
  validatePlan(plan, files);
  requireMigration(
    bound.releaseDigest === canonicalDigest(bound.record),
    "RELEASE_BINDING_MISMATCH",
  );
  requireMigration(
    plan.baselineSchemaDigest === context.migrationPlan.baselineSchemaDigest &&
      plan.resultSchemaDigest === context.migrationPlan.resultSchemaDigest &&
      canonicalDigest(plan.inventory) === canonicalDigest(context.migrationPlan.inventory) &&
      canonicalDigest(plan.baselineVersions) ===
        canonicalDigest(context.baseline.migrations.map((item) => item.id)),
    "RECONCILIATION_BINDING_MISMATCH",
  );
  return async (request) => {
    requireMigration(
      request.releaseDigest === bound.releaseDigest &&
        request.planDigest === bound.policy.migrationPlanDigest &&
        request.planDigest === canonicalDigest(request.plan) &&
        canonicalDigest(request.plan) === canonicalDigest(context.migrationPlan) &&
        canonicalDigest(request.target) === canonicalDigest(context.target),
      "MIGRATION_REQUEST_BINDING_MISMATCH",
    );
    return runMigrations({ plan, inventory: files, database, sourceSha: context.source.sha });
  };
}
