import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalDigest } from "../release/contract.mjs";
import { MigrationError, hash, requireMigration } from "./inventory.mjs";

const execute = promisify(execFile);

export async function databaseCommand(binary, args, { input, env, cwd }) {
  let child;
  try {
    child = execute(binary, args, {
      env,
      cwd,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const written = new Promise((resolve, reject) => {
      // stdin errors are separate from execFile's completion callback.
      // Reject safely if the subprocess exits before accepting the SQL.
      child.child.stdin.on("error", reject);
      child.child.stdin.end(input, (error) => (error ? reject(error) : resolve()));
    });
    const [result] = await Promise.all([child, written]);
    return result.stdout.trim();
  } catch {
    child?.child.kill();
    // SQL can contain private literals; never forward child stdout/stderr.
    throw new MigrationError("MIGRATION_COMMAND_FAILED");
  }
}

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
  let destination;
  let password;
  try {
    destination = new URL(connectionString);
    password = decodeURIComponent(destination.password);
    requireMigration(!/[\r\n\0]/.test(password), "DATABASE_URL_REJECTED");
    destination.password = "";
  } catch {
    throw new MigrationError("DATABASE_URL_REJECTED");
  }
  const workdir = await mkdtemp(join(tmpdir(), "minted-migrations-"));
  const passfile = join(workdir, "pgpass");
  const processEnv = {
    PATH: process.env.PATH,
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    SUPABASE_TELEMETRY_DISABLED: "true",
    PGCONNECT_TIMEOUT: "15",
  };
  const command = (binary, args, input, credentials = {}) =>
    databaseCommand(binary, args, { input, env: { ...processEnv, ...credentials }, cwd: workdir });

  try {
    const escape = (value) => value.replace(/[:\\]/g, "\\$&");
    const fields = [
      destination.hostname,
      destination.port || "5432",
      decodeURIComponent(destination.pathname.slice(1)),
      decodeURIComponent(destination.username),
      password,
    ];
    requireMigration(
      fields.every((value) => !/[\r\n\0]/.test(value)),
      "DATABASE_URL_REJECTED",
    );
    await writeFile(passfile, `${fields.map(escape).join(":")}\n`, { mode: 0o600 });
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
          ["-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1", destination.href],
          `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout='30s';\nSET LOCAL search_path=pg_catalog;\n` +
            `SELECT system_identifier::text FROM pg_catalog.pg_control_system();\n` +
            `SELECT coalesce(jsonb_agg(version ORDER BY version),'[]') FROM supabase_migrations.schema_migrations;\n` +
            catalogSql +
            "\nROLLBACK;\n",
          { PGPASSFILE: passfile },
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
        await command(
          binaries.supabase ?? "supabase",
          [
            "db",
            "push",
            "--db-url",
            destination.href,
            "--workdir",
            workdir,
            "--skip-vault",
            "--yes",
            ...(dryRun ? ["--dry-run"] : []),
          ],
          undefined,
          { PGPASSFILE: passfile },
        );
      },
      close: () => rm(workdir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    throw error;
  }
}
