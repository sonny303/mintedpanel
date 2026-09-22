import { canonicalDigest, validateRelease } from "../release/contract.mjs";
import {
  assertProductionBaselineAttestation,
  assertStagingQualification,
} from "./qualification.mjs";
import { requireCondition, requireId, requireSha } from "./boundary.mjs";

const same = (a, b) => canonicalDigest(a) === canonicalDigest(b);
const copy = (value) => structuredClone(value);

function exact(value, keys) {
  requireCondition(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
    "APPROVAL_INTENT_SHAPE",
  );
}

function instant(value) {
  requireCondition(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "APPROVAL_INTENT_TIME",
  );
  return Date.parse(value);
}

function evidence(value, field) {
  exact(value, [field, "artifactId", "artifactDigest"]);
  requireId(String(value.artifactId));
  requireCondition(
    Number.isSafeInteger(value.artifactId) &&
      value.artifactId > 0 &&
      /^sha256:[a-f0-9]{64}$/.test(value.artifactDigest),
    "APPROVAL_EVIDENCE_PIN",
  );
}

function requirements(qualification, attestation) {
  const policy = qualification.preflight.policy;
  return {
    requiredChecks: copy(policy.requiredChecks),
    requiredRecoveryScopes: copy(policy.requiredRecoveryScopes),
    evidenceMaxAgeSeconds: policy.evidenceMaxAgeSeconds,
    snapshotMaxAgeSeconds: policy.snapshotMaxAgeSeconds,
    backup: {
      selection: "fresh-matching-after-approval",
      supabaseRef: attestation.target.supabaseRef,
      schemaDigest: attestation.baseline.schemaDigest,
      lineageDigest: canonicalDigest(attestation.baseline.migrations),
      maxAgeSeconds: 86400,
      maxRestoreSeconds: 14400,
    },
    rollback: { mode: "compatible-app-only", maxSeconds: 300 },
  };
}

/** Pure metadata validation, not authentication. GitHub must authenticate both producers. */
export function assertApprovalIntent(request, { now }) {
  exact(request, [
    "version",
    "phase",
    "runId",
    "runAttempt",
    "workflowSha",
    "preparedAt",
    "staging",
    "expectedProduction",
    "requirements",
  ]);
  requireCondition(
    request.version === 1 && request.phase === "production-approval-intent",
    "APPROVAL_INTENT_PHASE",
  );
  requireId(request.runId);
  requireSha(request.workflowSha);
  requireCondition(request.runAttempt === 1, "FRESH_APPROVAL_RUN_REQUIRED");
  const current = instant(now);
  const prepared = instant(request.preparedAt);
  requireCondition(prepared <= current, "APPROVAL_INTENT_TIME");
  evidence(request.staging, "qualification");
  evidence(request.expectedProduction, "attestation");
  const stage = assertStagingQualification(request.staging.qualification, { now });
  const historical = request.expectedProduction.attestation;
  assertProductionBaselineAttestation(historical, { now });
  requireCondition(
    instant(stage.recordedAt) <= prepared &&
      instant(historical.recordedAt) <= prepared &&
      historical.workflow.runId !== request.runId,
    "APPROVAL_EVIDENCE_ORDER",
  );
  const initialStage = request.staging.qualification.preflight.record.context.baseline;
  requireCondition(
    stage.migrationPlan.baselineSchemaDigest === historical.baseline.schemaDigest &&
      same(initialStage.migrations, historical.baseline.migrations) &&
      same(stage.supportedExtensionVersions, historical.supportedExtensionVersions),
    "EXPECTED_PRODUCTION_MISMATCH",
  );
  requireCondition(
    same(request.requirements, requirements(request.staging.qualification, historical)),
    "APPROVAL_REQUIREMENTS_MISMATCH",
  );
  requireCondition(
    current - prepared <= request.requirements.evidenceMaxAgeSeconds * 1000,
    "APPROVAL_INTENT_STALE",
  );
  return { intentDigest: canonicalDigest(request), stage, historical: copy(historical) };
}

/** Inputs are authenticated loader results, never operator PASS JSON. */
export function createApprovalIntent({ staging, baseline, runId, runAttempt, workflowSha, now }) {
  const request = {
    version: 1,
    phase: "production-approval-intent",
    runId,
    runAttempt,
    workflowSha,
    preparedAt: now,
    staging: {
      qualification: copy(staging.qualification),
      artifactId: staging.artifactId,
      artifactDigest: staging.artifactDigest,
    },
    expectedProduction: {
      attestation: copy(baseline.attestation),
      artifactId: baseline.artifactId,
      artifactDigest: baseline.artifactDigest,
    },
    requirements: requirements(staging.qualification, baseline.attestation),
  };
  assertApprovalIntent(request, { now });
  return request;
}

/** Select once after approval; G0 binds that exact backup and its restore evidence into execution. */
export function bindProductionEligibility({ request, bundle, selectionStartedAt, now }) {
  const { intentDigest, stage, historical } = assertApprovalIntent(request, { now });
  const started = instant(selectionStartedAt);
  const current = instant(now);
  requireCondition(
    instant(request.preparedAt) <= started && started <= current,
    "PRODUCTION_COLLECTION_ORDER",
  );
  exact(bundle, ["record", "policy", "observed"]);
  const { record, policy, observed } = bundle;
  const result = validateRelease({ record, policy, observed, expectedTarget: "production", now });
  requireCondition(result.ok, "RELEASE_CONTRACT_REJECTED");
  const context = record.context;
  requireCondition(
    same(context.target, historical.target) &&
      same(context.source, stage.source) &&
      same(context.workflow, stage.workflow) &&
      same(context.staging, stage.staging) &&
      same(context.baseline, historical.baseline) &&
      same(context.migrationPlan, stage.migrationPlan) &&
      context.targetConfigurationDigest === historical.targetConfigurationDigest &&
      same(context.supportedExtensionVersions, historical.supportedExtensionVersions),
    "APPROVED_IDENTITY_DRIFT",
  );
  const expectedPolicy = {
    version: 1,
    source: stage.source,
    workflow: stage.workflow,
    migrationPlanDigest: canonicalDigest(stage.migrationPlan),
    requiredChecks: request.requirements.requiredChecks,
    supportedExtensionVersions: stage.supportedExtensionVersions,
    requiredRecoveryScopes: request.requirements.requiredRecoveryScopes,
    evidenceMaxAgeSeconds: request.requirements.evidenceMaxAgeSeconds,
    snapshotMaxAgeSeconds: request.requirements.snapshotMaxAgeSeconds,
  };
  requireCondition(same(policy, expectedPolicy), "APPROVED_POLICY_DRIFT");
  requireCondition(
    instant(record.createdAt) >= started &&
      instant(observed.observedAt) >= started &&
      instant(record.backup.verifiedAt) >= started,
    "PRODUCTION_COLLECTION_ORDER",
  );
  // All backup identity, availability, age, lineage, restore scope and duration
  // checks remain mandatory G0 checks. No exact production backup was approved in advance.
  return {
    ...copy(bundle),
    releaseDigest: result.digest,
    intentDigest,
    selectionStartedAt,
    selectedBackupDigest: canonicalDigest(record.backup),
  };
}
