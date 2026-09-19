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

test("sealed backup inspection authenticates every artifact before returning a candidate", async () => {
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
  await writeFile(`${workspace}/capture.json`, `${JSON.stringify(capture)}\n`, { mode: 0o600 });
  const verified = [];
  try {
    const result = await inspectSealedBackup(
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
    assert.deepEqual(verified, names);
    assert.equal(result.status, "SEALED_VERIFIED");
    assert.equal(result.observedBackup.available, true);
    assert.ok(result.remainingPrerequisites.includes("RELEASE_CONTEXT_BINDING"));
    assert.ok(result.remainingPrerequisites.includes("COMPLETE_RECOVERY_SCOPE_VERIFICATION"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

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
  assert.ok(!run.includes("--publish"));
  assert.ok(!run.includes("--volume"));
  assert.ok(run.includes(`type=volume,source=${PROFILE}-${runId},target=/var/lib/postgresql/data`));
  assert.ok(
    calls.filter((args) => args.includes("container") && args.includes("run")).length === 1,
  );
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
