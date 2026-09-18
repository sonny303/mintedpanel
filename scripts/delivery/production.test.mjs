// SIMULATOR ONLY. In-memory GitHub artifacts and provider actions; no hosted operations.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { canonicalDigest } from "../release/contract.mjs";
import { hash } from "../release/test-fixtures.mjs";
import { APPROVER_ID, PRODUCTION_ALIASES, REPOSITORY, WORKFLOWS } from "./boundary.mjs";
import { receiptBinding } from "./controller.mjs";
import { loadApprovalRequest, prepareProductionApproval } from "./github.mjs";
import {
  eligibilityFixture,
  EXECUTION_NOW,
  intentFixture,
  SELECTED_AT,
} from "./intent-fixtures.mjs";
import { QUALIFIED_NOW } from "./qualification-fixtures.mjs";
import { executeApprovedProduction } from "./production.mjs";

function zip(filename, value) {
  const name = Buffer.from(filename),
    data = Buffer.from(JSON.stringify(value));
  const local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12);
  end.writeUInt32LE(30 + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

function simulator(additive = true, productionWorkflowSha = "c".repeat(40)) {
  const request = intentFixture(additive);
  request.workflowSha = productionWorkflowSha;
  const state = {
    now: SELECTED_AT,
    approved: true,
    operations: [],
    held: false,
    failServed: false,
  };
  const artifacts = new Map();
  function artifact(id, name, filename, value, producerId) {
    const bytes = zip(filename, value);
    const metadata = {
      id,
      name,
      expired: false,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      workflow_run: {
        id: producerId,
        head_sha: producerId === 42 ? productionWorkflowSha : "c".repeat(40),
        head_branch: "main",
      },
    };
    artifacts.set(id, { bytes, metadata });
    return metadata.digest;
  }
  request.staging.artifactDigest = artifact(
    7,
    "minted-staging-qualification-12345-1",
    "staging-qualification.json",
    { qualification: request.staging.qualification, sourceCiRunId: "50" },
    12345,
  );
  request.expectedProduction.artifactDigest = artifact(
    8,
    "minted-production-baseline-41-1",
    "production-baseline.json",
    request.expectedProduction.attestation,
    41,
  );
  const approval = {
    runId: "42",
    workflowSha: request.workflowSha,
    artifactId: 9,
    artifactDigest: artifact(9, "minted-approval-42-1", "approval-request.json", request, 42),
  };
  const runs = new Map(
    [42, 41, 12345, 50].map((id) => [
      id,
      {
        id,
        path: id === 12345 ? WORKFLOWS.staging : id === 50 ? WORKFLOWS.ci : WORKFLOWS.production,
        event: id === 50 ? "push" : "workflow_dispatch",
        head_sha: id === 42 ? productionWorkflowSha : (id === 50 ? "a" : "c").repeat(40),
        head_branch: "main",
        run_attempt: 1,
        status: id === 42 ? "in_progress" : "completed",
        conclusion: id === 42 ? null : "success",
        repository: { full_name: REPOSITORY },
        head_repository: { full_name: REPOSITORY },
        run_started_at: "2026-09-08T17:58:00.000Z",
        updated_at: EXECUTION_NOW,
      },
    ]),
  );
  const github = {
    async request(method, path) {
      assert.equal(method, "GET");
      state.operations.push(`github:${path}`);
      if (/^\/actions\/runs\/\d+$/.test(path))
        return structuredClone(runs.get(Number(path.split("/").at(-1))));
      if (path.endsWith("/approvals"))
        return [
          {
            state: state.approved || path.includes("/41/") ? "approved" : "rejected",
            user: { id: APPROVER_ID },
            environments: [{ id: 99, name: "Production" }],
          },
        ];
      if (path === "/environments/Production")
        return {
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
      if (path.endsWith("deployment-branch-policies"))
        return { total_count: 1, branch_policies: [{ name: "main", type: "branch" }] };
      if (path === "/git/ref/heads/main")
        return { object: { sha: state.mainSha ?? "a".repeat(40) } };
      if (path.startsWith("/actions/artifacts/"))
        return structuredClone(artifacts.get(Number(path.split("/").at(-1))).metadata);
      throw new Error("unexpected simulator read");
    },
    async archive(id) {
      return Buffer.from(artifacts.get(Number(id)).bytes);
    },
  };
  const bundle = eligibilityFixture(request);
  const snapshot = {
    observed: structuredClone(bundle.observed),
    aliases: Object.fromEntries(
      PRODUCTION_ALIASES.map((alias) => [alias, bundle.record.context.baseline.deploymentId]),
    ),
  };
  const write = (name) => {
    assert.equal(state.held, true);
    state.operations.push(name);
  };
  const serve = (id, appSha, configurationDigest) => {
    Object.assign(snapshot.observed.baseline, { deploymentId: id, appSha, configurationDigest });
    for (const alias of PRODUCTION_ALIASES) snapshot.aliases[alias] = id;
  };
  const services = {
    async collectProductionEligibility() {
      assert.ok(state.operations.includes("github:/actions/runs/42/approvals"));
      assert.equal(state.approved, true);
      state.operations.push("collect");
      state.now = EXECUTION_NOW;
      return structuredClone(bundle);
    },
    async assertReady() {
      state.operations.push("ready");
    },
    async snapshot() {
      const result = structuredClone(snapshot);
      result.observed.observedAt = state.now;
      return result;
    },
    async acquireLease(identity) {
      assert.equal(identity.workflowSha, productionWorkflowSha);
      state.operations.push("lease");
      state.held = true;
      return {
        async assertOwned() {
          assert.equal(state.held, true);
        },
        async release() {
          state.held = false;
          state.operations.push("release");
        },
      };
    },
    async build({ releaseDigest }) {
      state.operations.push("build");
      return {
        deploymentId: "dpl_synthetic_production_candidate",
        sourceSha: bundle.record.context.source.sha,
        target: bundle.record.context.target,
        configurationDigest: bundle.record.context.targetConfigurationDigest,
        releaseDigest,
        readyState: "READY",
        domainsWithheld: true,
      };
    },
    async check({ phase, candidate, snapshot: current, releaseDigest }) {
      state.operations.push(`check:${phase}`);
      return {
        status: state.failServed && phase === "served-postconditions" ? "FAIL" : "PASS",
        bindingDigest: receiptBinding({ releaseDigest, phase, candidate, snapshot: current }),
        artifactDigest: hash("synthetic receipt"),
        finishedAt: state.now,
        databaseCompatible: true,
        extensionsCompatible: true,
        supportedExtensionVersions: bundle.record.context.supportedExtensionVersions,
      };
    },
    async applyMigration({ plan }) {
      write("database");
      Object.assign(snapshot.observed.baseline, {
        schemaDigest: plan.resultSchemaDigest,
        migrations: structuredClone(plan.inventory),
      });
    },
    async promote({ deploymentId }) {
      write("promote");
      serve(
        deploymentId,
        bundle.record.context.source.sha,
        bundle.record.context.targetConfigurationDigest,
      );
    },
    async rollbackApp({ deploymentId }) {
      write("rollback");
      serve(
        deploymentId,
        bundle.record.context.baseline.appSha,
        bundle.record.context.baseline.configurationDigest,
      );
    },
  };
  return {
    request,
    state,
    artifacts,
    approval,
    github,
    bundle,
    snapshot,
    services,
    runs,
    run: () => executeApprovedProduction({ github, approval, services, clock: () => state.now }),
    prepare: () =>
      prepareProductionApproval({
        github,
        stagingRunId: "12345",
        stagingArtifactId: 7,
        baselineRunId: "41",
        baselineArtifactId: 8,
        baselineArtifactDigest: request.expectedProduction.artifactDigest,
        runId: "42",
        runAttempt: 1,
        workflowSha: request.workflowSha,
        now: QUALIFIED_NOW,
      }),
  };
}

test("preparation authenticates only GitHub staging and historical baseline artifacts without current release approval or production reads", async () => {
  const s = simulator();
  s.state.approved = false;
  const result = await s.prepare();
  assert.deepEqual(result.request, s.request);
  assert.equal(
    s.state.operations.every((operation) => operation.startsWith("github:")),
    true,
  );
  assert.equal(s.state.operations.includes("github:/actions/runs/42/approvals"), false);
  assert.equal(s.state.operations.includes("github:/actions/runs/41/approvals"), true);
});

test("missing authenticated historical attestation blocks nomination without production access", async () => {
  const s = simulator();
  s.artifacts.get(8).metadata.expired = true;
  await assert.rejects(s.prepare, { code: "ARTIFACT_IDENTITY" });
  assert.equal(s.state.operations.includes("collect"), false);
});

for (const additive of [false, true])
  test(`approved intent selects backup once before ${additive ? "additive" : "no-change"} production delivery`, async () => {
    const s = simulator(additive);
    const result = await s.run();
    assert.equal(result.status, "DELIVERED");
    assert.equal(result.intentDigest, canonicalDigest(s.request));
    assert.equal(result.selectedBackupDigest, canonicalDigest(s.bundle.record.backup));
    assert.equal(s.state.operations.filter((op) => op === "collect").length, 1);
    assert.ok(s.state.operations.indexOf("collect") < s.state.operations.indexOf("build"));
    assert.ok(s.state.operations.indexOf("build") < s.state.operations.indexOf("promote"));
    assert.equal(s.state.operations.includes("database"), additive);
    assert.equal(s.state.held, false);
  });

for (const [name, change] of [
  [
    "denied approval",
    (s) => {
      s.state.approved = false;
    },
  ],
  [
    "rerun",
    (s) => {
      s.runs.get(42).run_attempt = 2;
    },
  ],
  [
    "changed main",
    (s) => {
      s.state.mainSha = "d".repeat(40);
    },
  ],
  [
    "changed artifact digest",
    (s) => {
      s.artifacts.get(9).metadata.digest = `sha256:${hash("changed")}`;
    },
  ],
  [
    "artifact from another run",
    (s) => {
      s.artifacts.get(9).metadata.workflow_run.id = 43;
    },
  ],
  [
    "old qualification",
    (s) => {
      s.state.now = "2026-09-08T20:00:00.000Z";
    },
  ],
])
  test(`${name} prevents even the production collector`, async () => {
    const s = simulator();
    change(s);
    await assert.rejects(s.run);
    assert.equal(s.state.operations.includes("collect"), false);
    assert.equal(s.state.operations.includes("build"), false);
  });

test("approval intent predating its producer run is refused", async () => {
  const s = simulator();
  s.runs.get(42).run_started_at = EXECUTION_NOW;
  await assert.rejects(
    loadApprovalRequest({ github: s.github, ...s.approval, now: EXECUTION_NOW }),
    { code: "ARTIFACT_PRODUCER_TIME" },
  );
});

test("changed production baseline after selection blocks building", async () => {
  const s = simulator();
  s.snapshot.observed.baseline.appSha = "d".repeat(40);
  await assert.rejects(s.run, { code: "RELEASE_CONTRACT_REJECTED" });
  assert.equal(s.state.operations.includes("build"), false);
});

test("backup replacement after candidate build is refused before database mutation", async () => {
  const s = simulator();
  const original = s.services.build;
  s.services.build = async (args) => {
    const result = await original(args);
    s.snapshot.observed.backup.artifactDigest = hash("replacement");
    return result;
  };
  await assert.rejects(s.run, { code: "CURRENT_BASELINE_DRIFT" });
  assert.equal(s.state.operations.includes("database"), false);
  assert.equal(s.state.operations.includes("promote"), false);
});

test("backup becoming stale during an otherwise fresh evidence window is refused before promotion", async () => {
  const s = simulator(false);
  const created = "2026-09-07T18:01:03.000Z";
  s.bundle.record.backup.createdAt =
    s.bundle.observed.backup.createdAt =
    s.snapshot.observed.backup.createdAt =
      created;
  const original = s.services.build;
  s.services.build = async (args) => {
    const result = await original(args);
    s.state.now = "2026-09-08T18:01:04.000Z";
    return result;
  };
  await assert.rejects(s.run, { code: "RELEASE_CONTRACT_REJECTED" });
  assert.equal(s.state.operations.includes("promote"), false);
});

test("changed backup after database mutation retains the lease and refuses promotion", async () => {
  const s = simulator();
  const original = s.services.applyMigration;
  s.services.applyMigration = async (args) => {
    await original(args);
    s.snapshot.observed.backup.artifactDigest = hash("changed");
  };
  await assert.rejects(s.run, {
    code: "DELIVERY_STOPPED_LEASE_RETAINED",
    reason: "CURRENT_BASELINE_DRIFT",
  });
  assert.equal(s.state.held, true);
  assert.equal(s.state.operations.includes("promote"), false);
});

test("served failure uses the same approval and selected backup for compatible app-only rollback", async () => {
  const s = simulator();
  s.state.failServed = true;
  const result = await s.run();
  assert.equal(result.status, "ROLLED_BACK");
  assert.equal(s.state.operations.filter((op) => op === "collect").length, 1);
  assert.equal(s.state.operations.includes("rollback"), true);
  assert.equal(
    s.snapshot.observed.baseline.schemaDigest,
    s.bundle.record.context.migrationPlan.resultSchemaDigest,
  );
  assert.equal(s.state.held, false);
});

test("unknown collector exception cannot expose provider credentials or data", async () => {
  const s = simulator();
  s.services.collectProductionEligibility = async () => {
    throw Object.assign(new Error("synthetic password"), { code: "synthetic private data" });
  };
  await assert.rejects(s.run, (error) => {
    assert.equal(error.code, "PRODUCTION_EXECUTION_FAILED");
    assert.equal(JSON.stringify(error).includes("synthetic"), false);
    return true;
  });
});

test("production lease is owned by the approved production workflow, independently of the staging producer", async () => {
  const s = simulator(true, "d".repeat(40));
  assert.notEqual(s.request.workflowSha, s.bundle.record.context.workflow.sha);
  assert.equal((await s.run()).status, "DELIVERED");
});
