import { createHash } from "node:crypto";
import { readdir, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";

export class MigrationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export function requireMigration(condition, code) {
  if (!condition) throw new MigrationError(code);
}
export const hash = (value) => createHash("sha256").update(value).digest("hex");

export async function readInventory(root) {
  const directory = join(root, "supabase/migrations");
  const inventory = [];
  for (const name of (await readdir(directory)).sort()) {
    if (
      [
        "20260716180000_payer_dead_column_drop.sql.superseded",
        "20260809120000_slice6_create_payer_assign_flag.sql.superseded",
      ].includes(name)
    )
      continue;
    requireMigration(/^\d{14}_[a-zA-Z0-9_-]+\.sql$/.test(name), "INVALID_MIGRATION_NAME");
    const path = `supabase/migrations/${name}`;
    requireMigration((await lstat(join(root, path))).isFile(), "MIGRATION_NOT_REGULAR_FILE");
    inventory.push({ id: name.slice(0, 14), path, sha256: hash(await readFile(join(root, path))) });
  }
  requireMigration(inventory.length > 0, "EMPTY_INVENTORY");
  return inventory;
}

export function assertUnique(inventory) {
  requireMigration(
    new Set(inventory.map((item) => item.id)).size === inventory.length,
    "DUPLICATE_MIGRATION_VERSION",
  );
}

// Immutable historical files are grandfathered, not renamed or marked applied.
// The hosted runner separately rejects ALL duplicate versions, including legacy ones.
export function checkHistory(inventory, history) {
  requireMigration(history.length > 0, "EMPTY_HISTORY_LOCK");
  for (const old of history) {
    requireMigration(
      inventory.some(
        (item) => item.path === old.path && item.id === old.id && item.sha256 === old.sha256,
      ),
      "HISTORICAL_MIGRATION_CHANGED",
    );
  }
  const paths = new Set(history.map((item) => item.path));
  const ids = new Set(history.map((item) => item.id));
  const last = history.at(-1).id;
  for (const item of inventory.filter((entry) => !paths.has(entry.path))) {
    requireMigration(!ids.has(item.id), "DUPLICATE_MIGRATION_VERSION");
    requireMigration(item.id > last, "BACKDATED_MIGRATION");
    ids.add(item.id);
  }
}
