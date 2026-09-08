// SIMULATOR ONLY. No hosted qualification, baseline enrollment or backup is represented.
import { canonicalDigest } from "../release/contract.mjs";
import { fixture, hash, NOW, rebind } from "../release/test-fixtures.mjs";
import { STAGING_ALIASES, WORKFLOWS } from "./boundary.mjs";

export const QUALIFIED_NOW = "2026-09-08T18:01:00.000Z";

export function qualificationFixture(additive = true) {
  const f = fixture("staging", additive);
  f.record.context.workflow.path = WORKFLOWS.staging;
  f.policy.workflow.path = WORKFLOWS.staging;
  rebind(f);
  const context = f.record.context;
  const candidate = {
    deploymentId: "dpl_synthetic_qualified",
    sourceSha: context.source.sha,
    target: structuredClone(context.target),
    configurationDigest: context.targetConfigurationDigest,
    releaseDigest: canonicalDigest(f.record),
    readyState: "READY",
    domainsWithheld: true,
  };
  const observed = structuredClone(f.observed);
  observed.observedAt = "2026-09-08T18:00:29.000Z";
  Object.assign(observed.baseline, {
    deploymentId: candidate.deploymentId,
    appSha: context.source.sha,
    configurationDigest: context.targetConfigurationDigest,
    schemaDigest: context.migrationPlan.resultSchemaDigest,
    migrations: structuredClone(context.migrationPlan.inventory),
  });
  Object.assign(observed.staging, {
    sourceSha: context.source.sha,
    workflowSha: context.workflow.sha,
    runId: context.workflow.runId,
    runAttempt: context.workflow.runAttempt,
    deploymentId: candidate.deploymentId,
    configurationDigest: context.targetConfigurationDigest,
    schemaDigest: context.migrationPlan.resultSchemaDigest,
    migrationPlanDigest: canonicalDigest(context.migrationPlan),
    verifiedAt: "2026-09-08T18:00:20.000Z",
  });
  const snapshot = {
    observed,
    aliases: Object.fromEntries(STAGING_ALIASES.map((alias) => [alias, candidate.deploymentId])),
  };
  const receipt = {
    status: "PASS",
    bindingDigest: canonicalDigest({
      releaseDigest: candidate.releaseDigest,
      phase: "served-postconditions",
      candidate,
      snapshot,
    }),
    artifactDigest: hash("synthetic served checks"),
    finishedAt: "2026-09-08T18:00:30.000Z",
  };
  return {
    version: 1,
    phase: "staging-qualification",
    preflight: { record: f.record, policy: f.policy, observed: f.observed, validatedAt: NOW },
    result: { status: "DELIVERED", recordedAt: receipt.finishedAt, candidate, snapshot, receipt },
  };
}

export function baselineAttestationFixture() {
  const f = fixture("production");
  return {
    version: 1,
    phase: "production-baseline-attestation",
    workflow: { path: WORKFLOWS.production, sha: "c".repeat(40), runId: "42", runAttempt: 1 },
    recordedAt: "2026-09-08T17:59:00.000Z",
    target: f.record.context.target,
    baseline: f.record.context.baseline,
    targetConfigurationDigest: f.record.context.targetConfigurationDigest,
    supportedExtensionVersions: f.record.context.supportedExtensionVersions,
  };
}
