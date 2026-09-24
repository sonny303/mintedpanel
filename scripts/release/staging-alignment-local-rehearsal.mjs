import { createHash } from "node:crypto";
import { open, readFile, rename } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalDigest } from "./contract.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PACKET = resolve(ROOT, "docs/ops/release-packets/2026-09-22");
export const ALIGNMENT_STATUS = "LOCAL_APPLICATION_BASELINE_VERIFIED";
export const ALIGNMENT_ADMISSION = "BLOCKED";
export const STAGING_REF = "vmznysvietfaddakkegt";
export const PRODUCTION_REF = "fkvuhfsqcmujywzgczmc";
export const SOURCE_SHA = "ae7aff60cac28ee9e2ac5a7a30a8bb7bce6c5c3b";
export const CAPTURE_DIGEST = "9cd07f296ce4eab010bfa1391094c02e7299e4edc8872965e0e08b9eefb8e0de";
export const BASELINE_TARGET = Object.freeze({
  runId: "775640d53985dcdc",
  systemIdentifier: "7689124825780498471",
});
export const REHEARSAL_TARGET = Object.freeze({
  runId: "1e65c046d5fd0fec",
  containerId: "9fb878f8776e684b8ce2c97f17fcb7d6c6e5d8cb1da797152686ba807ad4f88c",
  systemIdentifier: "7689139001490436135",
});
export const PACKET_FILES = Object.freeze([
  "staging-alignment-slice-1.sql",
  "staging-alignment-slice-2.sql",
  "staging-alignment-slice-3.sql",
  "staging-alignment-slice-4.sql",
  "staging-alignment-slice-5.sql",
]);
const MANIFEST_FILES = Object.freeze([
  "staging-alignment-slices-1-4-manifest.json",
  "staging-alignment-slice-5-manifest.json",
]);
const FULL_PRESERVATION_TABLES = Object.freeze([
  "public.provider_facility_assignments",
  "public.case_generation_runs",
  "public.case_generation_run_rows",
  "public.payer_pipeline_history",
  "public.import_runs",
  "public.party_capture_links",
  "public.audit_log",
]);
const SHA = /^[a-f0-9]{64}$/;
const RUN_ID = /^[a-f0-9]{16}$/;
const CONTAINER_ID = /^[a-f0-9]{64}$/;

function fail(code) {
  throw new Error(code);
}

function object(value, code = "ALIGNMENT_RECEIPT_INVALID") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function check(value, code = "ALIGNMENT_PACKET_REJECTED") {
  if (!value) fail(code);
}

export const digest = canonicalDigest;

function sha256Text(value) {
  check(typeof value === "string", "ALIGNMENT_CHECKSUM_INPUT_INVALID");
  return createHash("sha256").update(value).digest("hex");
}

function literal(value) {
  check(typeof value === "string" && !value.includes("\0"), "ALIGNMENT_SETTING_INVALID");
  return `'${value.replaceAll("'", "''")}'`;
}

function localBinding(manifest) {
  const local = object(manifest?.targetBinding?.local);
  check(local.sessionKind === "qualified_local_restore");
  check(local.requiredDatabase === "minted_recovery");
  check(local.requiredExternalReceiptBinding === true);
  check(local.requiredPhysicalSystemIdentifier === REHEARSAL_TARGET.systemIdentifier);
  check(local.expectedApplicationStatus === ALIGNMENT_STATUS);
  const binding = object(local.applicationBinding);
  check(["BLOCKED_UNBOUND", "BOUND"].includes(binding.status));
  check(
    binding.captureDigest === CAPTURE_DIGEST &&
      (binding.baselineQualificationDigest === null ||
        SHA.test(binding.baselineQualificationDigest)),
  );
  const target = object(binding.rehearsalTarget);
  check(target.runId === REHEARSAL_TARGET.runId);
  check(target.containerId === REHEARSAL_TARGET.containerId);
  check(target.systemIdentifier === REHEARSAL_TARGET.systemIdentifier);
  const baseline = object(binding.baselineTarget);
  check(baseline.runId === BASELINE_TARGET.runId);
  check(String(baseline.systemIdentifier) === BASELINE_TARGET.systemIdentifier);
  const current = object(local.currentReceipt);
  if (binding.status === "BLOCKED_UNBOUND") {
    check(current.status === "LOCAL_APPLICATION_BASELINE_PENDING");
    check(current.eligibleForApply === false);
    check(binding.baselineQualificationDigest === null);
  } else {
    check(current.status === ALIGNMENT_STATUS && current.eligibleForApply === false);
    check(SHA.test(binding.baselineQualificationDigest));
    check(RUN_ID.test(current.receiptId));
  }
  return { local, binding, current };
}

export function validateAlignmentManifest(manifest) {
  object(manifest);
  check(manifest.version === 1 && manifest.status === "AUTHOR_ONLY_NOT_APPLIED");
  check(manifest.sourceSha === SOURCE_SHA);
  check(manifest.stagingProjectRef === STAGING_REF);
  check(manifest.forbiddenProductionProjectRef === PRODUCTION_REF);
  check(manifest.targetBinding?.hosted?.sessionKind === "hosted_staging");
  check(manifest.targetBinding.hosted.requiredPhysicalSystemIdentifier === "7662742571317219726");
  check(manifest.targetBinding.hosted.productionRefRejected === true);
  const { binding } = localBinding(manifest);
  check(Array.isArray(manifest.packet?.files));
  for (const file of manifest.packet.files) check(PACKET_FILES.includes(file));
  return { manifest, binding };
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail("ALIGNMENT_PACKET_READ_REJECTED");
  }
}

async function writeDurableNew(path, content) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path);
}

async function writeDurableReplacement(path, content) {
  const temporaryPath = `${path}.complete`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, path);
  await syncDirectory(path);
}

async function syncDirectory(path) {
  const handle = await open(dirname(path), "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function loadAlignmentPacket(packetRoot = PACKET, root = ROOT) {
  const manifests = await Promise.all(
    MANIFEST_FILES.map((file) => readJson(resolve(packetRoot, file))),
  );
  manifests.forEach(validateAlignmentManifest);
  const files = [];
  for (const manifest of manifests) {
    for (const file of manifest.packet.files) {
      check(!files.some((entry) => entry.file === file), "ALIGNMENT_PACKET_DUPLICATE");
      const content = await readFile(resolve(packetRoot, file), "utf8");
      const sha256 = sha256Text(content);
      check(sha256 === manifest.packet.checksums[file], "ALIGNMENT_PACKET_CHECKSUM_DRIFT");
      files.push({ file, content, sha256 });
    }
    for (const [file, expected] of Object.entries(manifest.sourceFiles)) {
      const actual = sha256Text(await readFile(resolve(root, file), "utf8"));
      check(actual === expected, "ALIGNMENT_SOURCE_CHECKSUM_DRIFT");
    }
  }
  check(files.map((entry) => entry.file).join("|") === PACKET_FILES.join("|"));
  return Object.freeze({
    manifests,
    files,
    manifestDigests: manifests.map(digest),
    ready: manifests.every(
      (manifest) => manifest.targetBinding.local.applicationBinding.status === "BOUND",
    ),
  });
}

function receiptDigest(receipt) {
  const copy = structuredClone(object(receipt));
  delete copy.receiptDigest;
  delete copy.qualificationDigest;
  return digest(copy);
}

function receiptId(receipt) {
  const value =
    receipt.receiptId ?? receipt.runId ?? receipt.id ?? receiptDigest(receipt).slice(0, 16);
  check(typeof value === "string" && RUN_ID.test(value), "ALIGNMENT_QUALIFICATION_RECEIPT_INVALID");
  return value;
}

export function validateIndependentBaselineReceipt(receipt) {
  object(receipt, "ALIGNMENT_QUALIFICATION_RECEIPT_INVALID");
  check(
    receipt.status === ALIGNMENT_STATUS && receipt.releaseAdmission === ALIGNMENT_ADMISSION,
    "ALIGNMENT_QUALIFICATION_RECEIPT_INVALID",
  );
  const clones = object(receipt.clones, "ALIGNMENT_QUALIFICATION_RECEIPT_INVALID");
  const cloneIds = Array.isArray(clones.cloneIds)
    ? clones.cloneIds
    : [
        object(clones.untouchedBaseline, "ALIGNMENT_QUALIFICATION_RECEIPT_INVALID").cloneId,
        object(clones.rehearsal, "ALIGNMENT_QUALIFICATION_RECEIPT_INVALID").cloneId,
        object(clones.authRest, "ALIGNMENT_QUALIFICATION_RECEIPT_INVALID").cloneId,
      ];
  check(cloneIds.length === 3 && cloneIds.every((value) => RUN_ID.test(value)));
  check(new Set(cloneIds).size === cloneIds.length);
  check(cloneIds.includes(BASELINE_TARGET.runId) && cloneIds.includes(REHEARSAL_TARGET.runId));
  const binding = object(receipt.binding, "ALIGNMENT_QUALIFICATION_RECEIPT_INVALID");
  check(binding.captureDigest === CAPTURE_DIGEST);
  for (const clone of [clones.untouchedBaseline, clones.rehearsal, clones.authRest].filter(
    Boolean,
  )) {
    if (clone.captureDigest !== undefined) check(clone.captureDigest === CAPTURE_DIGEST);
  }
  const targets = object(receipt.targets, "ALIGNMENT_QUALIFICATION_RECEIPT_INVALID");
  const baselineTarget = object(targets.baseline, "ALIGNMENT_QUALIFICATION_RECEIPT_INVALID");
  const rehearsalTarget = object(targets.rehearsal, "ALIGNMENT_QUALIFICATION_RECEIPT_INVALID");
  check(baselineTarget.runId === BASELINE_TARGET.runId);
  check(String(baselineTarget.systemIdentifier) === BASELINE_TARGET.systemIdentifier);
  check(SHA.test(baselineTarget.targetDigest));
  check(rehearsalTarget.runId === REHEARSAL_TARGET.runId);
  check(String(rehearsalTarget.systemIdentifier) === REHEARSAL_TARGET.systemIdentifier);
  check(SHA.test(rehearsalTarget.targetDigest));
  return Object.freeze({
    receiptId: receiptId(receipt),
    qualificationDigest: receiptDigest(receipt),
    baselineRunId: BASELINE_TARGET.runId,
  });
}

export function bindBaselineQualification(manifest, receipt) {
  const { binding } = validateAlignmentManifest(manifest);
  check(binding.status === "BLOCKED_UNBOUND", "ALIGNMENT_BASELINE_ALREADY_BOUND");
  check(
    (receipt.captureDigest ?? receipt.binding?.captureDigest) === CAPTURE_DIGEST,
    "ALIGNMENT_CAPTURE_BINDING_MISMATCH",
  );
  const independent = validateIndependentBaselineReceipt(receipt);
  const bound = structuredClone(manifest);
  bound.targetBinding.local.applicationBinding.status = "BOUND";
  bound.targetBinding.local.applicationBinding.baselineQualificationDigest =
    independent.qualificationDigest;
  bound.targetBinding.local.currentReceipt = {
    status: ALIGNMENT_STATUS,
    eligibleForApply: false,
    receiptId: independent.receiptId,
  };
  return Object.freeze(bound);
}

export function validateQualificationReceipt(receipt, packet) {
  object(receipt, "ALIGNMENT_QUALIFICATION_RECEIPT_INVALID");
  check(packet.ready, "ALIGNMENT_BASELINE_BINDING_REQUIRED");
  const expected = packet.manifests[0].targetBinding.local.applicationBinding;
  check(
    (receipt.captureDigest ?? receipt.binding?.captureDigest) === expected.captureDigest,
    "ALIGNMENT_CAPTURE_BINDING_MISMATCH",
  );
  const independent = validateIndependentBaselineReceipt(receipt);
  for (const manifest of packet.manifests) {
    check(
      manifest.targetBinding.local.applicationBinding.baselineQualificationDigest ===
        independent.qualificationDigest,
      "ALIGNMENT_QUALIFICATION_DIGEST_MISMATCH",
    );
  }
  return independent;
}

export function validateRehearsalIdentity(identity, target) {
  object(identity, "ALIGNMENT_LOCAL_IDENTITY_REJECTED");
  check(identity.database === "minted_recovery", "ALIGNMENT_LOCAL_DATABASE_REJECTED");
  check(
    String(identity.systemIdentifier) === REHEARSAL_TARGET.systemIdentifier,
    "ALIGNMENT_LOCAL_SYSTEM_ID_REJECTED",
  );
  check(
    target?.runId === REHEARSAL_TARGET.runId &&
      target?.containerId === REHEARSAL_TARGET.containerId &&
      String(target?.systemIdentifier) === REHEARSAL_TARGET.systemIdentifier,
    "ALIGNMENT_LOCAL_TARGET_REJECTED",
  );
  return Object.freeze({
    database: identity.database,
    systemIdentifier: String(identity.systemIdentifier),
  });
}

export function validateBaselineIdentity(identity, target) {
  object(identity, "ALIGNMENT_BASELINE_IDENTITY_REJECTED");
  check(identity.database === "minted_recovery", "ALIGNMENT_BASELINE_DATABASE_REJECTED");
  check(
    String(identity.systemIdentifier) === BASELINE_TARGET.systemIdentifier,
    "ALIGNMENT_BASELINE_SYSTEM_ID_REJECTED",
  );
  check(
    target?.runId === BASELINE_TARGET.runId &&
      CONTAINER_ID.test(target?.containerId) &&
      String(target?.systemIdentifier) === BASELINE_TARGET.systemIdentifier,
    "ALIGNMENT_BASELINE_TARGET_REJECTED",
  );
  return Object.freeze({
    database: identity.database,
    systemIdentifier: String(identity.systemIdentifier),
  });
}

export function buildSessionSettings(receiptIdValue) {
  check(RUN_ID.test(receiptIdValue), "ALIGNMENT_RECEIPT_ID_INVALID");
  return [
    `SET minted.release_target_kind = ${literal("qualified_local_restore")};`,
    `SET minted.release_project_ref = ${literal(STAGING_REF)};`,
    `SET minted.release_source_sha = ${literal(SOURCE_SHA)};`,
    `SET minted.restore_status = ${literal(ALIGNMENT_STATUS)};`,
    `SET minted.restore_receipt_id = ${literal(receiptIdValue)};`,
    `SET minted.restore_capture_digest = ${literal(CAPTURE_DIGEST)};`,
    `SET minted.restore_system_identifier = ${literal(REHEARSAL_TARGET.systemIdentifier)};`,
  ].join("\n");
}

export function buildPacketSessionSql(packet, receiptIdValue) {
  check(packet.ready, "ALIGNMENT_BASELINE_BINDING_REQUIRED");
  const files = packet.files;
  check(files.length === PACKET_FILES.length);
  return `${buildSessionSettings(receiptIdValue)}
${files
  .map(
    ({ content }, index) => `${content}\nSELECT 'MINTED_ALIGNMENT_SLICE_COMMITTED:${index + 1}';`,
  )
  .join("\n")}
`;
}

export function parseCommittedSlices(output) {
  check(typeof output === "string", "ALIGNMENT_SESSION_OUTPUT_REJECTED");
  const committed = [...output.matchAll(/^MINTED_ALIGNMENT_SLICE_COMMITTED:(\d+)$/gm)].map(
    (match) => Number(match[1]),
  );
  check(
    committed.length === PACKET_FILES.length &&
      committed.every((value, index) => value === index + 1),
    "ALIGNMENT_SLICE_ORDER_REJECTED",
  );
  return committed;
}

function stateTableDigest(state, table) {
  object(state, "ALIGNMENT_STATE_REJECTED");
  const tables = object(state.tables, "ALIGNMENT_STATE_REJECTED");
  check(Object.hasOwn(tables, table), "ALIGNMENT_STATE_SCOPE_REJECTED");
  return digest(tables[table]);
}

export function comparePreservedState(before, after) {
  const preserved = Object.fromEntries(
    FULL_PRESERVATION_TABLES.map((table) => [table, stateTableDigest(before, table)]),
  );
  for (const table of FULL_PRESERVATION_TABLES)
    check(stateTableDigest(after, table) === preserved[table], "ALIGNMENT_PRESERVATION_FAILED");
  return digest(preserved);
}

export function verifyResumeReceipt(receipt, expected, liveState) {
  object(receipt, "ALIGNMENT_RESUME_BLOCKED");
  check(
    receipt.version === 1 &&
      receipt.status === "LOCAL_ALIGNMENT_REHEARSED_ONLY" &&
      receipt.releaseAdmission === ALIGNMENT_ADMISSION &&
      receipt.eligibleForApply === false,
    "ALIGNMENT_RESUME_BLOCKED",
  );
  check(
    Array.isArray(receipt.manifestDigests) &&
      Array.isArray(expected.manifestDigests) &&
      digest(receipt.manifestDigests) === digest(expected.manifestDigests),
    "ALIGNMENT_RESUME_BLOCKED",
  );
  check(receipt.qualificationDigest === expected.qualificationDigest, "ALIGNMENT_RESUME_BLOCKED");
  check(
    RUN_ID.test(receipt.receiptId) &&
      receipt.receiptId === expected.receiptId &&
      receipt.captureDigest === CAPTURE_DIGEST,
    "ALIGNMENT_RESUME_BLOCKED",
  );
  check(
    object(receipt.target, "ALIGNMENT_RESUME_BLOCKED") &&
      object(expected.target, "ALIGNMENT_RESUME_BLOCKED") &&
      digest(receipt.target) === digest(expected.target),
    "ALIGNMENT_RESUME_BLOCKED",
  );
  check(
    object(receipt.baselineTarget, "ALIGNMENT_RESUME_BLOCKED") &&
      object(expected.baselineTarget, "ALIGNMENT_RESUME_BLOCKED") &&
      digest(receipt.baselineTarget) === digest(expected.baselineTarget),
    "ALIGNMENT_RESUME_BLOCKED",
  );
  check(
    Array.isArray(receipt.slices) && receipt.slices.length === PACKET_FILES.length,
    "ALIGNMENT_RESUME_BLOCKED",
  );
  receipt.slices.forEach((slice, index) => {
    check(
      slice.index === index + 1 &&
        slice.status === "COMMITTED" &&
        slice.sqlSha256 === expected.sqlDigests[index],
      "ALIGNMENT_RESUME_BLOCKED",
    );
  });
  check(SHA.test(receipt.poststateDigest), "ALIGNMENT_RESUME_BLOCKED");
  check(
    Array.isArray(receipt.sqlDigests) && digest(receipt.sqlDigests) === digest(expected.sqlDigests),
    "ALIGNMENT_RESUME_BLOCKED",
  );
  check(digest(liveState) === receipt.poststateDigest, "ALIGNMENT_RESUME_BLOCKED");
  return Object.freeze({
    status: "SKIPPED",
    reason: "COMMITTED_RECEIPT_AND_LIVE_POSTSTATE_MATCH",
    receipt,
  });
}

function fixedPsqlArgs(target) {
  check(CONTAINER_ID.test(target.containerId), "ALIGNMENT_LOCAL_TARGET_REJECTED");
  return [
    "exec",
    "-i",
    target.containerId,
    "/nix/var/nix/profiles/default/bin/psql",
    "-X",
    "-q",
    "-A",
    "-t",
    "-U",
    "supabase_admin",
    "-h",
    "/var/run/postgresql",
    "-d",
    "minted_recovery",
    "-v",
    "ON_ERROR_STOP=1",
  ];
}

export async function runLocalAlignmentRehearsal(
  {
    qualificationReceipt,
    target: requestedTarget,
    untouchedBaseline,
    receiptPath,
    packetRoot = PACKET,
    root = ROOT,
  } = {},
  dependencies = {},
) {
  check(
    typeof receiptPath === "string" && isAbsolute(receiptPath),
    "ALIGNMENT_RECEIPT_PATH_INVALID",
  );
  const packet = await loadAlignmentPacket(packetRoot, root);
  const receipt =
    typeof qualificationReceipt === "string"
      ? await readJson(qualificationReceipt)
      : qualificationReceipt;
  const qualification = validateQualificationReceipt(receipt, packet);
  check(
    requestedTarget?.runId === REHEARSAL_TARGET.runId &&
      requestedTarget?.containerId === REHEARSAL_TARGET.containerId &&
      (requestedTarget?.systemIdentifier === undefined ||
        String(requestedTarget.systemIdentifier) === REHEARSAL_TARGET.systemIdentifier),
    "ALIGNMENT_LOCAL_TARGET_REJECTED",
  );
  check(
    untouchedBaseline?.runId === qualification.baselineRunId &&
      untouchedBaseline.runId === BASELINE_TARGET.runId &&
      (untouchedBaseline.containerId === undefined ||
        CONTAINER_ID.test(untouchedBaseline.containerId)) &&
      (untouchedBaseline.systemIdentifier === undefined ||
        String(untouchedBaseline.systemIdentifier) === BASELINE_TARGET.systemIdentifier),
    "ALIGNMENT_BASELINE_TARGET_REJECTED",
  );
  const collectTarget =
    dependencies.collectTarget ?? (await import("../recovery/local-target.mjs")).collectLocalTarget;
  const observedTarget = await collectTarget(requestedTarget.runId);
  check(
    observedTarget?.runId === requestedTarget.runId &&
      observedTarget.containerId === requestedTarget.containerId,
    "ALIGNMENT_LOCAL_TARGET_REJECTED",
  );
  const target = { ...observedTarget, systemIdentifier: REHEARSAL_TARGET.systemIdentifier };
  const observedBaseline = await collectTarget(untouchedBaseline.runId);
  check(
    observedBaseline?.runId === untouchedBaseline.runId &&
      CONTAINER_ID.test(observedBaseline.containerId) &&
      (untouchedBaseline.containerId === undefined ||
        observedBaseline.containerId === untouchedBaseline.containerId),
    "ALIGNMENT_BASELINE_TARGET_REJECTED",
  );
  const baselineTarget = {
    ...observedBaseline,
    systemIdentifier: BASELINE_TARGET.systemIdentifier,
  };
  const localSql =
    dependencies.localSql ?? (await import("../recovery/auth-rest-qualifier.mjs")).localSql;
  const collectState =
    dependencies.collectState ??
    (await import("../recovery/auth-rest-qualifier.mjs")).collectQuiescentState;
  const execute = dependencies.execute;
  const identitySql =
    "SELECT json_build_object('database',current_database(),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()));";
  const identity =
    dependencies.identity ?? JSON.parse(await localSql(target, identitySql, { execute }));
  validateRehearsalIdentity(identity, target);
  const baselineIdentity =
    dependencies.baselineIdentity ??
    JSON.parse(await localSql(baselineTarget, identitySql, { execute }));
  validateBaselineIdentity(baselineIdentity, baselineTarget);
  const before = await collectState(target, execute);
  const untouched = await collectState(baselineTarget, execute);
  const expected = {
    manifestDigests: packet.manifestDigests,
    qualificationDigest: qualification.qualificationDigest,
    receiptId: qualification.receiptId,
    target: {
      runId: target.runId,
      containerId: target.containerId,
      systemIdentifier: REHEARSAL_TARGET.systemIdentifier,
    },
    baselineTarget: {
      runId: baselineTarget.runId,
      containerId: baselineTarget.containerId,
      systemIdentifier: BASELINE_TARGET.systemIdentifier,
    },
    sqlDigests: packet.files.map((file) => file.sha256),
  };
  let previous;
  try {
    previous = JSON.parse(await readFile(receiptPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error("ALIGNMENT_RESUME_BLOCKED");
  }
  if (previous) {
    const live = await collectState(target, execute);
    comparePreservedState(untouched, live);
    if (previous.status === "LOCAL_ALIGNMENT_REHEARSED_ONLY")
      return verifyResumeReceipt(previous, expected, live);
    throw new Error("ALIGNMENT_RESUME_BLOCKED");
  }
  check(digest(before) === digest(untouched), "ALIGNMENT_BASELINE_STATE_MISMATCH");
  const started = {
    version: 1,
    status: "LOCAL_ALIGNMENT_STARTED",
    releaseAdmission: ALIGNMENT_ADMISSION,
    eligibleForApply: false,
    manifestDigests: expected.manifestDigests,
    qualificationDigest: expected.qualificationDigest,
    receiptId: expected.receiptId,
    captureDigest: CAPTURE_DIGEST,
    target: expected.target,
    baselineTarget: expected.baselineTarget,
    slices: [],
    sqlDigests: expected.sqlDigests,
    preservationDigest: comparePreservedState(before, before),
    poststateDigest: digest(before),
  };
  await writeDurableNew(receiptPath, `${JSON.stringify(started, null, 2)}\n`);
  const runSession =
    dependencies.runSession ??
    (async (sessionSql) => {
      const { fixedDocker } = await import("../recovery/local-services.mjs");
      return fixedDocker(fixedPsqlArgs(target), sessionSql, 900_000);
    });
  const output = await runSession(buildPacketSessionSql(packet, qualification.receiptId));
  const committed = parseCommittedSlices(output);
  const after = await collectState(target, execute);
  const preservationDigest = comparePreservedState(before, after);
  const result = Object.freeze({
    version: 1,
    status: "LOCAL_ALIGNMENT_REHEARSED_ONLY",
    releaseAdmission: ALIGNMENT_ADMISSION,
    eligibleForApply: false,
    manifestDigests: packet.manifestDigests,
    qualificationDigest: qualification.qualificationDigest,
    receiptId: qualification.receiptId,
    captureDigest: CAPTURE_DIGEST,
    target: expected.target,
    baselineTarget: expected.baselineTarget,
    slices: committed.map((index) => ({
      index,
      status: "COMMITTED",
      sqlSha256: expected.sqlDigests[index - 1],
    })),
    sqlDigests: expected.sqlDigests,
    preservationDigest,
    poststateDigest: digest(after),
  });
  await writeDurableReplacement(receiptPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
