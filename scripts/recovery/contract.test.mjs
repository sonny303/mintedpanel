import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { canonicalDigest } from "../release/contract.mjs";
import {
  STAGING,
  PROFILE,
  POSTGRES_IMAGE,
  SCOPES,
  CHECKS,
  stagingExportEnvironment,
  validateBackup,
  validateLocalTarget,
  validateRehearsal,
} from "./contract.mjs";

const digest = (letter) => letter.repeat(64);
const now = "2026-09-08T20:00:00.000Z";
const expectedRunId = "0123456789abcdef";
const expectedSocket = "unix:///Users/example/.colima/minted-staging-recovery/docker.sock";
const evidence = (names) =>
  names.map((name) => ({ name, status: "PASS", evidenceDigest: digest("a") }));
function fixture() {
  const source = { ...STAGING, schemaDigest: digest("b"), lineageDigest: digest("c") };
  const artifacts = [{ name: "synthetic", sha256: digest("d"), bytes: 2000 }];
  const backup = {
    version: 1,
    source,
    startedAt: "2026-09-08T19:00:00.000Z",
    finishedAt: "2026-09-08T19:01:00.000Z",
    schemaBefore: source.schemaDigest,
    schemaAfter: source.schemaDigest,
    artifacts,
    scopes: evidence(SCOPES),
    exporterSucceeded: true,
    snapshotMethod: "single-data-snapshot-catalog-bracketed",
  };
  const observed = {
    capturedAt: now,
    source: structuredClone(source),
    artifacts: structuredClone(artifacts),
    decryptionVerified: true,
  };
  const target = {
    observedAt: now,
    runId: expectedRunId,
    context: `colima-${PROFILE}`,
    engineEndpoint: expectedSocket,
    name: `${PROFILE}-${expectedRunId}`,
    ownerLabel: PROFILE,
    runLabel: expectedRunId,
    containerId: digest("e"),
    image: POSTGRES_IMAGE,
    imageArchitecture: "arm64",
    serverVersion: STAGING.serverVersion,
    database: "postgres",
    transport: "docker-exec-stdin",
    publishedPortCount: 0,
    configuredPortBindingCount: 0,
    networkName: `${PROFILE}-${expectedRunId}`,
    networkId: digest("f"),
    networkInternal: true,
    networkOwnerLabel: PROFILE,
    networkRunLabel: expectedRunId,
    networkContainerIds: [digest("e")],
    networkCount: 1,
    hostBindCount: 0,
    privileged: false,
    hostNamespaces: false,
    volumeName: `${PROFILE}-${expectedRunId}`,
    volumeCount: 1,
    addedCapabilityCount: 0,
    deviceCount: 0,
    volumeOwnerLabel: PROFILE,
    volumeRunLabel: expectedRunId,
  };
  const restore = {
    version: 1,
    ref: STAGING.ref,
    backupDigest: canonicalDigest(backup),
    targetDigest: validateLocalTarget({ target, expectedRunId, expectedSocket, now }),
    detectedAt: "2026-09-08T19:02:00.000Z",
    startedAt: "2026-09-08T19:03:00.000Z",
    finishedAt: "2026-09-08T19:10:00.000Z",
    status: "PASS",
    checks: evidence(CHECKS),
    scopes: evidence(SCOPES),
  };
  return { backup, observed, target, restore, expectedRunId, expectedSocket, now };
}

test("complete synthetic evidence passes and returns only fixed hashes", () => {
  const result = validateRehearsal(fixture());
  assert.deepEqual(Object.keys(result).sort(), ["backupDigest", "digest", "targetDigest"]);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
});
const rejects = [
  [
    "production source",
    (x) => {
      x.backup.source.ref = "fkvuhfsqcmujywzgczmc";
    },
  ],
  [
    "other pooler",
    (x) => {
      x.backup.source.host = "aws-0-us-east-1.pooler.supabase.com";
    },
  ],
  [
    "transaction pooler",
    (x) => {
      x.backup.source.port = 6543;
    },
  ],
  [
    "old image",
    (x) => {
      x.target.image = "supabase/postgres:17.6.1.095";
    },
  ],
  [
    "old backup",
    (x) => {
      x.backup.startedAt = "2026-09-07T19:59:59.999Z";
    },
  ],
  [
    "future backup",
    (x) => {
      x.backup.finishedAt = "2026-09-08T20:00:00.001Z";
    },
  ],
  [
    "stale observation",
    (x) => {
      x.observed.capturedAt = "2026-09-08T19:54:59.999Z";
    },
  ],
  [
    "schema drift",
    (x) => {
      x.backup.schemaAfter = digest("e");
    },
  ],
  [
    "different source lineage",
    (x) => {
      x.observed.source.lineageDigest = digest("f");
    },
  ],
  [
    "altered ciphertext",
    (x) => {
      x.observed.artifacts[0].sha256 = digest("e");
    },
  ],
  [
    "missing artifact",
    (x) => {
      x.observed.artifacts = [];
    },
  ],
  [
    "duplicate artifact",
    (x) => {
      x.backup.artifacts.push(structuredClone(x.backup.artifacts[0]));
    },
  ],
  [
    "unfinished exporter",
    (x) => {
      x.backup.exporterSucceeded = false;
    },
  ],
  [
    "unverified decryption",
    (x) => {
      x.observed.decryptionVerified = false;
    },
  ],
  [
    "missing Auth scope",
    (x) => {
      x.backup.scopes = x.backup.scopes.filter((s) => s.name !== "auth-data-access");
    },
  ],
  [
    "duplicate scope",
    (x) => {
      x.backup.scopes[0] = structuredClone(x.backup.scopes[1]);
    },
  ],
  [
    "skipped Vault",
    (x) => {
      x.backup.scopes.find((s) => s.name === "vault-secret-recovery").status = "SKIP";
    },
  ],
  [
    "missing integrity proof",
    (x) => {
      x.restore.checks.pop();
    },
  ],
  [
    "unverified Auth test",
    (x) => {
      x.restore.checks.find((c) => c.name === "auth-local-login-isolation").status = "UNVERIFIED";
    },
  ],
  [
    "changed backup binding",
    (x) => {
      x.restore.backupDigest = digest("a");
    },
  ],
  [
    "changed target binding",
    (x) => {
      x.restore.targetDigest = digest("b");
    },
  ],
  [
    "restore before backup",
    (x) => {
      x.restore.detectedAt = "2026-09-08T18:59:59.000Z";
    },
  ],
  [
    "slow restore including detection",
    (x) => {
      x.backup.startedAt = "2026-09-08T14:00:00.000Z";
      x.backup.finishedAt = "2026-09-08T14:01:00.000Z";
      x.restore.backupDigest = canonicalDigest(x.backup);
      x.restore.detectedAt = "2026-09-08T14:02:00.000Z";
      x.restore.startedAt = "2026-09-08T18:59:00.000Z";
      x.restore.finishedAt = "2026-09-08T19:00:00.000Z";
    },
  ],
  [
    "remote restore",
    (x) => {
      x.target.transport = "tcp";
    },
  ],
  [
    "effective published port",
    (x) => {
      x.target.publishedPortCount = 1;
    },
  ],
  [
    "unowned container",
    (x) => {
      x.target.runLabel = "fedcba9876543210";
    },
  ],
  [
    "unowned volume",
    (x) => {
      x.target.volumeOwnerLabel = "other-task";
    },
  ],
  [
    "other Docker context",
    (x) => {
      x.target.context = "default";
    },
  ],
  [
    "remote Docker engine",
    (x) => {
      x.target.engineEndpoint = "tcp://example.com:2375";
    },
  ],
  [
    "outbound network",
    (x) => {
      x.target.networkInternal = false;
    },
  ],
  [
    "extra network",
    (x) => {
      x.target.networkCount = 2;
    },
  ],
  [
    "unreviewed network peer",
    (x) => {
      x.target.networkContainerIds.push(digest("a"));
    },
  ],
  [
    "host mount",
    (x) => {
      x.target.hostBindCount = 1;
    },
  ],
  [
    "unowned extra volume",
    (x) => {
      x.target.volumeCount = 2;
    },
  ],
  [
    "network administration capability",
    (x) => {
      x.target.addedCapabilityCount = 1;
    },
  ],
  [
    "host device",
    (x) => {
      x.target.deviceCount = 1;
    },
  ],
  [
    "configured host port binding",
    (x) => {
      x.target.configuredPortBindingCount = 1;
    },
  ],
  [
    "privileged container",
    (x) => {
      x.target.privileged = true;
    },
  ],
  [
    "host namespace",
    (x) => {
      x.target.hostNamespaces = true;
    },
  ],
  [
    "stale target inspection",
    (x) => {
      x.target.observedAt = "2026-09-08T19:54:59.999Z";
    },
  ],
  [
    "unknown sensitive field",
    (x) => {
      x.backup["sensitive-canary"] = "private-value";
    },
  ],
];
for (const [name, change] of rejects)
  test(`rejects ${name}`, () => {
    const input = fixture();
    change(input);
    assert.throws(
      () => validateRehearsal(input),
      (error) => {
        assert.match(error.message, /^[A-Z_]+$/);
        assert.ok(!error.message.includes("private-value"));
        return true;
      },
    );
  });
test("fresh reinspection of the same target preserves restore identity", () => {
  const input = fixture();
  input.target.observedAt = "2026-09-08T19:59:00.000Z";
  assert.doesNotThrow(() => validateRehearsal(input));
});
test("backup limit includes the full export duration", () => {
  const input = fixture();
  input.backup.startedAt = "2026-09-07T20:00:00.000Z";
  assert.doesNotThrow(() => validateBackup(input));
  input.backup.startedAt = "2026-09-07T19:59:59.999Z";
  assert.throws(() => validateBackup(input), /STALE_OR_FUTURE/);
});
function credential() {
  return {
    response: {
      role: "cli_login_synthetic",
      password: "synthetic-not-a-real-password",
      ttl_seconds: 300,
    },
    requestedAt: "2026-09-08T19:59:00.000Z",
    receivedAt: "2026-09-08T19:59:01.000Z",
    now,
    sourceObserved: { capturedAt: now, source: fixture().backup.source },
  };
}
test("credential boundary pins staging TLS and read-only sessions", () => {
  const result = stagingExportEnvironment(credential());
  assert.equal(result.environment.PGHOST, "aws-0-ca-central-1.pooler.supabase.com");
  assert.equal(result.environment.PGPORT, "5432");
  assert.equal(result.environment.PGUSER, "cli_login_synthetic.vmznysvietfaddakkegt");
  assert.equal(result.environment.PGSSLMODE, "verify-full");
  assert.match(result.environment.PGOPTIONS, /default_transaction_read_only=on/);
  assert.equal(result.expiresAt, "2026-09-08T20:04:00.000Z");
});
for (const ttl of [0, -1, 900.1, 901, "300"])
  test(`rejects unsupported TTL ${ttl}`, () => {
    const input = credential();
    input.response.ttl_seconds = ttl;
    assert.throws(() => stagingExportEnvironment(input));
  });
test("rejects credential at its conservative deadline", () => {
  const input = credential();
  input.now = "2026-09-08T20:04:00.000Z";
  assert.throws(() => stagingExportEnvironment(input), /CREDENTIAL_EXPIRED/);
});
test("rejects production credential source", () => {
  const input = credential();
  input.sourceObserved.source.ref = "fkvuhfsqcmujywzgczmc";
  assert.throws(() => stagingExportEnvironment(input));
});

test("rejects stale credential source observations", () => {
  const input = credential();
  input.sourceObserved.capturedAt = "2026-09-08T19:54:59.999Z";
  assert.throws(() => stagingExportEnvironment(input), /STALE_OR_FUTURE/);
});

test("metadata CLI accepts fresh synthetic evidence and emits only digest fields", async (t) => {
  const directory = await mkdtemp(join(realpathSync(tmpdir()), "minted-recovery-metadata-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = fixture();
  const offset = Date.now() - Date.parse(now) - 1000;
  const shift = (value) => {
    if (typeof value === "string" && /^2026-09-08T/.test(value))
      return new Date(Date.parse(value) + offset).toISOString();
    if (Array.isArray(value)) return value.map(shift);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shift(v)]));
    return value;
  };
  const fresh = shift(input);
  fresh.restore.backupDigest = canonicalDigest(fresh.backup);
  fresh.restore.targetDigest = validateLocalTarget(fresh);
  const args = ["scripts/recovery/validate.mjs"];
  for (const name of ["backup", "observed", "restore", "target"]) {
    const path = join(directory, `${name}.json`);
    await writeFile(path, JSON.stringify(fresh[name]), { mode: 0o600 });
    args.push(`--${name}`, path);
  }
  args.push("--run-id", expectedRunId, "--socket", expectedSocket);
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(Object.keys(JSON.parse(result.stdout)).sort(), [
    "backupDigest",
    "digest",
    "ok",
    "targetDigest",
  ]);
  // Oversized input and a final-component symlink both fail without contents/paths.
  await writeFile(join(directory, "backup.json"), "private-canary".repeat(100000));
  const tooBig = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(tooBig.status, 2);
  assert.equal(tooBig.stdout, "");
  assert.equal(tooBig.stderr, '{"ok":false,"code":"RECOVERY_EVIDENCE_REJECTED"}\n');
  await rm(join(directory, "backup.json"));
  await symlink(join(directory, "observed.json"), join(directory, "backup.json"));
  const linked = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(linked.status, 2);
  assert.equal(linked.stderr, tooBig.stderr);
});
