// SIMULATOR ONLY. No actual approval, production backup, restore or eligibility.
import { canonicalDigest } from "../release/contract.mjs";
import { fixture, hash, rebind } from "../release/test-fixtures.mjs";
import {
  baselineAttestationFixture,
  qualificationFixture,
  QUALIFIED_NOW,
} from "./qualification-fixtures.mjs";
import { createApprovalIntent } from "./intent.mjs";

export const SELECTED_AT = "2026-09-08T18:01:01.000Z";
export const EXECUTION_NOW = "2026-09-08T18:01:02.000Z";

export function intentInputs(additive = true) {
  const attestation = baselineAttestationFixture();
  attestation.workflow.runId = "41";
  return {
    staging: {
      qualification: qualificationFixture(additive),
      artifactId: 7,
      artifactDigest: `sha256:${hash("synthetic stage archive")}`,
    },
    baseline: {
      attestation,
      artifactId: 8,
      artifactDigest: `sha256:${hash("synthetic historical archive")}`,
    },
    runId: "42",
    runAttempt: 1,
    workflowSha: "c".repeat(40),
    now: QUALIFIED_NOW,
  };
}

export const intentFixture = (additive = true) => createApprovalIntent(intentInputs(additive));

export function eligibilityFixture(request = intentFixture()) {
  const stage = request.staging.qualification;
  const historical = request.expectedProduction.attestation;
  const f = fixture("production", stage.preflight.record.context.migrationPlan.mode === "additive");
  Object.assign(f.record.context, {
    source: structuredClone(stage.preflight.record.context.source),
    workflow: structuredClone(stage.preflight.record.context.workflow),
    staging: structuredClone(stage.result.snapshot.observed.staging),
    baseline: structuredClone(historical.baseline),
    migrationPlan: structuredClone(stage.preflight.record.context.migrationPlan),
    targetConfigurationDigest: historical.targetConfigurationDigest,
  });
  f.record.createdAt = SELECTED_AT;
  f.record.backup.verifiedAt = SELECTED_AT;
  f.record.backup.artifactDigest = hash("synthetic newly selected production backup");
  f.record.backup.restore.backupArtifactDigest = f.record.backup.artifactDigest;
  for (const proof of [
    ...f.record.checks,
    f.record.rehearsal,
    f.record.compatibility.candidate,
    f.record.compatibility.previous,
    f.record.backup.restore,
    f.record.rollback,
  ])
    proof.finishedAt = SELECTED_AT;
  // Keep the app rollback evidence inside its fixed five-minute duration bound.
  f.record.rollback.detectedAt = "2026-09-08T17:58:00.000Z";
  f.record.rollback.startedAt = "2026-09-08T17:59:00.000Z";
  f.policy = structuredClone(stage.preflight.policy);
  f.policy.migrationPlanDigest = canonicalDigest(f.record.context.migrationPlan);
  Object.assign(f.observed, {
    observedAt: SELECTED_AT,
    baseline: structuredClone(f.record.context.baseline),
    staging: structuredClone(f.record.context.staging),
  });
  const { restore: _restore, ...backup } = f.record.backup;
  f.observed.backup = structuredClone(backup);
  rebind(f);
  return { record: f.record, policy: f.policy, observed: f.observed };
}
