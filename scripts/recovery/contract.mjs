import { fileURLToPath } from "node:url";
import { canonicalDigest } from "../release/contract.mjs";

// Public trust anchor from Supabase's official dashboard source. This file is
// used by the recovery process only; it never changes the host trust store.
export const SOURCE_CA = Object.freeze({
  path: fileURLToPath(new URL("./certs/supabase-root-2021.crt", import.meta.url)),
  sha256: "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7",
});

export const STAGING = Object.freeze({
  ref: "vmznysvietfaddakkegt",
  host: "aws-0-ca-central-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  serverVersion: "17.6",
});
export const POSTGRES_IMAGE =
  "supabase/postgres@sha256:ed13bb5ea4576948d5c0bec58fad3854d0fc27524e7a910ecab56ed9f96390c4";
export const PROFILE = "minted-staging-recovery";
export const ARTIFACT_NAMES = Object.freeze([
  "backup",
  "roles",
  "schema",
  "data",
  "supplements",
  "vault-recovery",
  "platform-config",
  "migration-lineage",
  "integrity",
  "synthetic",
]);
export const SCOPES = Object.freeze([
  "application-schema-data",
  "roles-memberships-grants-rls",
  "managed-auth-storage-schemas",
  "auth-data-access",
  "storage-metadata-objects",
  "vault-secret-recovery",
  "migration-lineage",
  "extensions-functions-triggers",
  "platform-configuration",
]);
export const CHECKS = Object.freeze([
  "schema-and-lineage",
  "counts-content-integrity-sequences",
  "roles-grants-rls",
  "auth-local-login-isolation",
  "storage-metadata-objects",
  "vault-recovery",
  "extensions-functions-triggers",
  "outbound-isolation",
]);

export class RecoveryError extends Error {
  constructor(code) {
    super(code);
    this.name = "RecoveryError";
    this.code = code;
  }
}
export function requireCondition(condition, code) {
  if (!condition) throw new RecoveryError(code);
}
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const timestamp = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
function closed(value, fields) {
  requireCondition(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === Object.keys(fields).length &&
      Object.entries(fields).every(
        ([key, accepts]) => Object.hasOwn(value, key) && accepts(value[key]),
      ),
    "INVALID_METADATA",
  );
}
function clock(now) {
  requireCondition(timestamp(now), "INVALID_CLOCK");
  return Date.parse(now);
}
function fresh(value, now, maximumMs) {
  requireCondition(timestamp(value), "INVALID_TIME");
  const age = now - Date.parse(value);
  requireCondition(age >= 0 && age <= maximumMs, "STALE_OR_FUTURE");
}
function source(value) {
  closed(value, {
    ...Object.fromEntries(Object.entries(STAGING).map(([k, v]) => [k, (x) => x === v])),
    schemaDigest: hash,
    lineageDigest: hash,
  });
}
function proofs(value, required) {
  requireCondition(Array.isArray(value) && value.length === required.length, "INCOMPLETE_SCOPE");
  const seen = new Set();
  for (const item of value) {
    closed(item, {
      name: (v) => required.includes(v),
      status: (v) => v === "PASS",
      evidenceDigest: hash,
    });
    requireCondition(!seen.has(item.name), "DUPLICATE_SCOPE");
    seen.add(item.name);
  }
}
function artifacts(value) {
  requireCondition(
    Array.isArray(value) && value.length >= 1 && value.length <= 32,
    "INVALID_ARTIFACTS",
  );
  const seen = new Set();
  for (const item of value) {
    closed(item, {
      name: (v) => ARTIFACT_NAMES.includes(v),
      sha256: hash,
      bytes: (v) => integer(v) && v > 0,
    });
    requireCondition(!seen.has(item.name), "DUPLICATE_ARTIFACT");
    seen.add(item.name);
  }
}

// Pure boundary only. The coordinator obtains the role after explicit approval.
// Never serialize, log or include the returned environment in evidence.
export function stagingExportEnvironment({
  response,
  requestedAt,
  receivedAt,
  now,
  sourceObserved,
}) {
  closed(response, {
    role: (v) => typeof v === "string" && /^cli_login_[a-zA-Z0-9_]{1,80}$/.test(v),
    password: (v) =>
      typeof v === "string" && v.length >= 16 && v.length <= 1024 && !/[\0\r\n]/.test(v),
    ttl_seconds: (v) => integer(v) && v > 0 && v <= 900,
  });
  const time = clock(now);
  closed(sourceObserved, {
    capturedAt: timestamp,
    source: (v) => {
      source(v);
      return true;
    },
  });
  fresh(sourceObserved.capturedAt, time, 300_000);
  fresh(requestedAt, time, 900_000);
  fresh(receivedAt, time, 900_000);
  requireCondition(Date.parse(receivedAt) >= Date.parse(requestedAt), "INVALID_TIME");
  // Use request start, not response receipt, to avoid overstating expiry.
  const expiresAt = Date.parse(requestedAt) + response.ttl_seconds * 1000;
  requireCondition(time < expiresAt, "CREDENTIAL_EXPIRED");
  return {
    expiresAt: new Date(expiresAt).toISOString(),
    environment: {
      PGHOST: STAGING.host,
      PGPORT: String(STAGING.port),
      PGDATABASE: STAGING.database,
      PGUSER: `${response.role}.${STAGING.ref}`,
      PGPASSWORD: response.password,
      PGSSLMODE: "verify-full",
      PGSSLROOTCERT: SOURCE_CA.path,
      PGCONNECT_TIMEOUT: "10",
      PGAPPNAME: "minted-staging-recovery-export",
      PGOPTIONS:
        "-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=5000",
    },
  };
}

// Normalized observations must come from fresh Docker inspect output, not a backup manifest.
// This baseline supports one DB container. Auth/REST peers need a separately reviewed collector.
export function validateLocalTarget({ target, expectedRunId, expectedSocket, now }) {
  const time = clock(now);
  requireCondition(
    typeof expectedRunId === "string" && /^[a-f0-9]{16}$/.test(expectedRunId),
    "INVALID_RUN",
  );
  requireCondition(
    typeof expectedSocket === "string" &&
      /^unix:\/\/.+\/\.colima\/minted-staging-recovery\/docker\.sock$/.test(expectedSocket),
    "INVALID_SOCKET",
  );
  closed(target, {
    observedAt: timestamp,
    runId: (v) => v === expectedRunId,
    context: (v) => v === `colima-${PROFILE}`,
    engineEndpoint: (v) => v === expectedSocket,
    name: (v) => v === `${PROFILE}-${expectedRunId}`,
    ownerLabel: (v) => v === PROFILE,
    runLabel: (v) => v === expectedRunId,
    containerId: hash,
    image: (v) => v === POSTGRES_IMAGE,
    imageArchitecture: (v) => v === "arm64",
    serverVersion: (v) => v === STAGING.serverVersion,
    database: (v) => v === "postgres",
    transport: (v) => v === "docker-exec-stdin",
    publishedPortCount: (v) => v === 0,
    configuredPortBindingCount: (v) => v === 0,
    networkName: (v) => v === `${PROFILE}-${expectedRunId}`,
    networkId: hash,
    networkInternal: (v) => v === true,
    networkOwnerLabel: (v) => v === PROFILE,
    networkRunLabel: (v) => v === expectedRunId,
    networkContainerIds: (v) => Array.isArray(v) && v.length === 1 && v[0] === target.containerId,
    networkCount: (v) => v === 1,
    hostBindCount: (v) => v === 0,
    volumeCount: (v) => v === 1,
    addedCapabilityCount: (v) => v === 0,
    deviceCount: (v) => v === 0,
    privileged: (v) => v === false,
    hostNamespaces: (v) => v === false,
    volumeName: (v) => v === `${PROFILE}-${expectedRunId}`,
    volumeOwnerLabel: (v) => v === PROFILE,
    volumeRunLabel: (v) => v === expectedRunId,
  });
  fresh(target.observedAt, time, 300_000);
  // Observation time is not identity: fresh reinspection must bind the same target.
  const { observedAt, ...identity } = target;
  void observedAt;
  return canonicalDigest(identity);
}

export function validateBackup({ backup, observed, now }) {
  const time = clock(now);
  closed(backup, {
    version: (v) => v === 1,
    source: (v) => {
      source(v);
      return true;
    },
    startedAt: timestamp,
    finishedAt: timestamp,
    schemaBefore: hash,
    schemaAfter: hash,
    artifacts: (v) => {
      artifacts(v);
      return true;
    },
    scopes: (v) => {
      proofs(v, SCOPES);
      return true;
    },
    exporterSucceeded: (v) => v === true,
    snapshotMethod: (v) => v === "single-data-snapshot-catalog-bracketed",
  });
  closed(observed, {
    capturedAt: timestamp,
    source: (v) => {
      source(v);
      return true;
    },
    artifacts: (v) => {
      artifacts(v);
      return true;
    },
    decryptionVerified: (v) => v === true,
  });
  fresh(observed.capturedAt, time, 300_000);
  fresh(backup.startedAt, time, 86_400_000);
  fresh(backup.finishedAt, time, 86_400_000);
  requireCondition(Date.parse(backup.finishedAt) >= Date.parse(backup.startedAt), "INVALID_TIME");
  requireCondition(
    Date.parse(observed.capturedAt) >= Date.parse(backup.finishedAt),
    "INVALID_TIME",
  );
  requireCondition(
    backup.schemaBefore === backup.source.schemaDigest &&
      backup.schemaAfter === backup.schemaBefore &&
      canonicalDigest(observed.source) === canonicalDigest(backup.source),
    "SOURCE_DRIFT",
  );
  requireCondition(
    canonicalDigest(observed.artifacts) === canonicalDigest(backup.artifacts),
    "ARTIFACT_MISMATCH",
  );
  return canonicalDigest(backup);
}

export function validateRehearsal({
  backup,
  observed,
  restore,
  target,
  expectedRunId,
  expectedSocket,
  now,
}) {
  const time = clock(now);
  const backupDigest = validateBackup({ backup, observed, now });
  const targetDigest = validateLocalTarget({ target, expectedRunId, expectedSocket, now });
  closed(restore, {
    version: (v) => v === 1,
    ref: (v) => v === STAGING.ref,
    backupDigest: hash,
    targetDigest: hash,
    detectedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    status: (v) => v === "PASS",
    checks: (v) => {
      proofs(v, CHECKS);
      return true;
    },
    scopes: (v) => {
      proofs(v, SCOPES);
      return true;
    },
  });
  for (const item of [restore.detectedAt, restore.startedAt, restore.finishedAt])
    fresh(item, time, 86_400_000);
  requireCondition(
    Date.parse(restore.detectedAt) >= Date.parse(backup.finishedAt) &&
      Date.parse(restore.startedAt) >= Date.parse(restore.detectedAt) &&
      Date.parse(restore.finishedAt) >= Date.parse(restore.startedAt) &&
      Date.parse(target.observedAt) >= Date.parse(restore.finishedAt),
    "INVALID_TIME",
  );
  requireCondition(
    Date.parse(restore.finishedAt) - Date.parse(restore.detectedAt) <= 14_400_000,
    "RESTORE_TOO_SLOW",
  );
  requireCondition(
    restore.backupDigest === backupDigest && restore.targetDigest === targetDigest,
    "PROOF_MISMATCH",
  );
  return { digest: canonicalDigest({ backup, restore }), backupDigest, targetDigest };
}
