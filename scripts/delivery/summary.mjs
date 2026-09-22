import { canonicalDigest } from "../release/contract.mjs";
import { createApprovalIntent } from "./intent.mjs";

/** Inputs come from authenticated staging and historical production baseline loaders. */
export function approvalSummary(inputs) {
  const request = createApprovalIntent(inputs);
  const stage = request.staging.qualification;
  const context = stage.preflight.record.context;
  const expected = request.expectedProduction.attestation;
  const markdown = [
    "## Production approval request",
    "",
    `Source: \`${context.source.sha}\``,
    `Approval intent: \`${canonicalDigest(request)}\``,
    `Database plan: \`${canonicalDigest(context.migrationPlan)}\` (${context.migrationPlan.mode})`,
    `Previously recorded production deployment: \`${expected.baseline.deploymentId}\``,
    `Previously recorded production schema: \`${expected.baseline.schemaDigest}\``,
    `Production baseline recorded at: ${expected.recordedAt} (historical expectation; current state is checked after approval)`,
    `Tested staging deployment: \`${stage.result.candidate.deploymentId}\``,
    `Supported installed production extensions: ${expected.supportedExtensionVersions.join(", ")}`,
    "",
    "Approval authorizes this exact source, workflow, recorded production baseline/configuration, tested staging result and compatible database plan. After approval, the protected job selects and verifies a fresh matching production backup: same database, baseline schema and migration lineage, no older than 24 hours, with every required recovery scope and a restore demonstrated within 4 hours. Its exact identity is then sealed into the execution record and rechecked before changes. A staging backup cannot qualify.",
    "",
    "The production build is created after approval with domains withheld, checked, then promoted by exact deployment ID. Failed postchecks permit app rollback within the 5-minute recovery target only with current database and installed-extension compatibility evidence. Database changes are never automatically reversed.",
    "",
    "Changed approved identities or expired qualification require a fresh run and approval. A different backup may be selected only during the post-approval selection phase; replacing the sealed execution backup is refused. Reruns are refused.",
  ].join("\n");
  return { request, markdown };
}
