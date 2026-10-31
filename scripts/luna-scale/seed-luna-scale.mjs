#!/usr/bin/env node
// MINT-82 (RC-07) — apply or tear down the Luna-scale synthetic org on
// staging. Runbook: scripts/luna-scale/README.md. Exactly one mode per run;
// there is no default, so a bare invocation never writes.
import { execFile, spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import process from "node:process";
import { promisify } from "node:util";
import {
  LUNA_FIXTURE_VERSION,
  LUNA_ORG_ID,
  LUNA_ORG_NAME,
  assertConfirmation,
  assertDatabaseIdentity,
  assertLunaTarget,
  assertMemberEmails,
  confirmationToken,
  isEntryPoint,
  parseAllowedRefs,
  maskConnection,
  psqlConnectionEnvironment,
} from "./luna-fixture.mjs";
import {
  LUNA_TABLES,
  buildLunaDataset,
  planCounts,
  summarizeDataset,
  validateLunaParams,
} from "./luna-dataset.mjs";
import {
  PRESERVED_ORG_TABLES,
  TEARDOWN_TABLES,
  buildApplySql,
  buildTeardownSql,
} from "./luna-sql.mjs";

const USAGE = `Usage:
  node scripts/luna-scale/seed-luna-scale.mjs --dry-run [--teardown] [count flags]
  node scripts/luna-scale/seed-luna-scale.mjs --emit-sql <file> [count flags]
  node scripts/luna-scale/seed-luna-scale.mjs --apply --confirm "SEED LUNA SCALE ON <ref>"
      [--member-email <email> ...] [--member-role admin|specialist|billing]
      [--allow-multi-org-member] [count flags]
  node scripts/luna-scale/seed-luna-scale.mjs --teardown --confirm "TEAR DOWN LUNA SCALE ON <ref>" [--allow-unowned]
Count flags: --providers N --groups N --locations N --states N --payers N --seed TEXT --anchor-date YYYY-MM-DD
Target env: SUPABASE_URL, LUNA_DATABASE_URL, LUNA_SCALE_ALLOWED_PROJECT_REFS
  (+ LUNA_SCALE_EXPECTED_DATABASE_IDENTITY for any allowlisted project other than pinned staging)
Local rehearsal against loopback Supabase only: add --local-rehearsal (token "... ON local").`;

const COUNT_FLAGS = new Set(["providers", "groups", "locations", "states", "payers"]);

export function parseArgs(argv) {
  const args = {
    modes: [],
    params: {},
    confirm: null,
    memberEmails: [],
    memberRole: "admin",
    allowUnowned: false,
    allowMultiOrgMember: false,
    localRehearsal: false,
    anchorDate: null,
    emitPath: null,
  };
  const value = (index, flag) => {
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value`);
    return next;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const name = flag.replace(/^--/, "");
    if (flag === "--dry-run") args.modes.push("dry-run");
    else if (flag === "--apply") args.modes.push("apply");
    else if (flag === "--teardown") args.modes.push("teardown");
    else if (flag === "--emit-sql") {
      args.modes.push("emit-sql");
      args.emitPath = value(index, flag);
      index += 1;
    } else if (flag === "--confirm") {
      args.confirm = value(index, flag);
      index += 1;
    } else if (flag === "--member-email") {
      args.memberEmails.push(value(index, flag));
      index += 1;
    } else if (flag === "--member-role") {
      args.memberRole = value(index, flag);
      index += 1;
    } else if (flag === "--anchor-date") {
      args.anchorDate = value(index, flag);
      index += 1;
    } else if (flag === "--seed") {
      args.params.seed = value(index, flag);
      index += 1;
    } else if (flag.startsWith("--") && COUNT_FLAGS.has(name)) {
      const raw = value(index, flag);
      if (!/^\d+$/.test(raw)) throw new Error(`${flag} must be a whole number`);
      args.params[name] = Number(raw);
      index += 1;
    } else if (flag === "--allow-unowned") args.allowUnowned = true;
    else if (flag === "--allow-multi-org-member") args.allowMultiOrgMember = true;
    else if (flag === "--local-rehearsal") args.localRehearsal = true;
    else if (flag === "--help" || flag === "-h") args.modes.push("help");
    else throw new Error(`Unknown argument: ${flag}\n${USAGE}`);
  }
  // --dry-run --teardown previews the teardown; every other mode stands alone.
  const modes = new Set(args.modes);
  if (modes.has("help")) args.mode = "help";
  else if (modes.size === 2 && modes.has("dry-run") && modes.has("teardown"))
    args.mode = "dry-run-teardown";
  else if (modes.size === 1 && args.modes.length === 1) args.mode = args.modes[0];
  else
    throw new Error(`Choose exactly one of --dry-run, --emit-sql, --apply, --teardown\n${USAGE}`);
  if (args.mode !== "apply" && args.mode !== "dry-run" && args.memberEmails.length > 0) {
    throw new Error("--member-email only applies to --apply (or its --dry-run)");
  }
  if (args.mode !== "apply" && args.mode !== "dry-run" && args.allowMultiOrgMember) {
    throw new Error("--allow-multi-org-member only applies to --apply (or its --dry-run)");
  }
  if (args.mode !== "teardown" && args.allowUnowned) {
    throw new Error("--allow-unowned only applies to --teardown");
  }
  return args;
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

const n = (value) => value.toLocaleString("en-US");

export function formatPlan(dataset, { target, members, sqlBytes }) {
  const counts = planCounts(dataset);
  const summary = summarizeDataset(dataset);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const width = Math.max(...LUNA_TABLES.map((table) => table.length)) + 2;
  const lines = [
    `Luna-scale synthetic org: DRY RUN (no connection; nothing written)`,
    `  fixture ${LUNA_FIXTURE_VERSION} · seed ${dataset.params.seed} · anchor ${dataset.anchorDate} · params sha256 ${dataset.paramsSha256.slice(0, 16)}…`,
    `  org "${LUNA_ORG_NAME}" ${LUNA_ORG_ID}`,
    `  params: ${dataset.params.providers} providers · ${dataset.params.groups} groups · ${dataset.params.locations} locations · ${dataset.params.states} states · ${dataset.params.payers} payers`,
    `  target: ${target}`,
    "",
    "Planned rows per table (apply order):",
    ...LUNA_TABLES.map((table) => `  ${table.padEnd(width)}${n(counts[table]).padStart(8)}`),
    `  ${"memberships".padEnd(width)}${n(members.length).padStart(8)}  (from --member-email)`,
    `  ${"audit_log".padEnd(width)}${n(1).padStart(8)}  (one receipt)`,
    `  ${"total".padEnd(width)}${n(total + members.length + 1).padStart(8)}`,
    `  The organization insert trigger also creates 3 roster_templates rows (append-only).`,
    `  SQL: ${(sqlBytes / 1_048_576).toFixed(1)} MiB in one transaction.`,
    "",
    "Provider Onboarding funnel:",
    `  profile incomplete ${n(summary.funnel.profile_incomplete)} (no NPI ${summary.scenarios.missing_npi ?? 0}, no CAQH ID ${summary.scenarios.missing_caqh ?? 0}, no DOB ${summary.scenarios.missing_dob ?? 0}, no SSN last 4 ${summary.scenarios.missing_ssn_last4 ?? 0}, no license ${summary.scenarios.no_license ?? 0}, no working-state license ${summary.scenarios.missing_work_state_license ?? 0})`,
    `  submitted ${n(summary.funnel.submitted)} (unverified license ${summary.scenarios.license_unverified ?? 0}, expired license ${summary.scenarios.license_expired ?? 0}, CAQH > 120 days ${summary.scenarios.caqh_stale ?? 0}, pending verification ${summary.scenarios.pending_verification ?? 0})`,
    `  ready for credentialing ${n(summary.funnel.ready_for_credentialing)} · credentialing ${n(summary.funnel.credentialing)} · terminated (not counted) ${n(summary.funnel.terminated_excluded)}`,
    "",
    "Cases by status:",
    `  ${Object.entries(summary.caseStatus)
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => `${status} ${n(count)}`)
      .join(" · ")}`,
    `  approved: effective ${n(summary.approvedEffective)} · awaiting effective date ${n(summary.approvedAwaitingEffective)}`,
    "",
    "Billing Readiness change feed sources (approval transitions · terminations · license expirations):",
    ...Object.entries(summary.feed).map(
      ([label, feed]) =>
        `  last ${label.padEnd(4)} ${n(feed.approvals)} · ${n(feed.terminations)} · ${n(feed.licenseExpirations)}`,
    ),
    "  (No location-link events: case_facilities.created_by references auth.users, so the seed leaves it null.)",
    "",
    `Follow-ups on open cases: overdue ${n(summary.followUps.overdue)} · due today ${n(summary.followUps.dueToday)} · upcoming ${n(summary.followUps.upcoming)}`,
    `States with a location: ${summary.states}`,
  ];
  return `${lines.join("\n")}\n`;
}

export function formatTeardownPlan(dataset, target) {
  const counts = planCounts(dataset);
  return `${[
    "Luna-scale teardown: DRY RUN (no connection; nothing written)",
    `  target: ${target}`,
    `  Deletes only rows in org ${LUNA_ORG_ID} whose id is seed-owned, in this order:`,
    ...TEARDOWN_TABLES.map(
      (table) =>
        `    ${table.padEnd(32)}${table === "memberships" ? "seed-added members" : `${n(counts[table])} if applied with these params`}`,
    ),
    "  Then sets the organization inactive. It is never deleted: the roster ledger",
    `  (${PRESERVED_ORG_TABLES.filter((t) => t.startsWith("roster")).join(", ")}) is append-only and audit_log is never deleted.`,
    "  Refuses, always, when any row the seed did not create references a seed row through a",
    "  foreign key (cascade, set null, set default or blocking), in any schema.",
    "  Refuses when the org holds other rows the seed did not create, unless --allow-unowned.",
  ].join("\n")}\n`;
}

function describeTarget(environment, allowLocal, action) {
  if (!environment.SUPABASE_URL || !environment.LUNA_DATABASE_URL) {
    return "not checked (SUPABASE_URL / LUNA_DATABASE_URL unset)";
  }
  try {
    const target = assertLunaTarget({
      supabaseUrl: environment.SUPABASE_URL,
      databaseUrl: environment.LUNA_DATABASE_URL,
      allowedRefs: parseAllowedRefs(environment.LUNA_SCALE_ALLOWED_PROJECT_REFS),
      allowLocal,
    });
    return `${target.kind} ${target.projectRef} (would need --confirm "${confirmationToken(action, target)}")`;
  } catch (error) {
    return `REFUSED: ${error.message}`;
  }
}

async function readDatabaseIdentity(executeIdentity, databaseUrl, environment) {
  // The validated parts travel as PG* variables; psql never sees the URL.
  const env = psqlConnectionEnvironment(databaseUrl, environment);
  const { stdout } = await executeIdentity(
    "psql",
    [
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "SELECT system_identifier::text FROM pg_control_system()",
    ],
    { env, timeout: 15000 },
  ).catch((error) => {
    // psql's own message, with the password masked in case it echoes one.
    const detail = maskConnection(error?.stderr, databaseUrl).trim();
    throw new Error(
      `Luna database identity preflight failed; nothing was written${detail ? `: ${detail}` : ""}`,
    );
  });
  return String(stdout).trim();
}

export async function runPsql(databaseUrl, sql, variables, environment) {
  const args = ["-X", "-q", "-v", "ON_ERROR_STOP=1"];
  for (const [key, value] of Object.entries(variables)) args.push("-v", `${key}=${value}`);
  args.push("-f", "-");
  const env = psqlConnectionEnvironment(databaseUrl, environment);
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const child = spawn("psql", args, { stdio: ["pipe", "inherit", "inherit"], env });
    child.once("error", () => finish(new Error("psql could not start; nothing was written")));
    child.once("exit", (code) =>
      finish(code === 0 ? null : new Error(`psql exited ${code}; the transaction rolled back`)),
    );
    // psql stops reading at the first error (ON_ERROR_STOP), so the rest of a
    // 16 MiB script hits a closed pipe. That EPIPE is the rollback, reported by
    // the exit handler above, not a crash.
    child.stdin.on("error", (error) => {
      if (error?.code !== "EPIPE") {
        finish(new Error("psql's input closed unexpectedly; the transaction rolled back"));
      }
    });
    child.stdin.end(sql);
  });
}

// Injected dependencies are in-process test seams; the CLI uses real ones.
export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  const executeIdentity = dependencies.executeIdentity ?? promisify(execFile);
  const runSql =
    dependencies.runSql ?? ((url, sql, variables) => runPsql(url, sql, variables, environment));
  const writeOutput = dependencies.writeFile ?? writeFile;
  const report = dependencies.report ?? ((message) => process.stdout.write(message));
  const today = dependencies.today ?? utcToday;

  const args = parseArgs(argv);
  if (args.mode === "help") {
    report(`${USAGE}\n`);
    return { mode: "help" };
  }
  const params = validateLunaParams(args.params);
  const anchorDate = args.anchorDate ?? today();
  const dataset = buildLunaDataset(params, { anchorDate });

  if (args.mode === "dry-run" || args.mode === "dry-run-teardown") {
    const members = assertMemberEmails(args.memberEmails, args.memberRole, environment);
    const target = describeTarget(
      environment,
      args.localRehearsal,
      args.mode === "dry-run-teardown" ? "teardown" : "apply",
    );
    if (args.mode === "dry-run-teardown") {
      report(formatTeardownPlan(dataset, target));
    } else {
      const sql = buildApplySql(dataset, {
        target: { kind: "review", projectRef: "REVIEW-ONLY" },
        members: members.map((email) => ({ email, role: args.memberRole })),
        allowMultiOrgMember: args.allowMultiOrgMember,
      });
      report(formatPlan(dataset, { target, members, sqlBytes: Buffer.byteLength(sql) }));
    }
    return { mode: args.mode, counts: planCounts(dataset) };
  }

  if (args.mode === "emit-sql") {
    // A review copy: its preamble raises unconditionally, so it never runs.
    const target = { kind: "review", projectRef: "REVIEW-ONLY" };
    const sql = `${buildApplySql(dataset, { target })}\n${buildTeardownSql({ target })}`;
    await writeOutput(args.emitPath, sql, { mode: 0o600 });
    report(`Wrote a review-only copy of the apply and teardown SQL to ${args.emitPath}\n`);
    return { mode: "emit-sql", counts: planCounts(dataset) };
  }

  // --apply / --teardown: every guard before any connection.
  const target = assertLunaTarget({
    supabaseUrl: environment.SUPABASE_URL,
    databaseUrl: environment.LUNA_DATABASE_URL,
    allowedRefs: parseAllowedRefs(environment.LUNA_SCALE_ALLOWED_PROJECT_REFS),
    allowLocal: args.localRehearsal,
  });
  assertConfirmation(args.mode, target, args.confirm);
  const members =
    args.mode === "apply"
      ? assertMemberEmails(args.memberEmails, args.memberRole, environment).map((email) => ({
          email,
          role: args.memberRole,
        }))
      : [];
  const identity = assertDatabaseIdentity(
    target,
    await readDatabaseIdentity(executeIdentity, environment.LUNA_DATABASE_URL, environment),
    environment.LUNA_SCALE_EXPECTED_DATABASE_IDENTITY,
  );
  const sql =
    args.mode === "apply"
      ? buildApplySql(dataset, { target, members, allowMultiOrgMember: args.allowMultiOrgMember })
      : buildTeardownSql({ target, allowUnowned: args.allowUnowned });
  await runSql(environment.LUNA_DATABASE_URL, sql, {
    expected_database_identity: identity,
    confirm_token: args.confirm,
  });
  report(
    args.mode === "apply"
      ? `Luna-scale org ${LUNA_ORG_ID} applied on ${target.kind} ${target.projectRef} (anchor ${anchorDate}, ${members.length} member(s) added). Verify with npm run verify:luna-scale.\n`
      : `Luna-scale teardown committed on ${target.kind} ${target.projectRef}.\n`,
  );
  return { mode: args.mode, target, counts: planCounts(dataset) };
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
