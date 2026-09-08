import { canonicalDigest, releaseTarget, validateRelease } from "../release/contract.mjs";
import {
  STAGING_ALIASES,
  WORKFLOWS,
  requireCondition,
  requireId,
  requireSha,
} from "./boundary.mjs";

const same = (left, right) => canonicalDigest(left) === canonicalDigest(right);
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const deployment = (value) => typeof value === "string" && /^dpl_[a-zA-Z0-9_]{1,100}$/.test(value);

function exact(value, keys) {
  requireCondition(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
    "QUALIFICATION_SHAPE",
  );
}

function instant(value) {
  requireCondition(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "QUALIFICATION_TIME",
  );
  return Date.parse(value);
}

function producer(workflow, path) {
  exact(workflow, ["path", "sha", "runId", "runAttempt"]);
  requireSha(workflow.sha);
  requireId(workflow.runId);
  requireCondition(
    workflow.path === path &&
      Number.isSafeInteger(workflow.runAttempt) &&
      workflow.runAttempt >= 1 &&
      workflow.runAttempt <= 10000,
    "QUALIFICATION_PRODUCER",
  );
}

function versions(value) {
  requireCondition(
    Array.isArray(value) &&
      value.length > 0 &&
      value.length <= 1024 &&
      new Set(value).size === value.length &&
      value.every(
        (entry) =>
          typeof entry === "string" &&
          /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[a-zA-Z0-9.-]{1,40})?$/.test(entry),
      ),
    "QUALIFICATION_EXTENSIONS",
  );
}

function baseline(value) {
  exact(value, ["deploymentId", "appSha", "configurationDigest", "schemaDigest", "migrations"]);
  requireSha(value.appSha);
  requireCondition(
    deployment(value.deploymentId) &&
      digest(value.configurationDigest) &&
      digest(value.schemaDigest) &&
      Array.isArray(value.migrations) &&
      value.migrations.length <= 1024,
    "QUALIFICATION_BASELINE",
  );
  for (let i = 0; i < value.migrations.length; i++) {
    const migration = value.migrations[i];
    exact(migration, ["id", "path", "sha256"]);
    requireCondition(
      typeof migration.id === "string" &&
        /^[0-9]{14}$/.test(migration.id) &&
        typeof migration.path === "string" &&
        /^supabase\/migrations\/[0-9]{14}_[a-zA-Z0-9_-]{1,150}\.sql$/.test(migration.path) &&
        migration.path.startsWith(`supabase/migrations/${migration.id}_`) &&
        digest(migration.sha256) &&
        (i === 0 || value.migrations[i - 1].id < migration.id),
      "QUALIFICATION_BASELINE",
    );
  }
}

/**
 * Historical staging preflight plus a distinct delivered-result receipt. This
 * validates metadata only; the GitHub loader must authenticate its producer.
 * The historical validation clock is never used as a fresh current observation.
 */
export function assertStagingQualification(value, { now }) {
  exact(value, ["version", "phase", "preflight", "result"]);
  requireCondition(
    value.version === 1 && value.phase === "staging-qualification",
    "QUALIFICATION_PHASE",
  );
  exact(value.preflight, ["record", "policy", "observed", "validatedAt"]);
  const { record, policy, observed, validatedAt } = value.preflight;
  const validated = instant(validatedAt);
  const current = instant(now);
  const preflight = validateRelease({
    record,
    policy,
    observed,
    expectedTarget: "staging",
    now: validatedAt,
  });
  requireCondition(preflight.ok, "STAGING_PREFLIGHT_REJECTED");
  const context = record.context;
  producer(context.workflow, WORKFLOWS.staging);
  exact(value.result, ["status", "recordedAt", "candidate", "snapshot", "receipt"]);
  const { candidate, snapshot, receipt, recordedAt } = value.result;
  const finished = instant(recordedAt);
  requireCondition(
    value.result.status === "DELIVERED" &&
      validated <= finished &&
      finished <= current &&
      current - finished <= policy.evidenceMaxAgeSeconds * 1000 &&
      current - instant(record.createdAt) <= policy.evidenceMaxAgeSeconds * 1000,
    "STAGING_QUALIFICATION_AGE",
  );
  for (const time of [
    ...record.checks.map((check) => check.finishedAt),
    record.rehearsal.finishedAt,
    record.compatibility.candidate.finishedAt,
    record.compatibility.previous.finishedAt,
    record.backup.restore.finishedAt,
    record.rollback.finishedAt,
    record.backup.verifiedAt,
    context.staging.verifiedAt,
  ])
    requireCondition(
      current - instant(time) <= policy.evidenceMaxAgeSeconds * 1000,
      "STAGING_QUALIFICATION_AGE",
    );
  requireCondition(
    current - instant(record.backup.createdAt) <= 86400000,
    "STAGING_QUALIFICATION_AGE",
  );
  exact(candidate, [
    "deploymentId",
    "sourceSha",
    "target",
    "configurationDigest",
    "releaseDigest",
    "readyState",
    "domainsWithheld",
  ]);
  requireCondition(
    deployment(candidate.deploymentId) &&
      candidate.sourceSha === context.source.sha &&
      same(candidate.target, releaseTarget("staging")) &&
      candidate.configurationDigest === context.targetConfigurationDigest &&
      candidate.releaseDigest === preflight.digest &&
      candidate.readyState === "READY" &&
      candidate.domainsWithheld === true,
    "STAGING_CANDIDATE_BINDING",
  );
  exact(snapshot, ["observed", "aliases"]);
  const expected = structuredClone(observed);
  expected.observedAt = snapshot.observed?.observedAt;
  const snapshotTime = instant(expected.observedAt);
  Object.assign(expected.baseline, {
    deploymentId: candidate.deploymentId,
    appSha: context.source.sha,
    configurationDigest: context.targetConfigurationDigest,
    schemaDigest: context.migrationPlan.resultSchemaDigest,
    migrations: structuredClone(context.migrationPlan.inventory),
  });
  Object.assign(expected.staging, {
    sourceSha: context.source.sha,
    workflowSha: context.workflow.sha,
    runId: context.workflow.runId,
    runAttempt: context.workflow.runAttempt,
    deploymentId: candidate.deploymentId,
    configurationDigest: context.targetConfigurationDigest,
    schemaDigest: context.migrationPlan.resultSchemaDigest,
    migrationPlanDigest: canonicalDigest(context.migrationPlan),
    verifiedAt: snapshot.observed?.staging?.verifiedAt,
  });
  const verified = instant(expected.staging.verifiedAt);
  requireCondition(
    instant(record.createdAt) <= verified &&
      validated <= verified &&
      verified <= snapshotTime &&
      snapshotTime <= finished &&
      finished - snapshotTime <= policy.snapshotMaxAgeSeconds * 1000 &&
      same(snapshot.observed, expected) &&
      same(
        snapshot.aliases,
        Object.fromEntries(STAGING_ALIASES.map((alias) => [alias, candidate.deploymentId])),
      ),
    "STAGING_RESULT_BINDING",
  );
  exact(receipt, ["status", "bindingDigest", "artifactDigest", "finishedAt"]);
  const receiptTime = instant(receipt.finishedAt);
  requireCondition(
    receipt.status === "PASS" &&
      digest(receipt.artifactDigest) &&
      snapshotTime <= receiptTime &&
      receiptTime <= finished &&
      receipt.bindingDigest ===
        canonicalDigest({
          releaseDigest: preflight.digest,
          phase: "served-postconditions",
          candidate,
          snapshot,
        }),
    "STAGING_RESULT_RECEIPT",
  );
  return {
    qualificationDigest: canonicalDigest(value),
    source: structuredClone(context.source),
    workflow: structuredClone(context.workflow),
    recordedAt,
    staging: structuredClone(expected.staging),
    migrationPlan: structuredClone(context.migrationPlan),
    supportedExtensionVersions: [...context.supportedExtensionVersions],
  };
}

/** Previously recorded production expectations; no current freshness or backup eligibility claim. */
export function assertProductionBaselineAttestation(value, { now }) {
  exact(value, [
    "version",
    "phase",
    "workflow",
    "recordedAt",
    "target",
    "baseline",
    "targetConfigurationDigest",
    "supportedExtensionVersions",
  ]);
  requireCondition(
    value.version === 1 && value.phase === "production-baseline-attestation",
    "QUALIFICATION_PHASE",
  );
  producer(value.workflow, WORKFLOWS.production);
  requireCondition(value.workflow.runAttempt === 1, "FRESH_APPROVAL_RUN_REQUIRED");
  requireCondition(instant(value.recordedAt) <= instant(now), "QUALIFICATION_TIME");
  requireCondition(
    same(value.target, releaseTarget("production")) && digest(value.targetConfigurationDigest),
    "QUALIFICATION_TARGET",
  );
  baseline(value.baseline);
  versions(value.supportedExtensionVersions);
  return {
    attestationDigest: canonicalDigest(value),
    recordedAt: value.recordedAt,
    freshness: "HISTORICAL_ONLY",
    backupPolicy: "UNRESOLVED",
  };
}
