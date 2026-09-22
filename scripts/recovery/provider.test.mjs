import test from "node:test";
import assert from "node:assert/strict";
import { RecoveryError, STAGING } from "./contract.mjs";
import {
  loadSupabaseAccessToken,
  observeStagingProvider,
  withStagingLoginRole,
} from "./provider.mjs";

const token = `sbp_${"a".repeat(40)}`;
const now = "2026-09-19T04:00:00.000Z";
const project = {
  id: STAGING.ref,
  ref: STAGING.ref,
  name: "mintedpanel-staging",
  region: "ca-central-1",
  status: "ACTIVE_HEALTHY",
  database: {
    host: `db.${STAGING.ref}.supabase.co`,
    version: "17.6.1.147",
    postgres_engine: "17",
    release_channel: "ga",
  },
};
const reply = (body, status = 200) => ({ status, json: async () => structuredClone(body) });
const loginResponse = {
  role: "cli_login_h10",
  password: "private-password-value",
  ttl_seconds: 3_600,
};

function fetchSequence(steps, calls) {
  return async (url, options) => {
    calls.push({ url, options });
    const step = steps.shift();
    assert.ok(step, `unexpected request ${options.method} ${url}`);
    return reply(step.body, step.status);
  };
}

test("loads only a valid environment token without launching a process", async () => {
  let launched = false;
  assert.equal(
    await loadSupabaseAccessToken({
      environment: { SUPABASE_ACCESS_TOKEN: token },
      run: async () => {
        launched = true;
      },
    }),
    token,
  );
  assert.equal(launched, false);
});

test("provider observation is sanitized and pinned to staging", async () => {
  const calls = [];
  const result = await observeStagingProvider({
    token,
    clock: () => now,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return reply(
        url.endsWith("/pooler") ? { default_pool_size: 15, pool_mode: "transaction" } : project,
      );
    },
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ options }) => options.headers.Authorization === `Bearer ${token}`));
  assert.deepEqual(result.source, {
    ...STAGING,
    schemaDigest: result.source.schemaDigest,
    lineageDigest: result.source.lineageDigest,
  });
  assert.match(result.providerDigest, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes(token));
});

for (const [label, mutate] of [
  ["production ref", (value) => (value.ref = "fkvuhfsqcmujywzgczmc")],
  ["wrong region", (value) => (value.region = "us-east-1")],
  ["paused project", (value) => (value.status = "INACTIVE")],
  ["database version drift", (value) => (value.database.version = "17.7.0.001")],
]) {
  test(`provider rejects ${label}`, async () => {
    const value = structuredClone(project);
    mutate(value);
    await assert.rejects(
      observeStagingProvider({
        token,
        clock: () => now,
        fetchImpl: async (url) =>
          reply(url.endsWith("/pooler") ? { default_pool_size: 15, pool_mode: "session" } : value),
      }),
      (error) => error instanceof RecoveryError && error.code === "RECOVERY_PROVIDER_REJECTED",
    );
  });
}

const lifecycleSteps = (poststate = [], cleanupStatus = 200) => [
  { body: [], status: 201 },
  { body: loginResponse, status: 200 },
  { body: [], status: cleanupStatus },
  { body: poststate, status: 201 },
];

test("provider rejects login response drift, cleans up, and never retries", async () => {
  const calls = [];
  const steps = lifecycleSteps();
  steps[1].body = { ...loginResponse, ttl_seconds: 0 };
  await assert.rejects(
    withStagingLoginRole(
      { token, operation: async () => "must-not-run" },
      { fetchImpl: fetchSequence(steps, calls), clock: () => now },
    ),
    (error) => error instanceof RecoveryError && error.code === "RECOVERY_PROVIDER_REJECTED",
  );
  assert.deepEqual(
    calls.map(({ options }) => options.method),
    ["POST", "POST", "POST", "POST"],
  );
  assert.equal(calls.filter(({ url }) => url.endsWith("/cli/login-role")).length, 1);
  assert.ok(calls[2].url.endsWith("/database/query"));
  assert.match(JSON.parse(calls[2].options.body).query, /DROP ROLE "cli_login_h10"/);
  assert.equal(steps.length, 0);
});

test("provider rejects a malformed response but cleans its validated exact role", async () => {
  const calls = [];
  const steps = lifecycleSteps();
  steps[1].body = { ...loginResponse, unexpected: true };
  await assert.rejects(
    withStagingLoginRole(
      { token, operation: async () => "must-not-run" },
      { fetchImpl: fetchSequence(steps, calls), clock: () => now },
    ),
    (error) => error instanceof RecoveryError && error.code === "RECOVERY_PROVIDER_REJECTED",
  );
  assert.ok(calls[2].url.endsWith("/database/query"));
  assert.match(JSON.parse(calls[2].options.body).query, /DROP ROLE "cli_login_h10"/);
  assert.equal(calls.filter(({ url }) => url.endsWith("/cli/login-role")).length, 1);
  assert.equal(steps.length, 0);
});

test("bounded login lifecycle seals empty prestate, removes the exact role, and verifies absence", async () => {
  const calls = [];
  const steps = lifecycleSteps();
  const result = await withStagingLoginRole(
    {
      token,
      operation: async (credentials) => {
        assert.deepEqual(Object.keys(credentials).sort(), [
          "receivedAt",
          "requestedAt",
          "response",
        ]);
        return credentials.response.role;
      },
    },
    { fetchImpl: fetchSequence(steps, calls), clock: () => now },
  );
  assert.equal(result.output, loginResponse.role);
  assert.deepEqual(
    calls.map(({ options }) => options.method),
    ["POST", "POST", "POST", "POST"],
  );
  assert.ok(calls[0].url.endsWith("/database/query/read-only"));
  assert.ok(calls[1].url.endsWith("/cli/login-role"));
  const cleanupQuery = JSON.parse(calls[2].options.body).query;
  assert.match(cleanupQuery, /pg_terminate_backend/);
  assert.match(cleanupQuery, /ALTER ROLE "cli_login_h10" NOLOGIN VALID UNTIL 'epoch'/);
  assert.match(cleanupQuery, /DROP ROLE "cli_login_h10"/);
  assert.equal(result.lifecycle.exactRoleAbsent, true);
  assert.equal(result.lifecycle.poststateRoleCount, 0);
  assert.match(result.lifecycle.roleDigest, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result.lifecycle).includes(loginResponse.password));
  assert.equal(steps.length, 0);
});

test("provider accepts a 900-second role and still performs exact-role cleanup", async () => {
  const calls = [];
  const steps = lifecycleSteps();
  steps[1].body = { ...loginResponse, ttl_seconds: 900 };
  const result = await withStagingLoginRole(
    { token, operation: async () => "captured" },
    { fetchImpl: fetchSequence(steps, calls), clock: () => now },
  );
  assert.equal(result.output, "captured");
  assert.equal(result.lifecycle.exactRoleAbsent, true);
  assert.equal(calls.filter(({ url }) => url.endsWith("/cli/login-role")).length, 1);
  assert.ok(calls.every(({ options }) => options.method !== "DELETE"));
});

test("capture failure still removes and verifies the created login role", async () => {
  const calls = [];
  const steps = lifecycleSteps();
  await assert.rejects(
    withStagingLoginRole(
      {
        token,
        operation: async () => {
          throw new Error("private capture failure");
        },
      },
      { fetchImpl: fetchSequence(steps, calls), clock: () => now },
    ),
    (error) =>
      error instanceof RecoveryError &&
      error.code === "RECOVERY_PROVIDER_REJECTED" &&
      !error.message.includes("private capture failure"),
  );
  assert.deepEqual(
    calls.map(({ options }) => options.method),
    ["POST", "POST", "POST", "POST"],
  );
  assert.equal(steps.length, 0);
});

test("exact-role cleanup failure remains rejected after the required poststate verification", async () => {
  const calls = [];
  const steps = lifecycleSteps([], 500);
  await assert.rejects(
    withStagingLoginRole(
      { token, operation: async () => "captured" },
      { fetchImpl: fetchSequence(steps, calls), clock: () => now },
    ),
    (error) => error instanceof RecoveryError && error.code === "RECOVERY_PROVIDER_REJECTED",
  );
  assert.deepEqual(
    calls.map(({ options }) => options.method),
    ["POST", "POST", "POST", "POST"],
  );
  assert.equal(steps.length, 0);
});

test("poststate rejects when the exact created role remains", async () => {
  const calls = [];
  const steps = lifecycleSteps([{ rolname: loginResponse.role }]);
  await assert.rejects(
    withStagingLoginRole(
      { token, operation: async () => "captured" },
      { fetchImpl: fetchSequence(steps, calls), clock: () => now },
    ),
    (error) => error instanceof RecoveryError && error.code === "RECOVERY_PROVIDER_REJECTED",
  );
  assert.deepEqual(
    calls.map(({ options }) => options.method),
    ["POST", "POST", "POST", "POST"],
  );
  assert.equal(steps.length, 0);
});

test("a concurrent CLI role is preserved while the exact created role is removed", async () => {
  const calls = [];
  const steps = lifecycleSteps([{ rolname: "cli_login_other_writer" }]);
  const result = await withStagingLoginRole(
    { token, operation: async () => "captured" },
    { fetchImpl: fetchSequence(steps, calls), clock: () => now },
  );
  assert.equal(result.output, "captured");
  assert.equal(result.lifecycle.exactRoleAbsent, true);
  assert.equal(result.lifecycle.poststateRoleCount, 1);
  assert.ok(calls.every(({ options }) => options.method !== "DELETE"));
  assert.match(JSON.parse(calls[2].options.body).query, /DROP ROLE "cli_login_h10"/);
  assert.ok(!JSON.parse(calls[2].options.body).query.includes("cli_login_other_writer"));
  assert.equal(steps.length, 0);
});

for (const ttl of [3_601, 86_400, Number.MAX_SAFE_INTEGER]) {
  test(`provider TTL ${ttl} is rejected after exact-role cleanup`, async () => {
    const calls = [];
    const steps = lifecycleSteps();
    steps[1].body = { ...loginResponse, ttl_seconds: ttl };
    await assert.rejects(
      withStagingLoginRole(
        { token, operation: async () => "must-not-run" },
        { fetchImpl: fetchSequence(steps, calls), clock: () => now },
      ),
      (error) => error instanceof RecoveryError && error.code === "RECOVERY_PROVIDER_REJECTED",
    );
    assert.deepEqual(
      calls.map(({ options }) => options.method),
      ["POST", "POST", "POST", "POST"],
    );
    assert.equal(steps.length, 0);
  });
}

test("uncertain POST outcome never bulk-deletes or retries and re-reads inventory", async () => {
  const calls = [];
  const steps = [
    { body: [], status: 201 },
    { body: { message: "provider uncertainty" }, status: 500 },
    { body: [{ rolname: "cli_login_unknown_created_role" }], status: 201 },
  ];
  await assert.rejects(
    withStagingLoginRole(
      { token, operation: async () => "must-not-run" },
      { fetchImpl: fetchSequence(steps, calls), clock: () => now },
    ),
    (error) => error instanceof RecoveryError && error.code === "RECOVERY_PROVIDER_REJECTED",
  );
  assert.deepEqual(
    calls.map(({ options }) => options.method),
    ["POST", "POST", "POST"],
  );
  assert.equal(calls.filter(({ url }) => url.endsWith("/cli/login-role")).length, 1);
  assert.ok(calls.every(({ options }) => options.method !== "DELETE"));
  assert.ok(calls[2].url.endsWith("/database/query/read-only"));
  assert.equal(steps.length, 0);
});

test("unexpected preexisting CLI role fails before login-role POST", async () => {
  const calls = [];
  const steps = [{ body: [{ rolname: "cli_login_existing" }], status: 201 }];
  await assert.rejects(
    withStagingLoginRole(
      { token, operation: async () => "must-not-run" },
      { fetchImpl: fetchSequence(steps, calls), clock: () => now },
    ),
    (error) => error instanceof RecoveryError && error.code === "RECOVERY_PROVIDER_REJECTED",
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/database/query/read-only"));
  assert.equal(steps.length, 0);
});
