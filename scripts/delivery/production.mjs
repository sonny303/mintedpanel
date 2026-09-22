import { canonicalDigest } from "../release/contract.mjs";
import { DeliveryError, requireCondition } from "./boundary.mjs";
import { executeDelivery } from "./controller.mjs";
import { loadApprovalRequest, verifyProductionApproval } from "./github.mjs";
import { assertApprovalIntent, bindProductionEligibility } from "./intent.mjs";

/**
 * Reviewed composition boundary; real collectors/executors are still missing.
 * No CLI adapter injection or operator approval/evidence JSON is supported.
 * Approval coordinates must come from the immutable preparation job outputs.
 */
export async function executeApprovedProduction({
  github,
  approval,
  services,
  clock = () => new Date().toISOString(),
}) {
  try {
    const coordinates = structuredClone(approval);
    const request = await loadApprovalRequest({ github, ...coordinates, now: clock() });
    const intentDigest = canonicalDigest(request);
    const authority = async () => {
      const actual = await loadApprovalRequest({ github, ...coordinates, now: clock() });
      requireCondition(canonicalDigest(actual) === intentDigest, "APPROVED_INTENT_DRIFT");
      await verifyProductionApproval({
        github,
        runId: coordinates.runId,
        runAttempt: 1,
        workflowSha: coordinates.workflowSha,
        request: actual,
        now: clock(),
      });
      const { stage } = assertApprovalIntent(actual, { now: clock() });
      const main = await github.request("GET", "/git/ref/heads/main");
      requireCondition(main.object?.sha === stage.source.sha, "MAIN_MOVED");
    };
    // No production evidence access, backup selection, build or mutation before this review.
    await authority();
    const selectionStartedAt = clock();
    const collected = await services.collectProductionEligibility({
      request: structuredClone(request),
      selectionStartedAt,
    });
    const bundle = bindProductionEligibility({
      request,
      bundle: collected,
      selectionStartedAt,
      now: clock(),
    });
    const releaseDigest = bundle.releaseDigest;
    const verifyAuthority = async (identity) => {
      requireCondition(
        identity.target === "production" && identity.releaseDigest === releaseDigest,
        "EXECUTION_BINDING",
      );
      await authority();
      // The controller clones the record and repeatedly validates G0 against
      // actual snapshots; their backup must remain this exact selected backup.
      requireCondition(
        canonicalDigest(bundle.record) === releaseDigest &&
          canonicalDigest(bundle.record.backup) === bundle.selectedBackupDigest,
        "EXECUTION_BINDING",
      );
    };
    const result = await executeDelivery({
      target: "production",
      bundle,
      services: {
        ...services,
        verifyAuthority,
        async acquireLease(identity) {
          requireCondition(
            identity.target === "production" &&
              identity.releaseDigest === releaseDigest &&
              identity.workflowSha === bundle.record.context.workflow.sha,
            "EXECUTION_BINDING",
          );
          // G0 names the stage evidence producer; ownership names this approved runner.
          return services.acquireLease({ ...identity, workflowSha: request.workflowSha });
        },
      },
      clock,
    });
    return { ...result, intentDigest, selectedBackupDigest: bundle.selectedBackupDigest };
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError("PRODUCTION_EXECUTION_FAILED");
  }
}
