// SIMULATOR ONLY: no database, Vercel deployment or GitHub approval is represented.
import assert from "node:assert/strict";
import test from "node:test";
import { fixture, hash, NOW } from "../release/test-fixtures.mjs";
import { canonicalDigest } from "../release/contract.mjs";
import { DeliveryError, PRODUCTION_ALIASES, STAGING_ALIASES } from "./boundary.mjs";
import { executeDelivery, receiptBinding } from "./controller.mjs";

function simulator(target = "production", additive = true) {
  const fixtureValue = fixture(target, additive);
  const { record, policy, observed } = fixtureValue;
  const bundle = { record, policy, releaseDigest: canonicalDigest(record) };
  const aliases = target === "production" ? PRODUCTION_ALIASES : STAGING_ALIASES;
  const state = {
    snapshot: {
      observed: structuredClone(observed),
      aliases: Object.fromEntries(
        aliases.map((name) => [name, record.context.baseline.deploymentId]),
      ),
    },
    operations: [],
    held: false,
    approved: true,
    dbCompatible: true,
    extensionCompatible: true,
    failedPhases: [],
    now: NOW,
  };
  const candidate = {
    deploymentId: "dpl_simulated_candidate",
    sourceSha: record.context.source.sha,
    target: record.context.target,
    configurationDigest: record.context.targetConfigurationDigest,
    releaseDigest: bundle.releaseDigest,
    readyState: "READY",
    domainsWithheld: true,
  };
  const serve = (previous = false) => {
    Object.assign(state.snapshot.observed.baseline, {
      deploymentId: previous ? record.context.baseline.deploymentId : candidate.deploymentId,
      appSha: previous ? record.context.baseline.appSha : record.context.source.sha,
      configurationDigest: previous
        ? record.context.baseline.configurationDigest
        : record.context.targetConfigurationDigest,
    });
  };
  const write = (name) => {
    assert.equal(state.held, true, `${name} must hold the shared lease`);
    state.operations.push(name);
  };
  const services = {
    async assertReady() {
      state.operations.push("ready");
    },
    async verifyAuthority() {
      if (!state.approved) throw new DeliveryError("SIMULATED_DENIAL");
      state.operations.push("authority");
    },
    async snapshot() {
      state.operations.push("snapshot");
      const value = structuredClone(state.snapshot);
      value.observed.observedAt = state.now;
      return value;
    },
    async acquireLease() {
      assert.equal(state.held, false);
      state.held = true;
      state.operations.push("acquire");
      return {
        async assertOwned() {
          assert.equal(state.held, true);
        },
        async release() {
          assert.equal(state.held, true);
          state.held = false;
          state.operations.push("release");
        },
      };
    },
    async fastForward() {
      write("fast-forward");
    },
    async build(options) {
      if (target === "production") {
        assert.deepEqual(options.argv, ["deploy", "--prod", "--skip-domain"]);
        assert.equal(state.held, false);
      } else {
        assert.equal(options.gitBranch, "staging");
        assert.equal(options.vercelEnvironment, "preview");
        assert.equal(state.held, true);
      }
      assert.equal(options.withholdDomains, true);
      state.operations.push("build");
      return structuredClone(candidate);
    },
    async applyMigration({ plan, planDigest }) {
      write("database");
      assert.equal(planDigest, canonicalDigest(record.context.migrationPlan));
      Object.assign(state.snapshot.observed.baseline, {
        schemaDigest: plan.resultSchemaDigest,
        migrations: structuredClone(plan.inventory),
      });
    },
    async assignAlias({ alias, deploymentId }) {
      write(`alias:${alias}`);
      state.snapshot.aliases[alias] = deploymentId;
      if (alias === "staging.mintedpanel.com") {
        serve();
        Object.assign(state.snapshot.observed.staging, {
          sourceSha: record.context.source.sha,
          workflowSha: record.context.workflow.sha,
          runId: record.context.workflow.runId,
          runAttempt: record.context.workflow.runAttempt,
          deploymentId,
          configurationDigest: record.context.targetConfigurationDigest,
          schemaDigest: record.context.migrationPlan.resultSchemaDigest,
          migrationPlanDigest: policy.migrationPlanDigest,
          verifiedAt: state.now,
        });
      }
    },
    async promote({ deploymentId }) {
      write("promote");
      assert.equal(deploymentId, candidate.deploymentId);
      serve();
      for (const name of aliases) state.snapshot.aliases[name] = deploymentId;
    },
    async rollbackApp({ deploymentId }) {
      write("rollback");
      assert.equal(deploymentId, record.context.baseline.deploymentId);
      serve(true);
      for (const name of aliases) state.snapshot.aliases[name] = deploymentId;
    },
    async check({ phase, candidate: built, snapshot, releaseDigest }) {
      state.operations.push(`check:${phase}`);
      return {
        status: state.failedPhases.includes(phase) ? "FAIL" : "PASS",
        bindingDigest: receiptBinding({ releaseDigest, phase, candidate: built, snapshot }),
        artifactDigest: hash("simulator receipt"),
        finishedAt: state.now,
        databaseCompatible: state.dbCompatible,
        extensionsCompatible: state.extensionCompatible,
        supportedExtensionVersions: record.context.supportedExtensionVersions,
      };
    },
  };
  return {
    state,
    services,
    bundle,
    run: () => executeDelivery({ target, bundle, services, clock: () => state.now }),
  };
}

test("simulator: approval precedes production build; lease spans mutation, checks and completion", async () => {
  const s = simulator();
  const result = await s.run();
  assert.equal(result.status, "DELIVERED");
  assert.equal(s.state.held, false);
  const steps = s.state.operations;
  assert.ok(steps.indexOf("authority") < steps.indexOf("build"));
  assert.ok(steps.indexOf("build") < steps.indexOf("acquire"));
  assert.ok(steps.indexOf("database") < steps.indexOf("check:database-postconditions"));
  assert.ok(
    steps.indexOf("check:post-application-candidate-and-installed-extensions") <
      steps.indexOf("promote"),
  );
  assert.ok(steps.indexOf("promote") < steps.indexOf("check:served-postconditions"));
  assert.equal(steps.at(-1), "release");
});

test("simulator: staging checks precede both fixed aliases and require ancestry update under lease", async () => {
  const s = simulator("staging");
  assert.equal((await s.run()).status, "DELIVERED");
  const steps = s.state.operations;
  assert.ok(steps.indexOf("acquire") < steps.indexOf("fast-forward"));
  assert.ok(steps.indexOf("database") < steps.indexOf("build"));
  for (const alias of STAGING_ALIASES)
    assert.ok(
      steps.indexOf("check:post-application-candidate-and-installed-extensions") <
        steps.indexOf(`alias:${alias}`),
    );
  assert.equal(steps.includes("promote"), false);
});

test("simulator: denied approval causes no build, lease or mutation", async () => {
  const s = simulator();
  s.state.approved = false;
  await assert.rejects(s.run, { code: "SIMULATED_DENIAL" });
  assert.deepEqual(s.state.operations, ["ready"]);
});

test("simulator: no-change database plan never invokes the migration executor", async () => {
  const s = simulator("production", false);
  await s.run();
  assert.equal(s.state.operations.includes("database"), false);
});

for (const field of [
  "targetConfigurationDigest",
  "supportedExtensionVersions",
  "backup",
  "baseline",
]) {
  test(`simulator: ${field} drift before production build denies all mutations`, async () => {
    const s = simulator();
    if (field === "targetConfigurationDigest") s.state.snapshot.observed[field] = hash("drift");
    if (field === "supportedExtensionVersions") s.state.snapshot.observed[field] = ["99.0.0"];
    if (field === "backup") s.state.snapshot.observed.backup.available = false;
    if (field === "baseline") s.state.snapshot.observed.baseline.schemaDigest = hash("drift");
    await assert.rejects(s.run, { code: "RELEASE_CONTRACT_REJECTED" });
    assert.equal(s.state.operations.includes("build"), false);
    assert.equal(s.state.held, false);
  });
}

test("simulator: changed production baseline during candidate build stops before DB mutation", async () => {
  const s = simulator();
  const build = s.services.build;
  s.services.build = async (options) => {
    const result = await build(options);
    s.state.snapshot.observed.baseline.deploymentId = "dpl_newer_release";
    return result;
  };
  await assert.rejects(s.run, { code: "CURRENT_BASELINE_DRIFT" });
  assert.equal(s.state.operations.includes("database"), false);
});

for (const phase of [
  "database-postconditions",
  "post-application-candidate-and-installed-extensions",
]) {
  test(`simulator: failing ${phase} preserves prior app and retains database state/lease`, async () => {
    const s = simulator();
    s.state.failedPhases = [phase];
    await assert.rejects(s.run, { code: "DELIVERY_STOPPED_LEASE_RETAINED" });
    assert.equal(s.state.operations.includes("promote"), false);
    assert.equal(s.state.operations.includes("rollback"), false);
    assert.equal(s.state.held, true);
    assert.equal(
      s.state.snapshot.observed.baseline.schemaDigest,
      s.bundle.record.context.migrationPlan.resultSchemaDigest,
    );
  });
}

test("simulator: post-failure app rollback retains the additive schema and holds one lease", async () => {
  const s = simulator();
  s.state.failedPhases = ["served-postconditions"];
  assert.equal((await s.run()).status, "ROLLED_BACK");
  assert.equal(
    s.state.snapshot.observed.baseline.schemaDigest,
    s.bundle.record.context.migrationPlan.resultSchemaDigest,
  );
  assert.equal(s.state.operations.filter((item) => item === "acquire").length, 1);
  assert.equal(s.state.held, false);
});

for (const compatibility of ["dbCompatible", "extensionCompatible"]) {
  test(`simulator: rollback denied when ${compatibility} is false`, async () => {
    const s = simulator();
    s.state.failedPhases = ["served-postconditions"];
    s.state[compatibility] = false;
    await assert.rejects(s.run, {
      code: "DELIVERY_STOPPED_LEASE_RETAINED",
      reason: "ROLLBACK_INCOMPATIBLE",
    });
    assert.equal(s.state.operations.includes("rollback"), false);
    assert.equal(s.state.held, true);
  });
}

test("simulator: an uncertain migration response keeps lease; no automatic database undo exists", async () => {
  const s = simulator();
  const apply = s.services.applyMigration;
  s.services.applyMigration = async (options) => {
    await apply(options);
    throw new Error("simulated network loss");
  };
  await assert.rejects(s.run, {
    code: "DELIVERY_STOPPED_LEASE_RETAINED",
    reason: "PROVIDER_OPERATION_UNCERTAIN",
  });
  assert.equal(s.state.held, true);
  assert.equal(s.state.operations.includes("promote"), false);
});

for (const [name, failure] of [
  [
    "error with a private code",
    Object.assign(new Error("SYNTHETIC_PRIVATE_MESSAGE"), { code: "SYNTHETIC_PRIVATE_CODE" }),
  ],
  ["object with a private code", { code: { privateValue: "SYNTHETIC_PRIVATE_CODE" } }],
  ["null exception", null],
]) {
  test(`simulator: pre-mutation ${name} cannot become a public delivery code`, async () => {
    const s = simulator("staging", false);
    s.services.acquireLease = async () => {
      throw failure;
    };
    await assert.rejects(s.run, (error) => {
      assert.ok(error instanceof DeliveryError);
      assert.equal(error.code, "DELIVERY_FAILED");
      assert.equal(error.message, "DELIVERY_FAILED");
      assert.equal(error.reason, "PROVIDER_OPERATION_UNCERTAIN");
      assert.equal(JSON.stringify(error).includes("SYNTHETIC_PRIVATE"), false);
      return true;
    });
    assert.equal(s.state.held, false);
    assert.equal(s.state.operations.includes("build"), false);
  });
}

test("simulator: a known pre-mutation delivery failure preserves its safe code", async () => {
  const s = simulator("staging", false);
  s.services.acquireLease = async () => {
    throw new DeliveryError("LEASE_CONFLICT");
  };
  await assert.rejects(s.run, { code: "LEASE_CONFLICT", reason: "LEASE_CONFLICT" });
});

test("simulator: stale original snapshot is never refreshed after an additive migration", async () => {
  const s = simulator();
  const apply = s.services.applyMigration;
  s.services.applyMigration = async (options) => {
    await apply(options);
    s.state.now = new Date(Date.parse(NOW) + 121000).toISOString();
  };
  await assert.rejects(s.run, {
    code: "DELIVERY_STOPPED_LEASE_RETAINED",
    reason: "RELEASE_CONTRACT_REJECTED",
  });
  assert.equal(s.state.operations.includes("promote"), false);
});

test("simulator: a long withheld production build recollects the actual unchanged baseline before mutation", async () => {
  const s = simulator();
  const build = s.services.build;
  s.services.build = async (options) => {
    const candidate = await build(options);
    s.state.now = new Date(Date.parse(NOW) + 180000).toISOString();
    return candidate;
  };
  assert.equal((await s.run()).status, "DELIVERED");
});

test("simulator: wrong result migration ledger is detected after application and before promotion", async () => {
  const s = simulator();
  const apply = s.services.applyMigration;
  s.services.applyMigration = async (options) => {
    await apply(options);
    s.state.snapshot.observed.baseline.migrations = [];
  };
  await assert.rejects(s.run, {
    code: "DELIVERY_STOPPED_LEASE_RETAINED",
    reason: "CURRENT_BASELINE_DRIFT",
  });
  assert.equal(s.state.operations.includes("promote"), false);
});

test("simulator: phase receipt for a different snapshot is rejected", async () => {
  const s = simulator();
  const check = s.services.check;
  s.services.check = async (options) => ({
    ...(await check(options)),
    bindingDigest: hash("different snapshot"),
  });
  await assert.rejects(s.run, { code: "PHASE_CHECK_FAILED" });
  assert.equal(s.state.operations.includes("acquire"), false);
});

test("simulator: a missing served alias cannot silently narrow the promotion boundary", async () => {
  const s = simulator();
  delete s.state.snapshot.aliases[PRODUCTION_ALIASES[0]];
  await assert.rejects(s.run, { code: "SERVED_ALIAS_BASELINE" });
});
