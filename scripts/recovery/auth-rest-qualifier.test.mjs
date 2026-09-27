import test from "node:test";
import assert from "node:assert/strict";
import { verifyOperationalProof } from "./auth-rest-qualifier.mjs";
test("active services cannot produce quiescent proof", () =>
  assert.throws(() => verifyOperationalProof({ serviceSessions: 1 })));
test("missing probes fail closed", () =>
  assert.throws(() => verifyOperationalProof({ serviceSessions: 0, probes: {} })));
import { normalizeSchemaDump } from "./auth-rest-qualifier.mjs";
test("only nondeterministic dump delimiter removed", () => {
  assert.equal(
    normalizeSchemaDump("\\restrict abc123\nCREATE TABLE x();\n\\unrestrict abc123"),
    "CREATE TABLE x();",
  );
  assert.notEqual(
    normalizeSchemaDump("CREATE TABLE x();"),
    normalizeSchemaDump("CREATE TABLE y();"),
  );
  assert.throws(() => normalizeSchemaDump("\\restrict abc"));
});
import { localHttp } from "./auth-rest-qualifier.mjs";
test("local HTTP sends secrets only through stdin and pins destination", async () => {
  let args, input;
  const result = await localHttp(
    { containerId: "a".repeat(64) },
    {
      service: "auth",
      path: "/token?grant_type=password",
      method: "POST",
      body: { password: "private-fixture" },
    },
    async (a, b) => {
      args = a;
      input = b;
      return "{}\n200";
    },
  );
  assert.equal(result.status, 200);
  assert.ok(!args.join().includes("private-fixture"));
  assert.ok(input.includes("http://auth:9999/token"));
});
test("HTTP rejects arbitrary destination and config injection", async () => {
  await assert.rejects(localHttp({}, { service: "host", path: "/" }));
  await assert.rejects(localHttp({}, { service: "auth", path: "/\nurl=x" }));
});
import { exerciseFixtures } from "./auth-rest-qualifier.mjs";
import { generateLocalCredentials } from "./local-services.mjs";
function fixtureExecutor({ crossLeaks = false } = {}) {
  const users = ["aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"];
  let creates = 0,
    logins = 0,
    note,
    temp;
  const jwt = (i) =>
    `x.${Buffer.from(JSON.stringify({ role: "authenticated", sub: users[i] })).toString("base64url")}.sig${i}`;
  return async (args, input) => {
    if (args.includes("/nix/var/nix/profiles/default/bin/psql"))
      return input.includes("SELECT json_agg") ? JSON.stringify([note]) : "";
    const settings = Object.fromEntries(
      input
        .trim()
        .split("\n")
        .filter((x) => x.includes(" = "))
        .map((x) => {
          const i = x.indexOf(" = ");
          return [x.slice(0, i), JSON.parse(x.slice(i + 3))];
        }),
    );
    const url = new URL(settings.url),
      method = settings.request,
      body = settings["data-binary"] ? JSON.parse(settings["data-binary"]) : undefined;
    const token = settings.header?.startsWith("Authorization: Bearer ")
      ? settings.header.slice(22)
      : "";
    let status = 200,
      data = {};
    if (url.pathname === "/admin/users") data = { id: users[creates++] };
    else if (url.pathname === "/token" && url.search.includes("password")) {
      if (body.password === "deliberately-invalid-fixture-password") {
        status = 400;
      } else {
        const i = logins++;
        data = { user: { id: users[i] }, access_token: jwt(i), refresh_token: `refresh${i}` };
      }
    } else if (url.pathname === "/token")
      data = { user: { id: users[0] }, access_token: jwt(0), refresh_token: "rotated" };
    else if (url.pathname === "/user") data = { id: users[0] };
    else if (token.endsWith("AAAAAAAA")) status = 401;
    else if (token === jwt(1)) {
      if (method === "POST") status = 403;
      else data = crossLeaks ? [note] : [];
    } else if (!token) data = [];
    else if (method === "POST") {
      status = 201;
      if (!note) {
        note = { ...body };
        data = [note];
      } else {
        temp = { ...body };
        data = [temp];
      }
    } else if (method === "PATCH") {
      note.content = body.content;
      data = [note];
    } else if (method === "DELETE") data = [temp];
    else data = [note];
    return `${JSON.stringify(data)}\n${status}`;
  };
}
test("complete fixture workflow produces all checks via actual request construction", async () => {
  const result = await exerciseFixtures(
    { runId: "1234567890abcdef", containerId: "a".repeat(64) },
    generateLocalCredentials(),
    fixtureExecutor(),
  );
  assert.equal(Object.keys(result.probes).length, 15);
});
test("cross-tenant leaked row aborts fixture workflow", async () => {
  await assert.rejects(
    exerciseFixtures(
      { runId: "1234567890abcdef", containerId: "a".repeat(64) },
      generateLocalCredentials(),
      fixtureExecutor({ crossLeaks: true }),
    ),
  );
});
import { validateFixtureRows, qualifyLocalAuthRest } from "./auth-rest-qualifier.mjs";
function semanticFixture() {
  const f = {
    runId: "1234567890abcdef",
    startedAt: Date.now() - 1000,
    finishedAt: Date.now() + 1000,
    users: ["aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"],
    orgs: ["org-a", "org-b"],
    members: ["member-a", "member-b"],
    note: "note",
    entity: "entity",
  };
  const rows = Object.fromEntries(
      [
        "auth.users",
        "auth.identities",
        "auth.sessions",
        "auth.refresh_tokens",
        "auth.mfa_amr_claims",
        "auth.audit_log_entries",
        "public.profiles",
        "public.organizations",
        "public.memberships",
        "public.notes",
      ].map((t) => [t, []]),
    ),
    time = new Date().toISOString();
  for (let i = 0; i < 2; i++) {
    const id = f.users[i],
      email = `recovery.${f.runId}.${i}@minted.invalid`,
      session = `${i ? "d" : "c"}`.repeat(8) + "-cccc-4ccc-cccc-cccccccccccc";
    rows["auth.users"].push({
      id,
      email,
      role: "authenticated",
      aud: "authenticated",
      is_sso_user: false,
      is_anonymous: false,
      deleted_at: null,
      banned_until: null,
      phone: null,
      created_at: time,
      last_sign_in_at: time,
      email_confirmed_at: time,
      encrypted_password: "$2a$fake",
      raw_app_meta_data: { provider: "email", providers: ["email"] },
      raw_user_meta_data: { full_name: `Recovery ${i}`, email_verified: true },
    });
    rows["auth.identities"].push({
      id: `identity${i}`,
      user_id: id,
      provider: "email",
      provider_id: id,
      identity_data: { sub: id, email },
      created_at: time,
    });
    rows["auth.sessions"].push({
      id: session,
      user_id: id,
      aal: "aal1",
      factor_id: null,
      created_at: time,
    });
    rows["auth.mfa_amr_claims"].push({
      id: `amr${i}`,
      session_id: session,
      authentication_method: "password",
      created_at: time,
    });
    rows["auth.refresh_tokens"].push({
      id: `${i + 1}`,
      user_id: id,
      session_id: session,
      parent: "",
      revoked: i === 0,
      token: i ? "bbbbbbbbbbbb" : "aaaaaaaaaaaa",
      created_at: time,
    });
    if (i === 0)
      rows["auth.refresh_tokens"].push({
        id: "3",
        user_id: id,
        session_id: session,
        parent: "aaaaaaaaaaaa",
        revoked: false,
        token: "cccccccccccc",
        created_at: time,
      });
    rows["public.profiles"].push({ id, email, full_name: `Recovery ${i}` });
    rows["public.organizations"].push({ id: f.orgs[i], name: `Recovery ${f.runId} ${i}` });
    rows["public.memberships"].push({
      id: f.members[i],
      org_id: f.orgs[i],
      user_id: id,
      role: "admin",
    });
    rows["auth.audit_log_entries"].push(
      {
        id: `signup${i}`,
        created_at: time,
        payload: {
          action: "user_signedup",
          log_type: "team",
          actor_id: "00000000-0000-0000-0000-000000000000",
          actor_username: "service_role",
          actor_via_sso: false,
          traits: { user_id: id, user_email: email, user_phone: "", provider: "email" },
        },
      },
      {
        id: `login${i}`,
        created_at: time,
        payload: {
          action: "login",
          log_type: "account",
          actor_id: id,
          actor_username: email,
          actor_via_sso: false,
          actor_name: `Recovery ${i}`,
          traits: { provider: "email" },
        },
      },
    );
  }
  for (const action of ["token_refreshed", "token_revoked"])
    rows["auth.audit_log_entries"].push({
      id: action,
      created_at: time,
      payload: {
        action,
        log_type: "token",
        actor_id: f.users[0],
        actor_username: `recovery.${f.runId}.0@minted.invalid`,
        actor_via_sso: false,
        actor_name: "Recovery 0",
      },
    });
  rows["public.notes"].push({
    id: f.note,
    org_id: f.orgs[0],
    author_id: f.users[0],
    entity_id: f.entity,
    entity_type: "provider",
    content: "recovery-updated",
  });
  return { rows, f };
}
test("fixture semantic rows and exact lineage pass", () => {
  const { rows, f } = semanticFixture();
  assert.equal(validateFixtureRows(rows, f), true);
});
for (const [name, { change, reason }] of Object.entries({
  missing: {
    change: (r) => delete r["auth.users"][0].raw_user_meta_data.email_verified,
    reason: "USER_USER_METADATA_MISSING_KEY",
  },
  false: {
    change: (r) => (r["auth.users"][0].raw_user_meta_data.email_verified = false),
    reason: "USER_USER_METADATA_VALUE",
  },
  nonboolean: {
    change: (r) => (r["auth.users"][0].raw_user_meta_data.email_verified = "true"),
    reason: "USER_USER_METADATA_TYPE",
  },
  thirdKey: {
    change: (r) => (r["auth.users"][0].raw_user_meta_data.extra = "unexpected"),
    reason: "USER_USER_METADATA_EXTRA_KEYS",
  },
  wrongName: {
    change: (r) => (r["auth.users"][0].raw_user_meta_data.full_name = "Wrong"),
    reason: "USER_USER_METADATA_VALUE",
  },
}))
  test(`reject user metadata ${name}`, () => {
    const { rows, f } = semanticFixture();
    change(rows);
    assert.throws(
      () => validateFixtureRows(rows, f),
      (error) => error.fixtureReason === reason,
    );
  });
for (const [name, change] of Object.entries({
  identity: (r) => (r["auth.identities"][1].user_id = r["auth.identities"][0].user_id),
  session: (r) => (r["auth.sessions"][1].user_id = r["auth.sessions"][0].user_id),
  amr: (r) => (r["auth.mfa_amr_claims"][0].authentication_method = "totp"),
  parent: (r) => (r["auth.refresh_tokens"][1].parent = "foreign"),
  revocation: (r) => (r["auth.refresh_tokens"][0].revoked = false),
  role: (r) => (r["auth.users"][0].role = "service_role"),
  profile: (r) => (r["public.profiles"][0].full_name = "wrong"),
  audit: (r) => (r["auth.audit_log_entries"][0].payload.traits.user_email = "wrong"),
  auditExtra: (r) => (r["auth.audit_log_entries"][0].payload.extra = true),
  note: (r) => (r["public.notes"][0].content = "forbidden"),
}))
  test(`reject semantic ${name} despite valid aggregate counts`, () => {
    const { rows, f } = semanticFixture();
    change(rows);
    assert.throws(() => validateFixtureRows(rows, f));
  });
import { finalizeOwnedQualification } from "./auth-rest-qualifier.mjs";
test("otherwise successful qualifier cannot write PASS for nonthrowing blocked cleanup", async () => {
  const result = {
      runId: "1234567890abcdef",
      status: "LOCAL_AUTH_REST_VERIFIED_ONLY",
      releaseAdmission: "BLOCKED",
    },
    saved = [];
  await assert.rejects(
    finalizeOwnedQualification(
      { workspace: "/private/tmp", runId: result.runId, result },
      {
        destroy: async (runId) => ({ runId, status: "CLEANUP_BLOCKED", remaining: ["volume"] }),
        save: async (...args) => saved.push(args),
      },
    ),
  );
  assert.deepEqual(saved, []);
});
test("otherwise successful qualifier writes cleanup before PASS only after exact absence", async () => {
  const result = {
      runId: "1234567890abcdef",
      status: "LOCAL_AUTH_REST_VERIFIED_ONLY",
      releaseAdmission: "BLOCKED",
    },
    saved = [];
  const completed = await finalizeOwnedQualification(
    { workspace: "/private/tmp", runId: result.runId, result },
    {
      destroy: async (runId) => ({ runId, status: "DESTROYED", remaining: [] }),
      save: async (path) => saved.push(path),
    },
  );
  assert.equal(completed.cleanup.status, "DESTROYED");
  assert.equal(saved.length, 2);
  assert.match(saved[0], /-cleanup.json$/);
  assert.match(saved[1], /auth-rest.json$/);
});
