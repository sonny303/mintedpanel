import { createHash } from "node:crypto";

const targets = {
  staging: {
    environment: "staging",
    vercelTeamId: "team_230fpJ9MgCj9ssW3LiIckfyA",
    vercelProjectId: "prj_1t7NkRJMkjTuFXEBEP4GjfN4B6Ch",
    supabaseRef: "vmznysvietfaddakkegt",
    vercelEnvironment: "preview",
    gitBranch: "staging",
  },
  production: {
    environment: "production",
    vercelTeamId: "team_230fpJ9MgCj9ssW3LiIckfyA",
    vercelProjectId: "prj_ILhPJbkyaiptdVA8DtsmNyw3tiub",
    supabaseRef: "fkvuhfsqcmujywzgczmc",
    vercelEnvironment: "production",
    gitBranch: "main",
  },
};

/** Return a copy so delivery collectors share the fixed allowlist without mutating it. */
export function releaseTarget(environment) {
  if (environment !== "staging" && environment !== "production")
    throw new TypeError("EXPLICIT_TARGET_REQUIRED");
  return structuredClone(targets[environment]);
}

const match = (pattern) => (value) => typeof value === "string" && pattern.test(value);
const oneOf =
  (...values) =>
  (value) =>
    values.includes(value);
const integer = (min, max) => (value) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const array = (item, min = 0) => ({ array: item, min });
const sha = match(/^[a-f0-9]{40}$/);
const digest = match(/^[a-f0-9]{64}$/);
const name = match(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/);
const ref = match(/^[a-z]{20}$/);
const version = match(/^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[a-zA-Z0-9.-]{1,40})?$/);
const timestamp = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const boolean = (value) => typeof value === "boolean";
const deployment = match(/^dpl_[a-zA-Z0-9_]{1,100}$/);
const targetShape = {
  environment: oneOf("staging", "production"),
  vercelTeamId: name,
  vercelProjectId: name,
  supabaseRef: ref,
  vercelEnvironment: oneOf("preview", "production"),
  gitBranch: name,
};
const sourceShape = { repository: oneOf("sonny303/mintedpanel"), sha };
const workflowShape = {
  path: match(/^\.github\/workflows\/[a-zA-Z0-9_-]{1,80}\.ya?ml$/),
  sha,
  runId: match(/^[1-9][0-9]{0,19}$/),
  runAttempt: integer(1, 10000),
};
const migrationShape = {
  id: match(/^[0-9]{14}$/),
  path: match(/^supabase\/migrations\/[0-9]{14}_[a-zA-Z0-9_-]{1,150}\.sql$/),
  sha256: digest,
};
const baselineShape = {
  deploymentId: deployment,
  appSha: sha,
  configurationDigest: digest,
  schemaDigest: digest,
  migrations: array(migrationShape),
};
const planShape = {
  mode: oneOf("none", "additive"),
  baselineSchemaDigest: digest,
  resultSchemaDigest: digest,
  inventory: array(migrationShape),
};
const stagingShape = {
  sourceSha: sha,
  workflowSha: sha,
  runId: workflowShape.runId,
  runAttempt: workflowShape.runAttempt,
  deploymentId: deployment,
  configurationDigest: digest,
  schemaDigest: digest,
  migrationPlanDigest: digest,
  verifiedAt: timestamp,
  supabaseRef: ref,
  gitBranch: name,
  vercelEnvironment: oneOf("preview", "production"),
};
const proofShape = {
  status: oneOf("PASS", "FAIL", "SKIP", "BLOCKED", "UNVERIFIED"),
  finishedAt: timestamp,
  contextDigest: digest,
  artifactDigest: digest,
};
const backupShape = {
  provider: oneOf("supabase"),
  supabaseRef: ref,
  schemaDigest: digest,
  lineageDigest: digest,
  createdAt: timestamp,
  verifiedAt: timestamp,
  available: boolean,
  artifactDigest: digest,
};
const recoveryShape = { ...proofShape, detectedAt: timestamp, startedAt: timestamp };
const contextShape = {
  phase: oneOf("staging-preflight", "production-eligibility"),
  target: targetShape,
  source: sourceShape,
  workflow: workflowShape,
  staging: stagingShape,
  baseline: baselineShape,
  migrationPlan: planShape,
  targetConfigurationDigest: digest,
  supportedExtensionVersions: array(version, 1),
};
const recordShape = {
  version: oneOf(1),
  createdAt: timestamp,
  context: contextShape,
  checks: array({ name, ...proofShape }, 1),
  rehearsal: proofShape,
  compatibility: { candidate: proofShape, previous: proofShape },
  backup: {
    ...backupShape,
    restore: { ...recoveryShape, backupArtifactDigest: digest, scopes: array(name, 1) },
  },
  rollback: { ...recoveryShape, mode: oneOf("compatible-app-only") },
};
const policyShape = {
  version: oneOf(1),
  source: sourceShape,
  workflow: workflowShape,
  migrationPlanDigest: digest,
  requiredChecks: array(name, 1),
  supportedExtensionVersions: array(version, 1),
  requiredRecoveryScopes: array(name, 1),
  evidenceMaxAgeSeconds: integer(1, 86400),
  snapshotMaxAgeSeconds: integer(1, 300),
};
const observedShape = {
  version: oneOf(1),
  observedAt: timestamp,
  target: targetShape,
  baseline: baselineShape,
  staging: stagingShape,
  targetConfigurationDigest: digest,
  supportedExtensionVersions: array(version, 1),
  backup: backupShape,
};

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

// The schema owns every emitted path. Unknown input keys/values are never echoed.
function shapeErrors(value, shape, path, errors) {
  const fail = () => {
    if (errors.length < 32) errors.push({ code: "SCHEMA", path });
  };
  if (typeof shape === "function") {
    if (!shape(value)) fail();
  } else if ("array" in shape) {
    if (!Array.isArray(value) || value.length < shape.min || value.length > 1024) return fail();
    for (let index = 0; index < value.length; index++)
      shapeErrors(value[index], shape.array, `${path}[${index}]`, errors);
  } else {
    if (!isObject(value)) return fail();
    if (Object.keys(value).some((key) => !Object.hasOwn(shape, key))) fail();
    for (const key of Object.keys(shape))
      shapeErrors(value[key], shape[key], `${path}.${key}`, errors);
  }
}

function canonical(value, depth = 0) {
  if (depth > 32) throw new TypeError("INVALID_JSON_VALUE");
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${Array.from(value, (item) => canonical(item, depth + 1)).join(",")}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`)
      .join(",")}}`;
  throw new TypeError("INVALID_JSON_VALUE");
}

/** SHA-256 of UTF-8 canonical JSON: sorted object keys, preserved array order. */
export function canonicalDigest(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

const same = (left, right) => canonical(left) === canonical(right);
const unique = (values) => new Set(values).size === values.length;
const sameSet = (left, right) =>
  unique(left) && unique(right) && same([...left].sort(), [...right].sort());

/**
 * Validate local data only. Policy and observations MUST be supplied by trusted
 * runners, never copied from the release record. A PASS is not authorization,
 * signature verification, a live observation, or proof that evidence was run.
 * All times are explicit UTC; the caller supplies the current trusted clock.
 */
export function validateRelease({
  record,
  policy,
  observed,
  expectedTarget,
  now,
  expectedDigest,
} = {}) {
  const errors = [];
  const check = (condition, code, path) => {
    if (!condition && errors.length < 32) errors.push({ code, path });
  };
  check(
    expectedTarget === "staging" || expectedTarget === "production",
    "EXPECTED_TARGET",
    "expectedTarget",
  );
  check(timestamp(now), "CLOCK", "now");
  check(
    expectedDigest === undefined || digest(expectedDigest),
    "EXPECTED_DIGEST",
    "expectedDigest",
  );
  shapeErrors(record, recordShape, "record", errors);
  shapeErrors(policy, policyShape, "policy", errors);
  shapeErrors(observed, observedShape, "observed", errors);
  if (errors.length) return { ok: false, errors };

  const current = Date.parse(now);
  const age = (time, maxSeconds) =>
    current - Date.parse(time) >= 0 && current - Date.parse(time) <= maxSeconds * 1000;
  const fresh = (time) => age(time, policy.evidenceMaxAgeSeconds);
  const context = record.context;
  const { source, workflow, baseline, staging, migrationPlan: plan } = context;
  const contextDigest = canonicalDigest(context);
  const planDigest = canonicalDigest(plan);
  check(
    context.phase ===
      (expectedTarget === "staging" ? "staging-preflight" : "production-eligibility"),
    "PHASE_MISMATCH",
    "record.context.phase",
  );
  check(same(context.target, targets[expectedTarget]), "TARGET_MISMATCH", "record.context.target");
  check(same(observed.target, targets[expectedTarget]), "TARGET_MISMATCH", "observed.target");
  check(same(source, policy.source), "SOURCE_MISMATCH", "record.context.source");
  check(same(workflow, policy.workflow), "WORKFLOW_MISMATCH", "record.context.workflow");
  check(fresh(record.createdAt), "RECORD_AGE", "record.createdAt");
  check(
    age(observed.observedAt, policy.snapshotMaxAgeSeconds),
    "SNAPSHOT_AGE",
    "observed.observedAt",
  );
  check(same(baseline, observed.baseline), "BASELINE_DRIFT", "record.context.baseline");
  check(
    context.targetConfigurationDigest === observed.targetConfigurationDigest,
    "CONFIGURATION_DRIFT",
    "record.context.targetConfigurationDigest",
  );
  check(same(staging, observed.staging), "STAGING_DRIFT", "record.context.staging");
  check(
    staging.supabaseRef === targets.staging.supabaseRef &&
      staging.gitBranch === "staging" &&
      staging.vercelEnvironment === "preview",
    "STAGING_PROVENANCE",
    "record.context.staging",
  );
  if (expectedTarget === "staging") {
    check(
      staging.sourceSha === baseline.appSha &&
        staging.deploymentId === baseline.deploymentId &&
        staging.schemaDigest === baseline.schemaDigest &&
        staging.configurationDigest === baseline.configurationDigest,
      "STAGING_BASELINE",
      "record.context.staging",
    );
  } else {
    check(
      staging.sourceSha === source.sha &&
        staging.workflowSha === workflow.sha &&
        staging.runId === workflow.runId &&
        staging.runAttempt === workflow.runAttempt &&
        staging.migrationPlanDigest === planDigest &&
        staging.schemaDigest === plan.resultSchemaDigest,
      "STAGING_PROVENANCE",
      "record.context.staging",
    );
  }
  check(
    fresh(staging.verifiedAt) && staging.verifiedAt <= record.createdAt,
    "EVIDENCE_AGE",
    "record.context.staging.verifiedAt",
  );
  check(
    sameSet(context.supportedExtensionVersions, policy.supportedExtensionVersions) &&
      sameSet(context.supportedExtensionVersions, observed.supportedExtensionVersions),
    "EXTENSION_SET",
    "record.context.supportedExtensionVersions",
  );
  check(planDigest === policy.migrationPlanDigest, "PLAN_MISMATCH", "record.context.migrationPlan");
  check(
    plan.baselineSchemaDigest === baseline.schemaDigest,
    "MIGRATION_BASELINE",
    "record.context.migrationPlan.baselineSchemaDigest",
  );

  for (const [inventory, path] of [
    [baseline.migrations, "record.context.baseline.migrations"],
    [plan.inventory, "record.context.migrationPlan.inventory"],
  ]) {
    check(
      unique(inventory.map((item) => item.id)) && unique(inventory.map((item) => item.path)),
      "MIGRATION_DUPLICATE",
      path,
    );
    check(
      inventory.every(
        (item, index) =>
          item.path.startsWith(`supabase/migrations/${item.id}_`) &&
          (index === 0 || inventory[index - 1].id < item.id),
      ),
      "MIGRATION_ORDER",
      path,
    );
  }
  check(
    plan.inventory.length >= baseline.migrations.length &&
      baseline.migrations.every((item, index) => same(item, plan.inventory[index])),
    "MIGRATION_HISTORY",
    "record.context.migrationPlan.inventory",
  );
  const unchanged =
    plan.inventory.length === baseline.migrations.length &&
    plan.resultSchemaDigest === baseline.schemaDigest;
  check(
    plan.mode === "none"
      ? unchanged
      : plan.inventory.length > baseline.migrations.length &&
          plan.resultSchemaDigest !== baseline.schemaDigest,
    "MIGRATION_MODE",
    "record.context.migrationPlan.mode",
  );

  const proof = (evidence, path) => {
    check(evidence.status === "PASS", "EVIDENCE_NOT_PASS", `${path}.status`);
    check(
      fresh(evidence.finishedAt) && evidence.finishedAt <= record.createdAt,
      "EVIDENCE_AGE",
      `${path}.finishedAt`,
    );
    check(evidence.contextDigest === contextDigest, "EVIDENCE_BINDING", `${path}.contextDigest`);
  };
  check(
    sameSet(
      record.checks.map((item) => item.name),
      policy.requiredChecks,
    ),
    "CHECK_SET",
    "record.checks",
  );
  record.checks.forEach((item, index) => proof(item, `record.checks[${index}]`));
  proof(record.rehearsal, "record.rehearsal");
  proof(record.compatibility.candidate, "record.compatibility.candidate");
  proof(record.compatibility.previous, "record.compatibility.previous");
  proof(record.backup.restore, "record.backup.restore");
  proof(record.rollback, "record.rollback");

  const { restore, ...backup } = record.backup;
  check(same(backup, observed.backup), "BACKUP_DRIFT", "record.backup");
  check(
    backup.supabaseRef === targets[expectedTarget].supabaseRef,
    "BACKUP_TARGET",
    "record.backup.supabaseRef",
  );
  check(
    backup.schemaDigest === baseline.schemaDigest &&
      backup.lineageDigest === canonicalDigest(baseline.migrations),
    "BACKUP_BASELINE",
    "record.backup",
  );
  check(backup.available, "BACKUP_UNAVAILABLE", "record.backup.available");
  check(
    restore.backupArtifactDigest === backup.artifactDigest,
    "RESTORE_BACKUP",
    "record.backup.restore.backupArtifactDigest",
  );
  check(age(backup.createdAt, 86400), "BACKUP_AGE", "record.backup.createdAt");
  check(
    fresh(backup.verifiedAt) &&
      backup.createdAt <= backup.verifiedAt &&
      backup.verifiedAt <= observed.observedAt,
    "EVIDENCE_AGE",
    "record.backup.verifiedAt",
  );
  check(
    sameSet(restore.scopes, policy.requiredRecoveryScopes),
    "RESTORE_SCOPE",
    "record.backup.restore.scopes",
  );
  const duration = (evidence, maxSeconds) =>
    evidence.detectedAt <= evidence.startedAt &&
    evidence.startedAt <= evidence.finishedAt &&
    Date.parse(evidence.finishedAt) - Date.parse(evidence.detectedAt) <= maxSeconds * 1000;
  check(
    duration(restore, 14400) && backup.createdAt <= restore.startedAt,
    "RESTORE_DURATION",
    "record.backup.restore",
  );
  check(duration(record.rollback, 300), "ROLLBACK_DURATION", "record.rollback");
  const releaseDigest = canonicalDigest(record);
  check(
    expectedDigest === undefined || expectedDigest === releaseDigest,
    "DIGEST_MISMATCH",
    "record",
  );
  return errors.length ? { ok: false, errors } : { ok: true, digest: releaseDigest };
}
