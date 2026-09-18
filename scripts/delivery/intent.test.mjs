// SIMULATOR ONLY: no hosted evidence is represented.
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalDigest } from "../release/contract.mjs";
import { hash, rebind } from "../release/test-fixtures.mjs";
import { assertApprovalIntent, bindProductionEligibility } from "./intent.mjs";
import {
  eligibilityFixture,
  EXECUTION_NOW,
  intentFixture,
  intentInputs,
} from "./intent-fixtures.mjs";
import { QUALIFIED_NOW } from "./qualification-fixtures.mjs";
import { approvalSummary } from "./summary.mjs";

const bind = (request, bundle) =>
  bindProductionEligibility({
    request,
    bundle,
    selectionStartedAt: QUALIFIED_NOW,
    now: EXECUTION_NOW,
  });

test("approval pins production requirements without requiring a production backup before approval", () => {
  const { request, markdown } = approvalSummary(intentInputs());
  const before = JSON.stringify(request);
  const result = assertApprovalIntent(request, { now: QUALIFIED_NOW });
  assert.equal(result.intentDigest, canonicalDigest(request));
  assert.equal(request.requirements.backup.selection, "fresh-matching-after-approval");
  assert.deepEqual(Object.keys(request.requirements.backup).sort(), [
    "lineageDigest",
    "maxAgeSeconds",
    "maxRestoreSeconds",
    "schemaDigest",
    "selection",
    "supabaseRef",
  ]);
  assert.equal(Object.hasOwn(request.expectedProduction.attestation, "backup"), false);
  assert.match(markdown, /historical expectation/);
  assert.match(markdown, /After approval/);
  assert.match(markdown, /24 hours/);
  assert.equal(JSON.stringify(request), before);
});

for (const [name, change] of [
  [
    "exact backup identity smuggled into intent",
    (r) => {
      r.requirements.backup.artifactDigest = hash("unapproved");
    },
  ],
  [
    "recovery bounds weakened",
    (r) => {
      r.requirements.backup.maxRestoreSeconds++;
    },
  ],
  [
    "backup age weakened",
    (r) => {
      r.requirements.backup.maxAgeSeconds++;
    },
  ],
  [
    "rollback weakened",
    (r) => {
      r.requirements.rollback.maxSeconds++;
    },
  ],
  [
    "historical production schema differs",
    (r) => {
      r.expectedProduction.attestation.baseline.schemaDigest = hash("changed");
    },
  ],
  [
    "historical production lineage differs",
    (r) => {
      r.expectedProduction.attestation.baseline.migrations = [];
    },
  ],
  [
    "extension set differs",
    (r) => {
      r.expectedProduction.attestation.supportedExtensionVersions.push("2.0.0");
    },
  ],
  [
    "bootstrap circularity",
    (r) => {
      r.expectedProduction.attestation.workflow.runId = r.runId;
    },
  ],
  [
    "unknown source credential",
    (r) => {
      r.secret = "synthetic";
    },
  ],
  [
    "preparation predates staging result",
    (r) => {
      r.preparedAt = "2026-09-08T17:59:00.000Z";
    },
  ],
])
  test(`intent rejects ${name}`, () => {
    const request = intentFixture();
    change(request);
    assert.throws(() => assertApprovalIntent(request, { now: QUALIFIED_NOW }));
  });

test("each fresh matching backup is eligible after approval and seals a different exact execution record", () => {
  for (const additive of [false, true]) {
    const request = intentFixture(additive);
    const a = eligibilityFixture(request);
    const b = structuredClone(a);
    b.record.backup.artifactDigest =
      b.record.backup.restore.backupArtifactDigest =
      b.observed.backup.artifactDigest =
        hash("synthetic alternative fresh backup");
    const first = bind(request, a);
    const second = bind(request, b);
    assert.equal(first.intentDigest, second.intentDigest);
    assert.notEqual(first.releaseDigest, second.releaseDigest);
    assert.notEqual(first.selectedBackupDigest, second.selectedBackupDigest);
    assert.equal(first.releaseDigest, canonicalDigest(a.record));
  }
});

for (const [name, change] of [
  [
    "wrong backup target",
    (f) => {
      f.record.backup.supabaseRef = f.observed.backup.supabaseRef = "vmznysvietfaddakkegt";
    },
  ],
  [
    "wrong backup schema",
    (f) => {
      f.record.backup.schemaDigest = f.observed.backup.schemaDigest = hash("wrong");
    },
  ],
  [
    "wrong backup lineage",
    (f) => {
      f.record.backup.lineageDigest = f.observed.backup.lineageDigest = hash("wrong");
    },
  ],
  [
    "unavailable backup",
    (f) => {
      f.record.backup.available = f.observed.backup.available = false;
    },
  ],
  [
    "stale backup",
    (f) => {
      f.record.backup.createdAt = f.observed.backup.createdAt = "2026-09-07T18:01:01.000Z";
    },
  ],
  [
    "future backup",
    (f) => {
      f.record.backup.createdAt = f.observed.backup.createdAt = "2026-09-08T18:02:00.000Z";
    },
  ],
  [
    "preapproval verification",
    (f) => {
      f.record.backup.verifiedAt = f.observed.backup.verifiedAt = "2026-09-08T18:00:59.000Z";
    },
  ],
  [
    "preapproval observation",
    (f) => {
      f.observed.observedAt = "2026-09-08T18:00:59.000Z";
    },
  ],
  [
    "restore of another backup",
    (f) => {
      f.record.backup.restore.backupArtifactDigest = hash("other");
    },
  ],
  [
    "missing Auth recovery",
    (f) => {
      f.record.backup.restore.scopes = ["database", "configuration"];
    },
  ],
  [
    "restore over four hours",
    (f) => {
      f.record.backup.restore.detectedAt = "2026-09-08T14:01:00.000Z";
    },
  ],
  [
    "weaker trusted policy",
    (f) => {
      f.policy.requiredChecks = [];
      f.record.checks = [];
    },
  ],
  [
    "changed production app",
    (f) => {
      f.record.context.baseline.appSha = f.observed.baseline.appSha = "d".repeat(40);
      rebind(f);
    },
  ],
  [
    "changed desired configuration",
    (f) => {
      f.record.context.targetConfigurationDigest = f.observed.targetConfigurationDigest =
        hash("drift");
      rebind(f);
    },
  ],
  [
    "changed old configuration",
    (f) => {
      f.record.context.baseline.configurationDigest = f.observed.baseline.configurationDigest =
        hash("drift");
      rebind(f);
    },
  ],
])
  test(`postapproval eligibility rejects ${name}`, () => {
    const request = intentFixture();
    const f = eligibilityFixture(request);
    change(f);
    assert.throws(() => bind(request, f));
  });

test("old full production G0 record cannot serve as approval intent", () => {
  assert.throws(() => assertApprovalIntent(eligibilityFixture(), { now: EXECUTION_NOW }), {
    code: "APPROVAL_INTENT_SHAPE",
  });
});
