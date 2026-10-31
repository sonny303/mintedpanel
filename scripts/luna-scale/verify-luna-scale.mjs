#!/usr/bin/env node
// MINT-82 (RC-07) — read-only check of the Luna-scale org after an apply or a
// teardown. Same target guards as the seed; no confirmation token, because it
// runs one READ ONLY transaction and writes nothing.
import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import {
  assertDatabaseIdentity,
  assertLunaTarget,
  parseAllowedRefs,
  psqlEnvironment,
} from "./luna-fixture.mjs";
import { LUNA_TABLES } from "./luna-dataset.mjs";
import { buildVerifySql } from "./luna-sql.mjs";

const IDENTITY_SQL = "SELECT system_identifier::text FROM pg_control_system()";

/** Compare a verify snapshot with its last receipt. Returns the problems. */
export function checkSnapshot(snapshot) {
  const problems = [];
  const receipt = snapshot.last_receipt;
  if (!snapshot.org) problems.push("the Luna org does not exist");
  if (receipt?.event === "apply") {
    if (snapshot.org?.lifecycle_state !== "active")
      problems.push("the org is not active after an apply");
    for (const table of LUNA_TABLES) {
      if (table === "organizations") continue;
      const expected = receipt.counts?.[table];
      if (snapshot.owned?.[table] !== expected) {
        problems.push(`${table}: ${snapshot.owned?.[table]} seed rows, receipt says ${expected}`);
      }
    }
  } else if (receipt?.event === "teardown") {
    for (const [table, count] of Object.entries(snapshot.owned ?? {})) {
      if (count !== 0) problems.push(`${table}: ${count} seed rows remain after the teardown`);
    }
  } else if (snapshot.org) {
    problems.push("no Luna-scale receipt in audit_log");
  }
  for (const key of [
    "cross_org_case_links",
    "cases_without_primary_location",
    "seed_rows_outside_org",
  ]) {
    if (snapshot[key] !== 0) problems.push(`${key}: ${snapshot[key]}`);
  }
  return problems;
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  const execute = dependencies.execute ?? promisify(execFile);
  const report = dependencies.report ?? ((message) => process.stdout.write(message));
  const allowLocal = argv.includes("--local-rehearsal");
  const unknown = argv.filter((arg) => arg !== "--local-rehearsal");
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);
  const target = assertLunaTarget({
    supabaseUrl: environment.SUPABASE_URL,
    databaseUrl: environment.LUNA_DATABASE_URL,
    allowedRefs: parseAllowedRefs(environment.LUNA_SCALE_ALLOWED_PROJECT_REFS),
    allowLocal,
  });
  const query = async (sql) => {
    const { stdout } = await execute(
      "psql",
      [environment.LUNA_DATABASE_URL, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
      { env: psqlEnvironment(environment), timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
    ).catch(() => {
      throw new Error("Luna verification query failed");
    });
    return String(stdout).trim();
  };
  assertDatabaseIdentity(
    target,
    await query(IDENTITY_SQL),
    environment.LUNA_SCALE_EXPECTED_DATABASE_IDENTITY,
  );
  const raw = await query(buildVerifySql());
  const line = raw.split("\n").find((text) => text.trim().startsWith("{"));
  if (!line) throw new Error("Luna verification returned no snapshot");
  const snapshot = JSON.parse(line);
  report(`${JSON.stringify(snapshot, null, 2)}\n`);
  const problems = checkSnapshot(snapshot);
  if (problems.length > 0) throw new Error(`Luna verification failed:\n- ${problems.join("\n- ")}`);
  report(`Luna verification passed (${snapshot.last_receipt?.event ?? "no receipt"}).\n`);
  return snapshot;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
