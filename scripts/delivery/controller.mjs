import { canonicalDigest, validateRelease } from "../release/contract.mjs";
import {
  DeliveryError,
  PRODUCTION_ALIASES,
  STAGING_ALIASES,
  requireCondition,
  requireTarget,
} from "./boundary.mjs";

const same = (left, right) => canonicalDigest(left) === canonicalDigest(right);
const copy = (value) => structuredClone(value);
const withoutTime = ({ observedAt: _observedAt, ...value }) => value;

function fresh(timestamp, now, seconds) {
  return (
    typeof timestamp === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) &&
    Date.parse(now) >= Date.parse(timestamp) &&
    Date.parse(now) - Date.parse(timestamp) <= seconds * 1000
  );
}

/** Bound receipt from a reviewed provider collector, never an operator PASS file. */
export function receiptBinding({ releaseDigest, phase, candidate, snapshot }) {
  return canonicalDigest({ releaseDigest, phase, candidate, snapshot });
}

export function productionBuildArguments() {
  return ["deploy", "--prod", "--skip-domain"];
}

/**
 * Transport-injected control core. The hosted entrypoint does not accept adapters,
 * records or receipts from the caller. Tests inject explicitly simulated services.
 */
export async function executeDelivery({
  target,
  bundle,
  services,
  clock = () => new Date().toISOString(),
}) {
  requireTarget(target);
  const record = copy(bundle.record);
  const policy = copy(bundle.policy);
  const releaseDigest = canonicalDigest(record);
  requireCondition(bundle.releaseDigest === releaseDigest, "IMMUTABLE_RECORD_MISMATCH");
  const context = record.context;
  const events = [];
  const event = (phase) => events.push(phase);
  let lease;
  let mutationStarted = false;
  let targetChanged = false;
  let preMutationSnapshot;
  let expected;
  let candidate = null;
  let stagingProof;

  const contract = () => {
    const result = validateRelease({
      record,
      policy,
      observed: preMutationSnapshot.observed,
      expectedTarget: target,
      expectedDigest: releaseDigest,
      now: clock(),
    });
    requireCondition(result.ok, "RELEASE_CONTRACT_REJECTED");
  };
  const guard = async () => {
    if (lease) await lease.assertOwned();
    await services.verifyAuthority({ target, releaseDigest });
    const actual = await services.snapshot({ target });
    requireCondition(
      fresh(actual.observed?.observedAt, clock(), policy.snapshotMaxAgeSeconds),
      "CURRENT_SNAPSHOT_STALE",
    );
    if (!preMutationSnapshot) {
      const aliases = target === "staging" ? STAGING_ALIASES : PRODUCTION_ALIASES;
      requireCondition(
        same(
          actual.aliases,
          Object.fromEntries(aliases.map((alias) => [alias, context.baseline.deploymentId])),
        ),
        "SERVED_ALIAS_BASELINE",
      );
      preMutationSnapshot = copy(actual);
      expected = copy(actual);
    }
    requireCondition(
      same(withoutTime(actual.observed), withoutTime(expected.observed)) &&
        same(actual.aliases, expected.aliases),
      "CURRENT_BASELINE_DRIFT",
    );
    // Before changing DB/domains, a newly collected actual baseline can replace
    // an older observation after full G0 validation. After mutation starts, keep
    // the last real pre-mutation observation and its original timestamp intact.
    if (!targetChanged) {
      const result = validateRelease({
        record,
        policy,
        observed: actual.observed,
        expectedTarget: target,
        expectedDigest: releaseDigest,
        now: clock(),
      });
      requireCondition(result.ok, "RELEASE_CONTRACT_REJECTED");
      preMutationSnapshot = copy(actual);
    }
    contract();
    return actual;
  };
  const check = async (phase, snapshot = undefined) => {
    const actual = snapshot ?? (await guard());
    const binding = receiptBinding({ releaseDigest, phase, candidate, snapshot: actual });
    const receipt = await services.check({
      target,
      phase,
      candidate,
      snapshot: actual,
      releaseDigest,
    });
    requireCondition(
      receipt?.status === "PASS" &&
        receipt.bindingDigest === binding &&
        /^[a-f0-9]{64}$/.test(receipt.artifactDigest) &&
        fresh(receipt.finishedAt, clock(), policy.snapshotMaxAgeSeconds),
      "PHASE_CHECK_FAILED",
    );
    if (phase === "rollback-compatible") {
      requireCondition(
        receipt.databaseCompatible === true &&
          receipt.extensionsCompatible === true &&
          same(receipt.supportedExtensionVersions, context.supportedExtensionVersions),
        "ROLLBACK_INCOMPATIBLE",
      );
    }
    event(`checked:${phase}`);
    return receipt;
  };
  const mutate = async (phase, action) => {
    await guard();
    mutationStarted = true;
    if (phase !== "staging-ref") targetChanged = true;
    event(`mutating:${phase}`);
    await action();
  };
  const setCandidateBaseline = () => {
    Object.assign(expected.observed.baseline, {
      deploymentId: candidate.deploymentId,
      appSha: context.source.sha,
      configurationDigest: context.targetConfigurationDigest,
    });
  };
  const build = async () => {
    await guard();
    if (target === "staging") {
      // Uploading content-addressed source and creating a Preview are provider
      // mutations even though neither served alias has moved yet. Preserve the
      // lease if their outcome is uncertain so another writer cannot race the
      // required reconciliation.
      mutationStarted = true;
      event("mutating:staging-candidate");
    }
    candidate = await services.build({
      target: copy(context.target),
      sourceSha: context.source.sha,
      releaseDigest,
      withholdDomains: true,
      ...(target === "production"
        ? { argv: productionBuildArguments() }
        : { gitBranch: "staging", vercelEnvironment: "preview" }),
    });
    requireCondition(
      /^dpl_[a-zA-Z0-9_]{1,100}$/.test(candidate?.deploymentId) &&
        candidate.sourceSha === context.source.sha &&
        same(candidate.target, context.target) &&
        candidate.configurationDigest === context.targetConfigurationDigest &&
        candidate.releaseDigest === releaseDigest &&
        candidate.readyState === "READY" &&
        candidate.domainsWithheld === true,
      "CANDIDATE_BINDING",
    );
    event("candidate-built");
    await check("candidate");
  };

  await services.assertReady({ target });
  await services.verifyAuthority({ target, releaseDigest });
  event(target === "production" ? "production-approval-verified" : "successful-main-verified");
  await guard();
  if (target === "production") await build();
  try {
    lease = await services.acquireLease({
      target,
      workflowSha: context.workflow.sha,
      releaseDigest,
    });
    event("lease-acquired");
    await guard();
    if (target === "staging") {
      await mutate("staging-ref", () => services.fastForward({ lease, sha: context.source.sha }));
    }
    if (context.migrationPlan.mode === "additive") {
      await check("migration-rehearsal-and-old-new-compatibility");
      await mutate("database", () =>
        services.applyMigration({
          target: copy(context.target),
          plan: copy(context.migrationPlan),
          planDigest: policy.migrationPlanDigest,
          releaseDigest,
        }),
      );
      expected.observed.baseline.schemaDigest = context.migrationPlan.resultSchemaDigest;
      expected.observed.baseline.migrations = copy(context.migrationPlan.inventory);
      await check("database-postconditions");
    }
    if (target === "staging") await build();
    stagingProof = await check("post-application-candidate-and-installed-extensions");
    if (target === "staging") {
      for (const alias of STAGING_ALIASES) {
        await mutate("staging-alias", () =>
          services.assignAlias({ alias, deploymentId: candidate.deploymentId, releaseDigest }),
        );
        expected.aliases[alias] = candidate.deploymentId;
        if (alias === "staging.mintedpanel.com") {
          setCandidateBaseline();
          Object.assign(expected.observed.staging, {
            sourceSha: context.source.sha,
            workflowSha: context.workflow.sha,
            runId: context.workflow.runId,
            runAttempt: context.workflow.runAttempt,
            deploymentId: candidate.deploymentId,
            configurationDigest: context.targetConfigurationDigest,
            schemaDigest: context.migrationPlan.resultSchemaDigest,
            migrationPlanDigest: policy.migrationPlanDigest,
            verifiedAt: stagingProof.finishedAt,
          });
        }
      }
    } else {
      await mutate("production-promotion", () =>
        services.promote({ deploymentId: candidate.deploymentId, releaseDigest }),
      );
      setCandidateBaseline();
      for (const alias of Object.keys(expected.aliases))
        expected.aliases[alias] = candidate.deploymentId;
    }
    try {
      await check("served-postconditions");
    } catch (error) {
      if (target !== "production" || error.code !== "PHASE_CHECK_FAILED") throw error;
      await check("rollback-compatible");
      await mutate("compatible-app-rollback", () =>
        services.rollbackApp({ deploymentId: context.baseline.deploymentId, releaseDigest }),
      );
      Object.assign(expected.observed.baseline, {
        deploymentId: context.baseline.deploymentId,
        appSha: context.baseline.appSha,
        configurationDigest: context.baseline.configurationDigest,
      });
      for (const alias of Object.keys(expected.aliases))
        expected.aliases[alias] = context.baseline.deploymentId;
      await check("rollback-postconditions");
      await lease.release();
      event("lease-released");
      return { status: "ROLLED_BACK", releaseDigest, events };
    }
    await lease.release();
    event("lease-released");
    return { status: "DELIVERED", releaseDigest, candidate, events };
  } catch (error) {
    // Any attempted mutation may have succeeded despite a transport error.
    // Preserve ownership for reconciliation; no finally-block unconditional unlock.
    if (lease && !mutationStarted) await lease.release();
    const stopped = new DeliveryError(
      lease && mutationStarted
        ? "DELIVERY_STOPPED_LEASE_RETAINED"
        : error instanceof DeliveryError
          ? error.code
          : "DELIVERY_FAILED",
    );
    stopped.reason = error instanceof DeliveryError ? error.code : "PROVIDER_OPERATION_UNCERTAIN";
    stopped.events = events;
    throw stopped;
  }
}
