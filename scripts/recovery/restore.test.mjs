import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalDigest } from "../release/contract.mjs";
import { PROFILE, POSTGRES_IMAGE, RecoveryError } from "./contract.mjs";
import {
  destroyIsolatedTarget,
  discoverOwnedRecoveryResources,
  inspectSealedBackup,
  prepareIsolatedTarget,
  rehearseStagingRestore,
} from "./restore.mjs";
import { LOCAL_SOCKET } from "./local-target.mjs";

const runId = "0123456789abcdef";

for (const [label, mutate, accepted] of [
  ["legacy exact-role", () => {}, true],
  [
    "exclusive maintenance",
    (lifecycle) => {
      lifecycle.cleanupMode = "exclusive-staging-maintenance";
    },
    true,
  ],
  [
    "unknown cleanup mode",
    (lifecycle) => {
      lifecycle.cleanupMode = "other";
    },
    false,
  ],
  [
    "maintenance with residual roles",
    (lifecycle) => {
      lifecycle.cleanupMode = "exclusive-staging-maintenance";
      lifecycle.poststateRoleCount = 1;
    },
    false,
  ],
  [
    "maintenance with nonempty digest",
    (lifecycle) => {
      lifecycle.cleanupMode = "exclusive-staging-maintenance";
      lifecycle.poststateInventoryDigest = canonicalDigest(["cli_login_other"]);
    },
    false,
  ],
]) {
  test(`sealed backup inspection validates ${label} before artifacts`, async () => {
    const workspace = await mkdtemp(join(await realpath(tmpdir()), "minted-restore-"));
    const names = ["backup", "roles", "schema", "integrity", "migration-lineage"];
    const artifacts = names.map((name, index) => ({
      name,
      sha256: String(index + 1).repeat(64),
      bytes: index + 1,
    }));
    const before = {};
    const schema = { before, after: before };
    const integrity = { catalogDigest: canonicalDigest(before), tables: [], sequences: [] };
    const lineage = [];
    const capture = {
      version: 1,
      status: "CAPTURED_ONLY",
      providerDigest: "a".repeat(64),
      loginRoleLifecycle: {
        prestateRequestedAt: "2026-09-19T03:59:58.000Z",
        prestateReceivedAt: "2026-09-19T03:59:58.100Z",
        prestateInventoryDigest: canonicalDigest([]),
        loginRequestedAt: "2026-09-19T03:59:58.200Z",
        loginReceivedAt: "2026-09-19T03:59:58.300Z",
        cleanupRequestedAt: "2026-09-19T04:00:00.100Z",
        cleanupReceivedAt: "2026-09-19T04:00:00.200Z",
        verifiedAt: "2026-09-19T04:00:00.300Z",
        roleDigest: "b".repeat(64),
        poststateInventoryDigest: canonicalDigest([]),
        poststateRoleCount: 0,
        exactRoleAbsent: true,
      },
      captured: {
        version: 1,
        status: "CAPTURED_ONLY",
        source: {
          ref: "vmznysvietfaddakkegt",
          host: "aws-0-ca-central-1.pooler.supabase.com",
          port: 5432,
          database: "postgres",
          serverVersion: "17.6",
          schemaDigest: canonicalDigest(before),
          lineageDigest: canonicalDigest(lineage),
        },
        capturedAt: "2026-09-19T04:00:00.000Z",
        snapshot: {
          method: "single-data-snapshot-catalog-bracketed",
          sourceEvidence: "OWNED_SNAPSHOT_COLLECTOR",
          declaredSchemaMatch: "NOT_CLAIMED",
          lineageMeaning: "OBSERVED_DATABASE_LEDGERS_ONLY",
        },
        artifacts,
        remainingPrerequisites: ["REPOSITORY_MIGRATION_INVENTORY"],
      },
    };
    mutate(capture.loginRoleLifecycle);
    await writeFile(`${workspace}/capture.json`, `${JSON.stringify(capture)}\n`, { mode: 0o600 });
    const verified = [];
    try {
      const inspection = inspectSealedBackup(
        { workspace, identityPath: "/private/tmp/unused-identity" },
        {
          verify: async ({ name }) => {
            verified.push(name);
            return artifacts.find((artifact) => artifact.name === name);
          },
          decrypt: async (_workspace, name) =>
            ({ schema, integrity, "migration-lineage": lineage })[name],
          clock: () => "2026-09-19T04:00:01.000Z",
        },
      );
      if (!accepted) {
        await assert.rejects(inspection, RecoveryError);
        assert.deepEqual(verified, []);
        return;
      }
      const result = await inspection;
      assert.deepEqual(verified, names);
      assert.equal(result.status, "SEALED_VERIFIED");
      assert.equal(result.observedBackup.available, true);
      assert.ok(result.remainingPrerequisites.includes("RELEASE_CONTEXT_BINDING"));
      assert.ok(result.remainingPrerequisites.includes("COMPLETE_RECOVERY_SCOPE_VERIFICATION"));
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
}

test("target preparation uses one pinned private engine and no published port or host bind", async () => {
  const calls = [];
  const target = { runId, containerId: "a".repeat(64), name: `${PROFILE}-${runId}` };
  const result = await prepareIsolatedTarget(runId, {
    password: "a".repeat(32),
    execute: async (args) => {
      calls.push(args);
      if (args[0] === "context")
        return JSON.stringify([
          { Name: `colima-${PROFILE}`, Endpoints: { docker: { Host: LOCAL_SOCKET } } },
        ]);
      return "ok";
    },
    inspect: async (value) => {
      assert.equal(value, runId);
      return target;
    },
  });
  assert.equal(result, target);
  const createNetwork = calls.find((args) => args.includes("network") && args.includes("create"));
  const run = calls.find((args) => args.includes("container") && args.includes("run"));
  assert.ok(createNetwork.includes("--internal"));
  assert.ok(run.includes(POSTGRES_IMAGE));
  assert.ok(run.includes("no-new-privileges:true"));
  assert.ok(run.includes("listen_addresses=*"));
  assert.ok(!run.includes("--publish"));
  assert.ok(!run.includes("--volume"));
  assert.ok(run.includes(`type=volume,source=${PROFILE}-${runId},target=/var/lib/postgresql/data`));
  assert.ok(
    calls.filter((args) => args.includes("container") && args.includes("run")).length === 1,
  );
});

test("target preparation cannot admit the image's socket-only initialization server", async () => {
  let finalServerReady = false;
  let probes = 0;
  let inspected = false;
  const target = { runId, containerId: "a".repeat(64) };
  const result = await prepareIsolatedTarget(runId, {
    password: "a".repeat(32),
    execute: async (args) => {
      if (args[0] === "context")
        return JSON.stringify([
          { Name: `colima-${PROFILE}`, Endpoints: { docker: { Host: LOCAL_SOCKET } } },
        ]);
      if (args.some((arg) => arg.endsWith("/pg_isready"))) {
        probes++;
        const host = args[args.indexOf("-h") + 1];
        // The image's init server accepts Unix sockets but disables TCP.
        if (host === "/var/run/postgresql") return "accepting connections";
        assert.equal(host, "127.0.0.1");
        if (probes === 1) throw new Error("final server is not listening yet");
        finalServerReady = true;
      }
      return "ok";
    },
    inspect: async () => {
      assert.equal(finalServerReady, true, "do not inspect the temporary init server");
      inspected = true;
      return target;
    },
    cleanup: async () => {},
  });
  assert.equal(result, target);
  assert.equal(probes, 2);
  assert.equal(inspected, true);
});

test("restore coordinator writes a sanitized proof only after restore and verification", async () => {
  const calls = [];
  let saved;
  const verifiedBackup = {
    observedBackup: { artifactDigest: "a".repeat(64) },
    remainingPrerequisites: ["RELEASE_CONTEXT_BINDING"],
  };
  const times = [
    "2026-09-19T04:00:00.000Z",
    "2026-09-19T04:00:01.000Z",
    "2026-09-19T04:00:02.000Z",
    "2026-09-19T04:00:03.000Z",
  ];
  const ticks = [10, 2010];
  const result = await rehearseStagingRestore(
    { workspace: "/private/tmp/recovery", identityPath: "/private/tmp/identity" },
    {
      randomBytes: () => Buffer.from(runId, "hex"),
      clock: () => times.shift(),
      monotonic: () => ticks.shift(),
      inspect: async () => {
        calls.push("inspect");
        return verifiedBackup;
      },
      saveJournal: async (path, value, options) => {
        calls.push("journal");
        assert.equal(path, `/private/tmp/recovery/restore-${runId}-journal.json`);
        assert.equal(JSON.parse(value).status, "CLEANUP_REQUIRED");
        assert.deepEqual(options, { encoding: "utf8", flag: "wx", mode: 0o600 });
      },
      prepare: async () => {
        calls.push("prepare");
        return { runId, containerId: "a".repeat(64) };
      },
      restore: async (options) => {
        assert.equal(options.verifiedBackup, verifiedBackup);
        calls.push("restore");
        return { database: "minted_recovery", serverVersion: "17.6" };
      },
      verify: async (options) => {
        assert.equal(options.verifiedBackup, verifiedBackup);
        calls.push("verify");
        return { status: "RESTORE_VERIFIED_ONLY", captureDigest: "b".repeat(64) };
      },
      save: async (path, value, options) => {
        calls.push("save");
        saved = { path, value, options };
      },
    },
  );
  assert.deepEqual(calls, ["inspect", "journal", "prepare", "restore", "verify", "save"]);
  assert.equal(result.runId, runId);
  assert.equal(result.status, "REHEARSED_ONLY");
  assert.equal(result.releaseAdmission, "BLOCKED");
  assert.equal(result.contextDigest, null);
  assert.equal(result.durationMs, 2000);
  assert.deepEqual(result.qualifiedRecoveryScopes, []);
  assert.ok(result.remainingPrerequisites.includes("RELEASE_CONTEXT_BINDING"));
  assert.equal(saved.path, "/private/tmp/recovery/restore.json");
  assert.deepEqual(saved.options, { encoding: "utf8", flag: "wx", mode: 0o600 });
});

test("target preparation rejects an unowned Docker context before daemon mutation", async () => {
  let calls = 0;
  await assert.rejects(
    prepareIsolatedTarget(runId, {
      execute: async () => {
        calls++;
        return JSON.stringify([
          { Name: "default", Endpoints: { docker: { Host: "unix:///tmp/docker.sock" } } },
        ]);
      },
    }),
    (error) => error instanceof RecoveryError && error.code === "RECOVERY_RESTORE_REJECTED",
  );
  assert.equal(calls, 1);
});

test("target preparation cleans by run ID when network creation has an uncertain outcome", async () => {
  const cleanup = [];
  await assert.rejects(
    prepareIsolatedTarget(runId, {
      password: "a".repeat(32),
      execute: async (args) => {
        if (args[0] === "context")
          return JSON.stringify([
            { Name: `colima-${PROFILE}`, Endpoints: { docker: { Host: LOCAL_SOCKET } } },
          ]);
        if (args.includes("image") && args.includes("inspect")) return "ok";
        if (args.includes("network") && args.includes("create"))
          throw new Error("uncertain transport");
        throw new Error("unexpected command");
      },
      cleanup: async (value) => cleanup.push(value),
    }),
    (error) => error instanceof RecoveryError && error.code === "RECOVERY_RESTORE_REJECTED",
  );
  assert.deepEqual(cleanup, [runId]);
});

function ownedDiscoveryExecutor({ foreignKind } = {}) {
  const name = `${PROFILE}-${runId}`;
  const containerId = "a".repeat(64);
  const networkId = "b".repeat(64);
  return async (args) => {
    if (args[0] === "context")
      return JSON.stringify([
        { Name: `colima-${PROFILE}`, Endpoints: { docker: { Host: LOCAL_SOCKET } } },
      ]);
    const value = args.join(" ");
    if (value.includes("container ls")) return `${containerId}\n`;
    if (value.includes("network ls")) return `${networkId}\n`;
    if (value.includes("volume ls")) return `${name}\n`;
    const labels = (kind) => ({
      "com.minted.recovery.owner": kind === foreignKind ? "foreign" : PROFILE,
      "com.minted.recovery.run-id": runId,
    });
    if (value.includes("container inspect"))
      return JSON.stringify([
        { Id: containerId, Name: `/${name}`, Config: { Labels: labels("container") } },
      ]);
    if (value.includes("network inspect"))
      return JSON.stringify([{ Id: networkId, Name: name, Labels: labels("network") }]);
    if (value.includes("volume inspect"))
      return JSON.stringify([{ Name: name, Labels: labels("volume") }]);
    throw new Error(`unexpected command: ${value}`);
  };
}

test("resource discovery proves exact names and both ownership labels", async () => {
  assert.deepEqual(
    await discoverOwnedRecoveryResources(runId, { execute: ownedDiscoveryExecutor() }),
    {
      container: { ref: "a".repeat(64) },
      network: { ref: "b".repeat(64) },
      volume: { ref: `${PROFILE}-${runId}` },
    },
  );
});

test("resource discovery refuses a foreign exact-name resource", async () => {
  await assert.rejects(
    discoverOwnedRecoveryResources(runId, {
      execute: ownedDiscoveryExecutor({ foreignKind: "volume" }),
    }),
    (error) => error instanceof RecoveryError && error.code === "RECOVERY_RESTORE_REJECTED",
  );
});

for (const phase of ["prepare", "restore", "verify", "save"]) {
  test(`restore coordinator records verified cleanup after ${phase} failure`, async () => {
    const calls = [];
    let cleanupReceipt;
    const verifiedBackup = {
      observedBackup: { artifactDigest: "a".repeat(64) },
      remainingPrerequisites: ["COMPLETE_RECOVERY_SCOPE_VERIFICATION"],
    };
    await assert.rejects(
      rehearseStagingRestore(
        { workspace: "/private/tmp/recovery", identityPath: "/private/tmp/identity" },
        {
          randomBytes: () => Buffer.from(runId, "hex"),
          clock: () => "2026-09-19T04:00:00.000Z",
          monotonic: () => 1,
          inspect: async () => verifiedBackup,
          saveJournal: async () => calls.push("journal"),
          prepare: async () => {
            calls.push("prepare");
            if (phase === "prepare") throw new Error("private failure");
            return { runId, containerId: "a".repeat(64) };
          },
          restore: async () => {
            calls.push("restore");
            if (phase === "restore") throw new Error("private failure");
            return { database: "minted_recovery", serverVersion: "17.6" };
          },
          verify: async () => {
            calls.push("verify");
            if (phase === "verify") throw new Error("private failure");
            return { status: "RESTORE_VERIFIED_ONLY" };
          },
          save: async () => {
            calls.push("save");
            if (phase === "save") throw new Error("private failure");
          },
          cleanup: async (value) => {
            calls.push("cleanup");
            assert.equal(value, runId);
            return {
              version: 1,
              runId,
              status: "DESTROYED",
              attempted: ["container", "network", "volume"],
              removed: ["container", "network", "volume"],
              remaining: [],
              failureKinds: [],
              verifiedAt: "2026-09-19T04:00:01.000Z",
            };
          },
          saveCleanup: async (path, value, options) => {
            calls.push("receipt");
            cleanupReceipt = JSON.parse(value);
            assert.equal(path, `/private/tmp/recovery/restore-${runId}-cleanup.json`);
            assert.deepEqual(options, { encoding: "utf8", flag: "wx", mode: 0o600 });
          },
        },
      ),
      (error) => error instanceof RecoveryError && error.code === "RECOVERY_RESTORE_REJECTED",
    );
    assert.equal(calls[0], "journal");
    assert.deepEqual(calls.slice(-2), ["cleanup", "receipt"]);
    assert.equal(cleanupReceipt.status, "DESTROYED");
    assert.ok(!JSON.stringify(cleanupReceipt).includes("private failure"));
  });
}

const allResources = {
  container: { ref: "a".repeat(64) },
  network: { ref: "b".repeat(64) },
  volume: { ref: `${PROFILE}-${runId}` },
};
const noResources = { container: null, network: null, volume: null };

for (const failedKind of ["container", "network", "volume"]) {
  test(`destroy attempts every resource and a rerun clears a prior ${failedKind} failure`, async () => {
    const snapshots = [
      structuredClone(allResources),
      { ...structuredClone(noResources), [failedKind]: structuredClone(allResources[failedKind]) },
      { ...structuredClone(noResources), [failedKind]: structuredClone(allResources[failedKind]) },
      structuredClone(noResources),
    ];
    let failed = false;
    const removals = [];
    const execute = async (args) => {
      const kind = args.includes("container")
        ? "container"
        : args.includes("network")
          ? "network"
          : "volume";
      removals.push(kind);
      if (kind === failedKind && !failed) {
        failed = true;
        throw new Error("private deletion failure");
      }
      return "";
    };
    const discover = async () => snapshots.shift();
    const first = await destroyIsolatedTarget(runId, {
      execute,
      discover,
      clock: () => "2026-09-19T04:00:00.000Z",
    });
    assert.equal(first.status, "CLEANUP_BLOCKED");
    assert.deepEqual(first.attempted, ["container", "network", "volume"]);
    assert.deepEqual(first.failureKinds, [failedKind]);
    assert.deepEqual(first.remaining, [failedKind]);
    const second = await destroyIsolatedTarget(runId, {
      execute,
      discover,
      clock: () => "2026-09-19T04:00:01.000Z",
    });
    assert.equal(second.status, "DESTROYED");
    assert.deepEqual(second.remaining, []);
    assert.equal(snapshots.length, 0);
    assert.ok(removals.includes(failedKind));
  });
}

test("destroy is idempotent when every owned resource is already absent", async () => {
  let executes = 0;
  const receipt = await destroyIsolatedTarget(runId, {
    execute: async () => {
      executes++;
    },
    discover: async () => structuredClone(noResources),
    clock: () => "2026-09-19T04:00:00.000Z",
  });
  assert.equal(receipt.status, "DESTROYED");
  assert.deepEqual(receipt.attempted, []);
  assert.deepEqual(receipt.remaining, []);
  assert.equal(executes, 0);
});

const roleFixture = (rolname, oid, extra = {}) => ({
  rolname,
  oid,
  rolsuper: false,
  rolinherit: true,
  rolcreaterole: false,
  rolcreatedb: false,
  rolcanlogin: false,
  rolreplication: false,
  rolbypassrls: false,
  rolconnlimit: -1,
  rolvaliduntil: null,
  rolconfig: null,
  ...extra,
});

test("local role planner creates only missing source roles and quotes configurations", async () => {
  const { planLocalRoles } = await import("./restore.mjs");
  const admin = roleFixture("supabase_admin", 1, { rolsuper: true, rolcanlogin: true });
  const local = { roles: [admin], memberships: [] };
  const source = {
    roles: [
      { ...admin, rolconfig: ["search_path=public, extensions"] },
      roleFixture('quoted"role', 2, { rolconfig: ["app.note=it's private\\value"] }),
      roleFixture("cli_login_postgres", 3),
    ],
    memberships: [],
    roleDatabaseSettings: [
      { setdatabase: "123", setrole: "2", setconfig: ["statement_timeout=3000"] },
    ],
  };
  const plan = planLocalRoles(source, local);
  assert.match(plan.rolesSql, /CREATE ROLE "quoted""role"/);
  assert.doesNotMatch(plan.rolesSql, /CREATE ROLE "supabase_admin"|cli_login_|PASSWORD/);
  assert.ok(plan.rolesSql.includes("E'it''s private\\\\value'"));
  assert.match(plan.databaseSettingsSql, /ALTER ROLE "quoted""role" IN DATABASE "minted_recovery"/);
});

test("local role planner preserves grantors and membership flags in dependency order", async () => {
  const { planLocalRoles } = await import("./restore.mjs");
  const roles = [
    roleFixture("supabase_admin", 1, { rolsuper: true }),
    roleFixture("group", 2),
    roleFixture("delegator", 3),
    roleFixture("member", 4),
  ];
  const memberships = [
    {
      roleid: 2,
      member: 4,
      grantor: 3,
      admin_option: false,
      inherit_option: false,
      set_option: true,
    },
    {
      roleid: 2,
      member: 3,
      grantor: 1,
      admin_option: true,
      inherit_option: true,
      set_option: true,
    },
  ];
  const plan = planLocalRoles(
    { roles, memberships, roleDatabaseSettings: [] },
    { roles, memberships: [] },
  );
  assert.ok(plan.rolesSql.indexOf('TO "delegator"') < plan.rolesSql.indexOf('TO "member"'));
  assert.match(
    plan.rolesSql,
    /TO "member" WITH ADMIN false, INHERIT false, SET true GRANTED BY "delegator"/,
  );
});

test("local role planner rejects reserved drift and unexpected local memberships", async () => {
  const { planLocalRoles } = await import("./restore.mjs");
  const admin = roleFixture("supabase_admin", 1, { rolsuper: true });
  const reserved = roleFixture("pg_monitor", 2);
  assert.throws(() =>
    planLocalRoles(
      {
        roles: [admin, { ...reserved, rolcanlogin: true }],
        memberships: [],
        roleDatabaseSettings: [],
      },
      { roles: [admin, reserved], memberships: [] },
    ),
  );
  assert.throws(() =>
    planLocalRoles(
      { roles: [admin, reserved], memberships: [], roleDatabaseSettings: [] },
      {
        roles: [admin, reserved],
        memberships: [
          {
            roleid: 2,
            member: 1,
            grantor: 1,
            admin_option: true,
            inherit_option: true,
            set_option: true,
          },
        ],
      },
    ),
  );
});

for (const archiveFails of [false, true]) {
  test(`isolated event-owner elevation is removed after archive ${archiveFails ? "failure" : "success"}`, async () => {
    const { restoreArchiveWithEventOwners } = await import("./restore.mjs");
    const calls = [];
    const operation = restoreArchiveWithEventOwners(
      {
        target: { containerId: "a".repeat(64) },
        workspace: "/private/tmp/backup",
        identityPath: "/private/tmp/identity",
        catalog: {
          roles: [roleFixture("postgres", 1), roleFixture("supabase_admin", 2, { rolsuper: true })],
          eventTriggers: [{ evtname: "managed_event", evtowner: 1 }],
        },
      },
      {
        prepareExtensions: async () => [],
        execute: async (args, sql) => {
          assert.equal(args[args.indexOf("-U") + 1], "supabase_admin");
          calls.push(sql);
          if (sql.includes("FROM pg_catalog.pg_event_trigger"))
            return JSON.stringify([{ name: "managed_event", owner: "postgres" }]);
          if (sql.includes("FROM pg_catalog.pg_roles"))
            return JSON.stringify([{ name: "postgres", superuser: false }]);
          return "";
        },
        restoreStream: async () => {
          calls.push("archive");
          if (archiveFails) throw Error("archive failed");
        },
      },
    );
    if (archiveFails) await assert.rejects(operation, /archive failed/);
    else await operation;
    assert.match(calls[0], /ALTER ROLE "postgres" SUPERUSER/);
    assert.equal(calls[1], "archive");
    assert.match(calls[2], /ALTER ROLE "postgres" NOSUPERUSER/);
    assert.ok(calls.every((sql) => !sql.includes('ALTER ROLE "supabase_admin"')));
  });
}

test("isolated event-owner restore refuses changed ownership and residual elevation", async () => {
  const { restoreArchiveWithEventOwners } = await import("./restore.mjs");
  for (const corrupt of ["owner", "superuser"]) {
    await assert.rejects(
      restoreArchiveWithEventOwners(
        {
          target: { containerId: "a".repeat(64) },
          workspace: "/private/tmp/backup",
          identityPath: "/private/tmp/identity",
          catalog: {
            roles: [roleFixture("postgres", 1)],
            eventTriggers: [{ evtname: "managed_event", evtowner: 1 }],
          },
        },
        {
          prepareExtensions: async () => [],
          execute: async (_args, sql) => {
            if (sql.includes("FROM pg_catalog.pg_event_trigger"))
              return JSON.stringify([
                { name: "managed_event", owner: corrupt === "owner" ? "other" : "postgres" },
              ]);
            if (sql.includes("FROM pg_catalog.pg_roles"))
              return JSON.stringify([{ name: "postgres", superuser: true }]);
            return "";
          },
          restoreStream: async () => {},
        },
      ),
      RecoveryError,
    );
  }
});

test("source policy roles normalize numeric and textual PUBLIC OIDs and reject unknown roles", async () => {
  const { sourceAccess } = await import("./restore.mjs");
  const catalog = {
    roles: [roleFixture("authenticated", "123")],
    relations: [],
    columns: [],
    policies: [{ schema: "public", table: "t", name: "p", roles: ["0", "123"] }],
  };
  const textual = sourceAccess(catalog);
  const numeric = sourceAccess({
    ...catalog,
    policies: [{ ...catalog.policies[0], roles: [0, 123] }],
  });
  assert.deepEqual(textual, numeric);
  assert.deepEqual(textual.policies[0].roles, ["authenticated", "public"]);
  assert.throws(
    () => sourceAccess({ ...catalog, policies: [{ ...catalog.policies[0], roles: ["999"] }] }),
    RecoveryError,
  );
});

test("uncertain local elevation still attempts exact revocation and skips archive", async () => {
  const { restoreArchiveWithEventOwners } = await import("./restore.mjs");
  const calls = [];
  await assert.rejects(
    restoreArchiveWithEventOwners(
      {
        target: { containerId: "a".repeat(64) },
        workspace: "/private/tmp/backup",
        identityPath: "/private/tmp/identity",
        catalog: {
          roles: [roleFixture("postgres", 1)],
          eventTriggers: [{ evtname: "managed_event", evtowner: 1 }],
        },
      },
      {
        prepareExtensions: async () => [],
        execute: async (_args, sql) => {
          calls.push(sql);
          if (sql.includes('"postgres" SUPERUSER')) throw Error("transport failed after commit");
          return "";
        },
        restoreStream: async () => assert.fail("archive must not run after uncertain elevation"),
      },
    ),
    /transport failed/,
  );
  assert.equal(calls.length, 2);
  assert.match(calls[1], /ALTER ROLE "postgres" NOSUPERUSER/);
});

test("restored access comparison ignores row collation but preserves content and ACL differences", async () => {
  const { normalizeRestoredAccess } = await import("./restore.mjs");
  const access = {
    relations: [],
    policies: [],
    columns: [
      { schema: "public", table: "groups", position: 2, name: "second", acl: null },
      { schema: "public", table: "groups", position: 10, name: "tenth", acl: ["b", "a"] },
      { schema: "public", table: "group_settings", position: 1, name: "first", acl: null },
    ],
  };
  const reordered = { ...access, columns: [...access.columns].reverse() };
  assert.deepEqual(normalizeRestoredAccess(access), normalizeRestoredAccess(reordered));
  reordered.columns[0] = { ...reordered.columns[0], acl: ["unexpected"] };
  assert.notDeepEqual(normalizeRestoredAccess(access), normalizeRestoredAccess(reordered));
});

test("catalog normalization preserves owner, body, ACL and role attributes across ordering", async () => {
  const { normalizeCatalogProof } = await import("./restore.mjs");
  const structure = {
    constraints: [],
    indexes: [],
    triggers: [],
    extensions: [
      { name: "z_extension", owner: "postgres" },
      { name: "a_extension", owner: "supabase_admin" },
    ],
    functions: [
      { identity: "public.a_b()", owner: "postgres", definition: "SELECT 1", acl: ["z", "a"] },
      { identity: "public.ab()", owner: "postgres", definition: "SELECT 2", acl: null },
    ],
  };
  const reordered = {
    ...structure,
    functions: [...structure.functions].reverse(),
    extensions: [...structure.extensions].reverse(),
  };
  assert.deepEqual(
    normalizeCatalogProof("structure", structure),
    normalizeCatalogProof("structure", reordered),
  );
  for (const change of [{ owner: "other" }, { definition: "SELECT 3" }, { acl: ["unexpected"] }]) {
    const changed = structuredClone(reordered);
    Object.assign(changed.functions[0], change);
    assert.notDeepEqual(
      normalizeCatalogProof("structure", structure),
      normalizeCatalogProof("structure", changed),
    );
  }
  const roles = { roles: [roleFixture("a_b", 1), roleFixture("ab", 2)], memberships: [] };
  assert.deepEqual(
    normalizeCatalogProof("roles", roles),
    normalizeCatalogProof("roles", { ...roles, roles: [...roles.roles].reverse() }),
  );
  assert.throws(() => normalizeCatalogProof("roles", { ...roles, unexpected: [] }));
});

test("restore TOC omits only one exact precreated schema CREATE and preserves ACL/data/extensions", async () => {
  const { filterRestoreTableOfContents } = await import("./restore.mjs");
  const toc =
    "12; 2615 16607 SCHEMA - vault supabase_admin\n5356; 0 0 ACL - SCHEMA vault supabase_admin\n5; 3079 16608 EXTENSION - supabase_vault \n50; 0 123 TABLE DATA vault secrets supabase_admin\n";
  const filtered = filterRestoreTableOfContents(toc, [{ name: "vault", owner: "supabase_admin" }]);
  assert.ok(filtered.startsWith("; source-owned schema precreated: 12;"));
  assert.ok(filtered.includes("5356; 0 0 ACL - SCHEMA vault supabase_admin"));
  assert.ok(filtered.includes("5; 3079 16608 EXTENSION - supabase_vault"));
  assert.ok(filtered.includes("50; 0 123 TABLE DATA vault secrets supabase_admin"));
  assert.throws(() => filterRestoreTableOfContents(toc, [{ name: "vault", owner: "postgres" }]));
  assert.throws(() =>
    filterRestoreTableOfContents("", [{ name: "vault", owner: "supabase_admin" }]),
  );
  assert.throws(() =>
    filterRestoreTableOfContents(toc + toc, [{ name: "vault", owner: "supabase_admin" }]),
  );
});

test("RI trigger normalization removes only internal generated names and keeps full semantics", async () => {
  const { normalizeCatalogProof } = await import("./restore.mjs");
  const trigger = (id) => ({
    schema: "public",
    table: "t",
    name: `RI_ConstraintTrigger_c_${id}`,
    internal: true,
    enabled: "O",
    definition: `CREATE CONSTRAINT TRIGGER "RI_ConstraintTrigger_c_${id}" AFTER INSERT ON public.t FROM public.parent NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION "RI_FKey_check_ins"()`,
  });
  const structure = (triggers) => ({
    constraints: [],
    indexes: [],
    functions: [],
    extensions: [],
    triggers,
  });
  assert.deepEqual(
    normalizeCatalogProof("structure", structure([trigger(1)])),
    normalizeCatalogProof("structure", structure([trigger(99)])),
  );
  const changed = trigger(99);
  changed.definition = changed.definition.replace("AFTER INSERT", "AFTER UPDATE");
  assert.notDeepEqual(
    normalizeCatalogProof("structure", structure([trigger(1)])),
    normalizeCatalogProof("structure", structure([changed])),
  );
  assert.notDeepEqual(
    normalizeCatalogProof("structure", structure([{ ...trigger(1), internal: false }])),
    normalizeCatalogProof("structure", structure([{ ...trigger(99), internal: false }])),
  );
});
