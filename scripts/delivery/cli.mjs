import { pathToFileURL } from "node:url";
import {
  ACTIVATION_BLOCKERS,
  DeliveryError,
  REPOSITORY,
  WORKFLOWS,
  assertHostedReady,
  requireCondition,
  requireId,
  requireSha,
} from "./boundary.mjs";
import { admitSuccessfulMain, createGitHub } from "./github.mjs";

/** Fixed entrypoints only: no adapter URL/module, target ID, record file or PASS override. */
export async function runCommand({ args, env, output }) {
  requireCondition(
    args.length === 1 &&
      ["status", "admit-staging", "staging", "prepare-production", "production"].includes(args[0]),
    "COMMAND_REJECTED",
  );
  const command = args[0];
  if (command === "status") {
    output({ status: "BLOCKED", blockers: ACTIVATION_BLOCKERS });
    return 2;
  }
  requireCondition(
    env.GITHUB_ACTIONS === "true" &&
      env.GITHUB_REPOSITORY === REPOSITORY &&
      env.GITHUB_REF === "refs/heads/main",
    "TRUSTED_MAIN_REQUIRED",
  );
  const workflowSha = requireSha(env.MINTED_WORKFLOW_SHA);
  requireCondition(
    env.GITHUB_WORKFLOW_REF ===
      `${REPOSITORY}/${command.includes("production") ? WORKFLOWS.production : WORKFLOWS.staging}@refs/heads/main`,
    "TRUSTED_WORKFLOW_REQUIRED",
  );
  requireCondition(env.MINTED_CHECKOUT_SHA === workflowSha, "CONTROL_CHECKOUT_MISMATCH");
  requireCondition(
    env.GITHUB_EVENT_NAME === "workflow_dispatch" && env.GITHUB_RUN_ATTEMPT === "1",
    command.includes("production") ? "FRESH_APPROVAL_RUN_REQUIRED" : "MANUAL_STAGING_RUN_REQUIRED",
  );
  requireId(env.GITHUB_RUN_ID);
  if (command === "admit-staging") {
    const github = createGitHub({ token: env.GITHUB_TOKEN });
    await admitSuccessfulMain({
      github,
      runId: requireId(env.MINTED_CI_RUN_ID),
      sha: requireSha(env.MINTED_SOURCE_SHA),
    });
    output({ status: "SOURCE_ADMITTED", sourceSha: env.MINTED_SOURCE_SHA });
    return 0;
  }
  // Provider collectors and executors are deliberately unavailable. The runnable
  // controller and GitHub adapters have simulator coverage, not hosted authority.
  // Connecting them requires reviewed code, approved credentials and real proofs.
  assertHostedReady();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await runCommand({
      args: process.argv.slice(2),
      env: process.env,
      output: (value) => process.stdout.write(`${JSON.stringify(value)}\n`),
    });
  } catch (error) {
    const code = error instanceof DeliveryError ? error.code : "DELIVERY_FAILED";
    process.stderr.write(
      `${JSON.stringify({ status: "BLOCKED", code, ...(code === "HOSTED_ACTIVATION_BLOCKED" ? { blockers: ACTIVATION_BLOCKERS } : {}) })}\n`,
    );
    process.exitCode = 2;
  }
}
