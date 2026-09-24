import { requireService, verifyFixtureDelta } from "./service-contract.mjs";
export const REQUIRED_PROBES = Object.freeze([
  "login-a",
  "login-b",
  "identity-a",
  "refresh-a",
  "invalid-password",
  "invalid-signature",
  "own-insert",
  "own-select",
  "own-update",
  "own-delete",
  "cross-select",
  "cross-insert",
  "cross-update",
  "cross-delete",
  "anon-select",
]);
// Pure proof assembly only. Runtime adapters and fixture-row semantic derivation
// must be reviewed before this can be exposed through a command.
export function verifyOperationalProof({
  before,
  after,
  manifest,
  probes,
  sequences,
  serviceSessions,
}) {
  requireService(
    serviceSessions === 0 &&
      probes &&
      Object.keys(probes).length === REQUIRED_PROBES.length &&
      REQUIRED_PROBES.every((k) => probes[k] === true),
  );
  requireService(
    sequences?.refreshAllocations === 3 &&
      sequences?.refreshIdsMatch === true &&
      sequences?.otherSequencesUnchanged === true,
  );
  verifyFixtureDelta(before, after, manifest);
  return Object.freeze({
    status: "LOCAL_AUTH_REST_VERIFIED_ONLY",
    releaseAdmission: "BLOCKED",
    qualifiedRecoveryScopes: [],
    checkCount: REQUIRED_PROBES.length,
  });
}

import { createHash } from "node:crypto";
import { fixedDocker } from "./local-services.mjs";
const identifier = (s) => {
  requireService(typeof s === "string" && /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(s));
  return `"${s}"`;
};
export async function localSql(target, sql, { write = false, execute = fixedDocker } = {}) {
  requireService(/^[a-f0-9]{64}$/.test(target?.containerId));
  const prefix = `SET statement_timeout='15s'; SET lock_timeout='3s'; SET timezone='UTC'; SET DateStyle='ISO, MDY'; SET extra_float_digits=3; SET bytea_output='hex'; SET search_path=pg_catalog;\n`;
  return execute(
    [
      "exec",
      "-i",
      target.containerId,
      "/nix/var/nix/profiles/default/bin/psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-U",
      "supabase_admin",
      "-h",
      "/var/run/postgresql",
      "-d",
      "minted_recovery",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    `${prefix}BEGIN ${write ? "" : "READ ONLY"};\n${sql}\nCOMMIT;\n`,
  );
}
export function normalizeSchemaDump(text) {
  requireService(typeof text === "string");
  const lines = text.split("\n");
  let restrict = 0,
    unrestrict = 0;
  const out = lines.filter((line) => {
    if (/^\\restrict [A-Za-z0-9]+$/.test(line)) {
      restrict++;
      return false;
    }
    if (/^\\unrestrict [A-Za-z0-9]+$/.test(line)) {
      unrestrict++;
      return false;
    }
    return true;
  });
  requireService(restrict === unrestrict && restrict <= 1);
  return out.join("\n");
}
export async function collectQuiescentState(
  target,
  execute = fixedDocker,
  { allowServiceSessions = false } = {},
) {
  const query = (sql) => localSql(target, sql, { execute });
  const sessions = JSON.parse(
    await query(
      "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND usename IN ('supabase_auth_admin','authenticator');",
    ),
  );
  requireService(allowServiceSessions || sessions === 0);
  const inventory = JSON.parse(
    await query(
      "SELECT coalesce(json_agg(json_build_object('schema',n.nspname,'name',c.relname) ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%';",
    ),
  );
  const tables = {};
  for (const t of inventory) {
    const key = `${t.schema}.${t.name}`;
    requireService(!Object.hasOwn(tables, key));
    tables[key] = JSON.parse(
      await query(
        `SELECT coalesce(json_agg(h ORDER BY h),'[]') FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM ONLY ${identifier(t.schema)}.${identifier(t.name)} t) s;`,
      ),
    );
  }
  const metadata = JSON.parse(
    await query(
      "SELECT json_build_object('roles',(SELECT json_agg(to_jsonb(r) ORDER BY rolname) FROM pg_roles r),'memberships',(SELECT json_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m),'settings',(SELECT json_agg(to_jsonb(s) ORDER BY setdatabase,setrole) FROM pg_db_role_setting s));",
    ),
  );
  const ledger = Object.fromEntries(
    Object.entries(tables).filter(([k]) =>
      [
        "auth.schema_migrations",
        "storage.migrations",
        "supabase_migrations.schema_migrations",
      ].includes(k),
    ),
  );
  const dump = await execute([
    "exec",
    target.containerId,
    "/nix/var/nix/profiles/default/bin/pg_dump",
    "--schema-only",
    "--username=supabase_admin",
    "--host=/var/run/postgresql",
    "--dbname=minted_recovery",
  ]);
  const sequenceNames = JSON.parse(
    await query(
      "SELECT coalesce(json_agg(json_build_object('schema',n.nspname,'name',c.relname) ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S';",
    ),
  );
  const sequences = {};
  for (const s of sequenceNames)
    sequences[`${s.schema}.${s.name}`] = JSON.parse(
      await query(
        `SELECT json_build_object('lastValue',last_value::text,'isCalled',is_called) FROM ${identifier(s.schema)}.${identifier(s.name)};`,
      ),
    );
  return {
    tables,
    ledger,
    sequences,
    schema: {
      metadata,
      dumpSha256: createHash("sha256").update(normalizeSchemaDump(dump)).digest("hex"),
    },
    serviceSessions: sessions,
  };
}

// Fixed local peer requests only. Credentials/body travel over stdin, never argv.
export async function localHttp(
  target,
  { service, path, method = "GET", token, body },
  execute = fixedDocker,
) {
  requireService(
    ["auth", "rest"].includes(service) &&
      typeof path === "string" &&
      path.startsWith("/") &&
      !/[\r\n"\\]/.test(path) &&
      !path.startsWith("//"),
  );
  requireService(["GET", "POST", "PATCH", "DELETE"].includes(method));
  requireService(token === undefined || /^[A-Za-z0-9_.-]+$/.test(token));
  const quote = (s) => JSON.stringify(s);
  const config = [
    "silent",
    "show-error",
    "max-time = 15",
    "connect-timeout = 3",
    `url = ${quote(`http://${service}:${service === "auth" ? 9999 : 3000}${path}`)}`,
    `request = ${quote(method)}`,
    'header = "Content-Type: application/json"',
    'header = "Prefer: return=representation"',
    'write-out = "\\n%{http_code}"',
  ];
  if (token) config.push(`header = ${quote(`Authorization: Bearer ${token}`)}`);
  if (body !== undefined) config.push(`data-binary = ${quote(JSON.stringify(body))}`);
  const out = await execute(
    ["exec", "-i", target.containerId, "/usr/bin/curl", "--config", "-"],
    config.join("\n") + "\n",
  );
  const split = out.lastIndexOf("\n"),
    status = Number(out.slice(split + 1));
  requireService(Number.isInteger(status) && status >= 100 && status <= 599);
  let data;
  try {
    data = JSON.parse(out.slice(0, split) || "null");
  } catch {
    requireService(false);
  }
  return { status, data };
}

import { randomUUID } from "node:crypto";
import { localAdminToken } from "./local-services.mjs";
const literal = (s) => `'${String(s).replaceAll("'", "''")}'`;
export async function exerciseFixtures(target, credentials, execute = fixedDocker) {
  const http = (request) => localHttp(target, request, execute);
  const fixture = {
    runId: target.runId,
    startedAt: Date.now(),
    users: [],
    orgs: [randomUUID(), randomUUID()],
    members: [randomUUID(), randomUUID()],
    note: randomUUID(),
    temporaryNote: randomUUID(),
    entity: randomUUID(),
  };
  const admin = localAdminToken(credentials.jwt, Math.floor(Date.now() / 1000));
  const tokens = [];
  const probes = {};
  for (let i = 0; i < 2; i++) {
    const email = `recovery.${target.runId}.${i}@minted.invalid`;
    const created = await http({
      service: "auth",
      path: "/admin/users",
      method: "POST",
      token: admin,
      body: {
        email,
        password: credentials.fixturePasswords[i],
        email_confirm: true,
        user_metadata: { full_name: `Recovery ${i}` },
      },
    });
    requireService([200, 201].includes(created.status) && /^[0-9a-f-]{36}$/.test(created.data?.id));
    fixture.users.push(created.data.id);
    await localSql(
      target,
      `INSERT INTO public.profiles(id,email,full_name) VALUES (${literal(created.data.id)},${literal(email)},${literal(`Recovery ${i}`)}); INSERT INTO public.organizations(id,name) VALUES (${literal(fixture.orgs[i])},${literal(`Recovery ${target.runId} ${i}`)}); INSERT INTO public.memberships(id,org_id,user_id,role) VALUES (${literal(fixture.members[i])},${literal(fixture.orgs[i])},${literal(created.data.id)},'admin');`,
      { write: true, execute },
    );
    const login = await http({
      service: "auth",
      path: "/token?grant_type=password",
      method: "POST",
      body: { email, password: credentials.fixturePasswords[i] },
    });
    requireService(
      login.status === 200 &&
        login.data?.user?.id === created.data.id &&
        typeof login.data.access_token === "string" &&
        typeof login.data.refresh_token === "string",
    );
    requireService(
      JSON.parse(Buffer.from(login.data.access_token.split(".")[1], "base64url").toString())
        .role === "authenticated",
    );
    tokens.push(login.data);
    probes[`login-${i ? "b" : "a"}`] = true;
  }
  const identity = await http({ service: "auth", path: "/user", token: tokens[0].access_token });
  requireService(identity.status === 200 && identity.data?.id === fixture.users[0]);
  probes["identity-a"] = true;
  const refresh = await http({
    service: "auth",
    path: "/token?grant_type=refresh_token",
    method: "POST",
    body: { refresh_token: tokens[0].refresh_token },
  });
  requireService(
    refresh.status === 200 &&
      refresh.data?.user?.id === fixture.users[0] &&
      refresh.data.refresh_token !== tokens[0].refresh_token,
  );
  tokens[0] = refresh.data;
  probes["refresh-a"] = true;
  const bad = await http({
    service: "auth",
    path: "/token?grant_type=password",
    method: "POST",
    body: {
      email: `recovery.${target.runId}.0@minted.invalid`,
      password: "deliberately-invalid-fixture-password",
    },
  });
  requireService([400, 401].includes(bad.status));
  probes["invalid-password"] = true;
  const path = `/notes?id=eq.${fixture.note}`;
  const note = {
    id: fixture.note,
    org_id: fixture.orgs[0],
    entity_type: "provider",
    entity_id: fixture.entity,
    author_id: fixture.users[0],
    content: "recovery-initial",
  };
  const own = await http({
    service: "rest",
    path: "/notes",
    method: "POST",
    token: tokens[0].access_token,
    body: note,
  });
  requireService(own.status === 201 && own.data?.length === 1 && own.data[0].id === fixture.note);
  probes["own-insert"] = true;
  const read = await http({ service: "rest", path, token: tokens[0].access_token });
  requireService(
    read.status === 200 && read.data?.length === 1 && read.data[0].content === note.content,
  );
  probes["own-select"] = true;
  const patch = await http({
    service: "rest",
    path,
    method: "PATCH",
    token: tokens[0].access_token,
    body: { content: "recovery-updated" },
  });
  requireService(
    patch.status === 200 &&
      patch.data?.length === 1 &&
      patch.data[0].content === "recovery-updated",
  );
  probes["own-update"] = true;
  for (const [key, method] of [
    ["cross-select", "GET"],
    ["cross-update", "PATCH"],
    ["cross-delete", "DELETE"],
  ]) {
    const r = await http({
      service: "rest",
      path,
      method,
      token: tokens[1].access_token,
      ...(method === "PATCH" ? { body: { content: "forbidden" } } : {}),
    });
    requireService(r.status === 200 && Array.isArray(r.data) && r.data.length === 0);
    probes[key] = true;
  }
  const cross = await http({
    service: "rest",
    path: "/notes",
    method: "POST",
    token: tokens[1].access_token,
    body: { ...note, id: randomUUID() },
  });
  requireService(cross.status === 403);
  probes["cross-insert"] = true;
  const anon = await http({ service: "rest", path });
  requireService(
    (anon.status === 200 && Array.isArray(anon.data) && anon.data.length === 0) ||
      [401, 403].includes(anon.status),
  );
  probes["anon-select"] = true;
  const invalid = await http({
    service: "rest",
    path,
    token: tokens[0].access_token.slice(0, -8) + "AAAAAAAA",
  });
  requireService(invalid.status === 401);
  probes["invalid-signature"] = true;
  const temp = await http({
    service: "rest",
    path: "/notes",
    method: "POST",
    token: tokens[0].access_token,
    body: { ...note, id: fixture.temporaryNote },
  });
  requireService(temp.status === 201);
  const removed = await http({
    service: "rest",
    path: `/notes?id=eq.${fixture.temporaryNote}`,
    method: "DELETE",
    token: tokens[0].access_token,
  });
  requireService(
    removed.status === 200 &&
      removed.data?.length === 1 &&
      removed.data[0].id === fixture.temporaryNote,
  );
  probes["own-delete"] = true;
  const observed = JSON.parse(
    await localSql(
      target,
      `SELECT json_agg(to_jsonb(n)) FROM public.notes n WHERE id IN (${literal(fixture.note)},${literal(fixture.temporaryNote)});`,
      { execute },
    ),
  );
  requireService(
    observed?.length === 1 &&
      observed[0].id === fixture.note &&
      observed[0].content === "recovery-updated" &&
      observed[0].org_id === fixture.orgs[0],
  );
  tokens.length = 0;
  fixture.finishedAt = Date.now();
  return { fixture, probes };
}

export async function collectFixtureManifest(
  target,
  fixture,
  before,
  after,
  execute = fixedDocker,
) {
  const ids = fixture.users.map(literal).join(","),
    orgs = fixture.orgs.map(literal).join(",");
  const predicates = {
    "auth.users": `id IN (${ids})`,
    "auth.identities": `user_id IN (${ids}) AND provider='email'`,
    "auth.sessions": `user_id IN (${ids})`,
    "auth.refresh_tokens": `user_id IN (${ids}) AND session_id IN (SELECT id FROM auth.sessions WHERE user_id IN (${ids}))`,
    "auth.mfa_amr_claims": `session_id IN (SELECT id FROM auth.sessions WHERE user_id IN (${ids})) AND authentication_method='password'`,
    "auth.audit_log_entries": `payload->>'actor_id' IN (${ids}) OR payload->'traits'->>'user_id' IN (${ids})`,
    "public.profiles": `id IN (${ids})`,
    "public.organizations": `id IN (${orgs})`,
    "public.memberships": `id IN (${fixture.members.map(literal).join(",")}) AND role='admin' AND ((org_id=${literal(fixture.orgs[0])} AND user_id=${literal(fixture.users[0])}) OR (org_id=${literal(fixture.orgs[1])} AND user_id=${literal(fixture.users[1])}))`,
    "public.notes": `id=${literal(fixture.note)} AND org_id=${literal(fixture.orgs[0])} AND author_id=${literal(fixture.users[0])} AND entity_id=${literal(fixture.entity)} AND entity_type='provider' AND content='recovery-updated'`,
  };
  const manifest = {},
    fixtureRows = {};
  for (const [table, predicate] of Object.entries(predicates)) {
    const [schema, name] = table.split(".");
    fixtureRows[table] = JSON.parse(
      await localSql(
        target,
        `SELECT coalesce(json_agg(to_jsonb(t)),'[]') FROM ONLY ${identifier(schema)}.${identifier(name)} t WHERE ${predicate};`,
        { execute },
      ),
    );
    manifest[table] = JSON.parse(
      await localSql(
        target,
        `SELECT coalesce(json_agg(h ORDER BY h),'[]') FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM ONLY ${identifier(schema)}.${identifier(name)} t WHERE ${predicate}) q;`,
        { execute },
      ),
    );
  }
  validateFixtureRows(fixtureRows, fixture);
  const audits = JSON.parse(
    await localSql(
      target,
      `SELECT coalesce(json_object_agg(action,n),'{}') FROM (SELECT payload->>'action' action,count(*) n FROM auth.audit_log_entries WHERE ${predicates["auth.audit_log_entries"]} GROUP BY 1) q;`,
      { execute },
    ),
  );
  requireService(
    JSON.stringify(Object.entries(audits).sort()) ===
      JSON.stringify(
        Object.entries({ user_signedup: 2, login: 2, token_refreshed: 1, token_revoked: 1 }).sort(),
      ),
  );
  const tokenIds = JSON.parse(
    await localSql(
      target,
      `SELECT json_agg(id::text ORDER BY id) FROM auth.refresh_tokens WHERE ${predicates["auth.refresh_tokens"]};`,
      { execute },
    ),
  );
  const sequence = "auth.refresh_tokens_id_seq",
    b = before.sequences[sequence],
    a = after.sequences[sequence];
  requireService(b && a && tokenIds?.length === 3);
  const start = BigInt(b.lastValue) + (b.isCalled ? 1n : 0n);
  requireService(
    tokenIds.every((id, i) => BigInt(id) === start + BigInt(i)) &&
      BigInt(a.lastValue) === start + 2n &&
      a.isCalled === true,
  );
  requireService(
    Object.keys(before.sequences).sort().join() === Object.keys(after.sequences).sort().join(),
  );
  for (const key of Object.keys(before.sequences))
    if (key !== sequence)
      requireService(
        JSON.stringify(before.sequences[key]) === JSON.stringify(after.sequences[key]),
      );
  verifyFixtureDelta(before, after, manifest);
  return manifest;
}

import { writeFile, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { rehearseStagingRestore, destroyIsolatedTarget } from "./restore.mjs";
import { collectLocalTarget } from "./local-target.mjs";
import {
  generateLocalCredentials,
  serviceEnvironment,
  createServices,
  inspectServices,
  stopServices,
  removeServices,
} from "./local-services.mjs";
// No CLI: parent review is required before invoking this bounded runtime entry.
export async function qualifyLocalAuthRest({ workspace, identityPath }, dependencies = {}) {
  let target,
    ownedRunId,
    result,
    failed = false;
  let phase = "PREFLIGHT",
    failurePhase,
    failureEvidence;
  const credentials = generateLocalCredentials();
  try {
    for (const name of ["restore-auth-rest.json", "auth-rest.json"]) {
      let absent = false;
      try {
        await lstat(join(workspace, name));
      } catch (e) {
        requireService(e.code === "ENOENT");
        absent = true;
      }
      requireService(absent);
    }
    phase = "RESTORE";
    const restored = await (dependencies.restore ?? rehearseStagingRestore)(
      { workspace, identityPath },
      {
        save: (_path, data, options) =>
          writeFile(join(workspace, "restore-auth-rest.json"), data, options),
      },
    );
    ownedRunId = restored.runId;
    requireService(
      restored.proof?.data?.driftCount === undefined || restored.proof.data.driftCount === 0,
    );
    target = await collectLocalTarget(restored.runId);
    requireService(!["db698c2326fe3f03", "f4a0e042347029a4"].includes(target.runId));
    await localSql(
      target,
      `ALTER ROLE supabase_auth_admin PASSWORD ${literal(credentials.authPassword)}; ALTER ROLE authenticator PASSWORD ${literal(credentials.restPassword)};`,
      { write: true },
    );
    const before = await collectQuiescentState(target);
    // Exact captured fixture-table trigger boundary must hold before services exist.
    const triggers = JSON.parse(
      await localSql(
        target,
        "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND ((n.nspname='auth' AND c.relname='users') OR (n.nspname='public' AND c.relname IN ('profiles','organizations','memberships','notes')));",
      ),
    );
    requireService(triggers === 0);
    phase = "SERVICE_START";
    await createServices(target, serviceEnvironment(target.runId, credentials));
    let ready = false;
    for (let i = 0; i < 20 && !ready; i++) {
      try {
        const a = await localHttp(target, { service: "auth", path: "/health" });
        const r = await localHttp(target, { service: "rest", path: "/" });
        ready = a.status === 200 && r.status === 200;
      } catch {}
      if (!ready) await new Promise((r) => setTimeout(r, 500));
    }
    requireService(ready);
    const topologyBefore = await inspectServices(
      target,
      fixedDocker,
      serviceEnvironment(target.runId, credentials),
    );
    const startup = await collectQuiescentState(target, fixedDocker, {
      allowServiceSessions: true,
    });
    requireService(
      same(before.schema, startup.schema) &&
        same(before.ledger, startup.ledger) &&
        same(before.tables, startup.tables) &&
        same(before.sequences, startup.sequences),
    );
    phase = "FIXTURE_PROBES";
    const { fixture, probes } = await exerciseFixtures(target, credentials);
    const topologyAfter = await inspectServices(
      target,
      fixedDocker,
      serviceEnvironment(target.runId, credentials),
    );
    await stopServices(target);
    phase = "QUIESCENT_PROOF";
    const after = await collectQuiescentState(target);
    const manifest = await collectFixtureManifest(target, fixture, before, after);
    requireService(/^[a-f0-9]{64}$/.test(restored.proof?.captureDigest ?? ""));
    const codeHashes = {};
    for (const file of [
      "auth-rest-qualifier.mjs",
      "service-contract.mjs",
      "local-services.mjs",
      "restore.mjs",
      "local-target.mjs",
      "contract.mjs",
    ])
      codeHashes[file] = createHash("sha256")
        .update(await readFile(new URL(file, import.meta.url)))
        .digest("hex");
    result = {
      captureDigest: restored.proof?.captureDigest ?? restored.captureDigest,
      restoreProofDigest: canonicalDigest(restored.proof),
      codeHashes,
      topologyBefore,
      topologyAfter,
      manifestDigest: canonicalDigest(manifest),
      beforeDigest: canonicalDigest(before),
      afterDigest: canonicalDigest(after),
      ...verifyOperationalProof({
        before,
        after,
        manifest,
        probes,
        sequences: { refreshAllocations: 3, refreshIdsMatch: true, otherSequencesUnchanged: true },
        serviceSessions: after.serviceSessions,
      }),
      runId: target.runId,
      verifiedAt: new Date().toISOString(),
    };
  } catch (error) {
    failed = true;
    failurePhase = phase;
    failureEvidence = safeFailureEvidence(error);
  } finally {
    if (target) {
      try {
        await removeServices(target);
      } catch {
        failed = true;
      }
    }
    if (ownedRunId) {
      try {
        result = await finalizeOwnedQualification(
          { workspace, runId: ownedRunId, result: failed ? undefined : result },
          dependencies,
        );
      } catch {
        failed = true;
      }
    }
    credentials.jwt = "";
    credentials.authPassword = "";
    credentials.restPassword = "";
    credentials.fixturePasswords.fill("");
  }
  if (failed || !result) {
    try {
      requireService(false);
    } catch (error) {
      error.phase = failurePhase ?? "CLEANUP";
      error.failureEvidence = failureEvidence ?? null;
      throw error;
    }
  }

  return result;
}

// Mandatory shared completion boundary: no success receipt before exact absence.
export async function finalizeOwnedQualification(
  { workspace, runId, result },
  { destroy = destroyIsolatedTarget, save = writeFile } = {},
) {
  const cleanup = await destroy(runId);
  requireService(
    cleanup?.runId === runId &&
      cleanup.status === "DESTROYED" &&
      Array.isArray(cleanup.remaining) &&
      cleanup.remaining.length === 0,
  );
  await save(
    join(workspace, `auth-rest-${runId}-cleanup.json`),
    JSON.stringify(cleanup, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  if (!result) return undefined;
  requireService(
    result.runId === runId &&
      result.status === "LOCAL_AUTH_REST_VERIFIED_ONLY" &&
      result.releaseAdmission === "BLOCKED",
  );
  const completed = { ...result, cleanup };
  await save(join(workspace, "auth-rest.json"), JSON.stringify(completed, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return completed;
}

import { canonicalDigest } from "../release/contract.mjs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const same = (a, b) => canonicalDigest(a) === canonicalDigest(b);
const SAFE_ERROR_NAMES = new Set([
  "Error",
  "RecoveryError",
  "SyntaxError",
  "TypeError",
  "RangeError",
]);
const SAFE_FAILURE_REASONS = new Set([
  "USER_EMAIL",
  "USER_ROLE",
  "USER_AUD",
  "USER_SSO",
  "USER_ANONYMOUS",
  "USER_DELETED",
  "USER_BANNED",
  "USER_PHONE",
  "USER_CREATED_AT",
  "USER_LAST_SIGN_IN_AT",
  "USER_EMAIL_CONFIRMED_AT",
  "USER_PASSWORD",
  "USER_APP_METADATA",
  "USER_USER_METADATA_MISSING_KEY",
  "USER_USER_METADATA_EXTRA_KEYS",
  "USER_USER_METADATA_TYPE",
  "USER_USER_METADATA_VALUE",
]);
function safeFailureEvidence(error) {
  const stack = typeof error?.stack === "string" ? error.stack : "";
  const matches = [...stack.matchAll(/\/scripts\/recovery\/([A-Za-z0-9._-]+\.mjs):(\d+):\d+/g)];
  const match = matches.find((item) => item[1] !== "service-contract.mjs") ?? matches[0];
  const reason = SAFE_FAILURE_REASONS.has(error?.fixtureReason) ? error.fixtureReason : null;
  return {
    name: SAFE_ERROR_NAMES.has(error?.name) ? error.name : "Error",
    source: match ? { file: match[1], line: Number(match[2]) } : null,
    reason,
  };
}
export function validateFixtureRows(rows, f) {
  requireService(
    f.users.length === 2 && new Set(f.users).size === 2 && f.users.every((x) => UUID.test(x)),
  );
  const inRun = (t) =>
    typeof t === "string" &&
    Number.isFinite(Date.parse(t)) &&
    Date.parse(t) >= f.startedAt - 1000 &&
    Date.parse(t) <= f.finishedAt + 1000;
  const unique = (list, key) =>
    requireService(new Set(list.map((x) => x[key])).size === list.length);
  for (const [table, count] of Object.entries(ADDITIONS_FOR_VALIDATION)) {
    requireService(rows[table]?.length === count);
    unique(rows[table], "id");
  }
  const one = (table, predicate) => {
    const found = rows[table].filter(predicate);
    requireService(found.length === 1);
    return found[0];
  };
  for (let i = 0; i < 2; i++) {
    const id = f.users[i],
      email = `recovery.${f.runId}.${i}@minted.invalid`;
    const user = one("auth.users", (r) => r.id === id);
    const metadata = user.raw_user_meta_data;
    const metadataFailure =
      !metadata || typeof metadata !== "object" || Array.isArray(metadata)
        ? "USER_USER_METADATA_TYPE"
        : !Object.hasOwn(metadata, "full_name") || !Object.hasOwn(metadata, "email_verified")
          ? "USER_USER_METADATA_MISSING_KEY"
          : Object.keys(metadata).sort().join(",") !== "email_verified,full_name"
            ? "USER_USER_METADATA_EXTRA_KEYS"
            : typeof metadata.full_name !== "string" || typeof metadata.email_verified !== "boolean"
              ? "USER_USER_METADATA_TYPE"
              : metadata.full_name !== `Recovery ${i}` || metadata.email_verified !== true
                ? "USER_USER_METADATA_VALUE"
                : null;
    const userFailure = [
      ["USER_EMAIL", user.email === email],
      ["USER_ROLE", user.role === "authenticated"],
      ["USER_AUD", user.aud === "authenticated"],
      ["USER_SSO", user.is_sso_user === false],
      ["USER_ANONYMOUS", user.is_anonymous === false],
      ["USER_DELETED", user.deleted_at === null],
      ["USER_BANNED", user.banned_until === null],
      ["USER_PHONE", user.phone === null],
      ["USER_CREATED_AT", inRun(user.created_at)],
      ["USER_LAST_SIGN_IN_AT", inRun(user.last_sign_in_at)],
      ["USER_EMAIL_CONFIRMED_AT", inRun(user.email_confirmed_at)],
      ["USER_PASSWORD", /^\$2[aby]\$/.test(user.encrypted_password)],
      [
        "USER_APP_METADATA",
        same(user.raw_app_meta_data, { provider: "email", providers: ["email"] }),
      ],
      [
        "USER_USER_METADATA_MISSING_KEY",
        metadataFailure === "USER_USER_METADATA_MISSING_KEY" ? false : true,
      ],
      [
        "USER_USER_METADATA_EXTRA_KEYS",
        metadataFailure === "USER_USER_METADATA_EXTRA_KEYS" ? false : true,
      ],
      ["USER_USER_METADATA_TYPE", metadataFailure === "USER_USER_METADATA_TYPE" ? false : true],
      ["USER_USER_METADATA_VALUE", metadataFailure === "USER_USER_METADATA_VALUE" ? false : true],
    ].find(([, valid]) => !valid)?.[0];
    if (userFailure) {
      const error = new Error("FIXTURE_USER_REJECTED");
      error.fixtureReason = userFailure;
      throw error;
    }
    const identity = one("auth.identities", (r) => r.user_id === id);
    requireService(
      identity.provider === "email" &&
        identity.provider_id === id &&
        identity.identity_data?.sub === id &&
        identity.identity_data?.email === email &&
        inRun(identity.created_at),
    );
    const session = one("auth.sessions", (r) => r.user_id === id);
    requireService(
      UUID.test(session.id) &&
        session.aal === "aal1" &&
        session.factor_id === null &&
        session.oauth_client_id == null &&
        session.refresh_token_hmac_key == null &&
        inRun(session.created_at),
    );
    const amr = one("auth.mfa_amr_claims", (r) => r.session_id === session.id);
    requireService(amr.authentication_method === "password" && inRun(amr.created_at));
    const tokens = rows["auth.refresh_tokens"].filter((r) => r.user_id === id);
    requireService(tokens.length === (i === 0 ? 2 : 1));
    const original = tokens.filter((r) => r.parent == null || r.parent === "");
    requireService(original.length === 1 && original[0].revoked === (i === 0));
    for (const token of tokens)
      requireService(
        token.session_id === session.id &&
          typeof token.token === "string" &&
          /^[A-Za-z0-9]{12}$/.test(token.token) &&
          inRun(token.created_at),
      );
    if (i === 0) {
      const child = tokens.find((r) => r !== original[0]);
      requireService(
        child.parent === original[0].token &&
          child.revoked === false &&
          child.token !== original[0].token,
      );
    }
    const profile = one("public.profiles", (r) => r.id === id);
    requireService(profile.email === email && profile.full_name === `Recovery ${i}`);
    one("public.organizations", (r) => r.id === f.orgs[i] && r.name === `Recovery ${f.runId} ${i}`);
    one(
      "public.memberships",
      (r) =>
        r.id === f.members[i] && r.org_id === f.orgs[i] && r.user_id === id && r.role === "admin",
    );
  }
  one(
    "public.notes",
    (r) =>
      r.id === f.note &&
      r.org_id === f.orgs[0] &&
      r.author_id === f.users[0] &&
      r.entity_id === f.entity &&
      r.entity_type === "provider" &&
      r.content === "recovery-updated",
  );
  const expected = [];
  for (let i = 0; i < 2; i++) {
    const email = `recovery.${f.runId}.${i}@minted.invalid`;
    expected.push({
      action: "user_signedup",
      log_type: "team",
      actor_id: "00000000-0000-0000-0000-000000000000",
      actor_username: "service_role",
      actor_via_sso: false,
      traits: { user_id: f.users[i], user_email: email, user_phone: "", provider: "email" },
    });
    expected.push({
      action: "login",
      log_type: "account",
      actor_id: f.users[i],
      actor_username: email,
      actor_via_sso: false,
      actor_name: `Recovery ${i}`,
      traits: { provider: "email" },
    });
  }
  for (const action of ["token_refreshed", "token_revoked"])
    expected.push({
      action,
      log_type: "token",
      actor_id: f.users[0],
      actor_username: `recovery.${f.runId}.0@minted.invalid`,
      actor_via_sso: false,
      actor_name: "Recovery 0",
    });
  for (const audit of rows["auth.audit_log_entries"]) {
    requireService(inRun(audit.created_at));
    const index = expected.findIndex((p) => same(p, audit.payload));
    requireService(index >= 0);
    expected.splice(index, 1);
  }
  requireService(expected.length === 0);
  return true;
}
import { ADDITIONS as ADDITIONS_FOR_VALIDATION } from "./service-contract.mjs";
