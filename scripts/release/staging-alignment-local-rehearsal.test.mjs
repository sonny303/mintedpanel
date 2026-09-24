import assert from "node:assert/strict";
import test from "node:test";
import {
  ALIGNMENT_STATUS,
  BASELINE_TARGET,
  CAPTURE_DIGEST,
  PACKET_FILES,
  REHEARSAL_TARGET,
  bindBaselineQualification,
  buildSessionSettings,
  comparePreservedState,
  digest,
  loadAlignmentPacket,
  parseCommittedSlices,
  runLocalAlignmentRehearsal,
  validateAlignmentManifest,
  validateRehearsalIdentity,
  validateBaselineIdentity,
  verifyResumeReceipt,
} from "./staging-alignment-local-rehearsal.mjs";

const preserved = {
  tables: {
    "public.provider_facility_assignments": ["a"],
    "public.case_generation_runs": ["b"],
    "public.case_generation_run_rows": ["c"],
    "public.payer_pipeline_history": ["d"],
    "public.import_runs": ["e"],
    "public.party_capture_links": ["f"],
    "public.audit_log": ["g"],
  },
};

test("the packet is bound to the independent baseline receipt while apply remains blocked", async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const root = resolve(new URL("../..", import.meta.url).pathname);
  for (const file of [
    "staging-alignment-slices-1-4-manifest.json",
    "staging-alignment-slice-5-manifest.json",
  ]) {
    const manifest = JSON.parse(
      await readFile(resolve(root, "docs/ops/release-packets/2026-09-22", file), "utf8"),
    );
    const result = validateAlignmentManifest(manifest);
    assert.equal(result.binding.status, "BOUND");
    assert.equal(
      result.binding.baselineQualificationDigest,
      "b4f73c3f4a37d349b4dc886b506e5f0520fa052dcf52ffaf5d80de63a5cfc5df",
    );
    assert.equal(manifest.targetBinding.local.currentReceipt.eligibleForApply, false);
    assert.equal(manifest.targetBinding.local.currentReceipt.receiptId, "b4f73c3f4a37d349");
    assert.equal(
      manifest.targetBinding.local.requiredPhysicalSystemIdentifier,
      REHEARSAL_TARGET.systemIdentifier,
    );
    assert.deepEqual(
      manifest.targetBinding.local.applicationBinding.baselineTarget,
      BASELINE_TARGET,
    );
  }
});

test("local session settings bind the reviewed local target and never the hosted cluster", () => {
  const sql = buildSessionSettings("0123456789abcdef");
  assert.match(sql, /qualified_local_restore/);
  assert.match(sql, new RegExp(ALIGNMENT_STATUS));
  assert.match(sql, new RegExp(CAPTURE_DIGEST));
  assert.match(sql, new RegExp(REHEARSAL_TARGET.systemIdentifier));
  assert.doesNotMatch(sql, /7662742571317219726/);
  assert.doesNotMatch(sql, /fkvuhfsqcmujywzgczmc/);
});

test("packet loader verifies the five ordered SQL hashes and retains apply block", async () => {
  const packet = await loadAlignmentPacket();
  assert.equal(packet.ready, true);
  assert.deepEqual(
    packet.files.map(({ file }) => file),
    PACKET_FILES,
  );
  assert.equal(packet.manifestDigests.length, 2);
});

test("slice completion is fixed to reviewed order", () => {
  const output = PACKET_FILES.map(
    (_, index) => `MINTED_ALIGNMENT_SLICE_COMMITTED:${index + 1}`,
  ).join("\n");
  assert.deepEqual(parseCommittedSlices(output), [1, 2, 3, 4, 5]);
  assert.throws(
    () => parseCommittedSlices(`${output}\nMINTED_ALIGNMENT_SLICE_COMMITTED:3`),
    /ALIGNMENT_SLICE_ORDER_REJECTED/,
  );
});

test("preservation compares only the packet's fully untouched relations", () => {
  assert.match(comparePreservedState(preserved, structuredClone(preserved)), /^[a-f0-9]{64}$/);
  const changed = structuredClone(preserved);
  changed.tables["public.audit_log"] = ["changed"];
  assert.throws(() => comparePreservedState(preserved, changed), /ALIGNMENT_PRESERVATION_FAILED/);
});

test("resume requires exact receipt chain, target, SQL hashes, and live poststate", () => {
  const expected = {
    manifestDigests: ["a".repeat(64), "b".repeat(64)],
    qualificationDigest: "c".repeat(64),
    receiptId: "0123456789abcdef",
    target: REHEARSAL_TARGET,
    baselineTarget: { ...BASELINE_TARGET, containerId: "1".repeat(64) },
    sqlDigests: PACKET_FILES.map((_, index) => String(index).repeat(64)),
  };
  const receipt = {
    status: "LOCAL_ALIGNMENT_REHEARSED_ONLY",
    releaseAdmission: "BLOCKED",
    manifestDigests: expected.manifestDigests,
    qualificationDigest: expected.qualificationDigest,
    receiptId: expected.receiptId,
    captureDigest: CAPTURE_DIGEST,
    target: expected.target,
    baselineTarget: expected.baselineTarget,
    sqlDigests: expected.sqlDigests,
    slices: expected.sqlDigests.map((sqlSha256, index) => ({
      index: index + 1,
      status: "COMMITTED",
      sqlSha256,
    })),
    poststateDigest: digest(preserved),
    version: 1,
    eligibleForApply: false,
  };
  assert.equal(verifyResumeReceipt(receipt, expected, preserved).status, "SKIPPED");
  assert.throws(
    () =>
      verifyResumeReceipt(
        { ...receipt, target: { ...receipt.target, containerId: "0".repeat(64) } },
        expected,
        preserved,
      ),
    /ALIGNMENT_RESUME_BLOCKED/,
  );
  assert.throws(
    () =>
      verifyResumeReceipt(receipt, expected, {
        ...preserved,
        tables: { ...preserved.tables, "public.audit_log": ["drift"] },
      }),
    /ALIGNMENT_RESUME_BLOCKED/,
  );
});

test("application identity must be the restored database and rehearsal system", () => {
  assert.deepEqual(
    validateRehearsalIdentity(
      { database: "minted_recovery", systemIdentifier: REHEARSAL_TARGET.systemIdentifier },
      { ...REHEARSAL_TARGET },
    ),
    { database: "minted_recovery", systemIdentifier: REHEARSAL_TARGET.systemIdentifier },
  );
  assert.throws(
    () =>
      validateRehearsalIdentity(
        { database: "postgres", systemIdentifier: REHEARSAL_TARGET.systemIdentifier },
        REHEARSAL_TARGET,
      ),
    /ALIGNMENT_LOCAL_DATABASE_REJECTED/,
  );
  assert.deepEqual(
    validateBaselineIdentity(
      { database: "minted_recovery", systemIdentifier: BASELINE_TARGET.systemIdentifier },
      { ...BASELINE_TARGET, containerId: "1".repeat(64) },
    ),
    { database: "minted_recovery", systemIdentifier: BASELINE_TARGET.systemIdentifier },
  );
});

test("a bound manifest rejects a second qualification binding", async () => {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const root = resolve(new URL("../..", import.meta.url).pathname);
  const manifest = JSON.parse(
    await readFile(
      resolve(root, "docs/ops/release-packets/2026-09-22/staging-alignment-slice-5-manifest.json"),
      "utf8",
    ),
  );
  const receipt = {
    status: ALIGNMENT_STATUS,
    releaseAdmission: "BLOCKED",
    receiptId: "fedcba9876543210",
    captureDigest: CAPTURE_DIGEST,
    binding: { captureDigest: CAPTURE_DIGEST },
    clones: {
      untouchedBaseline: {
        cloneId: BASELINE_TARGET.runId,
        status: "UNTOUCHED_BASELINE_VERIFIED",
        captureDigest: CAPTURE_DIGEST,
      },
      rehearsal: { cloneId: REHEARSAL_TARGET.runId, status: "REHEARSAL_VERIFIED" },
      authRest: { cloneId: "d3b5b144f3849391", status: "DESTROYED" },
    },
    targets: {
      baseline: { ...BASELINE_TARGET, targetDigest: "a".repeat(64) },
      rehearsal: { ...REHEARSAL_TARGET, targetDigest: "b".repeat(64) },
    },
  };
  assert.throws(
    () => bindBaselineQualification(manifest, receipt),
    /ALIGNMENT_BASELINE_ALREADY_BOUND/,
  );
});

test("local rehearsal executes five slices once and resumes only from the committed receipt and live poststate", async () => {
  const { copyFile, mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { join, resolve } = await import("node:path");
  const root = resolve(new URL("../..", import.meta.url).pathname);
  const sourcePacket = resolve(root, "docs/ops/release-packets/2026-09-22");
  const packetRoot = await mkdtemp("/tmp/minted-alignment-packet-");
  const receiptPath = join(packetRoot, "local-rehearsal-receipt.json");
  const manifestNames = [
    "staging-alignment-slices-1-4-manifest.json",
    "staging-alignment-slice-5-manifest.json",
  ];
  try {
    const qualificationReceipt = {
      status: ALIGNMENT_STATUS,
      releaseAdmission: "BLOCKED",
      binding: { captureDigest: CAPTURE_DIGEST },
      clones: {
        untouchedBaseline: {
          cloneId: BASELINE_TARGET.runId,
          status: "UNTOUCHED_BASELINE_VERIFIED",
          captureDigest: CAPTURE_DIGEST,
        },
        rehearsal: {
          cloneId: REHEARSAL_TARGET.runId,
          status: "REHEARSAL_VERIFIED",
          captureDigest: CAPTURE_DIGEST,
        },
        authRest: { cloneId: "d3b5b144f3849391", status: "DESTROYED" },
      },
      targets: {
        baseline: { ...BASELINE_TARGET, targetDigest: "a".repeat(64) },
        rehearsal: { ...REHEARSAL_TARGET, targetDigest: "b".repeat(64) },
      },
    };
    for (const file of PACKET_FILES)
      await copyFile(join(sourcePacket, file), join(packetRoot, file));
    for (const file of manifestNames) {
      const manifest = JSON.parse(await readFile(join(sourcePacket, file), "utf8"));
      manifest.targetBinding.local.applicationBinding.status = "BLOCKED_UNBOUND";
      manifest.targetBinding.local.applicationBinding.baselineQualificationDigest = null;
      manifest.targetBinding.local.currentReceipt = {
        status: "LOCAL_APPLICATION_BASELINE_PENDING",
        eligibleForApply: false,
      };
      await writeFile(
        join(packetRoot, file),
        `${JSON.stringify(bindBaselineQualification(manifest, qualificationReceipt), null, 2)}\n`,
      );
    }
    const baselineContainerId = "b".repeat(64);
    const baselineTarget = { ...BASELINE_TARGET, containerId: baselineContainerId };
    const rehearsalTarget = { ...REHEARSAL_TARGET };
    const state = structuredClone(preserved);
    state.tables["public.credential_cases"] = ["case"];
    const states = new Map([
      [BASELINE_TARGET.runId, state],
      [REHEARSAL_TARGET.runId, structuredClone(state)],
    ]);
    let sessions = 0;
    const dependencies = {
      identity: {
        database: "minted_recovery",
        systemIdentifier: REHEARSAL_TARGET.systemIdentifier,
      },
      baselineIdentity: {
        database: "minted_recovery",
        systemIdentifier: BASELINE_TARGET.systemIdentifier,
      },
      collectTarget: async (runId) =>
        runId === REHEARSAL_TARGET.runId ? rehearsalTarget : baselineTarget,
      localSql: async () => {
        throw new Error("SQL_EXECUTION_NOT_ALLOWED_IN_TEST");
      },
      collectState: async (target) => structuredClone(states.get(target.runId)),
      runSession: async (sessionSql) => {
        sessions++;
        assert.equal((sessionSql.match(/MINTED_ALIGNMENT_SLICE_COMMITTED:/g) ?? []).length, 5);
        return PACKET_FILES.map((_, index) => `MINTED_ALIGNMENT_SLICE_COMMITTED:${index + 1}`).join(
          "\n",
        );
      },
    };
    for (const [suffix, mutate] of [
      [
        "case",
        (value) => {
          value.tables["public.credential_cases"] = ["changed"];
        },
      ],
      [
        "facility",
        (value) => {
          value.tables["public.provider_facility_assignments"] = ["changed"];
        },
      ],
      [
        "schema",
        (value) => {
          value.schema = { dumpSha256: "changed" };
        },
      ],
      [
        "table-hash",
        (value) => {
          value.tables["public.audit_log"] = ["changed"];
        },
      ],
    ]) {
      const mismatch = structuredClone(state);
      mutate(mismatch);
      states.set(REHEARSAL_TARGET.runId, mismatch);
      await assert.rejects(
        runLocalAlignmentRehearsal(
          {
            qualificationReceipt,
            target: rehearsalTarget,
            untouchedBaseline: baselineTarget,
            receiptPath: join(packetRoot, `mismatch-${suffix}.json`),
            packetRoot,
            root,
          },
          dependencies,
        ),
        /ALIGNMENT_BASELINE_STATE_MISMATCH/,
      );
      assert.equal(sessions, 0);
    }
    states.set(REHEARSAL_TARGET.runId, structuredClone(state));
    const failedReceiptPath = join(packetRoot, "failed-rehearsal-receipt.json");
    await assert.rejects(
      runLocalAlignmentRehearsal(
        {
          qualificationReceipt,
          target: rehearsalTarget,
          untouchedBaseline: baselineTarget,
          receiptPath: failedReceiptPath,
          packetRoot,
          root,
        },
        {
          ...dependencies,
          runSession: async () => {
            throw new Error("UNKNOWN_OUTCOME");
          },
        },
      ),
      /UNKNOWN_OUTCOME/,
    );
    assert.equal(
      JSON.parse(await readFile(failedReceiptPath, "utf8")).status,
      "LOCAL_ALIGNMENT_STARTED",
    );
    await assert.rejects(
      runLocalAlignmentRehearsal(
        {
          qualificationReceipt,
          target: rehearsalTarget,
          untouchedBaseline: baselineTarget,
          receiptPath: failedReceiptPath,
          packetRoot,
          root,
        },
        dependencies,
      ),
      /ALIGNMENT_RESUME_BLOCKED/,
    );
    const first = await runLocalAlignmentRehearsal(
      {
        qualificationReceipt,
        target: rehearsalTarget,
        untouchedBaseline: baselineTarget,
        receiptPath,
        packetRoot,
        root,
      },
      dependencies,
    );
    assert.equal(first.status, "LOCAL_ALIGNMENT_REHEARSED_ONLY");
    assert.match(first.receiptId, /^[a-f0-9]{16}$/);
    assert.deepEqual(first.baselineTarget, baselineTarget);
    assert.deepEqual(
      first.slices.map(({ index }) => index),
      [1, 2, 3, 4, 5],
    );
    assert.equal(sessions, 1);
    const resumed = await runLocalAlignmentRehearsal(
      {
        qualificationReceipt,
        target: rehearsalTarget,
        untouchedBaseline: baselineTarget,
        receiptPath,
        packetRoot,
        root,
      },
      dependencies,
    );
    assert.equal(resumed.status, "SKIPPED");
    assert.equal(sessions, 1);
  } finally {
    await rm(packetRoot, { recursive: true, force: true });
  }
});
