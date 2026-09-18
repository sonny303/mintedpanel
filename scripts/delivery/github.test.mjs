// SIMULATOR ONLY: fabricated transport responses exercise trust checks, not release eligibility.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { canonicalDigest } from "../release/contract.mjs";
import { intentFixture } from "./intent-fixtures.mjs";
import { APPROVER_ID, REPOSITORY, WORKFLOWS } from "./boundary.mjs";
import {
  admitSuccessfulMain,
  createGitHub,
  loadProductionBaselineAttestation,
  loadStagingQualification,
  readArtifactJson,
  verifyProductionApproval,
} from "./github.mjs";
import {
  baselineAttestationFixture,
  qualificationFixture,
  QUALIFIED_NOW,
} from "./qualification-fixtures.mjs";

function singleFileZip(filename, value) {
  const name = Buffer.from(filename);
  const data = Buffer.from(JSON.stringify(value));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12);
  end.writeUInt32LE(30 + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

function run(path = WORKFLOWS.production, event = "workflow_dispatch", sha = "c".repeat(40)) {
  return {
    id: 42,
    path,
    event,
    head_sha: sha,
    head_branch: "main",
    run_attempt: 1,
    status: "in_progress",
    conclusion: null,
    repository: { full_name: REPOSITORY },
    head_repository: { full_name: REPOSITORY },
  };
}

function approvalSimulator() {
  const currentRun = run();
  const request = intentFixture();
  const environment = {
    id: 99,
    can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    protection_rules: [
      {
        type: "required_reviewers",
        prevent_self_review: false,
        reviewers: [{ type: "User", reviewer: { id: APPROVER_ID } }],
      },
    ],
  };
  const branches = { total_count: 1, branch_policies: [{ name: "main", type: "branch" }] };
  const history = [
    {
      state: "approved",
      user: { id: APPROVER_ID },
      environments: [{ id: 99, name: "Production" }],
    },
  ];
  const github = {
    async request(_method, path) {
      if (path.endsWith("/approvals")) return history;
      if (path.endsWith("deployment-branch-policies")) return branches;
      if (path === "/environments/Production") return environment;
      return currentRun;
    },
  };
  return {
    currentRun,
    request,
    environment,
    branches,
    history,
    github,
    verify: () =>
      verifyProductionApproval({
        github,
        runId: "42",
        runAttempt: 1,
        workflowSha: "c".repeat(40),
        request,
        now: QUALIFIED_NOW,
      }),
  };
}

test("simulator: approval binds actual reviewer ID, exact environment, fresh run and request digest", async () => {
  const s = approvalSimulator();
  const approved = await s.verify();
  assert.equal(approved.reviewerId, APPROVER_ID);
  assert.equal(approved.environmentId, 99);
  assert.equal(approved.requestDigest, canonicalDigest(s.request));
});

const denied = [
  [
    "wrong reviewer",
    (s) => {
      s.history[0].user.id = 1;
    },
  ],
  [
    "rejected review",
    (s) => {
      s.history[0].state = "rejected";
    },
  ],
  [
    "wrong environment",
    (s) => {
      s.history[0].environments[0].id = 100;
    },
  ],
  [
    "no review",
    (s) => {
      s.history.length = 0;
    },
  ],
  [
    "ambiguous review history",
    (s) => {
      s.history.push(structuredClone(s.history[0]));
    },
  ],
  [
    "rerun",
    (s) => {
      s.currentRun.run_attempt = 2;
    },
  ],
  [
    "request from old run",
    (s) => {
      s.request.runId = "41";
    },
  ],
  [
    "request workflow changed",
    (s) => {
      s.request.workflowSha = "d".repeat(40);
    },
  ],
  [
    "admin bypass enabled",
    (s) => {
      s.environment.can_admins_bypass = true;
    },
  ],
  [
    "second reviewer",
    (s) => {
      s.environment.protection_rules[0].reviewers.push({ type: "User", reviewer: { id: 2 } });
    },
  ],
  [
    "self review disabled",
    (s) => {
      s.environment.protection_rules[0].prevent_self_review = true;
    },
  ],
  [
    "tag named main",
    (s) => {
      s.branches.branch_policies[0].type = "tag";
    },
  ],
  [
    "fork repository",
    (s) => {
      s.currentRun.head_repository.full_name = "attacker/mintedpanel";
    },
  ],
  [
    "different workflow",
    (s) => {
      s.currentRun.path = ".github/workflows/other.yml";
    },
  ],
];
for (const [name, change] of denied) {
  test(`simulator: ${name} cannot reuse production approval`, async () => {
    const s = approvalSimulator();
    change(s);
    await assert.rejects(s.verify);
  });
}

test("simulator: CI admission verifies the provider run, SHA, source repository and current main", async () => {
  const ci = {
    ...run(WORKFLOWS.ci, "push", "a".repeat(40)),
    status: "completed",
    conclusion: "success",
  };
  const github = {
    async request(_method, path) {
      return path.includes("heads/main") ? { object: { sha: "a".repeat(40) } } : ci;
    },
  };
  await admitSuccessfulMain({ github, runId: "42", sha: "a".repeat(40) });
  ci.conclusion = "skipped";
  await assert.rejects(admitSuccessfulMain({ github, runId: "42", sha: "a".repeat(40) }), {
    code: "RUN_NOT_SUCCESSFUL",
  });
});

for (const suffix of ["", "@main"]) {
  test(`simulator: CI admission accepts the exact main workflow path ${suffix || "without a qualifier"}`, async () => {
    const sha = "a".repeat(40);
    const ci = {
      ...run(`${WORKFLOWS.ci}${suffix}`, "push", sha),
      status: "completed",
      conclusion: "success",
    };
    const github = {
      async request(_method, path) {
        return path.includes("heads/main") ? { object: { sha } } : ci;
      },
    };
    await admitSuccessfulMain({ github, runId: "42", sha });
  });
}

for (const suffix of [
  "@staging",
  "@refs/heads/main",
  "@refs/tags/main",
  "@MAIN",
  "@main/other",
  "@main@other",
  "@main ",
  "@main\n",
  "@" + "a".repeat(40),
]) {
  test(`simulator: CI admission rejects unexpected workflow qualifier ${JSON.stringify(suffix)}`, async () => {
    const sha = "a".repeat(40);
    const ci = {
      ...run(`${WORKFLOWS.ci}${suffix}`, "push", sha),
      status: "completed",
      conclusion: "success",
    };
    const github = {
      async request() {
        return ci;
      },
    };
    await assert.rejects(admitSuccessfulMain({ github, runId: "42", sha }), {
      code: "RUN_PROVENANCE",
    });
  });
}

test("simulator: exact main-qualified production workflow retains the approval checks", async () => {
  const s = approvalSimulator();
  s.currentRun.path = `${WORKFLOWS.production}@main`;
  assert.equal((await s.verify()).reviewerId, APPROVER_ID);
  s.currentRun.head_branch = "staging";
  await assert.rejects(s.verify, { code: "RUN_PROVENANCE" });
  s.currentRun.head_branch = "main";
  s.currentRun.head_sha = "d".repeat(40);
  await assert.rejects(s.verify, { code: "RUN_SHA" });
});

function artifactSimulator() {
  const qualification = qualificationFixture();
  const sourceSha = qualification.preflight.record.context.source.sha;
  const producer = {
    ...run(WORKFLOWS.staging, "workflow_run"),
    id: 12345,
    status: "completed",
    conclusion: "success",
    run_started_at: "2026-09-08T17:58:00.000Z",
    updated_at: QUALIFIED_NOW,
  };
  const bytes = singleFileZip("staging-qualification.json", {
    qualification,
    sourceCiRunId: "50",
  });
  const metadata = {
    id: 7,
    name: "minted-staging-qualification-12345-1",
    expired: false,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    workflow_run: { id: 12345, head_sha: producer.head_sha, head_branch: "main" },
  };
  const github = {
    async request(_method, path) {
      if (path === "/actions/artifacts/7") return metadata;
      if (path === "/actions/runs/12345") return producer;
      if (path === "/actions/runs/50")
        return {
          ...run(WORKFLOWS.ci, "push", sourceSha),
          id: 50,
          status: "completed",
          conclusion: "success",
        };
      if (path === "/git/ref/heads/main") return { object: { sha: sourceSha } };
      throw new Error("unexpected simulated read");
    },
    async archive() {
      return bytes;
    },
  };
  return {
    producer,
    metadata,
    bytes,
    github,
    load: () =>
      loadStagingQualification({
        github,
        stagingRunId: "12345",
        artifactId: 7,
        now: QUALIFIED_NOW,
      }),
  };
}

test("simulator: record requires a successful trusted producer, exact artifact metadata and downloaded digest", async () => {
  const s = artifactSimulator();
  const result = await s.load();
  assert.equal(result.artifactId, 7);
  assert.equal(result.qualificationDigest, canonicalDigest(result.qualification));
});

for (const [name, change] of [
  [
    "artifact substituted",
    (s) => {
      s.metadata.workflow_run.id = 2;
    },
  ],
  [
    "archive changed",
    (s) => {
      s.bytes[40] ^= 1;
    },
  ],
  [
    "expired artifact",
    (s) => {
      s.metadata.expired = true;
    },
  ],
  [
    "producer rerun changed",
    (s) => {
      s.producer.run_attempt = 2;
    },
  ],
  [
    "failed producer",
    (s) => {
      s.producer.conclusion = "failure";
    },
  ],
]) {
  test(`simulator: ${name} denies artifact eligibility`, async () => {
    const s = artifactSimulator();
    change(s);
    await assert.rejects(s.load);
  });
}

test("artifact extraction accepts one exact JSON filename; rejects traversal and truncated archives", () => {
  assert.deepEqual(readArtifactJson(singleFileZip("release.json", { value: 1 }), "release.json"), {
    value: 1,
  });
  assert.throws(() => readArtifactJson(singleFileZip("../release.json", {}), "release.json"));
  assert.throws(() => readArtifactJson(Buffer.alloc(10), "release.json"));
});

test("HTTP transport never forwards GitHub authorization to the artifact download origin", async () => {
  const calls = [];
  const github = createGitHub({
    token: "simulated-token",
    fetcher: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1)
        return new Response(null, {
          status: 302,
          headers: { location: "https://artifact.example.invalid/signed-download" },
        });
      return new Response("simulated archive");
    },
  });
  await github.archive("7");
  assert.equal(calls[0].options.headers.Authorization, "Bearer simulated-token");
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(calls[1].options.redirect, "error");
});

function phaseArtifactSimulator(phase) {
  const isStage = phase === "staging";
  const value = isStage
    ? { qualification: qualificationFixture(), sourceCiRunId: "50" }
    : baselineAttestationFixture();
  const currentRun = {
    ...run(
      isStage ? WORKFLOWS.staging : WORKFLOWS.production,
      isStage ? "workflow_run" : "workflow_dispatch",
    ),
    id: isStage ? 12345 : 42,
    status: "completed",
    conclusion: "success",
    run_started_at: "2026-09-08T17:50:00Z",
    updated_at: "2026-09-08T18:00:45Z",
  };
  const name = isStage ? "minted-staging-qualification-12345-1" : "minted-production-baseline-42-1";
  const filename = isStage ? "staging-qualification.json" : "production-baseline.json";
  let archive = singleFileZip(filename, value);
  const metadata = {
    id: 7,
    name,
    expired: false,
    workflow_run: { id: currentRun.id, head_sha: currentRun.head_sha, head_branch: "main" },
    digest: `sha256:${createHash("sha256").update(archive).digest("hex")}`,
  };
  const review = approvalSimulator();
  const calls = [];
  const github = {
    async request(method, path) {
      calls.push(path);
      if (path === "/actions/artifacts/7") return metadata;
      if (path === `/actions/runs/${currentRun.id}`) return currentRun;
      if (path === "/actions/runs/50")
        return {
          ...run(WORKFLOWS.ci, "push", "a".repeat(40)),
          status: "completed",
          conclusion: "success",
        };
      if (path === "/git/ref/heads/main") return { object: { sha: "a".repeat(40) } };
      return review.github.request(method, path);
    },
    async archive() {
      return archive;
    },
  };
  return {
    value,
    currentRun,
    metadata,
    review,
    calls,
    repackage() {
      archive = singleFileZip(filename, value);
      metadata.digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
    },
    load: () =>
      isStage
        ? loadStagingQualification({
            github,
            stagingRunId: "12345",
            artifactId: "7",
            now: QUALIFIED_NOW,
          })
        : loadProductionBaselineAttestation({
            github,
            runId: "42",
            artifactId: "7",
            artifactDigest: metadata.digest,
            now: QUALIFIED_NOW,
          }),
  };
}

test("authenticated staging qualification uses stage-only facts and never reads Production approval or configuration", async () => {
  const s = phaseArtifactSimulator("staging");
  const result = await s.load();
  assert.equal(result.productionEligibility, "NOT_EVALUATED");
  assert.equal(result.qualificationDigest, canonicalDigest(s.value.qualification));
  assert.equal(
    s.calls.some((path) => path.includes("Production") || path.endsWith("/approvals")),
    false,
  );
});

test("authenticated baseline attestation requires a successful approved Production producer and preserves recorded time", async () => {
  const s = phaseArtifactSimulator("production");
  const result = await s.load();
  assert.equal(result.productionEligibility, "NOT_EVALUATED");
  assert.equal(result.freshness, "HISTORICAL_ONLY");
  assert.equal(result.backupEligibility, "NOT_EVALUATED");
  assert.equal(result.recordedAt, s.value.recordedAt);
  assert.equal(result.reviewerId, APPROVER_ID);
});

for (const phase of ["staging", "production"]) {
  for (const [name, mutate] of [
    [
      "wrong artifact producer",
      (s) => {
        s.metadata.workflow_run.id = 999;
      },
    ],
    [
      "wrong workflow",
      (s) => {
        s.currentRun.path = ".github/workflows/other.yml";
      },
    ],
    [
      "failed producer",
      (s) => {
        s.currentRun.conclusion = "failure";
      },
    ],
    [
      "time outside producer execution",
      (s) => {
        s.currentRun.run_started_at = "2026-09-08T18:00:40Z";
      },
    ],
  ]) {
    test(`${phase} phase artifact rejects ${name}`, async () => {
      const s = phaseArtifactSimulator(phase);
      mutate(s);
      await assert.rejects(s.load);
    });
  }
}

test("production baseline artifact cannot reuse a denied approval", async () => {
  const s = phaseArtifactSimulator("production");
  s.review.history[0].state = "rejected";
  await assert.rejects(s.load, { code: "PRODUCTION_APPROVAL_MISSING" });
});

test("staging qualification cannot substitute a historical production expectation", async () => {
  const s = phaseArtifactSimulator("staging");
  s.value.qualification = baselineAttestationFixture();
  s.repackage();
  await assert.rejects(s.load, { code: "QUALIFICATION_SHAPE" });
});
