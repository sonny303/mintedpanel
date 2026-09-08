import { canonicalDigest } from "../release/contract.mjs";
import { requireCondition, requireId, requireSha } from "./boundary.mjs";

/** Caller obtains bundle through loadRelease; this never authenticates local JSON. */
export function approvalSummary({ bundle, runId, runAttempt, workflowSha }) {
  requireId(runId);
  requireSha(workflowSha);
  requireCondition(runAttempt === 1, "FRESH_APPROVAL_RUN_REQUIRED");
  const { record, releaseDigest, artifactId, artifactDigest, stagingRunId } = bundle;
  requireCondition(canonicalDigest(record) === releaseDigest, "IMMUTABLE_RECORD_MISMATCH");
  const request = {
    version: 1,
    runId,
    runAttempt,
    workflowSha,
    sourceSha: record.context.source.sha,
    releaseDigest,
    releaseArtifactId: artifactId,
    releaseArtifactDigest: artifactDigest,
    stagingRunId,
    migrationPlanDigest: canonicalDigest(record.context.migrationPlan),
  };
  const markdown = [
    "## Production approval request",
    "",
    `Source: \`${request.sourceSha}\``,
    `Release record: \`${releaseDigest}\``,
    `Database plan: \`${request.migrationPlanDigest}\` (${record.context.migrationPlan.mode})`,
    `Current production deployment: \`${record.context.baseline.deploymentId}\``,
    `Tested staging deployment: \`${record.context.staging.deploymentId}\``,
    `Supported installed production extensions: ${record.context.supportedExtensionVersions.join(", ")}`,
    "",
    "Approval authorizes this source and compatible database plan. The production build is created after approval with domains withheld, checked, then promoted by exact deployment ID. Failed postchecks permit app rollback only when the current database and supported installed extensions remain compatible. Database changes are never automatically reversed.",
    "",
    "Any changed source, workflow, record, configuration, baseline, plan or expired evidence requires a fresh run and approval. Reruns are refused.",
  ].join("\n");
  return { request, markdown };
}
