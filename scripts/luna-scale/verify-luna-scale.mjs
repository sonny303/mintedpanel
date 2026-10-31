#!/usr/bin/env node
// MINT-82 (RC-07) — read-only check of the Luna-scale org after an apply or a
// teardown. Same target guards as the seed; no confirmation token, because it
// runs READ ONLY transactions and writes nothing.
//
//   --strict            also fail on rows in the org the seed did not create
//                       (the CI job uses it; on staging a reviewer may add some)
//   --fingerprint SCOPE print md5 fingerprints and exit: "outside" (every row
//                       not in the Luna org) or "seed" (every row in it)
//   --local-rehearsal   loopback local Supabase only
import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import {
  LUNA_FIXTURE_VERSION,
  assertDatabaseIdentity,
  assertLunaTarget,
  parseAllowedRefs,
  psqlEnvironment,
} from "./luna-fixture.mjs";
import { LUNA_TABLES, buildLunaDataset, planCounts } from "./luna-dataset.mjs";
import { PRESERVED_ORG_TABLES, buildFingerprintSql, buildVerifySql } from "./luna-sql.mjs";

const IDENTITY_SQL = "SELECT system_identifier::text FROM pg_control_system()";
const SEED_TABLES = LUNA_TABLES.filter((table) => table !== "organizations");
/** The organization insert trigger seeds exactly this many roster templates. */
export const ROSTER_TEMPLATES_PER_ORG = 3;

/** The planned per-table counts, regenerated from the receipt's parameters
 * and anchor date by the same generator the apply used. */
export function plannedFromReceipt(receipt) {
  if (receipt?.event !== "apply" || !receipt.params || !receipt.anchor_date) return null;
  return planCounts(buildLunaDataset(receipt.params, { anchorDate: receipt.anchor_date }));
}

/** Compare a verify snapshot with its last receipt and the regenerated plan.
 * Returns the problems; empty means verified. */
export function checkSnapshot(snapshot, { planned = null, strict = false } = {}) {
  const problems = [];
  const receipt = snapshot.last_receipt;
  if (!snapshot.org) problems.push("the Luna org does not exist");
  if (receipt && receipt.version !== LUNA_FIXTURE_VERSION) {
    problems.push(
      `the last receipt is fixture ${receipt.version}, this code is ${LUNA_FIXTURE_VERSION}`,
    );
  }
  const orgRows = snapshot.org_rows ?? {};
  if (receipt?.event === "apply") {
    if (snapshot.org?.lifecycle_state !== "active") {
      problems.push("the org is not active after an apply");
    }
    if (!planned)
      problems.push("the apply receipt carries no parameters to regenerate the plan from");
    for (const table of SEED_TABLES) {
      const owned = snapshot.owned?.[table];
      if (owned !== receipt.counts?.[table]) {
        problems.push(`${table}: ${owned} seed rows, the receipt says ${receipt.counts?.[table]}`);
      }
      if (planned && owned !== planned[table]) {
        problems.push(`${table}: ${owned} seed rows, the plan says ${planned[table]}`);
      }
      if (strict && snapshot.unowned?.[table] !== 0) {
        problems.push(`${table}: ${snapshot.unowned?.[table]} rows the seed did not create`);
      }
    }
  } else if (receipt?.event === "teardown") {
    if (snapshot.org?.lifecycle_state !== "inactive") {
      problems.push("the org is not inactive after a teardown");
    }
    for (const [table, count] of Object.entries(snapshot.owned ?? {})) {
      if (count !== 0) problems.push(`${table}: ${count} seed rows remain after the teardown`);
    }
  } else if (snapshot.org) {
    problems.push("no Luna-scale receipt in audit_log");
  }
  if (strict && snapshot.org) {
    // Outside the seed's own tables the org holds only the documented
    // residue: the roster templates its insert trigger seeds, and receipts.
    const allowed = new Set([...PRESERVED_ORG_TABLES, ...SEED_TABLES, "memberships"]);
    if (receipt?.event === "teardown") allowed.clear();
    for (const [table, count] of Object.entries(orgRows)) {
      if (table === "audit_log" || table === "roster_templates" || allowed.has(table)) continue;
      if (count !== 0) problems.push(`${table}: ${count} rows in the Luna org`);
    }
    if (orgRows.roster_templates !== ROSTER_TEMPLATES_PER_ORG) {
      problems.push(
        `roster_templates: ${orgRows.roster_templates} rows in the Luna org, expected ${ROSTER_TEMPLATES_PER_ORG}`,
      );
    }
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

export function parseVerifyArgs(argv) {
  const args = { allowLocal: false, strict: false, fingerprint: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--local-rehearsal") args.allowLocal = true;
    else if (flag === "--strict") args.strict = true;
    else if (flag === "--fingerprint") {
      args.fingerprint = argv[index + 1] ?? null;
      index += 1;
      if (!["outside", "seed"].includes(args.fingerprint)) {
        throw new Error('--fingerprint must be "outside" or "seed"');
      }
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

function lastJsonLine(raw, what) {
  const line = raw.split("\n").find((text) => text.trim().startsWith("{"));
  if (!line) throw new Error(`Luna verification returned no ${what}`);
  return JSON.parse(line);
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  const execute = dependencies.execute ?? promisify(execFile);
  const report = dependencies.report ?? ((message) => process.stdout.write(message));
  const args = parseVerifyArgs(argv);
  const target = assertLunaTarget({
    supabaseUrl: environment.SUPABASE_URL,
    databaseUrl: environment.LUNA_DATABASE_URL,
    allowedRefs: parseAllowedRefs(environment.LUNA_SCALE_ALLOWED_PROJECT_REFS),
    allowLocal: args.allowLocal,
  });
  const databaseUrl = environment.LUNA_DATABASE_URL;
  const query = async (sql) => {
    const { stdout } = await execute(
      "psql",
      [databaseUrl, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
      { env: psqlEnvironment(environment), timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
    ).catch((error) => {
      // psql's own message, never the credential-bearing command line.
      const detail = String(error?.stderr ?? "")
        .replaceAll(databaseUrl, "<LUNA_DATABASE_URL>")
        .trim();
      throw new Error(`Luna verification query failed${detail ? `: ${detail}` : ""}`);
    });
    return String(stdout).trim();
  };
  assertDatabaseIdentity(
    target,
    await query(IDENTITY_SQL),
    environment.LUNA_SCALE_EXPECTED_DATABASE_IDENTITY,
  );
  if (args.fingerprint) {
    const fingerprint = lastJsonLine(
      await query(buildFingerprintSql(args.fingerprint)),
      "fingerprint",
    );
    report(`${JSON.stringify(fingerprint, Object.keys(fingerprint).sort(), 2)}\n`);
    return fingerprint;
  }
  const snapshot = lastJsonLine(await query(buildVerifySql()), "snapshot");
  report(`${JSON.stringify(snapshot, null, 2)}\n`);
  const planned = plannedFromReceipt(snapshot.last_receipt);
  if (planned) {
    const width = Math.max(...SEED_TABLES.map((table) => table.length)) + 2;
    report(
      `${["table".padEnd(width) + "planned".padStart(9) + "seed rows".padStart(11), ...SEED_TABLES.map((table) => `${table.padEnd(width)}${String(planned[table]).padStart(9)}${String(snapshot.owned?.[table]).padStart(11)}`)].join("\n")}\n`,
    );
  }
  const problems = checkSnapshot(snapshot, { planned, strict: args.strict });
  if (problems.length > 0) throw new Error(`Luna verification failed:\n- ${problems.join("\n- ")}`);
  report(
    `Luna verification passed (${snapshot.last_receipt?.event ?? "no receipt"}${args.strict ? ", strict" : ""}).\n`,
  );
  return snapshot;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
