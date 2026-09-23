import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalDigest } from "../release/contract.mjs";
import { MigrationError, hash, requireMigration } from "./inventory.mjs";

const execute = promisify(execFile);

export function validateDestination(connectionString, projectRef) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new MigrationError("DATABASE_URL_REJECTED");
  }
  const entries = [...url.searchParams.entries()];
  const keys = entries.map(([key]) => key);
  // libpq keeps the last repeated keyword. URLSearchParams.get keeps the first,
  // so a second sslmode or sslrootcert must be rejected rather than ignored.
  requireMigration(
    url.protocol === "postgresql:" &&
      url.hostname === `db.${projectRef}.supabase.co` &&
      (url.port === "5432" || !url.port) &&
      url.pathname === "/postgres" &&
      url.username === "postgres" &&
      !url.hash &&
      entries.length === new Set(keys).size &&
      url.searchParams.get("sslmode") === "verify-full" &&
      keys.every((key) => key === "sslmode" || key === "sslrootcert"),
    "DATABASE_URL_REJECTED",
  );
}

/** Real subprocess adapter. Credentials/output never enter errors or receipts.
 * The caller must validate the destination; integration tests use loopback only.
 */
export async function createDatabase({ root, inventory, connectionString, binaries = {} }) {
  const workdir = await mkdtemp(join(tmpdir(), "minted-migrations-"));
  const processEnv = {
    PATH: process.env.PATH,
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    SUPABASE_TELEMETRY_DISABLED: "true",
    PGCONNECT_TIMEOUT: "15",
  };
  async function command(binary, args, input) {
    try {
      const child = execute(binary, args, {
        env: processEnv,
        cwd: workdir,
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      child.child.stdin.end(input);
      return (await child).stdout.trim();
    } catch {
      // SQL can contain private literals; never forward child stdout/stderr.
      throw new MigrationError("MIGRATION_COMMAND_FAILED");
    }
  }
  try {
    await mkdir(join(workdir, "supabase/migrations"), { recursive: true });
    await writeFile(
      join(workdir, "supabase/config.toml"),
      'project_id = "minted-migration-runner"\n',
    );
    for (const item of inventory) {
      requireMigration(
        /^supabase\/migrations\/\d{14}_[a-zA-Z0-9_-]+\.sql$/.test(item.path),
        "INVALID_MIGRATION_PATH",
      );
      const bytes = await readFile(join(root, item.path));
      requireMigration(hash(bytes) === item.sha256, "MIGRATION_CHANGED_AFTER_PLAN");
      await writeFile(join(workdir, item.path), bytes, { mode: 0o600 });
    }
    const catalogSql = await readFile(new URL("./catalog.sql", import.meta.url), "utf8");
    return {
      version: () => command(binaries.supabase ?? "supabase", ["--version"]),
      async snapshot() {
        const output = await command(
          binaries.psql ?? "psql",
          ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", connectionString],
          `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout='30s';\nSET LOCAL search_path=pg_catalog;\n` +
            `SELECT system_identifier::text FROM pg_catalog.pg_control_system();\n` +
            `SELECT coalesce(jsonb_agg(version ORDER BY version),'[]') FROM supabase_migrations.schema_migrations;\n` +
            catalogSql +
            "\nROLLBACK;\n",
        );
        try {
          const [systemIdentifier, ledger, catalog, ...extra] = output.split(/\r?\n/);
          requireMigration(extra.length === 0, "INVALID_SNAPSHOT");
          const versions = JSON.parse(ledger);
          requireMigration(
            Array.isArray(versions) && versions.every((v) => /^\d{14}$/.test(v)),
            "INVALID_SNAPSHOT",
          );
          return { systemIdentifier, versions, schemaDigest: canonicalDigest(JSON.parse(catalog)) };
        } catch {
          throw new MigrationError("INVALID_SNAPSHOT");
        }
      },
      async push({ dryRun }) {
        await command(binaries.supabase ?? "supabase", [
          "db",
          "push",
          "--db-url",
          connectionString,
          "--workdir",
          workdir,
          "--skip-vault",
          "--yes",
          ...(dryRun ? ["--dry-run"] : []),
        ]);
      },
      close: () => rm(workdir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    throw error;
  }
}
