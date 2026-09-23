import assert from "node:assert/strict";
import test from "node:test";
import { DeliveryError } from "./boundary.mjs";
import { collectStagingEvidence, parseArgs } from "./collect-staging-evidence.mjs";
import { evidenceDigest } from "./staging-evidence.mjs";

const SHA = "a".repeat(40);
const DEPLOYMENT = "dpl_candidate";
const OBSERVED = {
  observedAt: "2026-09-23T18:00:00.000Z",
  qualification: { status: "BLOCKED", reasons: ["STAGING_ALIAS_PROJECT_MISMATCH"] },
  privateProviderBlob: "SECRET_MUST_NOT_ESCAPE",
};

test("CLI accepts only the fixed source SHA and optional candidate deployment", () => {
  assert.deepEqual(parseArgs(["--source-sha", SHA]), { sourceSha: SHA });
  assert.deepEqual(parseArgs(["--source-sha", SHA, "--candidate-deployment-id", DEPLOYMENT]), {
    sourceSha: SHA,
    candidateDeploymentId: DEPLOYMENT,
  });
  assert.throws(() => parseArgs(["--source-sha", SHA, "--vercel-api", "https://evil.invalid"]), {
    code: "STAGING_EVIDENCE_CLI_ARGUMENTS",
  });
  assert.throws(() => parseArgs(["--source-sha", SHA, "--supabase-token", "override"]), {
    code: "STAGING_EVIDENCE_CLI_ARGUMENTS",
  });
  assert.throws(() => parseArgs(["--candidate-deployment-id", DEPLOYMENT]), {
    code: "STAGING_EVIDENCE_CLI_SOURCE_SHA",
  });
});

test("CLI emits a versioned blocked evidence artifact and strips qualification fields", async () => {
  const outputs = [];
  const calls = [];
  const factory = (name) => (options) => ({
    collect: async (input) => {
      calls.push({ name, options, input });
      return { ...structuredClone(OBSERVED), [name]: true };
    },
  });
  const status = await collectStagingEvidence({
    args: ["--source-sha", SHA, "--candidate-deployment-id", DEPLOYMENT],
    env: { SUPABASE_ACCESS_TOKEN: "supabase-token", VERCEL_TOKEN: "vercel-token" },
    output: (value) => outputs.push(value),
    dependencies: { supabaseFactory: factory("supabase"), vercelFactory: factory("vercel") },
  });
  assert.equal(status, 0);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].version, 1);
  assert.equal(outputs[0].status, "BLOCKED");
  assert.equal(outputs[0].sourceSha, SHA);
  assert.equal(outputs[0].evidence.supabase.qualification, undefined);
  assert.ok(outputs[0].blockers.includes("STAGING_ALIAS_PROJECT_MISMATCH"));
  const { artifactDigest: firstDigest, ...artifactWithoutDigest } = outputs[0];
  assert.equal(firstDigest, evidenceDigest(artifactWithoutDigest));
  assert.equal(JSON.stringify(outputs[0]).includes("SECRET_MUST_NOT_ESCAPE"), false);
  assert.equal(calls[0].options.credential, "supabase-token");
  assert.deepEqual(calls[1].input, { sourceSha: SHA, expectedDeploymentId: DEPLOYMENT });
});

test("CLI artifact digest is deterministic and changes when evidence changes", async () => {
  const collect = () => ({
    collect: async () => ({ ...structuredClone(OBSERVED), privateProviderBlob: "DROP_ME" }),
  });
  const run = async () => {
    const outputs = [];
    await collectStagingEvidence({
      args: ["--source-sha", SHA],
      env: { SUPABASE_ACCESS_TOKEN: "supabase-token", VERCEL_TOKEN: "vercel-token" },
      output: (value) => outputs.push(value),
      dependencies: { supabaseFactory: collect, vercelFactory: collect },
    });
    return outputs[0];
  };
  const first = await run();
  const second = await run();
  assert.equal(first.artifactDigest, second.artifactDigest);
  const { artifactDigest: _firstDigest, ...changedArtifact } = first;
  assert.notEqual(
    first.artifactDigest,
    evidenceDigest({ ...changedArtifact, sourceSha: "b".repeat(40) }),
  );
});

test("CLI turns provider failures into a static blocked code without leaking provider text", async () => {
  const outputs = [];
  const status = await collectStagingEvidence({
    args: ["--source-sha", SHA],
    env: { SUPABASE_ACCESS_TOKEN: "supabase-token", VERCEL_TOKEN: "vercel-token" },
    output: (value) => outputs.push(value),
    dependencies: {
      supabaseFactory: () => ({
        collect: async () => {
          throw new Error("SECRET_PROVIDER_RESPONSE");
        },
      }),
      vercelFactory: () => ({
        collect: async () => {
          throw new Error("unreachable");
        },
      }),
    },
  });
  assert.equal(status, 2);
  assert.deepEqual(outputs, [
    { version: 1, status: "BLOCKED", code: "STAGING_EVIDENCE_COLLECTION_FAILED" },
  ]);
  assert.equal(JSON.stringify(outputs).includes("SECRET_PROVIDER_RESPONSE"), false);
});

test("CLI reports missing exact credentials as a static blocked result", async () => {
  const outputs = [];
  const status = await collectStagingEvidence({
    args: ["--source-sha", SHA],
    env: { SUPABASE_TOKEN: "wrong-name", VERCEL_API_TOKEN: "wrong-name" },
    output: (value) => outputs.push(value),
  });
  assert.equal(status, 2);
  assert.equal(outputs[0].status, "BLOCKED");
  assert.match(outputs[0].code, /^STAGING_/);
});

test("CLI dependency and parser errors remain closed DeliveryErrors", () => {
  assert.throws(
    () => parseArgs(["--source-sha", "not-a-sha"]),
    (error) => error instanceof DeliveryError,
  );
});
