import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runCommand } from "./cli.mjs";
import { REPOSITORY, WORKFLOWS } from "./boundary.mjs";

test("hosted status explicitly reports blockers and fails eligibility", async () => {
  const outputs = [];
  assert.equal(
    await runCommand({ args: ["status"], env: {}, output: (value) => outputs.push(value) }),
    2,
  );
  assert.equal(outputs[0].status, "BLOCKED");
  assert.ok(
    outputs[0].blockers.includes("AUTHENTICATED_SCHEMA_LINEAGE_AND_BACKUP_COLLECTORS_MISSING"),
  );
});

test("local PASS file, adapter module, arbitrary target and activation overrides are not command inputs", async () => {
  for (const args of [
    ["production", "--record=pass.json"],
    ["--adapter=custom.mjs"],
    ["preview"],
    [],
  ]) {
    await assert.rejects(runCommand({ args, env: {}, output() {} }), { code: "COMMAND_REJECTED" });
  }
});

test("even a trusted-looking environment with secrets and PASS flags cannot activate hosted delivery", async () => {
  const sha = "a".repeat(40);
  for (const command of ["prepare-production", "production", "staging"]) {
    const production = command.includes("production");
    const env = {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_REF: "refs/heads/main",
      GITHUB_WORKFLOW_REF: `${REPOSITORY}/${WORKFLOWS[production ? "production" : "staging"]}@refs/heads/main`,
      GITHUB_EVENT_NAME: production ? "workflow_dispatch" : "workflow_run",
      GITHUB_RUN_ID: "42",
      GITHUB_RUN_ATTEMPT: "1",
      MINTED_WORKFLOW_SHA: sha,
      MINTED_CHECKOUT_SHA: sha,
      ENABLE_DEPLOYMENT: "true",
      PASS: "true",
      VERCEL_TOKEN: "simulator",
      SUPABASE_KEY: "simulator",
    };
    await assert.rejects(runCommand({ args: [command], env, output() {} }), {
      code: "HOSTED_ACTIVATION_BLOCKED",
    });
  }
});

test("workflow source has one Production job, no production secrets before its gate, and no mid-mutation concurrency cancellation", async () => {
  const root = new URL("../../.github/workflows/", import.meta.url);
  const production = await readFile(new URL("production-release.yml", root), "utf8");
  const staging = await readFile(new URL("staging-delivery.yml", root), "utf8");
  assert.equal((production.match(/environment: Production/g) ?? []).length, 1);
  assert.match(production, /needs: prepare/);
  assert.match(production, /github\.run_attempt == 1/);
  assert.equal(/\$\{\{\s*secrets\./.test(production), false);
  assert.equal(/\$\{\{\s*secrets\./.test(staging), false);
  for (const workflow of [production, staging]) {
    assert.match(workflow, /cancel-in-progress: false/);
    assert.equal(workflow.includes("cancel-in-progress: true"), false);
    assert.equal(workflow.includes("pull_request_target"), false);
    assert.equal(workflow.includes("deployment_status"), false);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /github\.workflow_sha/);
  }
});
