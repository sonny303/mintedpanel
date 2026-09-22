#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  CONFIRMATION_TOKEN,
  FIXTURE_VERSION,
  OWNERSHIP_MARKER,
  assertSafeTarget,
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

function requiredEnv(name) {
  const value = process.env[name];
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
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth.admin;
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
      env: { ...process.env, PGPASSWORD: undefined },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`psql exited ${code}`)),
    );
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const databaseUrl = requiredEnv("UAT_DATABASE_URL");
  const target = assertSafeTarget({ supabaseUrl, databaseUrl });
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
  if (args.reset === "all" && args.confirm !== CONFIRMATION_TOKEN) {
    throw new Error(
      `Full reset owns organizations ${ids.organizations.join(", ")}. Re-run with --confirm \"${CONFIRMATION_TOKEN}\"`,
    );
  }
  const users = args.skipAuth
    ? Object.fromEntries(
        personas.map((persona) => [
          persona.key,
          requiredEnv(`UAT_${persona.key.toUpperCase()}_USER_ID`),
        ]),
      )
    : await provisionPersonas(
        supabaseUrl,
        requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
        requiredEnv("UAT_SHARED_PASSWORD"),
        args.reset !== "deletion-pool",
      );
  await runPsql(databaseUrl, {
    reset_mode: args.reset ?? "none",
    fixture_version: FIXTURE_VERSION,
    deletion_case_ids: manifest.ownership.deletionCases.join(","),
    ...Object.fromEntries(Object.entries(users).map(([key, value]) => [`user_${key}`, value])),
  });
  process.stdout.write(
    `UAT fixture ${FIXTURE_VERSION} ready on ${target}; password and credentials were not printed.\n`,
  );
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
