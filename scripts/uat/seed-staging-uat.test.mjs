import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FIXTURE_VERSION,
  assertSafeTarget,
  fixtureUuid,
  hasExactOwnershipMarker,
} from "./uat-fixture.mjs";

test("fixture UUIDs are deterministic and unique", () => {
  assert.equal(fixtureUuid("case", 1), fixtureUuid("case", 1));
  assert.notEqual(fixtureUuid("case", 1), fixtureUuid("case", 2));
  assert.match(
    fixtureUuid("case", 1),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("target guard accepts exact staging and loopback pairs", () => {
  assert.equal(
    assertSafeTarget({
      supabaseUrl: "https://vmznysvietfaddakkegt.supabase.co",
      databaseUrl: "postgres://postgres:x@db.vmznysvietfaddakkegt.supabase.co:5432/postgres",
    }),
    "staging",
  );
  assert.equal(
    assertSafeTarget({
      supabaseUrl: "https://vmznysvietfaddakkegt.supabase.co",
      databaseUrl:
        "postgres://postgres.vmznysvietfaddakkegt:x@aws-0-ca-central-1.pooler.supabase.com:5432/postgres",
    }),
    "staging",
  );
  assert.equal(
    assertSafeTarget({
      supabaseUrl: "http://127.0.0.1:54321",
      databaseUrl: "postgres://postgres:postgres@localhost:54322/postgres",
    }),
    "local",
  );
});

test("target guard rejects production, unknown refs, arbitrary URLs, and mixed targets", () => {
  for (const pair of [
    [
      "https://fkvuhfsqcmujywzgczmc.supabase.co",
      "postgres://postgres:x@db.fkvuhfsqcmujywzgczmc.supabase.co/postgres",
    ],
    ["https://unknown.supabase.co", "postgres://postgres:x@db.unknown.supabase.co/postgres"],
    ["http://127.0.0.1:54321", "postgres://postgres:x@remote.example/postgres"],
    [
      "https://vmznysvietfaddakkegt.supabase.co",
      "postgres://postgres:x@db.other.supabase.co/postgres",
    ],
  ])
    assert.throws(
      () => assertSafeTarget({ supabaseUrl: pair[0], databaseUrl: pair[1] }),
      /Refusing unsafe target/,
    );
});

test("ownership requires the exact version marker", () => {
  assert.equal(
    hasExactOwnershipMarker({
      user_metadata: { minted_uat_fixture: { version: FIXTURE_VERSION } },
    }),
    true,
  );
  assert.equal(
    hasExactOwnershipMarker({ user_metadata: { minted_uat_fixture: { version: "older" } } }),
    false,
  );
  assert.equal(hasExactOwnershipMarker({ user_metadata: {} }), false);
});

test("manifest exactly matches generated reset boundaries", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("./uat-fixture-manifest.json", import.meta.url), "utf8"),
  );
  const { ids } = await import("./uat-fixture.mjs");
  assert.deepEqual(manifest.ownership.organizations, ids.organizations);
  assert.deepEqual(manifest.ownership.deletionCases, ids.deletionCases);
});

test("SQL owns exact reset modes and deletion-fidelity children", async () => {
  const sql = await readFile(new URL("../../supabase/seed-uat.sql", import.meta.url), "utf8");
  for (const text of [
    "deletion-pool",
    "case_generation_run_rows",
    "case_generation_exclusions",
    "enrollment_facts",
    "case_status_history",
    "payer_pipeline_history",
    "fill_sessions",
    "case_facilities",
  ])
    assert.match(sql, new RegExp(text));
  assert.doesNotMatch(sql, /DELETE FROM public\.audit_log/i);
});

test("database target rejects spoofed hosts and all routing overrides", () => {
  const api = "https://vmznysvietfaddakkegt.supabase.co";
  const direct = "postgres://postgres:x@db.vmznysvietfaddakkegt.supabase.co:5432/postgres";
  for (const db of [
    direct.replace(".supabase.co", ".supabase.co.attacker.invalid"),
    direct + "?host=db.fkvuhfsqcmujywzgczmc.supabase.co",
    direct + "?hostaddr=192.0.2.1",
    direct + "?user=postgres.production",
    direct + "?service=production",
    direct + "?sslmode=disable",
    direct + "?sslmode=require&sslmode=require",
    direct + "#ignored",
    direct.replace("postgres:", "postgresfake:"),
    direct.replace("/postgres", "/other"),
    direct.replace(":5432", ":6543"),
    "postgres://wrong.vmznysvietfaddakkegt:x@aws-0-ca-central-1.pooler.supabase.com:5432/postgres",
    "postgres://postgres.vmznysvietfaddakkegt:x@aws-0-us-west-1.pooler.supabase.com:5432/postgres",
  ])
    assert.throws(() => assertSafeTarget({ supabaseUrl: api, databaseUrl: db }), db);
  for (const sslmode of ["require", "verify-full"]) {
    assert.equal(
      assertSafeTarget({ supabaseUrl: api, databaseUrl: direct + "?sslmode=" + sslmode }),
      "staging",
    );
  }
});

test("psql strips every inherited PG variable while keeping execution environment", async () => {
  const { psqlEnvironment } = await import("./uat-fixture.mjs");
  assert.deepEqual(
    psqlEnvironment({
      PATH: "/bin",
      HOME: "/tmp",
      PGHOST: "prod",
      PGHOSTADDR: "192.0.2.1",
      PGSERVICE: "prod",
      PGPASSWORD: "secret",
      PGOPTIONS: "options",
    }),
    { PATH: "/bin", HOME: "/tmp" },
  );
});

test("hosted auth bypass fails and full reset still requires exact confirmation", async () => {
  const { assertSeedOptions, CONFIRMATION_TOKEN } = await import("./uat-fixture.mjs");
  assert.throws(() => assertSeedOptions("staging", { skipAuth: true }), /skip-auth/);
  assert.doesNotThrow(() => assertSeedOptions("local", { skipAuth: true }));
  assert.throws(() => assertSeedOptions("staging", { reset: "all" }), /confirm/);
  assert.doesNotThrow(() =>
    assertSeedOptions("staging", { reset: "all", confirm: CONFIRMATION_TOKEN }),
  );
});

test("routine seed preserves existing persona passwords; explicit reset updates them", async () => {
  const { ensurePersonas } = await import("./seed-staging-uat.mjs");
  const { personas, OWNERSHIP_MARKER } = await import("./uat-fixture.mjs");
  const users = personas.map((p, i) => ({
    id: String(i),
    email: p.email,
    user_metadata: OWNERSHIP_MARKER,
  }));
  const updated = [];
  const admin = {
    listUsers: async () => ({ data: { users } }),
    createUser: async () => {
      throw new Error("must reuse owned users");
    },
    updateUserById: async (id, change) => {
      updated.push({ id, change });
      return { data: { user: users.find((u) => u.id === id) } };
    },
  };
  await ensurePersonas(admin, "new-password");
  assert.equal(updated.length, 0);
  await ensurePersonas(admin, "new-password", true);
  assert.equal(updated.length, 4);
  assert.ok(updated.every((entry) => entry.change.password === "new-password"));
});

const preflightEnvironment = {
  SUPABASE_URL: "https://vmznysvietfaddakkegt.supabase.co",
  UAT_DATABASE_URL:
    "postgres://postgres:private-test-password@db.vmznysvietfaddakkegt.supabase.co:5432/postgres",
  SUPABASE_SERVICE_ROLE_KEY: "private-service-key",
  UAT_SHARED_PASSWORD: "private-persona-password",
  PGHOST: "production.invalid",
};
for (const [label, identity, failedQuery] of [
  ["wrong staging identity", "123456789", false],
  ["known production identity", "7642734024280108049", false],
  ["malformed identity", "unexpected output", false],
  ["query failure", null, true],
]) {
  test(`seed preflight rejects ${label} before any Auth or fixture writes`, async () => {
    const { main } = await import("./seed-staging-uat.mjs");
    let authWrites = 0,
      fixtureWrites = 0,
      queries = 0;
    await assert.rejects(
      main([], {
        environment: preflightEnvironment,
        executeIdentity: async (command, args, options) => {
          queries++;
          assert.equal(command, "psql");
          assert.equal(args.at(-1), "SELECT system_identifier::text FROM pg_control_system()");
          assert.equal(options.timeout, 15000);
          assert.ok(!Object.keys(options.env).some((key) => key.startsWith("PG")));
          if (failedQuery)
            throw new Error(`query failed: ${preflightEnvironment.UAT_DATABASE_URL}`);
          return { stdout: identity + "\n" };
        },
        provision: async () => {
          authWrites++;
          return {};
        },
        seed: async () => {
          fixtureWrites++;
        },
        report: () => assert.fail("rejected seed must not report success"),
      }),
      (error) => {
        assert.match(error.message, /UAT database identity/);
        assert.ok(!error.message.includes("private-test-password"));
        assert.ok(!error.message.includes("postgres://"));
        return true;
      },
    );
    assert.equal(queries, 1);
    assert.equal(authWrites, 0);
    assert.equal(fixtureWrites, 0);
  });
}

test("verified staging identity reaches Auth before seed and binds the SQL identity", async () => {
  const { main } = await import("./seed-staging-uat.mjs");
  const steps = [];
  await main([], {
    environment: preflightEnvironment,
    executeIdentity: async () => {
      steps.push("identity");
      return { stdout: "7662742571317219726\n" };
    },
    provision: async (_url, _key, _password, updatePassword) => {
      steps.push("auth");
      assert.equal(updatePassword, false);
      return { admin_alpha: "test-user" };
    },
    seed: async (_url, variables) => {
      steps.push("seed");
      assert.equal(variables.expected_database_identity, "7662742571317219726");
    },
    report: () => {
      steps.push("report");
    },
  });
  assert.deepEqual(steps, ["identity", "auth", "seed", "report"]);
});
