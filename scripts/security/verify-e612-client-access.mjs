// E6.12 native authorization evidence.
//
// This verifier is deliberately SQL-only. It creates one uniquely named,
// networkless PostgreSQL container, applies the complete migration chain, and
// runs real role/RLS/function/concurrency checks. It is not Auth, PostgREST,
// Storage, or application HTTP evidence; those boundaries live in the paired
// verify-e612-client-access-http.mjs verifier.
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  E612,
  USERS,
  asRole,
  baseFixtureSql,
  restrictedFixtureSql,
  sqlLiteral,
  tokenHash,
  TOKENS,
  claims,
} from "./e612-fixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const context = process.env.E612_DOCKER_CONTEXT || "default";
const image = process.env.E612_POSTGRES_IMAGE || "postgres:16";
const container = `minted-e612-native-${randomUUID()}`;
const e612Migration = "20260925035408_e612_client_access_context.sql";
const env = Object.fromEntries(
  ["PATH", "HOME", "DOCKER_CONFIG", "LANG"].flatMap((name) =>
    process.env[name] ? [[name, process.env[name]]] : [],
  ),
);
const options = {
  env,
  encoding: "utf8",
  timeout: 120_000,
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["pipe", "pipe", "pipe"],
};
const emit = (line) => process.stdout.write(`${line}\n`);
const fail = (code) => {
  throw new Error(code);
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const inspect = JSON.parse(
  execFileSync("docker", ["--context", context, "context", "inspect", context], options),
)[0];
const endpoint = inspect?.Endpoints?.docker?.Host;
if (typeof endpoint !== "string" || !endpoint.startsWith("unix://"))
  fail("E612_LOCAL_DOCKER_REQUIRED");

const docker = (args, input) => {
  try {
    return execFileSync("docker", ["--context", context, ...args], {
      ...options,
      input,
    });
  } catch (error) {
    const state = String(error.stderr ?? "").match(/(?:ERROR|SQLSTATE)[: ]+([A-Z0-9]{5})/)?.[1];
    if (state) emit(`E612|SQLSTATE|${state}`);
    fail("E612_CONTAINER_COMMAND_FAILED");
  }
};

const psqlArgs = [
  "exec",
  "-i",
  container,
  "psql",
  "-X",
  "-qAt",
  "-h",
  "/tmp",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-v",
  "ON_ERROR_STOP=1",
  "-v",
  "VERBOSITY=verbose",
];
const psqlAs = (role) =>
  psqlArgs.map((arg, index) => (index === psqlArgs.indexOf("postgres") ? role : arg));
const sql = (input) => docker(psqlArgs, input);
const adminSql = (input) => docker(psqlAs("e612_native_superuser"), input);

function migrations() {
  const files = readdirSync(`${root}supabase/migrations`)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (!files.includes(e612Migration)) fail("E612_MIGRATION_MISSING");
  const source = readFileSync(`${root}supabase/migrations/${e612Migration}`, "utf8");
  if (!source.trim()) fail("E612_MIGRATION_EMPTY");
  return files;
}

const bootstrap = `
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  deleted_at timestamptz,
  is_anonymous boolean NOT NULL DEFAULT false,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), current_user::text)
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'sub', NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    'role', NULLIF(current_setting('request.jwt.claim.role', true), ''),
    'email', NULLIF(current_setting('request.jwt.claim.email', true), '')
  )
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;
`;

function authFixtureSql() {
  return `
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
VALUES ${USERS.map(([id, email]) => `('${id}', ${sqlLiteral(email)}, now(), '{}'::jsonb, '{}'::jsonb)`).join(",\n")}
ON CONFLICT (id) DO NOTHING;
`;
}

function runMigrations(files) {
  const restrictedIndex = files.indexOf(e612Migration);
  const beforeRestricted = restrictedIndex === -1 ? files : files.slice(0, restrictedIndex);
  const afterRestricted = restrictedIndex === -1 ? [] : files.slice(restrictedIndex + 1);
  for (const name of beforeRestricted) {
    try {
      sql(readFileSync(`${root}supabase/migrations/${name}`, "utf8"));
    } catch {
      fail(`E612_MIGRATION_FAILED_${name.replaceAll(/[^A-Za-z0-9]+/g, "_")}`);
    }
  }
  if (restrictedIndex !== -1) {
    // Supabase's hosted migration executor is a restricted CREATEROLE role,
    // not a superuser. Reassign the disposable baseline to the same kind of
    // executor before applying E6.12. The inherited membership preserves
    // disposable baseline ownership while keeping the executor itself
    // non-superuser and unable to SET ROLE into the helper owner by default.
    adminSql(`
      CREATE ROLE e612_restricted_migrator LOGIN CREATEROLE NOSUPERUSER BYPASSRLS;
      GRANT postgres TO e612_restricted_migrator WITH INHERIT TRUE, SET FALSE;
    `);
    try {
      const source = readFileSync(`${root}supabase/migrations/${e612Migration}`, "utf8");
      try {
        docker(psqlAs("e612_restricted_migrator"), source);
      } catch {
        fail(`E612_MIGRATION_FAILED_${e612Migration.replaceAll(/[^A-Za-z0-9]+/g, "_")}`);
      }
      restrictedMigrationChecks();
    } finally {
      adminSql(`
        REASSIGN OWNED BY e612_restricted_migrator TO postgres;
        DROP OWNED BY e612_restricted_migrator;
        REVOKE postgres FROM e612_restricted_migrator;
        DROP ROLE e612_restricted_migrator;
      `);
    }
  }
  for (const name of afterRestricted) {
    try {
      sql(readFileSync(`${root}supabase/migrations/${name}`, "utf8"));
    } catch {
      fail(`E612_MIGRATION_FAILED_${name.replaceAll(/[^A-Za-z0-9]+/g, "_")}`);
    }
  }
}

function restrictedMigrationChecks() {
  const helper = query(`
    SELECT pg_get_userbyid(p.proowner) || '|' ||
           has_function_privilege('public', p.oid, 'EXECUTE') || '|' ||
           has_function_privilege('anon', p.oid, 'EXECUTE') || '|' ||
           has_function_privilege('authenticated', p.oid, 'EXECUTE') || '|' ||
           has_function_privilege('service_role', p.oid, 'EXECUTE')
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_authz' AND p.proname = 'is_restricted_external';
  `);
  assertEqual(
    "restricted_migrator.helper_owner_acl",
    helper,
    "minted_e612_authz_owner|false|false|true|true",
  );

  const capabilities = query(`
    SELECT has_schema_privilege('minted_e612_authz_owner', 'app_authz', 'CREATE') || '|' ||
           pg_has_role('e612_restricted_migrator', 'minted_e612_authz_owner', 'SET') || '|' ||
           pg_has_role('e612_restricted_migrator', 'minted_e612_authz_owner', 'USAGE');
  `);
  assertEqual(
    "restricted_migrator.temporary_capabilities_removed",
    capabilities,
    "false|false|false",
  );

  const membership = query(`
    SELECT count(*) FILTER (
             WHERE m.grantor = 'e612_restricted_migrator'::regrole
           )::text || '|' ||
           count(*) FILTER (
             WHERE m.admin_option AND NOT m.inherit_option AND NOT m.set_option
           )::text || '|' || count(*)::text
      FROM pg_auth_members m
     WHERE m.roleid = 'minted_e612_authz_owner'::regrole
       AND m.member = 'e612_restricted_migrator'::regrole;
  `);
  if (!/^0\|[1-9][0-9]*\|[1-9][0-9]*$/.test(membership))
    fail(`E612_RESTRICTED_MIGRATOR_MEMBERSHIP_DRIFT_${membership.replaceAll("|", "_")}`);
  emit("E612|PASS|restricted_migrator.final_owner_acl_membership");
}

function expectedDeny(label, statement) {
  try {
    sql(statement);
  } catch {
    emit(`E612|PASS|${label}`);
    return;
  }
  fail(`E612_EXPECTED_DENIAL_MISSING_${label}`);
}

function expectedSqlError(label, statement, codes, message) {
  const args = message ? [...psqlArgs.slice(0, -2), "-v", "VERBOSITY=verbose"] : psqlArgs;
  let result;
  try {
    result = {
      ok: true,
      stdout: execFileSync("docker", ["--context", context, ...args], {
        ...options,
        input: statement,
      }),
    };
  } catch (error) {
    result = { ok: false, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") };
  }
  const safeLabel = label.replaceAll(/[^A-Za-z0-9]+/g, "_").toUpperCase();
  if (result.ok) fail(`E612_EXPECTED_SQL_ERROR_MISSING_${safeLabel}`);
  const output = `${result.stdout}\n${result.stderr}`;
  const state = output.match(/(?:ERROR|SQLSTATE)[: ]+([A-Z0-9]{5})/)?.[1];
  if (!state || !codes.includes(state))
    fail(`E612_SQLSTATE_MISMATCH_${safeLabel}_${state ?? "MISSING"}`);
  if (message && !output.includes(message)) fail(`E612_SQL_ERROR_MESSAGE_MISMATCH_${safeLabel}`);
  emit(`E612|PASS|${label}`);
}

function expectedServiceError(label, statement, message) {
  const args = message ? [...psqlArgs.slice(0, -2), "-v", "VERBOSITY=verbose"] : psqlArgs;
  let result;
  try {
    result = {
      ok: true,
      stdout: execFileSync("docker", ["--context", context, ...args], {
        ...options,
        input: statement,
      }),
    };
  } catch (error) {
    result = { ok: false, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") };
  }
  const safeLabel = label.replaceAll(/[^A-Za-z0-9]+/g, "_").toUpperCase();
  if (result.ok) fail(`E612_EXPECTED_SERVICE_ERROR_MISSING_${safeLabel}`);
  const output = `${result.stdout}\n${result.stderr}`;
  const state = output.match(/(?:ERROR|SQLSTATE|SQL state)[: ]+([A-Z0-9]{5})/i)?.[1]?.toUpperCase();
  if (state !== "P0001") fail(`E612_SERVICE_SQLSTATE_MISMATCH_${safeLabel}_${state ?? "MISSING"}`);
  if (message && !output.includes(message)) {
    fail(`E612_SERVICE_ERROR_MISMATCH_${safeLabel}`);
  }
  emit(`E612|PASS|${label}`);
}

function query(statement) {
  return sql(statement).trim();
}

function roleSqlResult(role, statement) {
  try {
    return {
      ok: true,
      stdout: execFileSync("docker", ["--context", context, ...psqlAs(role)], {
        ...options,
        input: statement,
      }),
      stderr: "",
    };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
    };
  }
}

function ownerHandoffProbeSql(injectFailure) {
  const source = readFileSync(`${root}supabase/migrations/${e612Migration}`, "utf8");
  const match = source.match(
    /DO \$\$\nDECLARE\n  v_executor_name name := current_user;[\s\S]*?\nEND\n\$\$;/,
  );
  if (!match) fail("E612_OWNER_HANDOFF_BLOCK_MISSING");
  let block = match[0]
    .replaceAll("minted_e612_authz_owner", "e612_probe_owner")
    .replaceAll("app_authz", "e612_owner_probe")
    .replaceAll("is_restricted_external", "helper");
  if (injectFailure) {
    block = block.replace(
      "EXECUTE 'ALTER FUNCTION e612_owner_probe.helper() OWNER TO e612_probe_owner';",
      "EXECUTE 'ALTER FUNCTION e612_owner_probe.helper() OWNER TO e612_probe_owner';\n  RAISE EXCEPTION 'e612_owner_handoff_injected_failure';",
    );
  }
  return `BEGIN;\n${block}\nCOMMIT;`;
}

function restrictedMigratorOwnershipRollbackCheck() {
  adminSql(`
    DROP SCHEMA IF EXISTS e612_owner_probe CASCADE;
    DROP ROLE IF EXISTS e612_probe_owner;
    DROP ROLE IF EXISTS e612_probe_migrator;
    CREATE ROLE e612_probe_migrator LOGIN CREATEROLE NOSUPERUSER BYPASSRLS;
    CREATE SCHEMA e612_owner_probe AUTHORIZATION e612_probe_migrator;
    REVOKE CREATE ON SCHEMA e612_owner_probe FROM PUBLIC;
  `);

  const setup = roleSqlResult(
    "e612_probe_migrator",
    `
      CREATE ROLE e612_probe_owner NOLOGIN NOBYPASSRLS;
      CREATE FUNCTION e612_owner_probe.helper()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = pg_catalog
      AS $$ SELECT true $$;
      REVOKE ALL ON FUNCTION e612_owner_probe.helper() FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION e612_owner_probe.helper() TO authenticated, service_role;
    `,
  );
  if (!setup.ok) fail("E612_RESTRICTED_MIGRATOR_PROBE_SETUP_FAILED");

  const rollback = roleSqlResult("e612_probe_migrator", ownerHandoffProbeSql(true));
  if (rollback.ok || !rollback.stderr.includes("e612_owner_handoff_injected_failure"))
    fail("E612_RESTRICTED_MIGRATOR_ROLLBACK_NOT_TRIGGERED");
  const rollbackState = query(`
    SELECT (SELECT pg_get_userbyid(p.proowner)
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'e612_owner_probe' AND p.proname = 'helper') || '|' ||
           has_schema_privilege('e612_probe_owner', 'e612_owner_probe', 'CREATE') || '|' ||
           pg_has_role('e612_probe_migrator', 'e612_probe_owner', 'SET') || '|' ||
           (SELECT count(*)::text
              FROM pg_auth_members m
             WHERE m.roleid = 'e612_probe_owner'::regrole
               AND m.member = 'e612_probe_migrator'::regrole
               AND m.grantor = 'e612_probe_migrator'::regrole);
  `);
  assertEqual(
    "restricted_migrator.rollback_state",
    rollbackState,
    "e612_probe_migrator|false|false|0",
  );
  emit("E612|PASS|restricted_migrator.rollback_restores_temp_privileges");

  const commit = roleSqlResult("e612_probe_migrator", ownerHandoffProbeSql(false));
  if (!commit.ok) fail("E612_RESTRICTED_MIGRATOR_COMMIT_FAILED");
  const committedState = query(`
    SELECT (SELECT pg_get_userbyid(p.proowner)
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'e612_owner_probe' AND p.proname = 'helper') || '|' ||
           has_schema_privilege('e612_probe_owner', 'e612_owner_probe', 'CREATE') || '|' ||
           pg_has_role('e612_probe_migrator', 'e612_probe_owner', 'SET') || '|' ||
           (SELECT count(*)::text
              FROM pg_auth_members m
             WHERE m.roleid = 'e612_probe_owner'::regrole
               AND m.member = 'e612_probe_migrator'::regrole
               AND m.grantor = 'e612_probe_migrator'::regrole) || '|' ||
           has_function_privilege('public', 'e612_owner_probe.helper()'::regprocedure, 'EXECUTE') || '|' ||
           has_function_privilege('anon', 'e612_owner_probe.helper()'::regprocedure, 'EXECUTE') || '|' ||
           has_function_privilege('authenticated', 'e612_owner_probe.helper()'::regprocedure, 'EXECUTE') || '|' ||
           has_function_privilege('service_role', 'e612_owner_probe.helper()'::regprocedure, 'EXECUTE');
  `);
  assertEqual(
    "restricted_migrator.committed_state",
    committedState,
    "e612_probe_owner|false|false|0|false|false|true|true",
  );
  emit("E612|PASS|restricted_migrator.commit_owner_acl");

  adminSql(`
    DROP SCHEMA e612_owner_probe CASCADE;
    DROP ROLE e612_probe_owner;
    DROP ROLE e612_probe_migrator;
  `);
}

function runSqlChild(input, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["--context", context, ...psqlArgs], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err, timedOut });
    });
    child.stdin.end(input);
  });
}

function spawnSqlSession(timeoutMs = 20_000) {
  const child = spawn("docker", ["--context", context, ...psqlArgs], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  let closed = false;
  let code = null;
  child.stdout.on("data", (chunk) => {
    out += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    err += String(chunk);
  });
  child.on("close", (exitCode) => {
    closed = true;
    code = exitCode;
  });
  const waitFor = async (marker) => {
    const deadline = Date.now() + timeoutMs;
    while (!out.includes(marker)) {
      if (closed) fail(`E612_RACE_SESSION_CLOSED_${marker.replaceAll(/[^A-Za-z0-9]+/g, "_")}`);
      if (Date.now() >= deadline) {
        child.kill("SIGKILL");
        fail(`E612_RACE_SESSION_MARKER_TIMEOUT_${marker.replaceAll(/[^A-Za-z0-9]+/g, "_")}`);
      }
      await pause(25);
    }
  };
  const result = async () => {
    const deadline = Date.now() + timeoutMs;
    while (!closed) {
      if (Date.now() >= deadline) {
        child.kill("SIGKILL");
        fail("E612_RACE_SESSION_RESULT_TIMEOUT");
      }
      await pause(25);
    }
    return { code, out, err, timedOut: false };
  };
  return {
    child,
    get out() {
      return out;
    },
    write(input) {
      child.stdin.write(input);
    },
    end() {
      child.stdin.end();
    },
    kill() {
      if (!closed) child.kill("SIGKILL");
    },
    waitFor,
    result,
  };
}

function jsonQuery(statement, label) {
  const raw = query(statement);
  try {
    return JSON.parse(raw);
  } catch {
    fail(`E612_${label}_JSON_INVALID`);
  }
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) fail(`E612_${label}_EXPECTED_${String(expected)}_GOT_${String(actual)}`);
}

function requireContains(label, text, pattern) {
  if (!pattern.test(text)) fail(`E612_${label}`);
}

function inventory() {
  const tables = query(`
    SELECT n.nspname || '.' || c.relname || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity || '|' ||
           has_table_privilege('anon', c.oid, 'SELECT') || '|' ||
           has_table_privilege('authenticated', c.oid, 'SELECT')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'private' AND c.relkind = 'r'
    ORDER BY c.relname;
  `);
  for (const required of [
    "private.internal_staff",
    "private.client_access",
    "private.client_group_grants",
    "private.client_invites",
    "private.client_invite_group_grants",
    "private.client_identity_classifications",
  ]) {
    const line = tables.split("\n").find((row) => row.startsWith(`${required}|`));
    if (!line) fail(`E612_PRIVATE_TABLE_MISSING_${required.replaceAll(".", "_")}`);
    const [, rls, forceRls, anonSelect, authSelect] = line.split("|");
    if (rls !== "true" || forceRls !== "true" || anonSelect !== "false" || authSelect !== "false")
      fail(`E612_PRIVATE_ACL_OR_RLS_${required.replaceAll(".", "_")}`);
    emit(`E612|PASS|private.${required.split(".")[1]}.acl_rls`);
  }
  const browserPrivateWrites = query(`
    SELECT c.relname || '|' ||
           has_table_privilege('anon', c.oid, 'INSERT') || '|' ||
           has_table_privilege('anon', c.oid, 'UPDATE') || '|' ||
           has_table_privilege('anon', c.oid, 'DELETE') || '|' ||
           has_table_privilege('authenticated', c.oid, 'INSERT') || '|' ||
           has_table_privilege('authenticated', c.oid, 'UPDATE') || '|' ||
           has_table_privilege('authenticated', c.oid, 'DELETE')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'private' AND c.relkind = 'r'
     ORDER BY c.relname;
  `);
  for (const row of browserPrivateWrites.split("\n").filter(Boolean)) {
    if (!row.endsWith("|false|false|false|false|false|false"))
      fail(`E612_PRIVATE_BROWSER_WRITE_GRANT_DRIFT_${row.replaceAll("|", "_")}`);
  }
  emit("E612|PASS|private.browser_write_floor");
  const functions = query(`
    SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' ||
           '|security_definer=' || p.prosecdef || '|owner=' || r.rolname ||
           '|public_exec=' || has_function_privilege('public', p.oid, 'EXECUTE') ||
           '|anon_exec=' || has_function_privilege('anon', p.oid, 'EXECUTE') ||
           '|auth_exec=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.proname ILIKE '%client%' OR p.proname IN ('claim_invites', 'create_organization')
    ORDER BY 1;
  `);
  requireContains("FUNCTION_INVENTORY_EMPTY", functions, /claim_invites/);
  emit(`E612|INVENTORY|functions=${functions.split("\n").filter(Boolean).length}`);
  const policies = query(`
    SELECT schemaname || '.' || tablename || '|' || policyname || '|' || COALESCE(roles::text, '{}')
    FROM pg_policies
    WHERE schemaname IN ('private', 'public')
      AND (tablename ILIKE '%client%' OR tablename IN ('inbound_leads','payer_catalog_changes'))
    ORDER BY 1;
  `);
  if (!policies) fail("E612_POLICY_INVENTORY_EMPTY");
  emit(`E612|INVENTORY|policies=${policies.split("\n").filter(Boolean).length}`);

  const privateGrants = query(`
    SELECT c.relname || '|' || has_table_privilege('minted_e612_authz_owner', c.oid, 'SELECT') || '|' ||
           has_table_privilege('minted_e612_authz_owner', c.oid, 'INSERT') || '|' ||
           has_table_privilege('minted_e612_authz_owner', c.oid, 'UPDATE') || '|' ||
           has_table_privilege('minted_e612_authz_owner', c.oid, 'DELETE')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'private' AND c.relkind = 'r'
     ORDER BY c.relname;
  `);
  const allowedOwnerReads = new Set(["client_identity_classifications", "internal_staff"]);
  for (const row of privateGrants.split("\n").filter(Boolean)) {
    const [name, select, insert, update, del] = row.split("|");
    const actual = `${select}|${insert}|${update}|${del}`;
    const expected = allowedOwnerReads.has(name)
      ? "true|false|false|false"
      : "false|false|false|false";
    if (actual !== expected) fail(`E612_PRIVATE_OWNER_GRANT_DRIFT_${name}`);
  }
  if (
    query(
      `SELECT has_schema_privilege('anon','private','USAGE') || '|' || has_schema_privilege('authenticated','private','USAGE');`,
    ) !== "false|false"
  ) {
    fail("E612_PRIVATE_SCHEMA_BROWSER_USAGE");
  }
  emit("E612|PASS|private.owner_read_floor");
}

function catalogChecks() {
  const normalizeSignature = (row) => row.replace(/\bp_[a-z0-9_]+ /g, "");
  const gatewayRows = query(`
    SELECT p.proname || '|' || pg_get_function_identity_arguments(p.oid) || '|' || p.prosecdef || '|' ||
           has_function_privilege('public', p.oid, 'EXECUTE') || '|' ||
           has_function_privilege('anon', p.oid, 'EXECUTE') || '|' ||
           has_function_privilege('authenticated', p.oid, 'EXECUTE') || '|' ||
           has_function_privilege('service_role', p.oid, 'EXECUTE')
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'resolve_enrollment_context', 'create_client_invite', 'claim_client_invite',
       'set_client_group_grants', 'revoke_client_access', 'set_internal_staff_manifest'
     )
     ORDER BY 1;
  `)
    .split("\n")
    .filter(Boolean)
    .map(normalizeSignature);
  const expectedGateways = new Set([
    "resolve_enrollment_context|uuid, text, uuid|false|false|false|false|true",
    "create_client_invite|uuid, uuid, text, uuid[]|false|false|false|false|true",
    "claim_client_invite|uuid, text|false|false|false|false|true",
    "set_client_group_grants|uuid, uuid, uuid[]|false|false|false|false|true",
    "revoke_client_access|uuid, uuid|false|false|false|false|true",
    "set_internal_staff_manifest|uuid, uuid, uuid, text, boolean, text|false|false|false|false|true",
  ]);
  if (
    gatewayRows.length !== expectedGateways.size ||
    gatewayRows.some((row) => !expectedGateways.has(row))
  ) {
    fail(`E612_GATEWAY_PRIVILEGE_DRIFT_${gatewayRows.join(";")}`);
  }
  const browserGatewayRows = gatewayRows.filter(
    (row) => !row.startsWith("set_internal_staff_manifest|"),
  );
  if (browserGatewayRows.length !== 5)
    fail(`E612_BROWSER_GATEWAY_COUNT_${browserGatewayRows.length}`);
  const actorArguments = query(`
    SELECT p.proname || '|' || pg_get_function_arguments(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'resolve_enrollment_context', 'create_client_invite', 'claim_client_invite',
       'set_client_group_grants', 'revoke_client_access'
     )
     ORDER BY 1;
  `)
    .split("\n")
    .filter(Boolean);
  if (
    actorArguments.length !== 5 ||
    actorArguments.some((row) => {
      const args = row.slice(row.indexOf("|") + 1);
      return (
        !args.startsWith("p_actor_user_id uuid") || /p_actor_user_id uuid\s+DEFAULT/i.test(args)
      );
    })
  ) {
    fail(`E612_GATEWAY_ACTOR_ARGUMENT_DRIFT_${actorArguments.join(";")}`);
  }
  emit("E612|PASS|gateway.service_only_invoker_acl");

  const signatures = query(`
    SELECT p.proname || '|' || pg_get_function_identity_arguments(p.oid) || '|' || pg_get_function_result(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'upsert_global_portal','set_global_portal_flags','author_global_sop',
       'publish_sop_template_version','propose_shared_field_map','train_global_field_map',
       'update_shared_field_registry','list_global_payers','create_organization'
     )
     ORDER BY 1;
  `)
    .split("\n")
    .filter(Boolean)
    .map(normalizeSignature)
    .join("\n");
  const expectedSignatures = new Set([
    "upsert_global_portal|uuid, text, text, uuid, text|portals",
    "set_global_portal_flags|uuid, boolean, boolean|portals",
    "author_global_sop|uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb|jsonb",
    "publish_sop_template_version|uuid, integer, text, jsonb, text, jsonb|jsonb",
    "propose_shared_field_map|text, text, text, text, text, text, integer, text, jsonb, text|portal_field_maps",
    "train_global_field_map|uuid, text, text, text, text, text, text|portal_field_maps",
    "update_shared_field_registry|jsonb|SETOF portal_field_maps",
    "list_global_payers||SETOF payers",
    "create_organization|text|uuid",
    "create_organization|text, text, text|uuid",
    "create_organization|text, text, text, jsonb, jsonb|uuid",
  ]);
  const actualSignatures = new Set(signatures.split("\n").filter(Boolean));
  if (
    actualSignatures.size !== expectedSignatures.size ||
    [...expectedSignatures].some((row) => !actualSignatures.has(row))
  )
    fail(`E612_FUNCTION_SIGNATURE_SET_DRIFT_${signatures.replaceAll("\n", ";")}`);
  if (
    signatures
      .split("\n")
      .some((row) => row.startsWith("author_global_sop|uuid, text, uuid, text|"))
  )
    fail("E612_RETIRED_AUTHOR_SOP_OVERLOAD_PRESENT");
  emit("E612|PASS|global_rpc_final_signatures");

  const globalAcl = query(`
    SELECT p.proname || '|' || pg_get_function_identity_arguments(p.oid) || '|' ||
           has_function_privilege('public', p.oid, 'EXECUTE') || '|' ||
           has_function_privilege('anon', p.oid, 'EXECUTE') || '|' ||
           has_function_privilege('authenticated', p.oid, 'EXECUTE') || '|' ||
           has_function_privilege('service_role', p.oid, 'EXECUTE')
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'upsert_global_portal','set_global_portal_flags','author_global_sop',
       'publish_sop_template_version','propose_shared_field_map','train_global_field_map',
       'update_shared_field_registry','list_global_payers'
     )
     ORDER BY 1;
  `)
    .split("\n")
    .filter(Boolean)
    .map(normalizeSignature);
  for (const row of globalAcl) {
    const expected = row.startsWith("list_global_payers|")
      ? "|false|false|true|false"
      : "|false|false|true|true";
    if (!row.endsWith(expected)) fail("E612_GLOBAL_RPC_AUTH_ACL_DRIFT");
  }
  const catalogAcl = query(`
    SELECT has_table_privilege('anon','public.payer_catalog_changes','SELECT') || '|' ||
           has_table_privilege('authenticated','public.payer_catalog_changes','SELECT') || '|' ||
           has_table_privilege('service_role','public.payer_catalog_changes','SELECT') || '|' ||
           has_function_privilege('anon','public.review_payer_catalog_change(uuid, boolean)','EXECUTE') || '|' ||
           has_function_privilege('authenticated','public.review_payer_catalog_change(uuid, boolean)','EXECUTE') || '|' ||
           has_function_privilege('service_role','public.review_payer_catalog_change(uuid, boolean)','EXECUTE');
  `);
  if (catalogAcl !== "false|false|true|false|false|true") fail("E612_PLATFORM_CATALOG_ACL_DRIFT");
  emit("E612|PASS|catalog.platform_only_acl");
}

function helperChecks() {
  const owner = query(
    `SELECT rolcanlogin || '|' || rolbypassrls FROM pg_roles WHERE rolname = 'minted_e612_authz_owner';`,
  );
  if (owner !== "false|false") fail("E612_HELPER_OWNER_ROLE_TOO_BROAD");
  const grants = query(`
    SELECT has_schema_privilege('minted_e612_authz_owner', 'private', 'USAGE') || '|' ||
           has_schema_privilege('minted_e612_authz_owner', 'auth', 'USAGE') || '|' ||
           has_table_privilege('minted_e612_authz_owner', 'private.client_identity_classifications', 'SELECT') || '|' ||
           has_table_privilege('minted_e612_authz_owner', 'private.client_identity_classifications', 'INSERT') || '|' ||
           has_table_privilege('minted_e612_authz_owner', 'private.internal_staff', 'SELECT') || '|' ||
           has_table_privilege('minted_e612_authz_owner', 'private.internal_staff', 'INSERT');
  `);
  if (grants !== "true|true|true|false|true|false")
    fail(
      `E612_HELPER_OWNER_GRANTS_TOO_BROAD_OR_NARROW_${grants.replaceAll("|", "_").toUpperCase()}`,
    );
  const helperIdentity = query(`
    SELECT pg_get_function_identity_arguments(p.oid) || '|' || pg_get_function_result(p.oid) || '|' ||
           p.prosecdef || '|' || r.rolname || '|' ||
           has_function_privilege('public', p.oid, 'EXECUTE') || '|' ||
           has_function_privilege('anon', p.oid, 'EXECUTE') || '|' ||
           has_function_privilege('authenticated', p.oid, 'EXECUTE') || '|' ||
           has_function_privilege('service_role', p.oid, 'EXECUTE')
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_roles r ON r.oid = p.proowner
     WHERE n.nspname = 'app_authz' AND p.proname = 'is_restricted_external';
  `);
  if (helperIdentity !== "|boolean|true|minted_e612_authz_owner|false|false|true|true")
    fail(`E612_HELPER_IDENTITY_OR_ACL_DRIFT_${helperIdentity.replaceAll("|", "_")}`);
  const authUidExec = query(
    `SELECT has_function_privilege('minted_e612_authz_owner', 'auth.uid()'::regprocedure, 'EXECUTE');`,
  );
  if (authUidExec !== "t")
    fail(`E612_HELPER_AUTH_UID_EXECUTE_MISSING_${authUidExec.toUpperCase()}`);
  emit("E612|PASS|helper.owner_acl");
  const restricted = query(`
    SET ROLE authenticated;
    ${claims(E612.clientActive)}
    SELECT app_authz.is_restricted_external();
    RESET ROLE;
  `);
  if (restricted !== "t") fail("E612_RESTRICTED_HELPER_FALSE_FOR_KNOWN_CLIENT");
  emit("E612|PASS|helper.known_restricted_true");
  const ordinary = query(`
    SET ROLE authenticated;
    ${claims(E612.trainer)}
    SELECT app_authz.is_restricted_external();
    RESET ROLE;
  `);
  if (ordinary !== "f") fail("E612_RESTRICTED_HELPER_TRUE_FOR_ZERO_MEMBERSHIP_TRAINER");
  emit("E612|PASS|helper.zero_membership_trainer_false");
  const dual = query(`
    SET ROLE authenticated;
    ${claims(E612.dual)}
    SELECT app_authz.is_restricted_external();
    RESET ROLE;
  `);
  if (dual !== "f") fail("E612_RESTRICTED_HELPER_TRUE_FOR_MANIFESTED_DUAL_USER");
  emit("E612|PASS|helper.dual_staff_false");
  expectedSqlError(
    "private.direct_select.anon",
    `SET ROLE anon; SELECT count(*) FROM private.client_access;`,
    ["42501"],
  );
  expectedSqlError(
    "private.direct_select.authenticated",
    asRole("authenticated", E612.clientActive, "SELECT count(*) FROM private.client_access;"),
    ["42501"],
  );
  expectedSqlError(
    "private.owner_write",
    `SET ROLE minted_e612_authz_owner; INSERT INTO private.client_access (id, auth_user_id, org_id, classification_id, state) VALUES ('${E612.accessNoGrant}', '${E612.clientNoGrant}', '${E612.orgA}', (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientNoGrant}' AND org_id = '${E612.orgA}'), 'active');`,
    ["42501"],
  );
}

function rlsChecks() {
  const billing = query(
    asRole(
      "authenticated",
      E612.billing,
      "SELECT count(*) FROM public.organizations WHERE id = '" + E612.orgA + "';",
    ),
  );
  if (billing !== "1") fail("E612_BILLING_MEMBER_READ_REGRESSION");
  emit("E612|PASS|legacy.billing_member_read");
  const memberOtherOrg = query(
    asRole(
      "authenticated",
      E612.memberOnly,
      "SELECT count(*) FROM public.organizations WHERE id = '" + E612.orgB + "';",
    ),
  );
  if (memberOtherOrg !== "0") fail("E612_WRONG_ORG_MEMBER_READ_LEAK");
  emit("E612|PASS|legacy.wrong_org_read_denied");
  const activeGroup = query(
    asRole(
      "authenticated",
      E612.clientActive,
      "SELECT count(*) FROM public.provider_groups WHERE id = '" + E612.groupA1 + "';",
    ),
  );
  if (activeGroup !== "0") fail("E612_CLIENT_GROUP_RLS_LEAK_OR_MEMBERSHIP");
  emit("E612|PASS|client.no_membership_group_read");
  const revokedGroup = query(
    asRole(
      "authenticated",
      E612.clientRevoked,
      "SELECT count(*) FROM public.provider_groups WHERE id = '" + E612.groupA1 + "';",
    ),
  );
  if (revokedGroup !== "0") fail("E612_REVOKED_CLIENT_GROUP_READ");
  emit("E612|PASS|client.revoked_group_read_denied");
  const trainer = query(
    asRole("authenticated", E612.trainer, "SELECT count(*) FROM public.organizations;"),
  );
  if (trainer !== "0") fail("E612_ZERO_MEMBERSHIP_ORG_READ_LEAK");
  emit("E612|PASS|trainer.no_membership_org_read_denied");
}

function resolverChecks() {
  const resolve = (userId, audience = null, orgId = null) =>
    jsonQuery(
      asRole(
        "service_role",
        userId,
        `SELECT public.resolve_enrollment_context(${sqlLiteral(userId)}, ${sqlLiteral(audience)}, ${sqlLiteral(orgId)});`,
      ),
      `resolver_${userId.slice(-3)}_${audience ?? "auto"}`,
    );
  const billing = resolve(E612.billing);
  assertEqual("resolver.billing.audience", billing.audience, "staff");
  assertEqual("resolver.billing.restricted", billing.restrictedExternal, false);
  assertEqual("resolver.billing.global_training", billing.globalTraining, true);
  assertEqual("resolver.billing.staff_org_count", billing.staffOrgs.length, 1);
  assertEqual("resolver.billing.report_staff", billing.staffOrgs[0].reportStaff, false);
  assertEqual("resolver.billing.client_manage", billing.staffOrgs[0].clientManage, false);
  emit("E612|PASS|resolver.billing_member_scope");

  const admin = resolve(E612.admin, "staff", E612.orgA);
  assertEqual("resolver.admin.selected_org", admin.selectedOrgId, E612.orgA);
  assertEqual("resolver.admin.report_staff", admin.staffOrgs[0].reportStaff, true);
  assertEqual("resolver.admin.client_manage", admin.staffOrgs[0].clientManage, true);
  const specialist = resolve(E612.specialist, "staff", E612.orgA);
  assertEqual("resolver.specialist.report_staff", specialist.staffOrgs[0].reportStaff, true);
  assertEqual("resolver.specialist.client_manage", specialist.staffOrgs[0].clientManage, false);
  emit("E612|PASS|resolver.manifested_staff_authority");

  const trainer = resolve(E612.trainer);
  assertEqual("resolver.trainer.audience", trainer.audience, null);
  assertEqual("resolver.trainer.staff_org_count", trainer.staffOrgs.length, 0);
  assertEqual("resolver.trainer.client_org_count", trainer.clientOrgs.length, 0);
  assertEqual("resolver.trainer.global_training", trainer.globalTraining, true);
  emit("E612|PASS|resolver.zero_membership_trainer");

  const active = resolve(E612.clientActive, "client", E612.orgA);
  assertEqual("resolver.active.client_org", active.selectedOrgId, E612.orgA);
  assertEqual("resolver.active.restricted", active.restrictedExternal, true);
  assertEqual("resolver.active.global_training", active.globalTraining, false);
  assertEqual("resolver.active.client_org_count", active.clientOrgs.length, 1);
  assertEqual("resolver.active.group_count", active.clientOrgs[0].groups.length, 2);
  if (
    !active.clientOrgs[0].groups.some((row) => row.groupId === E612.groupA1) ||
    !active.clientOrgs[0].groups.some((row) => row.groupId === E612.groupA2)
  )
    fail("E612_RESOLVER_ACTIVE_GROUP_SCOPE_DRIFT");
  emit("E612|PASS|resolver.active_client_scope");

  const dual = resolve(E612.dual, "client", E612.orgA);
  assertEqual("resolver.dual.client_org", dual.selectedOrgId, E612.orgA);
  assertEqual("resolver.dual.restricted", dual.restrictedExternal, false);
  assertEqual("resolver.dual.staff_org_count", dual.staffOrgs.length, 1);
  assertEqual("resolver.dual.client_org_count", dual.clientOrgs.length, 1);
  assertEqual("resolver.dual.staff_role", dual.staffOrgs[0].role, "admin");
  assertEqual("resolver.dual.staff_report", dual.staffOrgs[0].reportStaff, true);
  assertEqual(
    "resolver.dual.client_group_ids",
    JSON.stringify(dual.clientOrgs[0].groups.map((row) => row.groupId)),
    JSON.stringify([E612.groupA1, E612.groupA2]),
  );
  const dualStaff = resolve(E612.dual, "staff", E612.orgA);
  assertEqual("resolver.dual_staff.audience", dualStaff.audience, "staff");
  assertEqual("resolver.dual_staff.selected_org", dualStaff.selectedOrgId, E612.orgA);
  assertEqual(
    "resolver.dual_staff.client_group_ids",
    JSON.stringify(dualStaff.clientOrgs[0].groups.map((row) => row.groupId)),
    JSON.stringify([E612.groupA1, E612.groupA2]),
  );
  emit("E612|PASS|resolver.dual_explicit_audience");

  for (const userId of [E612.clientPending, E612.clientRevoked]) {
    expectedServiceError(
      `resolver.client_unavailable.${userId.slice(-3)}`,
      asRole(
        "service_role",
        userId,
        `SELECT public.resolve_enrollment_context('${userId}', 'client', '${E612.orgA}');`,
      ),
      "Client context is unavailable",
    );
  }
  const noGrant = resolve(E612.clientNoGrant, "client", E612.orgA);
  assertEqual("resolver.no_grant.restricted", noGrant.restrictedExternal, true);
  assertEqual("resolver.no_grant.client_org_count", noGrant.clientOrgs.length, 1);
  assertEqual("resolver.no_grant.group_count", noGrant.clientOrgs[0].groups.length, 0);
  emit("E612|PASS|resolver.no_grant_empty_group_scope");
  expectedServiceError(
    "resolver.wrong_org_client_unavailable",
    asRole(
      "service_role",
      E612.clientActive,
      `SELECT public.resolve_enrollment_context('${E612.clientActive}', 'client', '${E612.orgB}');`,
    ),
    "Client organization is unavailable",
  );
  expectedServiceError(
    "resolver.invalid_audience",
    asRole(
      "service_role",
      E612.billing,
      `SELECT public.resolve_enrollment_context('${E612.billing}', 'operator', NULL);`,
    ),
    "Unsupported audience",
  );
  expectedServiceError(
    "resolver.null_actor",
    asRole(
      "service_role",
      E612.billing,
      `SELECT public.resolve_enrollment_context(NULL, 'staff', '${E612.orgA}');`,
    ),
    "Actor is required",
  );
  expectedServiceError(
    "resolver.unknown_actor",
    asRole(
      "service_role",
      E612.billing,
      `SELECT public.resolve_enrollment_context('30000000-0000-4000-8000-000000000099', 'staff', '${E612.orgA}');`,
    ),
    "Verified actor is unavailable",
  );
  for (const [label, mutation] of [
    ["unconfirmed", "email_confirmed_at = NULL"],
    ["banned", "banned_until = now() + interval '1 hour'"],
    ["deleted", "deleted_at = now()"],
    ["anonymous", "is_anonymous = TRUE"],
  ]) {
    sql(`UPDATE auth.users SET ${mutation} WHERE id = '${E612.billing}';`);
    expectedServiceError(
      `resolver.invalid_auth_status.${label}`,
      asRole(
        "service_role",
        E612.billing,
        `SELECT public.resolve_enrollment_context('${E612.billing}', 'staff', '${E612.orgA}');`,
      ),
      "Verified actor is unavailable",
    );
    sql(
      `UPDATE auth.users SET email_confirmed_at = now(), banned_until = NULL, deleted_at = NULL, is_anonymous = FALSE WHERE id = '${E612.billing}';`,
    );
  }
  sql(
    `UPDATE private.internal_staff SET staff_role = 'admin' WHERE auth_user_id = '${E612.specialist}' AND org_id = '${E612.orgA}' AND staff_role = 'specialist';`,
  );
  const mismatchedManifest = resolve(E612.specialist, "staff", E612.orgA);
  assertEqual(
    "resolver.mismatched_manifest.report_staff",
    mismatchedManifest.staffOrgs[0].reportStaff,
    false,
  );
  assertEqual(
    "resolver.mismatched_manifest.client_manage",
    mismatchedManifest.staffOrgs[0].clientManage,
    false,
  );
  sql(
    `UPDATE private.internal_staff SET staff_role = 'specialist' WHERE auth_user_id = '${E612.specialist}' AND org_id = '${E612.orgA}' AND staff_role = 'admin';`,
  );
  sql(
    `UPDATE private.internal_staff SET active = FALSE WHERE auth_user_id = '${E612.specialist}' AND org_id = '${E612.orgA}' AND staff_role = 'specialist';`,
  );
  const revokedManifest = resolve(E612.specialist, "staff", E612.orgA);
  assertEqual(
    "resolver.revoked_manifest.report_staff",
    revokedManifest.staffOrgs[0].reportStaff,
    false,
  );
  assertEqual(
    "resolver.revoked_manifest.client_manage",
    revokedManifest.staffOrgs[0].clientManage,
    false,
  );
  sql(
    `UPDATE private.internal_staff SET active = TRUE WHERE auth_user_id = '${E612.specialist}' AND org_id = '${E612.orgA}' AND staff_role = 'specialist';`,
  );
  sql(
    `DELETE FROM public.memberships WHERE user_id = '${E612.specialist}' AND org_id = '${E612.orgA}';`,
  );
  expectedServiceError(
    "resolver.removed_membership_with_manifest",
    asRole(
      "service_role",
      E612.specialist,
      `SELECT public.resolve_enrollment_context('${E612.specialist}', 'staff', '${E612.orgA}');`,
    ),
    "Staff context is unavailable",
  );
  sql(
    `INSERT INTO public.memberships (org_id, user_id, role) VALUES ('${E612.orgA}', '${E612.specialist}', 'specialist');`,
  );
  emit("E612|PASS|resolver.restricted_and_selection_denials");

  const stableA = resolve(E612.dual, "client", E612.orgA).contextRevision;
  const stableB = resolve(E612.dual, "client", E612.orgA).contextRevision;
  assertEqual("resolver.revision.stable", stableB, stableA);
  emit("E612|PASS|resolver.revision_stable");

  sql(`INSERT INTO private.client_group_grants (access_id, org_id, group_id)
       VALUES ('${MATRIX.dualAccess}', '${E612.orgA}', '${MATRIX.revisionGroup}');`);
  const grantRevision = resolve(E612.dual, "client", E612.orgA).contextRevision;
  if (grantRevision === stableA) fail("E612_RESOLVER_REVISION_GRANT_NOT_CHANGED");
  sql(
    `DELETE FROM private.client_group_grants WHERE access_id = '${MATRIX.dualAccess}' AND group_id = '${MATRIX.revisionGroup}';`,
  );

  sql(
    `UPDATE private.client_identity_classifications SET email_normalized = 'dual-revision@e612.test' WHERE auth_user_id = '${E612.dual}' AND org_id = '${E612.orgA}';`,
  );
  const classificationRevision = resolve(E612.dual, "client", E612.orgA).contextRevision;
  if (classificationRevision === stableA) fail("E612_RESOLVER_REVISION_CLASSIFICATION_NOT_CHANGED");
  sql(
    `UPDATE private.client_identity_classifications SET email_normalized = 'dual@e612.test' WHERE auth_user_id = '${E612.dual}' AND org_id = '${E612.orgA}';`,
  );

  sql(
    `INSERT INTO public.memberships (org_id, user_id, role) VALUES ('${E612.orgB}', '${E612.dual}', 'billing');`,
  );
  const membershipRevision = resolve(E612.dual, "client", E612.orgA).contextRevision;
  if (membershipRevision === stableA) fail("E612_RESOLVER_REVISION_MEMBERSHIP_NOT_CHANGED");
  sql(`DELETE FROM public.memberships WHERE org_id = '${E612.orgB}' AND user_id = '${E612.dual}';`);

  sql(
    `UPDATE private.internal_staff SET manifest_version = 'e612-revision-manifest' WHERE auth_user_id = '${E612.dual}' AND org_id = '${E612.orgA}';`,
  );
  const manifestRevision = resolve(E612.dual, "client", E612.orgA).contextRevision;
  if (manifestRevision === stableA) fail("E612_RESOLVER_REVISION_MANIFEST_NOT_CHANGED");
  sql(
    `UPDATE private.internal_staff SET manifest_version = 'e612-fixture-v1' WHERE auth_user_id = '${E612.dual}' AND org_id = '${E612.orgA}';`,
  );

  sql(`UPDATE auth.users SET email = 'dual-revision-auth@e612.test' WHERE id = '${E612.dual}';`);
  const authRevision = resolve(E612.dual, "client", E612.orgA).contextRevision;
  if (authRevision === stableA) fail("E612_RESOLVER_REVISION_AUTH_IDENTITY_NOT_CHANGED");
  sql(`UPDATE auth.users SET email = 'dual@e612.test' WHERE id = '${E612.dual}';`);
  emit("E612|PASS|resolver.revision_determinants");
}

function managementChecks() {
  const issued = jsonQuery(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.create_client_invite('${E612.admin}', '${E612.orgA}', '${MATRIX.managementEmail}', ARRAY['${E612.groupA1}', '${E612.groupA2}']::uuid[]);`,
    ),
    "management.create_positive",
  );
  if (
    typeof issued.inviteId !== "string" ||
    typeof issued.token !== "string" ||
    issued.organizationId !== E612.orgA
  )
    fail("E612_MANAGEMENT_CREATE_POSITIVE_SHAPE");
  const claimed = jsonQuery(
    asRole(
      "service_role",
      MATRIX.managementUser,
      `SELECT public.claim_client_invite('${MATRIX.managementUser}', '${issued.token}');`,
    ),
    "management.claim_positive",
  );
  if (typeof claimed.accessId !== "string" || claimed.organizationId !== E612.orgA)
    fail("E612_MANAGEMENT_CLAIM_POSITIVE_SHAPE");
  const setResult = jsonQuery(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.set_client_group_grants('${E612.admin}', '${claimed.accessId}', ARRAY['${E612.groupA1}']::uuid[]);`,
    ),
    "management.set_grants_positive",
  );
  if (
    setResult.accessId !== claimed.accessId ||
    setResult.organizationId !== E612.orgA ||
    JSON.stringify(setResult.groupIds) !== JSON.stringify([E612.groupA1])
  )
    fail("E612_MANAGEMENT_SET_GRANTS_POSITIVE_SHAPE");
  const revokeResult = jsonQuery(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.revoke_client_access('${E612.admin}', '${claimed.accessId}');`,
    ),
    "management.revoke_positive",
  );
  if (
    revokeResult.accessId !== claimed.accessId ||
    revokeResult.organizationId !== E612.orgA ||
    revokeResult.state !== "revoked"
  )
    fail("E612_MANAGEMENT_REVOKE_POSITIVE_SHAPE");
  emit("E612|PASS|management.allowed_admin_outputs_and_effects");

  const createDenied = [
    [E612.specialist, E612.orgA, "specialist"],
    [E612.memberOnly, E612.orgA, "member"],
    [E612.admin, E612.orgB, "wrong_org_admin"],
    [MATRIX.staffClaimUser, E612.orgA, "missing_manifest"],
  ];
  for (const [actor, org, label] of createDenied) {
    expectedServiceError(
      `management.create_denied.${label}`,
      asRole(
        "service_role",
        actor,
        `SELECT public.create_client_invite('${actor}', '${org}', '${MATRIX.managementEmail}', ARRAY['${E612.groupA1}']::uuid[]);`,
      ),
      "Client management requires current same-org admin authority",
    );
  }
  const statusCases = [
    ["email_unconfirmed", "email_confirmed_at = NULL"],
    ["banned", "banned_until = now() + interval '1 hour'"],
    ["deleted", "deleted_at = now()"],
    ["anonymous", "is_anonymous = TRUE"],
  ];
  for (const [label, mutation] of statusCases) {
    sql(`UPDATE auth.users SET ${mutation} WHERE id = '${E612.admin}';`);
    expectedServiceError(
      `management.create_actor_status.${label}`,
      asRole(
        "service_role",
        E612.admin,
        `SELECT public.create_client_invite('${E612.admin}', '${E612.orgA}', 'status-${label}@e612.test', ARRAY['${E612.groupA1}']::uuid[]);`,
      ),
      "Verified actor is unavailable",
    );
    sql(
      `UPDATE auth.users SET email_confirmed_at = now(), banned_until = NULL, deleted_at = NULL, is_anonymous = FALSE WHERE id = '${E612.admin}';`,
    );
  }
  emit("E612|PASS|management.actor_status_denials");

  const protectedBefore = query(`
    SELECT (SELECT state FROM private.client_access WHERE id = '${E612.accessActive}') || '|' ||
           coalesce((SELECT string_agg(group_id::text, ',' ORDER BY group_id) FROM private.client_group_grants WHERE access_id = '${E612.accessActive}'), '') || '|' ||
           (SELECT count(*)::text FROM public.audit_log WHERE entity_type = 'client_access' AND entity_id = '${E612.accessActive}');
  `);
  const authorityCases = [
    [
      "set.null_actor",
      `SELECT public.set_client_group_grants(NULL, '${E612.accessActive}', ARRAY['${E612.groupA1}']::uuid[]);`,
      "Actor and access are required",
    ],
    [
      "revoke.null_actor",
      `SELECT public.revoke_client_access(NULL, '${E612.accessActive}');`,
      "Actor and access are required",
    ],
    [
      "set.unknown_actor",
      `SELECT public.set_client_group_grants('30000000-0000-4000-8000-000000000099', '${E612.accessActive}', ARRAY['${E612.groupA1}']::uuid[]);`,
      "Verified actor is unavailable",
    ],
    [
      "revoke.unknown_actor",
      `SELECT public.revoke_client_access('30000000-0000-4000-8000-000000000099', '${E612.accessActive}');`,
      "Verified actor is unavailable",
    ],
    [
      "set.member_only",
      `SELECT public.set_client_group_grants('${E612.memberOnly}', '${E612.accessActive}', ARRAY['${E612.groupA1}']::uuid[]);`,
      "Client management requires current same-org admin authority",
    ],
    [
      "revoke.member_only",
      `SELECT public.revoke_client_access('${E612.memberOnly}', '${E612.accessActive}');`,
      "Client management requires current same-org admin authority",
    ],
    [
      "set.specialist",
      `SELECT public.set_client_group_grants('${E612.specialist}', '${E612.accessActive}', ARRAY['${E612.groupA1}']::uuid[]);`,
      "Client management requires current same-org admin authority",
    ],
    [
      "revoke.specialist",
      `SELECT public.revoke_client_access('${E612.specialist}', '${E612.accessActive}');`,
      "Client management requires current same-org admin authority",
    ],
    [
      "set.wrong_org_admin",
      `SELECT public.set_client_group_grants('${E612.admin}', '${E612.accessWrongOrg}', ARRAY['${E612.groupB1}']::uuid[]);`,
      "Client management requires current same-org admin authority",
    ],
    [
      "revoke.wrong_org_admin",
      `SELECT public.revoke_client_access('${E612.admin}', '${E612.accessWrongOrg}');`,
      "Client management requires current same-org admin authority",
    ],
    [
      "set.missing_manifest",
      `SELECT public.set_client_group_grants('${MATRIX.staffClaimUser}', '${E612.accessActive}', ARRAY['${E612.groupA1}']::uuid[]);`,
      "Client management requires current same-org admin authority",
    ],
    [
      "revoke.missing_manifest",
      `SELECT public.revoke_client_access('${MATRIX.staffClaimUser}', '${E612.accessActive}');`,
      "Client management requires current same-org admin authority",
    ],
  ];
  for (const [label, statement, message] of authorityCases)
    expectedServiceError(
      `management.authority.${label}`,
      asRole("service_role", E612.admin, statement),
      message,
    );
  for (const [label, mutation] of [
    ["unconfirmed", "email_confirmed_at = NULL"],
    ["banned", "banned_until = now() + interval '1 hour'"],
    ["deleted", "deleted_at = now()"],
    ["anonymous", "is_anonymous = TRUE"],
  ]) {
    sql(`UPDATE auth.users SET ${mutation} WHERE id = '${E612.admin}';`);
    expectedServiceError(
      `management.set_actor_status.${label}`,
      asRole(
        "service_role",
        E612.admin,
        `SELECT public.set_client_group_grants('${E612.admin}', '${E612.accessActive}', ARRAY['${E612.groupA1}']::uuid[]);`,
      ),
      "Verified actor is unavailable",
    );
    expectedServiceError(
      `management.revoke_actor_status.${label}`,
      asRole(
        "service_role",
        E612.admin,
        `SELECT public.revoke_client_access('${E612.admin}', '${E612.accessActive}');`,
      ),
      "Verified actor is unavailable",
    );
    sql(
      `UPDATE auth.users SET email_confirmed_at = now(), banned_until = NULL, deleted_at = NULL, is_anonymous = FALSE WHERE id = '${E612.admin}';`,
    );
  }
  sql(
    `UPDATE private.internal_staff SET staff_role = 'specialist' WHERE auth_user_id = '${E612.admin}' AND org_id = '${E612.orgA}' AND staff_role = 'admin';`,
  );
  expectedServiceError(
    "management.set_mismatched_manifest",
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.set_client_group_grants('${E612.admin}', '${E612.accessActive}', ARRAY['${E612.groupA1}']::uuid[]);`,
    ),
    "Client management requires current same-org admin authority",
  );
  expectedServiceError(
    "management.revoke_mismatched_manifest",
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.revoke_client_access('${E612.admin}', '${E612.accessActive}');`,
    ),
    "Client management requires current same-org admin authority",
  );
  sql(
    `UPDATE private.internal_staff SET staff_role = 'admin' WHERE auth_user_id = '${E612.admin}' AND org_id = '${E612.orgA}' AND staff_role = 'specialist';`,
  );
  sql(
    `UPDATE private.internal_staff SET active = FALSE WHERE auth_user_id = '${E612.admin}' AND org_id = '${E612.orgA}' AND staff_role = 'admin';`,
  );
  expectedServiceError(
    "management.set_revoked_manifest",
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.set_client_group_grants('${E612.admin}', '${E612.accessActive}', ARRAY['${E612.groupA1}']::uuid[]);`,
    ),
    "Client management requires current same-org admin authority",
  );
  expectedServiceError(
    "management.revoke_revoked_manifest",
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.revoke_client_access('${E612.admin}', '${E612.accessActive}');`,
    ),
    "Client management requires current same-org admin authority",
  );
  sql(
    `UPDATE private.internal_staff SET active = TRUE WHERE auth_user_id = '${E612.admin}' AND org_id = '${E612.orgA}' AND staff_role = 'admin';`,
  );
  assertEqual(
    "management.invalid_actor_no_write",
    query(`
    SELECT (SELECT state FROM private.client_access WHERE id = '${E612.accessActive}') || '|' ||
           coalesce((SELECT string_agg(group_id::text, ',' ORDER BY group_id) FROM private.client_group_grants WHERE access_id = '${E612.accessActive}'), '') || '|' ||
           (SELECT count(*)::text FROM public.audit_log WHERE entity_type = 'client_access' AND entity_id = '${E612.accessActive}');
  `),
    protectedBefore,
  );
  emit("E612|PASS|management.set_revoke_authority_status_matrix");

  const createNoWriteBefore = query(`
    SELECT (SELECT count(*)::text FROM private.client_identity_classifications) || '|' ||
           (SELECT count(*)::text FROM private.client_invites) || '|' ||
           (SELECT count(*)::text FROM private.client_invite_group_grants) || '|' ||
           (SELECT count(*)::text FROM public.audit_log);
  `);
  expectedServiceError(
    "management.create_invalid_recipient_no_write",
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.create_client_invite('${E612.admin}', '${E612.orgA}', 'missing-recipient@e612.test', ARRAY['${E612.groupA1}']::uuid[]);`,
    ),
    "Recipient must be an existing verified Auth user",
  );
  expectedServiceError(
    "management.create_invalid_group_no_write",
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.create_client_invite('${E612.admin}', '${E612.orgA}', '${MATRIX.firstClaimEmail}', ARRAY['${E612.groupB1}']::uuid[]);`,
    ),
    "Every provider group must belong to the organization",
  );
  expectedServiceError(
    "management.create_invalid_email_no_write",
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.create_client_invite('${E612.admin}', '${E612.orgA}', 'invalid-recipient', ARRAY['${E612.groupA1}']::uuid[]);`,
    ),
    "Recipient email is not valid",
  );
  assertEqual(
    "management.create_invalid_input_no_write",
    query(`
    SELECT (SELECT count(*)::text FROM private.client_identity_classifications) || '|' ||
           (SELECT count(*)::text FROM private.client_invites) || '|' ||
           (SELECT count(*)::text FROM private.client_invite_group_grants) || '|' ||
           (SELECT count(*)::text FROM public.audit_log);
  `),
    createNoWriteBefore,
  );
  emit("E612|PASS|management.invalid_recipient_group_no_write");

  for (const [label, statement, message] of [
    [
      "set_grants.specialist",
      `SELECT public.set_client_group_grants('${E612.specialist}', '${MATRIX.dualAccess}', ARRAY['${E612.groupA1}']::uuid[]);`,
      "Client management requires current same-org admin authority",
    ],
    [
      "set_grants.wrong_org",
      `SELECT public.set_client_group_grants('${E612.admin}', '${E612.accessActive}', ARRAY['${E612.groupB1}']::uuid[]);`,
      "Every provider group must belong to the client organization",
    ],
    [
      "set_grants.revoked",
      `SELECT public.set_client_group_grants('${E612.admin}', '${E612.accessRevoked}', ARRAY['${E612.groupA1}']::uuid[]);`,
      "Client access is not active",
    ],
    [
      "revoke.specialist",
      `SELECT public.revoke_client_access('${E612.specialist}', '${MATRIX.dualAccess}');`,
      "Client management requires current same-org admin authority",
    ],
    [
      "revoke.missing_manifest",
      `SELECT public.revoke_client_access('${MATRIX.staffClaimUser}', '${E612.accessActive}');`,
      "Client management requires current same-org admin authority",
    ],
  ]) {
    expectedServiceError(
      `management.${label}`,
      asRole(
        "service_role",
        label.includes("specialist") || label.includes("missing_manifest")
          ? label.includes("missing_manifest")
            ? MATRIX.staffClaimUser
            : E612.specialist
          : E612.admin,
        statement,
      ),
      message,
    );
  }
  emit("E612|PASS|management.invalid_authority_denials");

  expectedSqlError(
    "manifest.browser_activate_denied",
    asRole(
      "authenticated",
      E612.admin,
      `SELECT public.set_internal_staff_manifest('${E612.operator}', '${MATRIX.staffClaimUser}', '${E612.orgA}', 'admin', TRUE, 'browser-forbidden');`,
    ),
    ["42501"],
  );
  expectedSqlError(
    "manifest.browser_revoke_denied",
    asRole(
      "authenticated",
      E612.admin,
      `SELECT public.set_internal_staff_manifest('${E612.operator}', '${MATRIX.staffClaimUser}', '${E612.orgA}', 'admin', FALSE, 'browser-forbidden');`,
    ),
    ["42501"],
  );
  expectedServiceError(
    "manifest.dual_staff_claim_before_activation_denied",
    asRole("authenticated", MATRIX.staffClaimUser, "SELECT public.claim_invites();"),
    "Restricted client cannot claim staff invites",
  );
  const activated = jsonQuery(
    asRole(
      "service_role",
      E612.operator,
      `SELECT public.set_internal_staff_manifest('${E612.operator}', '${MATRIX.staffClaimUser}', '${E612.orgA}', 'admin', TRUE, 'e612-matrix-manifest');`,
    ),
    "manifest.operator_activate",
  );
  if (activated.active !== true || activated.authUserId !== MATRIX.staffClaimUser)
    fail("E612_MANIFEST_OPERATOR_ACTIVATION_SHAPE");
  emit("E612|PASS|manifest.operator_activation_precedes_dual");
}

function functionDenials() {
  const deniedClients = [
    E612.clientPending,
    E612.clientActive,
    E612.clientNoGrant,
    E612.clientRevoked,
  ];
  for (const userId of deniedClients) {
    expectedSqlError(
      `create_org.restricted.one_arg.${userId.slice(-3)}`,
      asRole("authenticated", userId, "SELECT public.create_organization('E612 forbidden org');"),
      ["P0001"],
      "Restricted client cannot create an organization",
    );
    expectedSqlError(
      `create_org.restricted.three_arg.${userId.slice(-3)}`,
      asRole(
        "authenticated",
        userId,
        "SELECT public.create_organization('E612 forbidden org 3', 'forbidden@e612.test', '303-555-0199');",
      ),
      ["P0001"],
      "Restricted client cannot create an organization",
    );
    expectedSqlError(
      `create_org.restricted.five_arg.${userId.slice(-3)}`,
      asRole(
        "authenticated",
        userId,
        "SELECT public.create_organization('E612 forbidden org 5', 'forbidden@e612.test', '303-555-0199', '{}'::jsonb, '{}'::jsonb);",
      ),
      ["P0001"],
      "Restricted client cannot create an organization",
    );
    expectedSqlError(
      `claim_invites.restricted.${userId.slice(-3)}`,
      asRole("authenticated", userId, "SELECT public.claim_invites();"),
      ["P0001"],
      "Restricted client cannot claim staff invites",
    );
  }
  emit("E612|PASS|bootstrap.restricted_client_denied_all_overloads");
  const billing = query(asRole("authenticated", E612.billing, "SELECT public.claim_invites();"));
  if (!/^\d+$/.test(billing)) fail("E612_LEGACY_CLAIM_INVITES_SHAPE_CHANGED");
  emit("E612|PASS|bootstrap.legacy_claim_invites_shape");
}

function bootstrapChecks() {
  const staffBefore = query(`
    SELECT (SELECT count(*) FROM public.memberships WHERE user_id = '${MATRIX.staffPositiveUser}') || '|' ||
           (SELECT count(*) FROM public.pending_invites WHERE id = '${MATRIX.staffInviteId}') || '|' ||
           coalesce((SELECT full_name FROM public.profiles WHERE id = '${MATRIX.staffPositiveUser}'), '');
  `);
  assertEqual("bootstrap.staff_before", staffBefore, "0|1|");
  const staffClaimed = query(
    asRole("authenticated", MATRIX.staffPositiveUser, "SELECT public.claim_invites();"),
  );
  assertEqual("bootstrap.staff_claim_count", staffClaimed, "1");
  const staffAfter = query(`
    SELECT (SELECT role FROM public.memberships WHERE user_id = '${MATRIX.staffPositiveUser}' AND org_id = '${E612.orgA}') || '|' ||
           (SELECT count(*) FROM public.pending_invites WHERE id = '${MATRIX.staffInviteId}') || '|' ||
           (SELECT full_name FROM public.profiles WHERE id = '${MATRIX.staffPositiveUser}');
  `);
  assertEqual("bootstrap.staff_claim_effects", staffAfter, "billing|0|E612 Claimed Staff");
  emit("E612|PASS|bootstrap.legacy_staff_invite_positive");

  const restrictedBefore = query(`
    SELECT (SELECT count(*) FROM public.memberships WHERE user_id = '${E612.clientActive}') || '|' ||
           (SELECT count(*) FROM public.pending_invites WHERE id = '${MATRIX.restrictedStaffInviteId}') || '|' ||
           (SELECT full_name FROM public.profiles WHERE id = '${E612.clientActive}');
  `);
  expectedServiceError(
    "bootstrap.restricted_staff_claim_fixture",
    asRole("authenticated", E612.clientActive, "SELECT public.claim_invites();"),
    "Restricted client cannot claim staff invites",
  );
  expectedSqlError(
    "bootstrap.restricted_direct_membership_insert",
    asRole(
      "authenticated",
      E612.clientActive,
      `INSERT INTO public.memberships (org_id, user_id, role) VALUES ('${E612.orgB}', '${E612.clientActive}', 'billing');`,
    ),
    ["42501"],
  );
  expectedSqlError(
    "bootstrap.restricted_direct_pending_invite_insert",
    asRole(
      "authenticated",
      E612.clientActive,
      `INSERT INTO public.pending_invites (id, org_id, email, role, full_name, invited_by) VALUES ('70000000-0000-4000-8000-000000000004', '${E612.orgA}', 'active@e612.test', 'billing', 'forbidden', '${E612.admin}');`,
    ),
    ["42501"],
  );
  const restrictedAfter = query(`
    SELECT (SELECT count(*) FROM public.memberships WHERE user_id = '${E612.clientActive}') || '|' ||
           (SELECT count(*) FROM public.pending_invites WHERE id = '${MATRIX.restrictedStaffInviteId}') || '|' ||
           (SELECT full_name FROM public.profiles WHERE id = '${E612.clientActive}');
  `);
  assertEqual("bootstrap.restricted_staff_claim_effects", restrictedAfter, restrictedBefore);
  emit("E612|PASS|bootstrap.restricted_staff_no_write_or_consume");

  const dualStaffClaimed = query(
    asRole("authenticated", MATRIX.staffClaimUser, "SELECT public.claim_invites();"),
  );
  assertEqual("bootstrap.dual_staff_claim_count", dualStaffClaimed, "1");
  const dualStaffAfter = query(`
    SELECT (SELECT role FROM public.memberships WHERE user_id = '${MATRIX.staffClaimUser}' AND org_id = '${E612.orgA}') || '|' ||
           (SELECT count(*) FROM public.pending_invites WHERE id = '${MATRIX.dualStaffInviteId}') || '|' ||
           (SELECT active FROM private.internal_staff WHERE auth_user_id = '${MATRIX.staffClaimUser}' AND org_id = '${E612.orgA}');
  `);
  assertEqual("bootstrap.dual_staff_claim_effects", dualStaffAfter, "specialist|0|true");
  emit("E612|PASS|bootstrap.operator_manifest_then_dual_claim");

  for (const userId of [E612.clientPending, E612.clientNoGrant, E612.clientRevoked]) {
    expectedSqlError(
      `bootstrap.refresh_gate.create_one.${userId.slice(-3)}`,
      asRole(
        "authenticated",
        userId,
        "SELECT public.create_organization('E612 refresh forbidden');",
      ),
      ["P0001"],
      "Restricted client cannot create an organization",
    );
    expectedSqlError(
      `bootstrap.refresh_gate.create_three.${userId.slice(-3)}`,
      asRole(
        "authenticated",
        userId,
        "SELECT public.create_organization('E612 refresh forbidden', 'refresh@e612.test', '303-555-0121');",
      ),
      ["P0001"],
      "Restricted client cannot create an organization",
    );
    expectedSqlError(
      `bootstrap.refresh_gate.create_five.${userId.slice(-3)}`,
      asRole(
        "authenticated",
        userId,
        "SELECT public.create_organization('E612 refresh forbidden', 'refresh@e612.test', '303-555-0121', '{}'::jsonb, '{}'::jsonb);",
      ),
      ["P0001"],
      "Restricted client cannot create an organization",
    );
    expectedSqlError(
      `bootstrap.refresh_gate.claim.${userId.slice(-3)}`,
      asRole("authenticated", userId, "SELECT public.claim_invites();"),
      ["P0001"],
      "Restricted client cannot claim staff invites",
    );
  }
  for (const statement of [
    "SELECT public.create_organization('E612 email-changed forbidden');",
    "SELECT public.create_organization('E612 email-changed forbidden', 'changed@e612.test', '303-555-0122');",
    "SELECT public.create_organization('E612 email-changed forbidden', 'changed@e612.test', '303-555-0122', '{}'::jsonb, '{}'::jsonb);",
    "SELECT public.claim_invites();",
  ]) {
    expectedSqlError(
      "bootstrap.email_changed_restricted",
      asRole("authenticated", E612.clientPending, statement),
      statement.includes("claim_invites") ? ["P0001"] : ["P0001"],
      statement.includes("claim_invites")
        ? "Restricted client cannot claim staff invites"
        : "Restricted client cannot create an organization",
    );
  }
  emit("E612|PASS|bootstrap.restricted_refresh_gate_matrix");
}

const GLOBAL = Object.freeze({
  payer: "60000000-0000-4000-8000-000000000001",
  portal: "61000000-0000-4000-8000-000000000001",
  fieldMap: "62000000-0000-4000-8000-000000000001",
  sop: "63000000-0000-4000-8000-000000000001",
  form: "64000000-0000-4000-8000-000000000001",
  lead: "65000000-0000-4000-8000-000000000001",
  catalogChange: "66000000-0000-4000-8000-000000000001",
});

const MATRIX = Object.freeze({
  firstClaimUser: "30000000-0000-4000-8000-000000000018",
  firstClaimEmail: "first-claim@e612.test",
  rollbackUser: "30000000-0000-4000-8000-000000000014",
  rollbackEmail: "rollback@e612.test",
  staffClaimUser: "30000000-0000-4000-8000-000000000019",
  staffClaimEmail: "dual-staff@e612.test",
  staffPositiveUser: "30000000-0000-4000-8000-000000000016",
  staffPositiveEmail: "staff-positive@e612.test",
  managementUser: "30000000-0000-4000-8000-000000000017",
  managementEmail: "management@e612.test",
  dualAccess: "40000000-0000-4000-8000-000000000005",
  revisionGroup: "20000000-0000-4000-8000-000000000004",
  staffInviteId: "70000000-0000-4000-8000-000000000001",
  restrictedStaffInviteId: "70000000-0000-4000-8000-000000000002",
  dualStaffInviteId: "70000000-0000-4000-8000-000000000003",
});

function matrixAuthSql() {
  return `
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
VALUES
  ('${MATRIX.firstClaimUser}', '${MATRIX.firstClaimEmail}', now(), '{}'::jsonb, '{}'::jsonb),
  ('${MATRIX.rollbackUser}', '${MATRIX.rollbackEmail}', now(), '{}'::jsonb, '{}'::jsonb),
  ('${MATRIX.staffClaimUser}', '${MATRIX.staffClaimEmail}', now(), '{}'::jsonb, '{}'::jsonb),
  ('${MATRIX.staffPositiveUser}', '${MATRIX.staffPositiveEmail}', now(), '{}'::jsonb, '{}'::jsonb),
  ('${MATRIX.managementUser}', '${MATRIX.managementEmail}', now(), '{}'::jsonb, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
`;
}

function matrixFixtureSql() {
  return `
INSERT INTO public.profiles (id, email, full_name)
VALUES
  ('${MATRIX.firstClaimUser}', '${MATRIX.firstClaimEmail}', NULL),
  ('${MATRIX.rollbackUser}', '${MATRIX.rollbackEmail}', NULL),
  ('${MATRIX.staffClaimUser}', '${MATRIX.staffClaimEmail}', 'E612 Dual Staff'),
  ('${MATRIX.staffPositiveUser}', '${MATRIX.staffPositiveEmail}', NULL),
  ('${MATRIX.managementUser}', '${MATRIX.managementEmail}', NULL)
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
INSERT INTO public.provider_groups (id, org_id, name)
VALUES ('${MATRIX.revisionGroup}', '${E612.orgA}', 'E612 Revision Group')
ON CONFLICT (id) DO NOTHING;
INSERT INTO private.client_identity_classifications
  (auth_user_id, org_id, email_normalized, state, expires_at)
VALUES ('${MATRIX.staffClaimUser}', '${E612.orgA}', '${MATRIX.staffClaimEmail}', 'active', NULL)
ON CONFLICT (auth_user_id, org_id) DO NOTHING;
INSERT INTO private.client_access
  (id, auth_user_id, org_id, classification_id, state)
VALUES
  ('${MATRIX.dualAccess}', '${E612.dual}', '${E612.orgA}',
   (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.dual}' AND org_id = '${E612.orgA}'), 'active')
ON CONFLICT (id) DO NOTHING;
INSERT INTO private.client_group_grants (access_id, org_id, group_id)
VALUES
  ('${MATRIX.dualAccess}', '${E612.orgA}', '${E612.groupA1}'),
  ('${MATRIX.dualAccess}', '${E612.orgA}', '${E612.groupA2}')
ON CONFLICT (access_id, group_id) DO NOTHING;
INSERT INTO public.pending_invites
  (id, org_id, email, role, full_name, invited_by)
VALUES
  ('${MATRIX.staffInviteId}', '${E612.orgA}', '${MATRIX.staffPositiveEmail}', 'billing', 'E612 Claimed Staff', '${E612.admin}'),
  ('${MATRIX.restrictedStaffInviteId}', '${E612.orgA}', 'active@e612.test', 'billing', 'E612 Restricted Staff', '${E612.admin}'),
  ('${MATRIX.dualStaffInviteId}', '${E612.orgA}', '${MATRIX.staffClaimEmail}', 'specialist', 'E612 Dual Staff', '${E612.admin}');
`;
}

function globalFixtureSql() {
  return `
INSERT INTO public.payers
  (id, org_id, name, is_active, payer_kind, payer_slug, states, status)
VALUES
  ('${GLOBAL.payer}', NULL, 'E612 Global Payer', TRUE, 'commercial', 'e612-global-payer', ARRAY['CO']::text[], 'active')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.org_payer_assignments (org_id, payer_id, starter)
VALUES ('${E612.orgA}', '${GLOBAL.payer}', TRUE)
ON CONFLICT (org_id, payer_id) DO NOTHING;
INSERT INTO public.portals
  (id, org_id, portal_key, name, payer_id, form_url)
VALUES
  ('${GLOBAL.portal}', NULL, 'e612-global-portal', 'E612 Global Portal', '${GLOBAL.payer}', 'https://e612.test/portal')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.portal_field_maps
  (id, org_id, portal_key, selector, map_type, source, field_type, status, notes)
VALUES
  ('${GLOBAL.fieldMap}', NULL, 'e612-global-portal', '#e612-field', 'web', 'manual', 'text', 'proposed', 'E612 native fixture')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.sop_templates
  (id, org_id, name, payer_id, state, states, group_id, task_definitions, archived, current_version, required_profile_attributes)
VALUES
  ('${GLOBAL.sop}', NULL, 'E612 Global SOP', '${GLOBAL.payer}', 'CO', ARRAY['CO']::text[], NULL, '[]'::jsonb, FALSE, 1, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.sop_template_versions
  (template_id, version, name, task_definitions, change_note, published_by, required_profile_attributes)
VALUES
  ('${GLOBAL.sop}', 1, 'E612 Global SOP', '[]'::jsonb, 'E612 native fixture', '${E612.trainer}', '[]'::jsonb)
ON CONFLICT (template_id, version) DO NOTHING;
INSERT INTO public.payer_forms
  (id, template_id, payer_id, family_id, version, label, file_name, storage_path, mime_type, byte_size, created_by)
VALUES
  ('${GLOBAL.form}', '${GLOBAL.sop}', '${GLOBAL.payer}', '64000000-0000-4000-8000-000000000002', 1, 'E612 Global Form', 'e612.pdf', 'payer/${GLOBAL.payer}/e612/1/e612.pdf', 'application/pdf', 128, '${E612.trainer}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.inbound_leads (id, org_name, contact_name, contact_email, contact_phone, status)
VALUES ('${GLOBAL.lead}', 'E612 Lead', 'E612 Contact', 'lead@e612.test', '303-555-0111', 'new')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.payer_catalog_changes (id, payer_id, field, old_value, new_value, source, review_state)
VALUES ('${GLOBAL.catalogChange}', '${GLOBAL.payer}', 'name', 'E612 Global Payer', 'E612 Global Payer Updated', 'sync', 'unreviewed')
ON CONFLICT (id) DO NOTHING;
`;
}

function globalChecks() {
  const trainerPayers = query(
    asRole(
      "authenticated",
      E612.trainer,
      `SELECT count(*) FROM public.list_global_payers() WHERE id = '${GLOBAL.payer}';`,
    ),
  );
  if (trainerPayers !== "1") fail("E612_ZERO_MEMBERSHIP_TRAINER_GLOBAL_PAYER_READ_MISSING");
  const trainerMaps = query(
    asRole(
      "authenticated",
      E612.trainer,
      `SELECT count(*) FROM public.portal_field_maps WHERE id = '${GLOBAL.fieldMap}';`,
    ),
  );
  if (trainerMaps !== "1") fail("E612_TRAINER_GLOBAL_FIELD_MAP_READ_MISSING");
  const billingRows = query(
    asRole(
      "authenticated",
      E612.billing,
      `SELECT (SELECT count(*) FROM public.payers WHERE id = '${GLOBAL.payer}') || '|' || (SELECT count(*) FROM public.sop_templates WHERE id = '${GLOBAL.sop}') || '|' || (SELECT count(*) FROM public.sop_template_versions WHERE template_id = '${GLOBAL.sop}') || '|' || (SELECT count(*) FROM public.payer_forms WHERE id = '${GLOBAL.form}');`,
    ),
  );
  if (billingRows !== "1|1|1|1") fail("E612_ORG_ASSIGNED_GLOBAL_REFERENCE_READ_MISSING");
  const ordinaryGroup = query(
    asRole(
      "authenticated",
      E612.billing,
      `SELECT count(*) FROM public.provider_groups WHERE id = '${E612.groupA1}' AND org_id = '${E612.orgA}';`,
    ),
  );
  assertEqual("global_rpc.ordinary_reference_positive", ordinaryGroup, "1");
  const leadRows = query(
    asRole(
      "authenticated",
      E612.billing,
      `SELECT count(*) FROM public.inbound_leads WHERE id = '${GLOBAL.lead}';`,
    ),
  );
  if (leadRows !== "1") fail("E612_LEGACY_INBOUND_LEAD_READ_REGRESSION");
  expectedSqlError(
    "catalog_change.browser_denied",
    asRole(
      "authenticated",
      E612.billing,
      `SELECT count(*) FROM public.payer_catalog_changes WHERE id = '${GLOBAL.catalogChange}';`,
    ),
    ["42501"],
  );
  if (
    query(
      asRole(
        "service_role",
        E612.operator,
        `SELECT count(*) FROM public.payer_catalog_changes WHERE id = '${GLOBAL.catalogChange}';`,
      ),
    ) !== "1"
  )
    fail("E612_SERVICE_CATALOG_REVIEW_READ_MISSING");

  const trainerPortal = query(
    asRole(
      "authenticated",
      E612.trainer,
      `SELECT (public.upsert_global_portal('${GLOBAL.portal}', 'E612 Global Portal Edited', 'e612-global-portal', '${GLOBAL.payer}', 'https://e612.test/portal')).id;`,
    ),
  );
  assertEqual("global_rpc.upsert_portal_return", trainerPortal, GLOBAL.portal);
  assertEqual(
    "global_rpc.upsert_portal_effect",
    query(`SELECT name FROM public.portals WHERE id = '${GLOBAL.portal}';`),
    "E612 Global Portal Edited",
  );

  const trainerFlagsReturn = query(
    asRole(
      "authenticated",
      E612.trainer,
      `SELECT (public.set_global_portal_flags('${GLOBAL.portal}', TRUE, TRUE)).id;`,
    ),
  );
  assertEqual("global_rpc.set_flags_return", trainerFlagsReturn, GLOBAL.portal);
  const trainerFlags = query(`
    SELECT CASE WHEN is_verified THEN 'true' ELSE 'false' END || '|' ||
           CASE WHEN proven_at IS NOT NULL THEN 'true' ELSE 'false' END
      FROM public.portals WHERE id = '${GLOBAL.portal}';
  `);
  assertEqual("global_rpc.set_flags_stored_effect", trainerFlags, "true|true");

  const authoredSop = query(
    asRole(
      "authenticated",
      E612.trainer,
      `SELECT (public.author_global_sop('${GLOBAL.sop}', 'E612 Global SOP Edited', '${GLOBAL.payer}', ARRAY['UT']::text[], NULL, '[]'::jsonb, FALSE, '[]'::jsonb))->>'id';`,
    ),
  );
  assertEqual("global_rpc.author_sop_return", authoredSop, GLOBAL.sop);
  assertEqual(
    "global_rpc.author_sop_effect",
    query(
      `SELECT name || '|' || state || '|' || states[1] FROM public.sop_templates WHERE id = '${GLOBAL.sop}';`,
    ),
    "E612 Global SOP|UT|UT",
  );

  const published = query(
    asRole(
      "authenticated",
      E612.trainer,
      `SELECT (public.publish_sop_template_version('${GLOBAL.sop}', 1, 'E612 Global SOP v2', '[]'::jsonb, 'E612 publish', '[]'::jsonb))->>'version';`,
    ),
  );
  assertEqual("global_rpc.publish_sop_return", published, "2");
  assertEqual(
    "global_rpc.publish_sop_effect",
    query(
      `SELECT (SELECT current_version::text FROM public.sop_templates WHERE id = '${GLOBAL.sop}') || '|' || (SELECT count(*)::text FROM public.sop_template_versions WHERE template_id = '${GLOBAL.sop}');`,
    ),
    "2|2",
  );

  const proposedMap = query(
    asRole(
      "authenticated",
      E612.trainer,
      `SELECT (public.propose_shared_field_map('e612-global-portal', '#e612-field-2', 'E612 Field', 'credentialing', 'step-1', 'text', 1, 'E612', NULL, 'web')).id;`,
    ),
  );
  if (!/^[0-9a-f-]{36}$/.test(proposedMap)) fail("E612_GLOBAL_PROPOSE_RETURN_INVALID");
  assertEqual(
    "global_rpc.propose_effect",
    query(`SELECT status FROM public.portal_field_maps WHERE id = '${proposedMap}';`),
    "proposed",
  );

  const trainedMap = query(
    asRole(
      "authenticated",
      E612.trainer,
      `SELECT (public.train_global_field_map('${GLOBAL.fieldMap}', 'approved', 'manual', NULL, 'E612 Field', NULL, NULL)).id;`,
    ),
  );
  assertEqual("global_rpc.train_return", trainedMap, GLOBAL.fieldMap);
  assertEqual(
    "global_rpc.train_effect",
    query(
      `SELECT status || '|' || source FROM public.portal_field_maps WHERE id = '${GLOBAL.fieldMap}';`,
    ),
    "approved|manual",
  );

  const registryRows = query(
    asRole(
      "authenticated",
      E612.trainer,
      `SELECT count(*)::text FROM public.update_shared_field_registry(jsonb_build_array(jsonb_build_object('id', '${GLOBAL.fieldMap}', 'display_label', 'E612 Registry Label')));`,
    ),
  );
  assertEqual("global_rpc.registry_return", registryRows, "1");
  assertEqual(
    "global_rpc.registry_effect",
    query(`SELECT display_label FROM public.portal_field_maps WHERE id = '${GLOBAL.fieldMap}';`),
    "E612 Registry Label",
  );
  emit("E612|PASS|global_rpc.trainer_positive_outputs_and_effects");

  const globalRpc = [
    `SELECT public.upsert_global_portal('${GLOBAL.portal}', 'E612 Restricted Edit', 'e612-global-portal', '${GLOBAL.payer}', 'https://e612.test/restricted');`,
    `SELECT public.set_global_portal_flags('${GLOBAL.portal}', FALSE, FALSE);`,
    `SELECT public.author_global_sop('${GLOBAL.sop}', 'E612 Restricted SOP', '${GLOBAL.payer}', ARRAY['CO']::text[], NULL, '[]'::jsonb, FALSE, '[]'::jsonb);`,
    `SELECT public.publish_sop_template_version('${GLOBAL.sop}', 2, 'E612 Restricted SOP v3', '[]'::jsonb, 'E612 restricted', '[]'::jsonb);`,
    `SELECT public.propose_shared_field_map('e612-global-portal', '#e612-restricted', 'E612 Restricted Field', 'credentialing', 'step-1', 'text', 1, 'E612', NULL, 'web');`,
    `SELECT public.train_global_field_map('${GLOBAL.fieldMap}', 'approved', 'manual', NULL, 'E612 Restricted Field', NULL, NULL);`,
    `SELECT public.update_shared_field_registry(jsonb_build_array(jsonb_build_object('id', '${GLOBAL.fieldMap}')));`,
  ];
  const denied = [E612.clientPending, E612.clientActive, E612.clientNoGrant, E612.clientRevoked];
  for (const userId of denied) {
    for (const [index, statement] of globalRpc.entries()) {
      expectedSqlError(
        `global_rpc.restricted.${userId.slice(-3)}.${index}`,
        asRole("authenticated", userId, statement),
        ["P0001"],
        "Restricted client cannot modify global training surfaces",
      );
    }
    const list = query(
      asRole(
        "authenticated",
        userId,
        `SELECT count(*) FROM public.list_global_payers() WHERE id = '${GLOBAL.payer}';`,
      ),
    );
    if (list !== "0") fail(`E612_RESTRICTED_GLOBAL_PAYER_LIST_LEAK_${userId}`);
    if (
      query(
        asRole(
          "authenticated",
          userId,
          `SELECT count(*) FROM public.inbound_leads WHERE id = '${GLOBAL.lead}';`,
        ),
      ) !== "0"
    )
      fail(`E612_RESTRICTED_INBOUND_LEAD_LEAK_${userId}`);
    emit(`E612|PASS|inbound_leads.restricted.${userId.slice(-3)}`);
    if (
      query(
        asRole(
          "authenticated",
          userId,
          `SELECT count(*) FROM public.payer_forms WHERE id = '${GLOBAL.form}';`,
        ),
      ) !== "0"
    )
      fail(`E612_RESTRICTED_PAYER_FORM_LEAK_${userId}`);
    emit(`E612|PASS|payer_forms.restricted.${userId.slice(-3)}`);
    for (const [label, statement] of [
      ["portals", `SELECT count(*) FROM public.portals WHERE id = '${GLOBAL.portal}';`],
      [
        "portal_field_maps",
        `SELECT count(*) FROM public.portal_field_maps WHERE id = '${GLOBAL.fieldMap}';`,
      ],
      ["sop_templates", `SELECT count(*) FROM public.sop_templates WHERE id = '${GLOBAL.sop}';`],
      [
        "sop_template_versions",
        `SELECT count(*) FROM public.sop_template_versions WHERE template_id = '${GLOBAL.sop}';`,
      ],
    ]) {
      if (query(asRole("authenticated", userId, statement)) !== "0")
        fail(`E612_RESTRICTED_${label.toUpperCase()}_LEAK_${userId}`);
      emit(`E612|PASS|${label}.restricted.${userId.slice(-3)}`);
    }
  }
  const trainerDirectSurfaces = [
    ["portals", `SELECT count(*) FROM public.portals WHERE id = '${GLOBAL.portal}';`],
    [
      "portal_field_maps",
      `SELECT count(*) FROM public.portal_field_maps WHERE id = '${GLOBAL.fieldMap}';`,
    ],
    ["sop_templates", `SELECT count(*) FROM public.sop_templates WHERE id = '${GLOBAL.sop}';`],
    [
      "sop_template_versions",
      `SELECT count(*) FROM public.sop_template_versions WHERE template_id = '${GLOBAL.sop}';`,
    ],
    ["payer_forms", `SELECT count(*) FROM public.payer_forms WHERE id = '${GLOBAL.form}';`],
  ];
  for (const [label, statement] of trainerDirectSurfaces) {
    if (!/^[1-9]\d*$/.test(query(asRole("authenticated", E612.trainer, statement))))
      fail(`E612_TRAINER_${label.toUpperCase()}_POSITIVE_MISSING`);
    emit(`E612|PASS|${label}.trainer_positive`);
  }
  emit("E612|PASS|restricted.global_training_and_direct_surface_denials");
}

function coherenceChecks() {
  const fkCases = [
    [
      "coherence.access_classification_user_crosswire",
      `INSERT INTO private.client_access (id, auth_user_id, org_id, classification_id, state)
       VALUES ('40000000-0000-4000-8000-000000000010', '${MATRIX.staffClaimUser}', '${E612.orgA}',
         (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientActive}' AND org_id = '${E612.orgA}'), 'active');`,
    ],
    [
      "coherence.access_classification_org_crosswire",
      `INSERT INTO private.client_access (id, auth_user_id, org_id, classification_id, state)
       VALUES ('40000000-0000-4000-8000-000000000011', '${E612.clientActive}', '${E612.orgB}',
         (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientActive}' AND org_id = '${E612.orgA}'), 'active');`,
    ],
    [
      "coherence.invite_classification_user_crosswire",
      `INSERT INTO private.client_invites (id, auth_user_id, org_id, classification_id, email_normalized, token_hash, state, expires_at, created_by)
       VALUES ('50000000-0000-4000-8000-000000000010', '${E612.clientNoGrant}', '${E612.orgA}',
         (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientActive}' AND org_id = '${E612.orgA}'),
         'nogrant@e612.test', repeat('a', 64), 'pending', now() + interval '7 days', '${E612.admin}');`,
    ],
    [
      "coherence.invite_classification_org_crosswire",
      `INSERT INTO private.client_invites (id, auth_user_id, org_id, classification_id, email_normalized, token_hash, state, expires_at, created_by)
       VALUES ('50000000-0000-4000-8000-000000000011', '${E612.clientActive}', '${E612.orgB}',
         (SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientActive}' AND org_id = '${E612.orgA}'),
         'active@e612.test', repeat('b', 64), 'pending', now() + interval '7 days', '${E612.admin}');`,
    ],
    [
      "coherence.access_group_parent_correct_wrong_group",
      `INSERT INTO private.client_group_grants (access_id, org_id, group_id)
       VALUES ('${E612.accessNoGrant}', '${E612.orgA}', '${E612.groupB1}');`,
    ],
    [
      "coherence.access_group_parent_wrong_correct_group",
      `INSERT INTO private.client_group_grants (access_id, org_id, group_id)
       VALUES ('${E612.accessNoGrant}', '${E612.orgB}', '${E612.groupB1}');`,
    ],
    [
      "coherence.invite_group_parent_correct_wrong_group",
      `INSERT INTO private.client_invite_group_grants (invite_id, org_id, group_id)
       VALUES ('${E612.inviteEmailChange}', '${E612.orgA}', '${E612.groupB1}');`,
    ],
    [
      "coherence.invite_group_parent_wrong_correct_group",
      `INSERT INTO private.client_invite_group_grants (invite_id, org_id, group_id)
       VALUES ('${E612.inviteEmailChange}', '${E612.orgB}', '${E612.groupB1}');`,
    ],
  ];
  for (const [label, statement] of fkCases)
    expectedSqlError(label, asRole("service_role", E612.operator, statement), ["23503"]);
  emit("E612|PASS|coherence.composite_fk_crosswire_denials");

  const issued = jsonQuery(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.create_client_invite('${E612.admin}', '${E612.orgA}', '${MATRIX.firstClaimEmail}', ARRAY['${E612.groupA1}', '${E612.groupA2}']::uuid[]);`,
    ),
    "coherence.first_issue",
  );
  if (
    typeof issued.inviteId !== "string" ||
    typeof issued.token !== "string" ||
    typeof issued.expiresAt !== "string"
  )
    fail("E612_FIRST_ISSUE_RESPONSE_INCOMPLETE");
  const firstClassification = query(
    `SELECT id FROM private.client_identity_classifications WHERE auth_user_id = '${MATRIX.firstClaimUser}' AND org_id = '${E612.orgA}';`,
  );
  const beforeAudit = Number(
    query(
      `SELECT count(*) FROM public.audit_log WHERE entity_type = 'client_access' AND entity_id = '${MATRIX.firstClaimUser}';`,
    ),
  );
  const claimed = jsonQuery(
    asRole(
      "service_role",
      MATRIX.firstClaimUser,
      `SELECT public.claim_client_invite('${MATRIX.firstClaimUser}', '${issued.token}');`,
    ),
    "coherence.first_claim",
  );
  if (
    claimed.accessId === undefined ||
    claimed.organizationId !== E612.orgA ||
    JSON.stringify(claimed.groupIds) !== JSON.stringify([E612.groupA1, E612.groupA2])
  )
    fail("E612_FIRST_CLAIM_RESPONSE_OR_GROUPS_DRIFT");
  const stored = query(`
    SELECT i.state || '|' || (i.token_hash = '${tokenHash(issued.token)}')::text || '|' ||
           (i.expires_at > now() + interval '6 days 23 hours')::text || '|' ||
           (i.expires_at < now() + interval '7 days 1 minute')::text || '|' ||
           c.state || '|' ||
           (SELECT count(*)::text FROM private.client_group_grants g WHERE g.access_id = '${claimed.accessId}') || '|' ||
           (SELECT string_agg(g.group_id::text, ',' ORDER BY g.group_id) FROM private.client_group_grants g WHERE g.access_id = '${claimed.accessId}')
      FROM private.client_invites i
      JOIN private.client_identity_classifications c ON c.id = i.classification_id
     WHERE i.id = '${issued.inviteId}';
  `);
  assertEqual(
    "coherence.first_claim_stored_state",
    stored,
    `claimed|true|true|true|active|2|${E612.groupA1},${E612.groupA2}`,
  );
  assertEqual(
    "coherence.first_claim_no_membership",
    query(
      `SELECT count(*) FROM public.memberships WHERE user_id = '${MATRIX.firstClaimUser}' AND org_id = '${E612.orgA}';`,
    ),
    "0",
  );
  const afterAudit = Number(
    query(
      `SELECT count(*) FROM public.audit_log WHERE entity_type = 'client_access' AND entity_id = '${claimed.accessId}';`,
    ),
  );
  if (afterAudit - beforeAudit !== 1)
    fail(`E612_FIRST_CLAIM_AUDIT_COUNT_${afterAudit - beforeAudit}`);
  if (firstClassification === "") fail("E612_FIRST_CLAIM_CLASSIFICATION_MISSING");
  emit("E612|PASS|coherence.issue_claim_hash_expiry_groups_audit");

  const rollbackIssued = jsonQuery(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.create_client_invite('${E612.admin}', '${E612.orgA}', '${MATRIX.rollbackEmail}', ARRAY['${E612.groupA1}']::uuid[]);`,
    ),
    "coherence.rollback_issue",
  );
  sql(`
    CREATE OR REPLACE FUNCTION public.e612_fail_after_claim()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'E612 forced after-write failure';
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER e612_fail_after_claim_trigger
      AFTER INSERT ON private.client_group_grants
      FOR EACH ROW EXECUTE FUNCTION public.e612_fail_after_claim();
  `);
  expectedSqlError(
    "coherence.claim_after_write_rollback",
    asRole(
      "service_role",
      MATRIX.rollbackUser,
      `SELECT public.claim_client_invite('${MATRIX.rollbackUser}', '${rollbackIssued.token}');`,
    ),
    ["P0001"],
    "E612 forced after-write failure",
  );
  sql(
    "DROP TRIGGER e612_fail_after_claim_trigger ON private.client_group_grants; DROP FUNCTION public.e612_fail_after_claim();",
  );
  const rollbackState = query(`
    SELECT (SELECT count(*)::text FROM private.client_access WHERE auth_user_id = '${MATRIX.rollbackUser}' AND org_id = '${E612.orgA}') || '|' ||
           (SELECT state FROM private.client_invites WHERE id = '${rollbackIssued.inviteId}') || '|' ||
           (SELECT state FROM private.client_identity_classifications WHERE auth_user_id = '${MATRIX.rollbackUser}' AND org_id = '${E612.orgA}') || '|' ||
           (SELECT count(*)::text FROM private.client_invite_group_grants WHERE invite_id = '${rollbackIssued.inviteId}') || '|' ||
           (SELECT count(*)::text FROM public.audit_log WHERE entity_type = 'client_access' AND description LIKE '%Claimed restricted client invite atomically%' AND user_id = '${MATRIX.rollbackUser}') || '|' ||
           (SELECT count(*)::text FROM public.memberships WHERE user_id = '${MATRIX.rollbackUser}' AND org_id = '${E612.orgA}');
  `);
  assertEqual(
    "coherence.claim_after_write_rollback_effects",
    rollbackState,
    "0|pending|pending|1|0|0",
  );
  emit("E612|PASS|coherence.after_write_atomic_rollback");
}

function inviteChecks() {
  const functions = query(`
    SELECT p.proname || '|' || pg_get_function_identity_arguments(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname ILIKE '%client%invite%'
    ORDER BY 1;
  `);
  if (!functions) fail("E612_CLIENT_INVITE_RPC_MISSING");
  emit(`E612|INVENTORY|client_invite_rpcs=${functions.split("\n").length}`);
  const pendingCount = query(
    `SELECT count(*) FROM private.client_invites WHERE id = '${E612.invitePending}' AND token_hash = '${tokenHash(TOKENS.pending)}';`,
  );
  if (pendingCount !== "1") fail("E612_INVITE_HASH_OR_FIXTURE_MISMATCH");
  emit("E612|PASS|invite.hashed_at_rest");
  // A direct email change before the claim must leave the user-bound
  // restricted classification in place; the application HTTP verifier covers
  // the Auth endpoint and this native phase proves the durable state.
  sql(
    `UPDATE auth.users SET email = 'changed-before-claim@e612.test' WHERE id = '${E612.clientPending}';`,
  );
  const classification = query(
    `SELECT count(*) FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientPending}' AND state = 'pending';`,
  );
  if (classification !== "1") fail("E612_EMAIL_CHANGE_DROPPED_DURABLE_CLASSIFICATION");
  emit("E612|PASS|invite.email_change_keeps_restriction");
  expectedSqlError(
    "claim_invite.email_changed",
    asRole(
      "service_role",
      E612.clientPending,
      `SELECT public.claim_client_invite('${E612.clientPending}', '${TOKENS.pending}');`,
    ),
    ["P0001"],
    "Invite email does not match verified actor",
  );
  expectedServiceError(
    "claim_invite.email_changed_domain_check",
    asRole(
      "service_role",
      E612.clientPending,
      `SELECT public.claim_client_invite('${E612.clientPending}', '${TOKENS.emailChange}');`,
    ),
    "Invite email does not match verified actor",
  );
  const unchanged = query(`
    SELECT (SELECT state FROM private.client_invites WHERE id = '${E612.inviteEmailChange}') || '|' ||
           (SELECT state FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientPending}' AND org_id = '${E612.orgA}');
  `);
  if (unchanged !== "pending|pending") fail("E612_EMAIL_CHANGE_ERROR_MUTATED_RESTRICTION");
  const expiry = query(
    `SELECT expires_at < now() FROM private.client_invites WHERE id = '${E612.inviteExpiry}';`,
  );
  if (expiry !== "t") fail("E612_EXPIRY_FIXTURE_NOT_EXPIRED");
  expectedServiceError(
    "claim_invite.expiry_domain_check",
    asRole(
      "service_role",
      E612.clientNoGrant,
      `SELECT public.claim_client_invite('${E612.clientNoGrant}', '${TOKENS.expiry}');`,
    ),
    "Invite is expired",
  );
  const expired = query(`
    SELECT (SELECT state FROM private.client_invites WHERE id = '${E612.inviteExpiry}') || '|' ||
           (SELECT state FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientNoGrant}' AND org_id = '${E612.orgA}');
  `);
  if (expired !== "pending|active") fail("E612_EXPIRY_ERROR_NOT_ATOMIC");
  emit("E612|PASS|invite.expiry_fixture");
  expectedServiceError(
    "claim_invite.replay_domain_check",
    asRole(
      "service_role",
      E612.clientActive,
      `SELECT public.claim_client_invite('${E612.clientActive}', '${TOKENS.replay}');`,
    ),
    "Invite is invalid or already claimed",
  );
  if (
    query(`SELECT state FROM private.client_invites WHERE id = '${E612.inviteReplay}';`) !==
    "claimed"
  ) {
    fail("E612_REPLAY_ERROR_MUTATED_INVITE");
  }
  emit("E612|PASS|invite.replay_fixture");
}

async function concurrencyCheck() {
  // The migration must expose an atomic claim path. Find the canonical claim
  // function by identity, then run two real authenticated sessions against one
  // invite. If the RPC name or argument contract changes, fail closed instead
  // of silently skipping the winner/loser proof.
  const candidates = query(`
    SELECT p.oid::text || '|' || p.proname || '|' || pg_get_function_identity_arguments(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('claim_client_invite','claim_client_access_invite')
    ORDER BY p.oid;
  `)
    .split("\n")
    .filter(Boolean);
  if (candidates.length !== 1) fail("E612_ATOMIC_CLAIM_RPC_CONTRACT_AMBIGUOUS");
  const [, name] = candidates[0].split("|");
  const claimSql = `SET ROLE service_role; ${claims(E612.clientActive, "service_role")} SELECT public.${name}('${E612.clientActive}', '${TOKENS.race}');`;
  const beforeAudit = Number(
    query(
      `SELECT count(*) FROM public.audit_log WHERE entity_type = 'client_access' AND entity_id = '${E612.accessActive}' AND user_id = '${E612.clientActive}';`,
    ),
  );
  const [a, b] = await Promise.all([runSqlChild(claimSql), runSqlChild(claimSql)]);
  if (a.code === 0 && b.code === 0) fail("E612_ATOMIC_CLAIM_TWO_WINNERS");
  const winnerCount = [a, b].filter((result) => result.code === 0).length;
  if (winnerCount !== 1 || a.timedOut || b.timedOut) fail("E612_ATOMIC_CLAIM_NO_SINGLE_WINNER");
  const winner = [a, b].find((result) => result.code === 0);
  const loser = [a, b].find((result) => result.code !== 0);
  let winnerPayload;
  try {
    winnerPayload = JSON.parse(winner.out.trim().split("\n").filter(Boolean).at(-1));
  } catch {
    fail("E612_ATOMIC_CLAIM_WINNER_RESPONSE_INVALID");
  }
  if (
    winnerPayload.accessId !== E612.accessActive ||
    winnerPayload.organizationId !== E612.orgA ||
    JSON.stringify(winnerPayload.groupIds) !== JSON.stringify([E612.groupA1])
  )
    fail("E612_ATOMIC_CLAIM_WINNER_PAYLOAD_DRIFT");
  if (
    !/(?:ERROR|SQLSTATE|SQL state)[: ]+P0001/i.test(loser.err) ||
    !loser.err.includes("Invite is invalid or already claimed")
  )
    fail(`E612_ATOMIC_CLAIM_LOSER_CAUSE_DRIFT_${loser.err.replaceAll("\n", " ").slice(0, 180)}`);
  const access = query(`
    SELECT (SELECT id || '|' || state FROM private.client_access WHERE auth_user_id = '${E612.clientActive}' AND org_id = '${E612.orgA}') || '|' ||
           (SELECT state FROM private.client_invites WHERE id = '${E612.inviteRace}') || '|' ||
           (SELECT string_agg(group_id::text, ',' ORDER BY group_id) FROM private.client_group_grants WHERE access_id = '${E612.accessActive}') || '|' ||
           (SELECT count(*)::text FROM public.audit_log WHERE entity_type = 'client_access' AND entity_id = '${E612.accessActive}' AND user_id = '${E612.clientActive}');
  `);
  if (access !== `${E612.accessActive}|active|claimed|${E612.groupA1}|${beforeAudit + 1}`)
    fail(`E612_EXISTING_ACCESS_UPSERT_CHANGED_ACCESS_OR_AUDIT_${access}`);
  emit("E612|PASS|invite.existing_access_upsert");
  emit("E612|PASS|invite.concurrent_single_winner_exact_loser");
}

function replacementRevocationCheck() {
  const restored = jsonQuery(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.set_client_group_grants('${E612.admin}', '${E612.accessActive}', ARRAY['${E612.groupA1}', '${E612.groupA2}']::uuid[]);`,
    ),
    "replacement.restore_groups",
  );
  if (JSON.stringify(restored.groupIds) !== JSON.stringify([E612.groupA1, E612.groupA2]))
    fail("E612_REPLACEMENT_RESTORE_GROUPS_RESPONSE_DRIFT");

  const issued = query(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.create_client_invite('${E612.admin}', '${E612.orgA}', 'active@e612.test', ARRAY['${E612.groupA1}', '${E612.groupA2}']::uuid[]);`,
    ),
  );
  let token;
  try {
    token = JSON.parse(issued).token;
  } catch {
    fail("E612_REPLACEMENT_INVITE_RESPONSE_INVALID");
  }
  if (typeof token !== "string" || token.length < 16) fail("E612_REPLACEMENT_INVITE_TOKEN_MISSING");
  const replacementInvite = query(
    `SELECT id FROM private.client_invites WHERE token_hash = '${tokenHash(token)}';`,
  );
  const setAfterReplacement = jsonQuery(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.set_client_group_grants('${E612.admin}', '${E612.accessActive}', ARRAY['${E612.groupA1}']::uuid[]);`,
    ),
    "replacement.set_after_issue",
  );
  if (JSON.stringify(setAfterReplacement.groupIds) !== JSON.stringify([E612.groupA1]))
    fail("E612_REPLACEMENT_SET_AFTER_ISSUE_RESPONSE_DRIFT");
  expectedServiceError(
    "claim_invite.replacement_invalidated_by_set",
    asRole(
      "service_role",
      E612.clientActive,
      `SELECT public.claim_client_invite('${E612.clientActive}', '${token}');`,
    ),
    "Invite is invalid or already claimed",
  );
  const replacementState = query(`
    SELECT (SELECT state FROM private.client_access WHERE id = '${E612.accessActive}') || '|' ||
           (SELECT string_agg(group_id::text, ',' ORDER BY group_id) FROM private.client_group_grants WHERE access_id = '${E612.accessActive}') || '|' ||
           (SELECT state FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientActive}' AND org_id = '${E612.orgA}') || '|' ||
           (SELECT state FROM private.client_invites WHERE id = '${replacementInvite}') || '|' ||
           (SELECT count(*)::text FROM private.client_invite_group_grants WHERE invite_id = '${replacementInvite}');
  `);
  assertEqual(
    "replacement.set_invalidates_old_token",
    replacementState,
    `active|${E612.groupA1}|active|revoked|0`,
  );
  emit("E612|PASS|replacement.grant_reduction_invalidates_old_token");

  const revokedIssued = query(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.create_client_invite('${E612.admin}', '${E612.orgA}', 'active@e612.test', ARRAY['${E612.groupA1}', '${E612.groupA2}']::uuid[]);`,
    ),
  );
  let revokedToken;
  try {
    revokedToken = JSON.parse(revokedIssued).token;
  } catch {
    fail("E612_REVOKE_REISSUE_RESPONSE_INVALID");
  }
  if (typeof revokedToken !== "string") fail("E612_REVOKE_REISSUE_TOKEN_MISSING");
  sql(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.revoke_client_access('${E612.admin}', '${E612.accessActive}');`,
    ),
  );
  expectedServiceError(
    "claim_invite.revoked_replacement_denial",
    asRole(
      "service_role",
      E612.clientActive,
      `SELECT public.claim_client_invite('${E612.clientActive}', '${revokedToken}');`,
    ),
    "Invite is invalid or already claimed",
  );
  const durable = query(`
    SELECT (SELECT state FROM private.client_access WHERE id = '${E612.accessActive}') || '|' ||
           (SELECT state FROM private.client_identity_classifications WHERE auth_user_id = '${E612.clientActive}' AND org_id = '${E612.orgA}') || '|' ||
           (SELECT count(*)::text FROM private.client_invites i WHERE i.classification_id = (SELECT classification_id FROM private.client_access WHERE id = '${E612.accessActive}') AND i.state = 'pending');
  `);
  if (durable !== "revoked|revoked|0")
    fail("E612_REVOKED_REPLACEMENT_REACTIVATED_OR_REMAINED_PENDING");
  emit("E612|PASS|invite.revoke_before_claim_denied");

  const serialIssued = jsonQuery(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.create_client_invite('${E612.admin}', '${E612.orgA}', '${MATRIX.managementEmail}', ARRAY['${E612.groupA1}']::uuid[]);`,
    ),
    "replacement.serial_issue",
  );
  const serialClaim = jsonQuery(
    asRole(
      "service_role",
      MATRIX.managementUser,
      `SELECT public.claim_client_invite('${MATRIX.managementUser}', '${serialIssued.token}');`,
    ),
    "replacement.serial_claim",
  );
  sql(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.revoke_client_access('${E612.admin}', '${serialClaim.accessId}');`,
    ),
  );
  expectedServiceError(
    "replacement.serial_old_token_after_revoke",
    asRole(
      "service_role",
      MATRIX.managementUser,
      `SELECT public.claim_client_invite('${MATRIX.managementUser}', '${serialIssued.token}');`,
    ),
    "Invite is invalid or already claimed",
  );
  const reissued = jsonQuery(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.create_client_invite('${E612.admin}', '${E612.orgA}', '${MATRIX.managementEmail}', ARRAY['${E612.groupA1}']::uuid[]);`,
    ),
    "replacement.serial_reissue",
  );
  const reClaimed = jsonQuery(
    asRole(
      "service_role",
      MATRIX.managementUser,
      `SELECT public.claim_client_invite('${MATRIX.managementUser}', '${reissued.token}');`,
    ),
    "replacement.serial_reclaim",
  );
  if (
    reClaimed.accessId !== serialClaim.accessId ||
    reClaimed.organizationId !== E612.orgA ||
    JSON.stringify(reClaimed.groupIds) !== JSON.stringify([E612.groupA1])
  )
    fail("E612_REISSUE_SERIAL_RESULT_DRIFT");
  const serialState = query(`
    SELECT (SELECT state FROM private.client_access WHERE id = '${serialClaim.accessId}') || '|' ||
           (SELECT state FROM private.client_identity_classifications WHERE auth_user_id = '${MATRIX.managementUser}' AND org_id = '${E612.orgA}') || '|' ||
           (SELECT string_agg(group_id::text, ',' ORDER BY group_id) FROM private.client_group_grants WHERE access_id = '${serialClaim.accessId}') || '|' ||
           (SELECT count(*)::text FROM private.client_invites WHERE auth_user_id = '${MATRIX.managementUser}' AND state = 'pending');
  `);
  assertEqual(
    "replacement.serial_claim_revoke_reissue_state",
    serialState,
    `active|active|${E612.groupA1}|0`,
  );
  sql(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.revoke_client_access('${E612.admin}', '${serialClaim.accessId}');`,
    ),
  );
  emit("E612|PASS|replacement.serial_claim_revoke_reissue_no_resurrection");
}

async function controlledLifecycleRaces() {
  const operationSql = ({ kind, actor, token, accessId, email }) => {
    if (kind === "claim") return `SELECT public.claim_client_invite('${actor}', '${token}');`;
    if (kind === "revoke") return `SELECT public.revoke_client_access('${actor}', '${accessId}');`;
    if (kind === "reissue")
      return `SELECT public.create_client_invite('${actor}', '${E612.orgA}', '${email}', ARRAY['${E612.groupA1}', '${E612.groupA2}']::uuid[]);`;
    fail(`E612_RACE_UNKNOWN_OPERATION_${kind}`);
  };
  const jsonFromSession = (label, result) => {
    if (result.code !== 0) fail(`E612_${label}_SESSION_FAILED`);
    const lines = result.out
      .trim()
      .split("\n")
      .filter((line) => line.startsWith("{"));
    try {
      return JSON.parse(lines.at(-1));
    } catch {
      fail(`E612_${label}_JSON_INVALID`);
    }
  };
  const assertLoserSession = (label, result) => {
    if (
      result.code === 0 ||
      !/(?:ERROR|SQLSTATE|SQL state)[: ]+P0001/i.test(result.err) ||
      !result.err.includes("Invite is invalid or already claimed")
    )
      fail(`E612_${label}_LOSER_CAUSE_DRIFT`);
  };
  const backendBlock = async (label, firstPid, secondPid) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const activity = query(`
        SELECT coalesce(wait_event_type, '') || '|' || array_to_string(pg_blocking_pids(pid), ',')
          FROM pg_stat_activity WHERE pid = ${secondPid};
      `);
      const [waitEvent, blockers = ""] = activity.split("|");
      if (waitEvent === "Lock" && blockers.split(",").includes(String(firstPid))) {
        emit(
          `E612|RACE|${label}|first_pid=${firstPid}|second_pid=${secondPid}|wait_event=Lock|blocked_by=${firstPid}`,
        );
        return;
      }
      await pause(50);
    }
    fail(`E612_${label.toUpperCase()}_BACKEND_BLOCKING_NOT_OBSERVED`);
  };
  const runHeldRace = async ({ label, first, second, firstArgs, secondArgs, secondWins }) => {
    const runId = randomUUID();
    const firstSession = spawnSqlSession();
    const secondSession = spawnSqlSession();
    const firstMarker = `E612_RACE|${runId}|first|`;
    const secondMarker = `E612_RACE|${runId}|second|`;
    const firstSql = `
      SET application_name = 'e612-${runId}-first';
      SET ROLE service_role;
      ${claims(firstArgs.actor, "service_role")}
      BEGIN;
      SELECT '${firstMarker}' || pg_backend_pid();
      ${operationSql({ kind: first, ...firstArgs })}
      SELECT '${runId}|FIRST_HOLD';
    `;
    const secondSql = `
      SET application_name = 'e612-${runId}-second';
      SET ROLE service_role;
      ${claims(secondArgs.actor, "service_role")}
      BEGIN;
      SELECT '${secondMarker}' || pg_backend_pid();
      ${operationSql({ kind: second, ...secondArgs })}
      SELECT '${runId}|SECOND_DONE';
    `;
    try {
      firstSession.write(firstSql);
      await firstSession.waitFor(`${runId}|FIRST_HOLD`);
      const firstPid = Number(
        firstSession.out
          .split("\n")
          .find((line) => line.startsWith(firstMarker))
          ?.slice(firstMarker.length),
      );
      if (!Number.isInteger(firstPid)) fail(`E612_${label.toUpperCase()}_FIRST_PID_MISSING`);
      secondSession.write(secondSql);
      await secondSession.waitFor(`${runId}|second|`);
      const secondPid = Number(
        secondSession.out
          .split("\n")
          .find((line) => line.startsWith(secondMarker))
          ?.slice(secondMarker.length),
      );
      if (!Number.isInteger(secondPid)) fail(`E612_${label.toUpperCase()}_SECOND_PID_MISSING`);
      await backendBlock(label, firstPid, secondPid);
      firstSession.write("COMMIT;\n\\q\n");
      const firstResult = await firstSession.result();
      if (firstResult.code !== 0) fail(`E612_${label.toUpperCase()}_FIRST_SESSION_FAILED`);
      const firstJson = jsonFromSession(`${label}_first`, firstResult);
      if (secondWins) {
        await secondSession.waitFor(`${runId}|SECOND_DONE`);
        secondSession.write("COMMIT;\n\\q\n");
        const secondResult = await secondSession.result();
        return {
          firstJson,
          secondJson: jsonFromSession(`${label}_second`, secondResult),
          firstPid,
          secondPid,
        };
      }
      const secondResult = await secondSession.result();
      assertLoserSession(`${label}_second`, secondResult);
      return { firstJson, secondResult, firstPid, secondPid };
    } finally {
      firstSession.kill();
      secondSession.kill();
    }
  };
  const accessFor = (userId) =>
    query(
      `SELECT id FROM private.client_access WHERE auth_user_id = '${userId}' AND org_id = '${E612.orgA}';`,
    );
  const stateFor = (userId, accessId, inviteId, auditBefore) =>
    query(`
    SELECT (SELECT state FROM private.client_access WHERE id = '${accessId}') || '|' ||
           (SELECT state FROM private.client_identity_classifications WHERE auth_user_id = '${userId}' AND org_id = '${E612.orgA}') || '|' ||
           (SELECT state FROM private.client_invites WHERE id = '${inviteId}') || '|' ||
           coalesce((SELECT string_agg(group_id::text, ',' ORDER BY group_id) FROM private.client_group_grants WHERE access_id = '${accessId}'), '') || '|' ||
           ((SELECT count(*) FROM public.audit_log WHERE entity_type = 'client_access' AND entity_id = '${accessId}') - ${auditBefore});
  `);

  const firstRaceAccess = accessFor(MATRIX.firstClaimUser);
  const firstRaceInvite = jsonQuery(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.create_client_invite('${E612.admin}', '${E612.orgA}', '${MATRIX.firstClaimEmail}', ARRAY['${E612.groupA1}', '${E612.groupA2}']::uuid[]);`,
    ),
    "race.claim_revoke_first_issue",
  );
  const firstRaceAudit = Number(
    query(
      `SELECT count(*) FROM public.audit_log WHERE entity_type = 'client_access' AND entity_id = '${firstRaceAccess}';`,
    ),
  );
  await runHeldRace({
    label: "claim_revoke_claim_first",
    first: "claim",
    second: "revoke",
    firstArgs: { actor: MATRIX.firstClaimUser, token: firstRaceInvite.token },
    secondArgs: { actor: E612.admin, accessId: firstRaceAccess },
    secondWins: true,
  });
  assertEqual(
    "race.claim_revoke_claim_first.state",
    stateFor(MATRIX.firstClaimUser, firstRaceAccess, firstRaceInvite.inviteId, firstRaceAudit),
    `revoked|revoked|claimed||2`,
  );
  emit("E612|PASS|race.claim_revoke_claim_first_serial_outcome");

  const secondRaceInvite = jsonQuery(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.create_client_invite('${E612.admin}', '${E612.orgA}', '${MATRIX.firstClaimEmail}', ARRAY['${E612.groupA1}', '${E612.groupA2}']::uuid[]);`,
    ),
    "race.claim_revoke_second_issue",
  );
  const secondRaceAudit = Number(
    query(
      `SELECT count(*) FROM public.audit_log WHERE entity_type = 'client_access' AND entity_id = '${firstRaceAccess}';`,
    ),
  );
  await runHeldRace({
    label: "revoke_claim_revoke_first",
    first: "revoke",
    second: "claim",
    firstArgs: { actor: E612.admin, accessId: firstRaceAccess },
    secondArgs: { actor: MATRIX.firstClaimUser, token: secondRaceInvite.token },
    secondWins: false,
  });
  assertEqual(
    "race.revoke_claim_revoke_first.state",
    stateFor(MATRIX.firstClaimUser, firstRaceAccess, secondRaceInvite.inviteId, secondRaceAudit),
    `revoked|revoked|revoked||1`,
  );
  emit("E612|PASS|race.revoke_claim_revoke_first_serial_outcome");

  const raceReissueEmail = MATRIX.managementEmail;
  const raceReissueAccess = accessFor(MATRIX.managementUser);
  const claimVsReissue = jsonQuery(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.create_client_invite('${E612.admin}', '${E612.orgA}', '${raceReissueEmail}', ARRAY['${E612.groupA1}', '${E612.groupA2}']::uuid[]);`,
    ),
    "race.claim_reissue_first_issue",
  );
  const reissueFirstAudit = Number(
    query(
      `SELECT count(*) FROM public.audit_log WHERE entity_type = 'client_access' AND entity_id = '${raceReissueAccess}';`,
    ),
  );
  await runHeldRace({
    label: "claim_reissue_claim_first",
    first: "claim",
    second: "reissue",
    firstArgs: { actor: MATRIX.managementUser, token: claimVsReissue.token },
    secondArgs: { actor: E612.admin, email: raceReissueEmail },
    secondWins: true,
  });
  assertEqual(
    "race.claim_reissue_claim_first.state",
    stateFor(MATRIX.managementUser, raceReissueAccess, claimVsReissue.inviteId, reissueFirstAudit),
    `active|active|claimed|${E612.groupA1},${E612.groupA2}|1`,
  );
  assertEqual(
    "race.claim_reissue_claim_first.pending_count",
    query(
      `SELECT count(*) FROM private.client_invites WHERE auth_user_id = '${MATRIX.managementUser}' AND state = 'pending';`,
    ),
    "1",
  );
  emit("E612|PASS|race.claim_reissue_claim_first_serial_outcome");

  const reissueSecondOld = jsonQuery(
    asRole(
      "service_role",
      E612.admin,
      `SELECT public.create_client_invite('${E612.admin}', '${E612.orgA}', '${raceReissueEmail}', ARRAY['${E612.groupA1}', '${E612.groupA2}']::uuid[]);`,
    ),
    "race.reissue_claim_second_issue",
  );
  const reissueSecondAudit = Number(
    query(
      `SELECT count(*) FROM public.audit_log WHERE entity_type = 'client_access' AND entity_id = '${raceReissueAccess}';`,
    ),
  );
  await runHeldRace({
    label: "reissue_claim_reissue_first",
    first: "reissue",
    second: "claim",
    firstArgs: { actor: E612.admin, email: raceReissueEmail },
    secondArgs: { actor: MATRIX.managementUser, token: reissueSecondOld.token },
    secondWins: false,
  });
  assertEqual(
    "race.reissue_claim_reissue_first.state",
    stateFor(
      MATRIX.managementUser,
      raceReissueAccess,
      reissueSecondOld.inviteId,
      reissueSecondAudit,
    ),
    `active|active|revoked|${E612.groupA1},${E612.groupA2}|0`,
  );
  assertEqual(
    "race.reissue_claim_reissue_first.pending_count",
    query(
      `SELECT count(*) FROM private.client_invites WHERE auth_user_id = '${MATRIX.managementUser}' AND state = 'pending';`,
    ),
    "1",
  );
  emit("E612|PASS|race.reissue_claim_reissue_first_serial_outcome");
  emit("E612|PASS|race.lock_order_overlap_no_resurrection");
}

let started = false;
try {
  const imageId = docker(["image", "inspect", image, "--format", "{{.Id}}"]).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) fail("E612_CACHED_IMAGE_REQUIRED");
  docker([
    "run",
    "--detach",
    "--rm",
    "--pull",
    "never",
    "--name",
    container,
    "--label",
    "com.minted.e612=synthetic-only",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    "postgres",
    "--tmpfs",
    "/tmp:rw,mode=1777",
    "--entrypoint",
    "/bin/sh",
    imageId,
    "-c",
    "initdb -D /tmp/e612-data --no-locale --encoding=UTF8 --auth=trust >/tmp/init.log 2>&1 && exec postgres -D /tmp/e612-data -k /tmp -c listen_addresses='' -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse",
  ]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      docker(["exec", container, "pg_isready", "-q", "-h", "/tmp", "-U", "postgres"]);
      ready = true;
      break;
    } catch {
      await pause(250);
    }
  }
  if (!ready) fail("E612_DATABASE_NOT_READY");
  emit(`E612|IMAGE|${imageId}`);
  emit(`E612|POSTGRES|${query("SHOW server_version;")}`);
  sql(bootstrap);
  sql("CREATE ROLE e612_native_superuser LOGIN SUPERUSER;");
  const files = migrations();
  runMigrations(files);
  emit(`E612|MIGRATIONS|${files.length}`);
  sql(authFixtureSql());
  sql(matrixAuthSql());
  emit("E612|PHASE|base_fixture");
  sql(baseFixtureSql());
  emit("E612|PHASE|restricted_fixture");
  sql(restrictedFixtureSql());
  sql(matrixFixtureSql());
  emit("E612|PHASE|global_fixture");
  sql(globalFixtureSql());
  inventory();
  catalogChecks();
  helperChecks();
  rlsChecks();
  resolverChecks();
  managementChecks();
  functionDenials();
  globalChecks();
  coherenceChecks();
  inviteChecks();
  bootstrapChecks();
  await concurrencyCheck();
  replacementRevocationCheck();
  await controlledLifecycleRaces();
  restrictedMigratorOwnershipRollbackCheck();
  sql("DROP ROLE e612_native_superuser;");
  emit("E612|NATIVE|PASS");
} catch (error) {
  const code =
    error instanceof Error && /^E612_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "E612_NATIVE_VERIFICATION_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      docker(["rm", "--force", container]);
      emit("E612|CLEANUP|PASS");
    } catch {
      process.stderr.write("E612_CLEANUP_FAILED\n");
      process.exitCode = 1;
    }
  }
}
