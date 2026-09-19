import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { canonicalDigest } from "../release/contract.mjs";
import { PROFILE, POSTGRES_IMAGE, RecoveryError } from "./contract.mjs";
import { inspectSealedBackup, prepareIsolatedTarget, rehearseStagingRestore } from "./restore.mjs";
import { LOCAL_SOCKET } from "./local-target.mjs";

const runId = "0123456789abcdef";

test("sealed backup inspection authenticates every artifact before returning a candidate", async () => {
  const workspace = await mkdtemp("/private/tmp/minted-restore-");
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
      deleteRequestedAt: "2026-09-19T04:00:00.100Z",
      deleteReceivedAt: "2026-09-19T04:00:00.200Z",
      verifiedAt: "2026-09-19T04:00:00.300Z",
      roleDigest: "b".repeat(64),
      poststateInventoryDigest: canonicalDigest([]),
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
  assert.deepEqual(calls, ["inspect", "prepare", "restore", "verify", "save"]);
  assert.equal(result.runId, runId);
  assert.equal(result.status, "REHEARSED_ONLY");
  assert.equal(result.releaseAdmission, "BLOCKED");
  assert.equal(result.contextDigest, null);
  assert.equal(result.durationMs, 2000);
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
