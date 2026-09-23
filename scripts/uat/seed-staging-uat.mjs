#!/usr/bin/env node
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  FIXTURE_VERSION,
  OWNERSHIP_MARKER,
  assertSafeTarget,
  assertSeedOptions,
  psqlEnvironment,
  hasExactOwnershipMarker,
  ids,
  personas,
} from "./uat-fixture.mjs";

function parseArgs(argv) {
  const args = { reset: null, confirm: null, skipAuth: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--reset") args.reset = argv[++i];
    else if (argv[i] === "--confirm") args.confirm = argv[++i];
    else if (argv[i] === "--skip-auth") args.skipAuth = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (args.reset && !["deletion-pool", "all"].includes(args.reset))
    throw new Error("--reset must be deletion-pool or all");
  return args;
}

function requiredEnv(name, environment = process.env) {
  const value = environment[name];
  if (!value) throw new Error(`Missing protected environment variable ${name}`);
  return value;
}

async function findUserByEmail(admin, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 100) return null;
  }
  throw new Error("Auth user scan exceeded safety pagination limit");
}

async function provisionPersonas(supabaseUrl, serviceRoleKey, password, updatePassword) {
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth.admin;
  return ensurePersonas(admin, password, updatePassword);
}

export async function ensurePersonas(admin, password, updatePassword = false) {
  const users = {};
  for (const persona of personas) {
    let user = await findUserByEmail(admin, persona.email);
    if (user && !hasExactOwnershipMarker(user))
      throw new Error(
        `Refusing same-email Auth user without exact ownership marker: ${persona.email}`,
      );
    if (!user) {
      const { data, error } = await admin.createUser({
        email: persona.email,
        password,
        email_confirm: true,
        user_metadata: { ...OWNERSHIP_MARKER, full_name: persona.name },
      });
      if (error) throw error;
      user = data.user;
    } else if (updatePassword) {
      const { data, error } = await admin.updateUserById(user.id, {
        password,
        email_confirm: true,
      });
      if (error) throw error;
      user = data.user;
    }
    users[persona.key] = user.id;
  }
  return users;
}

async function runPsql(databaseUrl, variables) {
  const sqlPath = new URL("../../supabase/seed-uat.sql", import.meta.url).pathname;
  const args = [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1"];
  for (const [key, value] of Object.entries(variables)) args.push("-v", `${key}=${value}`);
  args.push("-f", sqlPath);
  await new Promise((resolve, reject) => {
    const child = spawn("psql", args, {
      stdio: "inherit",
      env: psqlEnvironment(),
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`psql exited ${code}`)),
    );
  });
}

// Injected dependencies are in-process test seams; the CLI always uses real operations.
export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  const executeIdentity = dependencies.executeIdentity ?? promisify(execFile);
  const provision = dependencies.provision ?? provisionPersonas;
  const seed = dependencies.seed ?? runPsql;
  const report = dependencies.report ?? ((message) => process.stdout.write(message));
  const args = parseArgs(argv);
  const supabaseUrl = requiredEnv("SUPABASE_URL", environment);
  const databaseUrl = requiredEnv("UAT_DATABASE_URL", environment);
  const target = assertSafeTarget({ supabaseUrl, databaseUrl });
  assertSeedOptions(target, args);
  // Observe the actual database before creating any Auth personas. The hosted
  // identity was read from the fixed staging project, never from production data.
  const { stdout } = await executeIdentity(
    "psql",
    [
      databaseUrl,
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "SELECT system_identifier::text FROM pg_control_system()",
    ],
    { env: psqlEnvironment(environment), timeout: 15000 },
  ).catch(() => {
    // execFile errors can contain the credential-bearing connection argument.
    throw new Error("UAT database identity preflight failed; no Auth users were changed");
  });
  const databaseIdentity = stdout.trim();
  if (
    !/^\d+$/.test(databaseIdentity) ||
    databaseIdentity === "7642734024280108049" ||
    (target === "staging" && databaseIdentity !== "7662742571317219726")
  ) {
    throw new Error("UAT database identity mismatch; re-audit the staging target before seeding");
  }
  const manifest = JSON.parse(
    await readFile(new URL("./uat-fixture-manifest.json", import.meta.url), "utf8"),
  );
  if (
    manifest.version !== FIXTURE_VERSION ||
    JSON.stringify(manifest.ownership.organizations) !== JSON.stringify(ids.organizations) ||
    JSON.stringify(manifest.ownership.deletionCases) !== JSON.stringify(ids.deletionCases)
  ) {
    throw new Error("Fixture manifest does not match deterministic fixture definitions");
  }
  const users = args.skipAuth
    ? Object.fromEntries(
        personas.map((persona) => [
          persona.key,
          requiredEnv(`UAT_${persona.key.toUpperCase()}_USER_ID`, environment),
        ]),
      )
    : await provision(
        supabaseUrl,
        requiredEnv("SUPABASE_SERVICE_ROLE_KEY", environment),
        requiredEnv("UAT_SHARED_PASSWORD", environment),
        args.reset === "all",
      );
  await seed(databaseUrl, {
    expected_database_identity: databaseIdentity,
    reset_mode: args.reset ?? "none",
    fixture_version: FIXTURE_VERSION,
    deletion_case_ids: manifest.ownership.deletionCases.join(","),
    ...Object.fromEntries(Object.entries(users).map(([key, value]) => [`user_${key}`, value])),
  });
  report(
    `UAT fixture ${FIXTURE_VERSION} ready on ${target}; password and credentials were not printed.\n`,
  );
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
