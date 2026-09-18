import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalDigest, validateRelease } from "./contract.mjs";
import { fixture, hash, rebind, NOW } from "./test-fixtures.mjs";

test("valid synthetic release contracts pass for both explicit targets and DB modes", () => {
  for (const target of ["staging", "production"]) {
    for (const additive of [false, true]) {
      const value = fixture(target, additive);
      const result = validateRelease(value);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.digest, canonicalDigest(value.record));
    }
  }
});

test("staging preflight observes the previous deployment before an additive migration", () => {
  const value = fixture("staging", true);
  assert.equal(value.record.context.staging.schemaDigest, value.observed.baseline.schemaDigest);
  assert.notEqual(
    value.record.context.staging.schemaDigest,
    value.record.context.migrationPlan.resultSchemaDigest,
  );
  assert.equal(validateRelease(value).ok, true);
  value.record.context.staging.schemaDigest = value.record.context.migrationPlan.resultSchemaDigest;
  value.observed.staging.schemaDigest = value.record.context.staging.schemaDigest;
  const result = validateRelease(rebind(value));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "STAGING_BASELINE"));
});

test("each explicit target accepts only its pre-mutation phase", () => {
  for (const target of ["staging", "production"]) {
    const value = fixture(target);
    value.record.context.phase =
      target === "staging" ? "production-eligibility" : "staging-preflight";
    const result = validateRelease(rebind(value));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === "PHASE_MISMATCH"));
  }
});

const rejects = [
  [
    "implicit target",
    (v) => {
      delete v.expectedTarget;
    },
    "EXPECTED_TARGET",
  ],
  [
    "wrong target",
    (v) => {
      v.expectedTarget = "staging";
    },
    "TARGET_MISMATCH",
  ],
  [
    "wrong team",
    (v) => {
      v.record.context.target.vercelTeamId = "team_other";
    },
    "TARGET_MISMATCH",
  ],
  [
    "wrong project",
    (v) => {
      v.record.context.target.vercelProjectId = "prj_other";
    },
    "TARGET_MISMATCH",
  ],
  [
    "wrong DB",
    (v) => {
      v.record.context.target.supabaseRef = "x".repeat(20);
    },
    "TARGET_MISMATCH",
  ],
  [
    "wrong branch",
    (v) => {
      v.record.context.staging.gitBranch = "main";
    },
    "STAGING_PROVENANCE",
  ],
  [
    "changed source",
    (v) => {
      v.record.context.source.sha = "d".repeat(40);
    },
    "SOURCE_MISMATCH",
  ],
  [
    "changed workflow run",
    (v) => {
      v.record.context.workflow.runAttempt++;
    },
    "WORKFLOW_MISMATCH",
  ],
  [
    "changed staging source",
    (v) => {
      v.record.context.staging.sourceSha = "d".repeat(40);
    },
    "STAGING_PROVENANCE",
  ],
  [
    "production drift",
    (v) => {
      v.observed.baseline.deploymentId = "dpl_newer";
    },
    "BASELINE_DRIFT",
  ],
  [
    "configuration drift",
    (v) => {
      v.observed.targetConfigurationDigest = hash("different");
    },
    "CONFIGURATION_DRIFT",
  ],
  [
    "staging drift",
    (v) => {
      v.observed.staging.deploymentId = "dpl_newer_stage";
    },
    "STAGING_DRIFT",
  ],
  [
    "staging backup for production",
    (v) => {
      v.record.backup.supabaseRef = "vmznysvietfaddakkegt";
    },
    "BACKUP_TARGET",
  ],
  [
    "wrong backup schema",
    (v) => {
      v.record.backup.schemaDigest = hash("other");
    },
    "BACKUP_BASELINE",
  ],
  [
    "wrong backup lineage",
    (v) => {
      v.record.backup.lineageDigest = hash("other");
    },
    "BACKUP_BASELINE",
  ],
  [
    "stale backup",
    (v) => {
      v.record.backup.createdAt = "2026-09-07T17:59:59.000Z";
    },
    "BACKUP_AGE",
  ],
  [
    "future backup",
    (v) => {
      v.record.backup.createdAt = "2026-09-08T18:00:01.000Z";
    },
    "BACKUP_AGE",
  ],
  [
    "unavailable backup",
    (v) => {
      v.record.backup.available = false;
    },
    "BACKUP_UNAVAILABLE",
  ],
  [
    "backup availability changed",
    (v) => {
      v.observed.backup.available = false;
    },
    "BACKUP_DRIFT",
  ],
  [
    "restoration from another backup",
    (v) => {
      v.record.backup.restore.backupArtifactDigest = hash("other backup");
    },
    "RESTORE_BACKUP",
  ],
  [
    "missing check",
    (v) => {
      v.record.checks.pop();
    },
    "CHECK_SET",
  ],
  [
    "duplicate check",
    (v) => {
      v.record.checks.push(v.record.checks[0]);
    },
    "CHECK_SET",
  ],
  [
    "failed check",
    (v) => {
      v.record.checks[0].status = "FAIL";
    },
    "EVIDENCE_NOT_PASS",
  ],
  [
    "skipped check",
    (v) => {
      v.record.checks[0].status = "SKIP";
    },
    "EVIDENCE_NOT_PASS",
  ],
  [
    "stale check",
    (v) => {
      v.record.checks[0].finishedAt = "2026-09-08T16:00:00.000Z";
    },
    "EVIDENCE_AGE",
  ],
  [
    "future check",
    (v) => {
      v.record.checks[0].finishedAt = "2026-09-08T18:00:01.000Z";
    },
    "EVIDENCE_AGE",
  ],
  [
    "mismatched evidence",
    (v) => {
      v.record.checks[0].contextDigest = hash("other context");
    },
    "EVIDENCE_BINDING",
  ],
  [
    "missing no-op rehearsal",
    (v) => {
      delete v.record.rehearsal;
    },
    "SCHEMA",
  ],
  [
    "failed no-op rehearsal",
    (v) => {
      v.record.rehearsal.status = "FAIL";
    },
    "EVIDENCE_NOT_PASS",
  ],
  [
    "incompatible previous app",
    (v) => {
      v.record.compatibility.previous.status = "FAIL";
    },
    "EVIDENCE_NOT_PASS",
  ],
  [
    "incompatible candidate",
    (v) => {
      v.record.compatibility.candidate.status = "FAIL";
    },
    "EVIDENCE_NOT_PASS",
  ],
  [
    "undeclared extension change",
    (v) => {
      v.record.context.supportedExtensionVersions.push("0.2.0");
    },
    "EXTENSION_SET",
  ],
  [
    "installed extension drift",
    (v) => {
      v.observed.supportedExtensionVersions.push("0.2.0");
    },
    "EXTENSION_SET",
  ],
  [
    "slow app rollback",
    (v) => {
      v.record.rollback.detectedAt = "2026-09-08T17:53:59.000Z";
    },
    "ROLLBACK_DURATION",
  ],
  [
    "automatic database rollback",
    (v) => {
      v.record.rollback.mode = "database-undo";
    },
    "SCHEMA",
  ],
  [
    "slow restoration",
    (v) => {
      v.record.backup.restore.detectedAt = "2026-09-08T13:58:59.000Z";
    },
    "RESTORE_DURATION",
  ],
  [
    "incomplete restoration",
    (v) => {
      v.record.backup.restore.scopes.pop();
    },
    "RESTORE_SCOPE",
  ],
  [
    "inverted restoration time",
    (v) => {
      v.record.backup.restore.startedAt = NOW;
    },
    "RESTORE_DURATION",
  ],
  [
    "stale observed state",
    (v) => {
      v.observed.observedAt = "2026-09-08T17:57:59.000Z";
    },
    "SNAPSHOT_AGE",
  ],
  [
    "future observed state",
    (v) => {
      v.observed.observedAt = "2026-09-08T18:00:01.000Z";
    },
    "SNAPSHOT_AGE",
  ],
  [
    "empty trusted required set",
    (v) => {
      v.policy.requiredChecks = [];
    },
    "SCHEMA",
  ],
  [
    "unknown secret field",
    (v) => {
      v.record.SUPABASE_SERVICE_ROLE_KEY = "private-sentinel";
    },
    "SCHEMA",
  ],
  [
    "invalid timestamp",
    (v) => {
      v.record.createdAt = "2026-02-30T18:00:00.000Z";
    },
    "SCHEMA",
  ],
  [
    "changed approval digest",
    (v) => {
      v.expectedDigest = "0".repeat(64);
    },
    "DIGEST_MISMATCH",
  ],
];
for (const [name, mutate, code] of rejects) {
  test(`rejects ${name}`, () => {
    const value = fixture();
    mutate(value);
    const result = validateRelease(value);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((error) => error.code === code),
      JSON.stringify(result),
    );
    assert.ok(!JSON.stringify(result).includes("private-sentinel"));
    assert.ok(!("digest" in result));
  });
}

test("migration checks cannot be bypassed by rebinding evidence or declaring no-op", () => {
  for (const [name, mutate, code] of [
    [
      "duplicate id",
      (v) => {
        v.record.context.migrationPlan.inventory.push(v.record.context.migrationPlan.inventory[0]);
      },
      "MIGRATION_DUPLICATE",
    ],
    [
      "changed history",
      (v) => {
        v.record.context.migrationPlan.inventory[0].sha256 = hash("edited SQL");
      },
      "MIGRATION_HISTORY",
    ],
    [
      "deleted history",
      (v) => {
        v.record.context.migrationPlan.inventory = [];
      },
      "MIGRATION_HISTORY",
    ],
    [
      "no-op schema change",
      (v) => {
        v.record.context.migrationPlan.resultSchemaDigest = hash("different schema");
      },
      "MIGRATION_MODE",
    ],
    [
      "no-op added migration",
      (v) => {
        v.record.context.migrationPlan.inventory.push({
          id: "20260902000000",
          path: "supabase/migrations/20260902000000_add.sql",
          sha256: hash("add"),
        });
      },
      "MIGRATION_MODE",
    ],
    [
      "wrong baseline",
      (v) => {
        v.record.context.migrationPlan.baselineSchemaDigest = hash("different");
      },
      "MIGRATION_BASELINE",
    ],
    [
      "unapproved plan",
      (v) => {
        v.policy.migrationPlanDigest = hash("other approved plan");
      },
      "PLAN_MISMATCH",
    ],
  ]) {
    const value = fixture();
    mutate(value);
    const result = validateRelease(rebind(value));
    assert.equal(result.ok, false, name);
    assert.ok(
      result.errors.some((error) => error.code === code),
      `${name}: ${JSON.stringify(result)}`,
    );
  }
});

test("approval hash is canonical and covers evidence and source", () => {
  assert.equal(canonicalDigest({ b: 2, a: 1 }), hash('{"a":1,"b":2}'));
  const value = fixture();
  const initial = validateRelease(value).digest;
  value.record.checks[0].artifactDigest = hash("different evidence");
  assert.notEqual(validateRelease(value).digest, initial);
  value.expectedDigest = initial;
  assert.equal(validateRelease(value).ok, false);
});

test("recovery deadlines include detection and accept exact limits", () => {
  const value = fixture();
  value.record.backup.restore.detectedAt = "2026-09-08T13:59:00.000Z";
  value.record.rollback.detectedAt = "2026-09-08T17:54:00.000Z";
  assert.equal(validateRelease(value).ok, true);
});
