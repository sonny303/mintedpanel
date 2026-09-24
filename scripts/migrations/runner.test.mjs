import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkHistory, hash } from "./inventory.mjs";
import { CLI_VERSION, runMigrations } from "./runner.mjs";
import { createDatabase, validateDestination } from "./database.mjs";
import { runCommand } from "./cli.mjs";
import { createMigrationExecutor } from "./delivery.mjs";
import { fixture as releaseFixture } from "../release/test-fixtures.mjs";
import { canonicalDigest } from "../release/contract.mjs";

function fixture() {
  const inventory = ["20260101000000", "20260102000000"].map((id) => ({
    id,
    path: `supabase/migrations/${id}_test.sql`,
    sha256: hash(id),
  }));
  const plan = {
    status: "reconciled",
    inventory,
    baselineVersions: [inventory[0].id],
    systemIdentifier: "1234567890123456789",
    baselineSchemaDigest: hash("before"),
    resultSchemaDigest: hash("after"),
  };
  let state = {
    systemIdentifier: plan.systemIdentifier,
    versions: plan.baselineVersions,
    schemaDigest: plan.baselineSchemaDigest,
  };
  const pushes = [];
  const database = {
    version: async () => CLI_VERSION,
    snapshot: async () => structuredClone(state),
    push: async ({ dryRun }) => {
      pushes.push(dryRun);
      if (!dryRun)
        state = {
          ...state,
          versions: inventory.map((i) => i.id),
          schemaDigest: plan.resultSchemaDigest,
        };
    },
  };
  return {
    plan,
    inventory,
    database,
    pushes,
    sourceSha: "a".repeat(40),
    change: (patch) => {
      Object.assign(state, patch);
    },
  };
}

test("apply records exact result and a repeated execution performs no writes", async () => {
  const f = fixture();
  assert.equal((await runMigrations(f)).status, "APPLIED");
  assert.deepEqual(f.pushes, [true, false]);
  assert.equal((await runMigrations(f)).status, "ALREADY_APPLIED");
  assert.deepEqual(f.pushes, [true, false]);
});

for (const [name, mutate, code] of [
  [
    "unreconciled database",
    (f) => {
      f.plan.status = "blocked";
    },
    "RECONCILIATION_REQUIRED",
  ],
  [
    "duplicate versions",
    (f) => {
      f.inventory[1].id = f.inventory[0].id;
    },
    "DUPLICATE_MIGRATION_VERSION",
  ],
  [
    "modified migration bytes",
    (f) => {
      f.plan.inventory = structuredClone(f.inventory);
      f.inventory[1].sha256 = hash("edit");
    },
    "PLAN_INVENTORY_MISMATCH",
  ],
  [
    "wrong cluster",
    (f) => f.change({ systemIdentifier: "9876543210123456789" }),
    "DATABASE_IDENTITY_MISMATCH",
  ],
  [
    "unknown remote version",
    (f) => f.change({ versions: ["20250101000000"] }),
    "MIGRATION_HISTORY_MISMATCH",
  ],
  ["missing ledger entries", (f) => f.change({ versions: [] }), "MIGRATION_HISTORY_MISMATCH"],
  ["schema drift", (f) => f.change({ schemaDigest: hash("drift") }), "SCHEMA_DRIFT"],
  [
    "wrong CLI",
    (f) => {
      f.database.version = async () => "latest";
    },
    "CLI_VERSION_MISMATCH",
  ],
]) {
  test(`${name} prevents every push`, async () => {
    const f = fixture();
    mutate(f);
    await assert.rejects(runMigrations(f), { code });
    assert.deepEqual(f.pushes, []);
  });
}

test("database change during dry-run prevents writes", async () => {
  const f = fixture();
  f.database.push = async () => {
    f.pushes.push(true);
    f.change({ schemaDigest: hash("race") });
  };
  await assert.rejects(runMigrations(f), { code: "DATABASE_CHANGED_DURING_PLAN" });
  assert.deepEqual(f.pushes, [true]);
});

test("migration failure stops execution without retry or success receipt", async () => {
  const f = fixture();
  f.database.push = async ({ dryRun }) => {
    f.pushes.push(dryRun);
    if (!dryRun) throw new Error("synthetic failure");
  };
  await assert.rejects(runMigrations(f), /synthetic failure/);
  assert.deepEqual(f.pushes, [true, false]);
});

test("successful command with missing versions cannot pass postcheck", async () => {
  const f = fixture();
  f.database.push = async () => {};
  await assert.rejects(runMigrations(f), { code: "MIGRATION_POSTCHECK_FAILED" });
});

test("successful ledger with missing schema objects cannot pass postcheck", async () => {
  const f = fixture();
  f.database.push = async ({ dryRun }) => {
    if (!dryRun) f.change({ versions: f.inventory.map((i) => i.id) });
  };
  await assert.rejects(runMigrations(f), { code: "SCHEMA_POSTCHECK_FAILED" });
});

test("a partial ledger between baseline and head is not resumed", async () => {
  const f = fixture();
  const pending = {
    id: "20260103000000",
    path: "supabase/migrations/20260103000000_test.sql",
    sha256: hash("pending"),
  };
  f.inventory.push(pending);
  f.plan.inventory = structuredClone(f.inventory);
  f.change({ versions: f.inventory.slice(0, 2).map((item) => item.id) });
  await assert.rejects(runMigrations(f), { code: "MIGRATION_HISTORY_MISMATCH" });
  assert.deepEqual(f.pushes, []);
});

test("no pending versions still requires schema parity", async () => {
  const f = fixture();
  f.change({ versions: f.inventory.map((i) => i.id) });
  await assert.rejects(runMigrations(f), { code: "SCHEMA_DRIFT" });
  assert.deepEqual(f.pushes, []);
});

test("history lock rejects changed SQL, new duplicate versions and backdated additions", () => {
  const { inventory } = fixture();
  checkHistory(inventory, inventory.slice(0, 1));
  assert.throws(
    () => checkHistory([{ ...inventory[0], sha256: hash("changed") }], inventory.slice(0, 1)),
    { code: "HISTORICAL_MIGRATION_CHANGED" },
  );
  assert.throws(
    () => checkHistory([...inventory, { ...inventory[1], path: "other.sql" }], inventory),
    { code: "DUPLICATE_MIGRATION_VERSION" },
  );
  assert.throws(
    () =>
      checkHistory(
        [...inventory, { ...inventory[1], id: "20250101000000", path: "old.sql" }],
        inventory,
      ),
    { code: "BACKDATED_MIGRATION" },
  );
  assert.throws(
    () =>
      checkHistory(
        [
          ...inventory,
          { ...inventory[1], id: "20260105000000", path: "b.sql" },
          { ...inventory[1], id: "20260103000000", path: "c.sql" },
        ],
        inventory,
      ),
    { code: "BACKDATED_MIGRATION" },
  );
});

test("database adapter tolerates CRLF line endings from psql", async () => {
  const { inventory } = fixture();
  const root = await mkdtemp(join(tmpdir(), "crlf-test-"));
  try {
    await mkdir(join(root, "supabase/migrations"), { recursive: true });
    await writeFile(join(root, inventory[0].path), inventory[0].id);
    const psqlScript = join(root, "mock-psql.sh");
    await writeFile(
      psqlScript,
      "#!/bin/sh\nprintf \"1234567890123456789\\r\\n[\\\"20260101000000\\\"]\\r\\n{\\\"relations\\\":[],\\\"columns\\\":[],\\\"constraints\\\":[],\\\"indexes\\\":[],\\\"functions\\\":[],\\\"policies\\\":[],\\\"triggers\\\":[],\\\"views\\\":[],\\\"enums\\\":[],\\\"defaultAcls\\\":[]}\\r\\n\"\n",
    );
    await chmod(psqlScript, 0o755);
    const db = await createDatabase({
      root,
      inventory: [inventory[0]],
      connectionString: "postgresql://postgres:secret@127.0.0.1:5432/postgres",
      binaries: { psql: psqlScript, supabase: "echo" },
    });
    const snapshot = await db.snapshot();
    assert.equal(snapshot.systemIdentifier, "1234567890123456789");
    await db.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hosted destination rejects alternate projects, local hosts, proxies and unsafe TLS", () => {
  const ref = "vmznysvietfaddakkegt";
  const url = `postgresql://postgres:secret@db.${ref}.supabase.co:5432/postgres?sslmode=verify-full`;
  validateDestination(url, ref);
  validateDestination(`${url}&sslrootcert=/etc/ssl/cert.pem`, ref);
  for (const bad of [
    url.replace(ref, "fkvuhfsqcmujywzgczmc"),
    url.replace("verify-full", "require"),
    url.replace(`db.${ref}.supabase.co`, "localhost"),
    `${url}&host=elsewhere`,
    `${url}&sslmode=disable`,
    `${url}&sslrootcert=/tmp/a.crt&sslrootcert=/tmp/b.crt`,
    undefined,
  ]) {
    assert.throws(() => validateDestination(bad, ref), { code: "DATABASE_URL_REJECTED" });
  }
});

test("committed reconciliation holds block release readiness", async () => {
  for (const target of ["staging", "production"]) {
    await assert.rejects(runCommand(["readiness", target]), { code: "RECONCILIATION_REQUIRED" });
  }
  assert.equal((await runCommand(["check"])).status, "INVENTORY_VALID");
  assert.equal(
    (await runCommand(["check"], { MINTED_MIGRATION_BASE_SHA: "0".repeat(40) })).status,
    "INVENTORY_VALID",
  );
  await assert.rejects(
    runCommand(["check"], { MINTED_MIGRATION_BASE_SHA: "1".repeat(40) }),
    { code: "BASE_SHA_NOT_FOUND" },
  );
  await assert.rejects(runCommand(["execute", "staging", "--force"]), { code: "COMMAND_REJECTED" });
});

test("release workflows enforce readiness before delivery and preserve serialization", async () => {
  for (const [name, entry] of [
    ["staging-delivery", "staging"],
    ["production-release", "production"],
  ]) {
    const source = await readFile(
      new URL(`../../.github/workflows/${name}.yml`, import.meta.url),
      "utf8",
    );
    assert.ok(source.indexOf(`scripts/migrations/cli.mjs readiness ${entry}`) > 0);
    assert.ok(
      source.indexOf(`scripts/migrations/cli.mjs readiness ${entry}`) <
        source.indexOf(`scripts/delivery/cli.mjs ${entry}`),
    );
    assert.match(source, /cancel-in-progress: false/);
  }
});

test("release adapter rejects a changed target, plan or release before database access", async () => {
  const { record, policy } = releaseFixture("production", true);
  const bundle = { record, policy, releaseDigest: canonicalDigest(record) };
  const plan = record.context.migrationPlan;
  const executor = createMigrationExecutor({
    bundle,
    inventory: plan.inventory,
    reconciliation: {
      status: "reconciled",
      systemIdentifier: "1234567890123456789",
      inventory: plan.inventory,
      baselineVersions: record.context.baseline.migrations.map((i) => i.id),
      baselineSchemaDigest: plan.baselineSchemaDigest,
      resultSchemaDigest: plan.resultSchemaDigest,
    },
    database: { version: () => assert.fail("database must not be accessed") },
  });
  const request = {
    target: record.context.target,
    plan,
    planDigest: canonicalDigest(plan),
    releaseDigest: bundle.releaseDigest,
  };
  for (const patch of [
    { target: { ...request.target, environment: "staging" } },
    { planDigest: hash("different") },
    { releaseDigest: hash("different") },
    { plan: { ...plan, resultSchemaDigest: hash("different") } },
  ]) {
    await assert.rejects(executor({ ...request, ...patch }), {
      code: "MIGRATION_REQUEST_BINDING_MISMATCH",
    });
  }
});
