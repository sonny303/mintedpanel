// SIMULATOR ONLY: validates envelopes, never hosted evidence or production eligibility.
import assert from "node:assert/strict";
import test from "node:test";
import { hash, fixture } from "../release/test-fixtures.mjs";
import { canonicalDigest } from "../release/contract.mjs";
import {
  assertProductionBaselineAttestation,
  assertStagingQualification,
} from "./qualification.mjs";
import {
  baselineAttestationFixture,
  qualificationFixture,
  QUALIFIED_NOW,
} from "./qualification-fixtures.mjs";

test("stage-only qualification requires a distinct delivered result for both migration modes", () => {
  for (const additive of [true, false]) {
    const value = qualificationFixture(additive);
    const result = assertStagingQualification(value, { now: QUALIFIED_NOW });
    assert.equal(result.qualificationDigest, canonicalDigest(value));
    assert.equal(value.preflight.record.context.target.supabaseRef, "vmznysvietfaddakkegt");
    assert.equal(value.preflight.record.backup.supabaseRef, "vmznysvietfaddakkegt");
    assert.equal(result.staging.deploymentId, value.result.candidate.deploymentId);
    assert.equal(Object.hasOwn(result, "productionEligibility"), false);
  }
});

for (const [name, mutate] of [
  [
    "preflight PASS offered as delivered",
    (v) => {
      v.result.status = "PASS";
    },
  ],
  [
    "production eligibility offered as stage preflight",
    (v) => {
      Object.assign(v.preflight, fixture());
    },
  ],
  [
    "wrong candidate target",
    (v) => {
      v.result.candidate.target.supabaseRef = "fkvuhfsqcmujywzgczmc";
    },
  ],
  [
    "wrong candidate source",
    (v) => {
      v.result.candidate.sourceSha = "f".repeat(40);
    },
  ],
  [
    "wrong actual schema",
    (v) => {
      v.result.snapshot.observed.baseline.schemaDigest = hash("wrong schema");
    },
  ],
  [
    "wrong actual lineage",
    (v) => {
      v.result.snapshot.observed.baseline.migrations = [];
    },
  ],
  [
    "wrong alias",
    (v) => {
      v.result.snapshot.aliases["staging.mintedpanel.com"] = "dpl_other";
    },
  ],
  [
    "wrong receipt binding",
    (v) => {
      v.result.receipt.bindingDigest = hash("different snapshot");
    },
  ],
  [
    "failed served receipt",
    (v) => {
      v.result.receipt.status = "FAIL";
    },
  ],
  [
    "future result",
    (v) => {
      v.result.recordedAt = "2026-09-08T19:00:00.000Z";
    },
  ],
  [
    "unknown secret field",
    (v) => {
      v.result.sourceSecret = "synthetic";
    },
  ],
  [
    "wrong trusted workflow",
    (v) => {
      v.preflight.record.context.workflow.path = ".github/workflows/other.yml";
    },
  ],
]) {
  test(`staging qualification rejects ${name}`, () => {
    const value = qualificationFixture();
    mutate(value);
    assert.throws(() => assertStagingQualification(value, { now: QUALIFIED_NOW }));
  });
}

test("historical preflight timestamps are preserved and cannot manufacture current evidence freshness", () => {
  const value = qualificationFixture();
  const before = JSON.stringify(value);
  assertStagingQualification(value, { now: QUALIFIED_NOW });
  assert.equal(JSON.stringify(value), before);
  assert.throws(() => assertStagingQualification(value, { now: "2026-09-08T20:00:00.000Z" }), {
    code: "STAGING_QUALIFICATION_AGE",
  });
});

test("delivered observations and receipts cannot predate preflight validation", () => {
  const value = qualificationFixture();
  value.preflight.validatedAt = "2026-09-08T18:00:25.000Z";
  value.result.snapshot.observed.staging.verifiedAt = "2026-09-08T18:00:05.000Z";
  value.result.snapshot.observed.observedAt = "2026-09-08T18:00:10.000Z";
  value.result.receipt.finishedAt = "2026-09-08T18:00:12.000Z";
  value.result.recordedAt = "2026-09-08T18:00:30.000Z";
  value.result.receipt.bindingDigest = canonicalDigest({
    releaseDigest: canonicalDigest(value.preflight.record),
    phase: "served-postconditions",
    candidate: value.result.candidate,
    snapshot: value.result.snapshot,
  });
  assert.throws(() => assertStagingQualification(value, { now: QUALIFIED_NOW }), {
    code: "STAGING_RESULT_BINDING",
  });
});

test("production baseline attestation stays historical even when older than a snapshot window", () => {
  const value = baselineAttestationFixture();
  const result = assertProductionBaselineAttestation(value, { now: "2026-09-10T18:00:00.000Z" });
  assert.equal(result.freshness, "HISTORICAL_ONLY");
  assert.equal(result.backupPolicy, "UNRESOLVED");
  assert.equal(result.recordedAt, value.recordedAt);
});

for (const [name, mutate] of [
  [
    "staging target",
    (v) => {
      v.target.supabaseRef = "vmznysvietfaddakkegt";
    },
  ],
  [
    "out-of-order lineage",
    (v) => {
      v.baseline.migrations.push(v.baseline.migrations[0]);
    },
  ],
  [
    "wrong producer",
    (v) => {
      v.workflow.path = ".github/workflows/staging-delivery.yml";
    },
  ],
  [
    "producer rerun",
    (v) => {
      v.workflow.runAttempt = 2;
    },
  ],
  [
    "duplicate installed version",
    (v) => {
      v.supportedExtensionVersions.push(v.supportedExtensionVersions[0]);
    },
  ],
  [
    "unreviewed backup policy",
    (v) => {
      v.backup = { artifactDigest: hash("unapproved policy") };
    },
  ],
  [
    "future observation",
    (v) => {
      v.recordedAt = "2026-09-09T18:00:00.000Z";
    },
  ],
]) {
  test(`baseline attestation rejects ${name}`, () => {
    const value = baselineAttestationFixture();
    mutate(value);
    assert.throws(() => assertProductionBaselineAttestation(value, { now: QUALIFIED_NOW }));
  });
}
