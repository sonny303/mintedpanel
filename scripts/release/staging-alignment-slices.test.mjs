import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PACKET = resolve(ROOT, "docs/ops/release-packets/2026-09-22");
const MANIFEST_PATH = resolve(PACKET, "staging-alignment-slices-1-4-manifest.json");
const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
const expectedFiles = [
  "staging-alignment-slice-1.sql",
  "staging-alignment-slice-2.sql",
  "staging-alignment-slice-3.sql",
  "staging-alignment-slice-4.sql",
];
const backupTables = [
  "portal_field_maps_aetna_backup_20260904",
  "portal_field_maps_aetna_direct_backup_20260812",
  "portals_aetna_backup_20260904",
];
const mappedCaseStatusCounts = {
  submitted: 32,
  approved: 14,
  not_started: 12,
  in_progress: 3,
  not_pursuing: 2,
  in_review: 1,
  denied: 1,
  action_required: 0,
  total: 65,
};

function stripDollarQuotedBodies(sql) {
  let output = "";
  let cursor = 0;
  while (cursor < sql.length) {
    const match = sql.slice(cursor).match(/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/);
    if (!match) {
      output += sql.slice(cursor);
      break;
    }
    const open = cursor + match.index;
    const delimiter = match[0];
    const close = sql.indexOf(delimiter, open + delimiter.length);
    if (close < 0) return sql;
    output += sql.slice(cursor, open);
    output += " ".repeat(close + delimiter.length - open);
    cursor = close + delimiter.length;
  }
  return output;
}

test("alignment manifest pins the reviewed source and exact target counts", async () => {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.status, "AUTHOR_ONLY_NOT_APPLIED");
  assert.match(manifest.sourceSha, /^[a-f0-9]{40}$/);
  assert.equal(manifest.sourceSha, "7a40fc7876c4b53810e1391426afbed865176c3b");
  assert.equal(manifest.stagingProjectRef, "vmznysvietfaddakkegt");
  assert.equal(manifest.forbiddenProductionProjectRef, "fkvuhfsqcmujywzgczmc");
  assert.equal(
    manifest.targetBinding.hosted.requiredPhysicalSystemIdentifier,
    "7662742571317219726",
  );
  assert.deepEqual(manifest.packet.files, expectedFiles);
  assert.deepEqual(manifest.targetCounts, {
    newTables: 3,
    newTableColumns: 32,
    addedExistingColumns: 13,
    distinctTargetColumns: 45,
    legacyCases: 65,
    explicitFacilityCases: 61,
    nullFacilityCases: 4,
    payerRows: 287,
    payerSourceBackfillRows: 287,
    enrollmentFactRowsCreated: 0,
    heldFacilityEligibilityExceptions: 2,
    productionOperatorBackupTables: 3,
    mappedCaseStatusCounts,
  });
  for (const file of expectedFiles) {
    const actualDigest = createHash("sha256")
      .update(await readFile(resolve(PACKET, file)))
      .digest("hex");
    assert.equal(actualDigest, manifest.packet.checksums[file], `packet checksum drift: ${file}`);
  }
  assert.deepEqual(manifest.preservation, {
    perPrimaryKeyRowHashTables: [
      "provider_facility_assignments",
      "case_generation_runs",
      "case_generation_run_rows",
      "payer_pipeline_history",
      "import_runs",
    ],
    caseGuardAllowedColumns: ["case_status", "contract_executed_date", "case_number"],
  });
  assert.deepEqual(manifest.aclContracts.privateHelpers, [
    "_payer_norm_name(text)",
    "_payer_norm_states(text[])",
    "_payer_norm_aliases(text[])",
    "_payer_assert_name_available(text[], uuid)",
  ]);
  assert.equal(manifest.targetBinding.local.requiredDatabase, "minted_recovery");
  assert.equal(
    manifest.targetBinding.local.requiredPhysicalSystemIdentifier,
    "7688850032395546663",
  );
  assert.equal(manifest.targetBinding.local.requiredExternalReceiptBinding, true);
  assert.equal(
    manifest.targetBinding.local.expectedApplicationStatus,
    "LOCAL_APPLICATION_BASELINE_VERIFIED",
  );
  assert.equal(manifest.targetBinding.local.applicationBinding.status, "BOUND");
  assert.equal(
    manifest.targetBinding.local.applicationBinding.baselineQualificationDigest,
    "0feaecb6544f20a899cc169c472c5e668ef3d73f61f3e15a5ea170cb63abea7b",
  );
  assert.deepEqual(manifest.targetBinding.local.applicationBinding.baselineTarget, {
    runId: "2e465ae49df2037d",
    systemIdentifier: "7688816016043610151",
  });
  assert.equal(
    manifest.targetBinding.local.applicationBinding.captureDigest,
    "efe2bdaecddf7e3ea83d0afd42110e775c637e867f06499e75537b89f66da4a5",
  );
  assert.deepEqual(manifest.targetBinding.local.applicationBinding.rehearsalTarget, {
    runId: "7dc905282a047aa2",
    containerId: "d7ed97e0cb0baceab4ea2a9eb94a6357fad2a6ddb10fd536a9bd1b2731bfdb84",
    systemIdentifier: "7688850032395546663",
  });
  assert.equal(
    manifest.targetBinding.local.currentReceipt.status,
    "LOCAL_APPLICATION_BASELINE_VERIFIED",
  );
  assert.equal(manifest.targetBinding.local.currentReceipt.receiptId, "0feaecb6544f20a8");
  assert.equal(manifest.targetBinding.local.currentReceipt.eligibleForApply, false);

  for (const [relativePath, expectedDigest] of Object.entries(manifest.sourceFiles)) {
    const actualDigest = createHash("sha256")
      .update(await readFile(resolve(ROOT, relativePath)))
      .digest("hex");
    assert.equal(actualDigest, expectedDigest, `source checksum drift: ${relativePath}`);
  }
});

test("each alignment slice is serial, identity guarded, physical-restore guarded, and additive", async () => {
  for (const file of expectedFiles) {
    const sql = await readFile(resolve(PACKET, file), "utf8");
    const executable = stripDollarQuotedBodies(sql);

    assert.match(sql, /^-- AUTHOR-ONLY staging alignment packet/m);
    assert.match(sql, /BEGIN;\s*SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;/);
    assert.match(sql, /SET LOCAL lock_timeout = '5s';/);
    assert.match(sql, /SET LOCAL statement_timeout = '120s';/);
    assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(/);
    assert.match(sql, /COMMIT;\s*$/);
    assert.match(
      sql,
      /current_setting\('minted\.release_project_ref', true\) IS DISTINCT FROM 'vmznysvietfaddakkegt'/,
    );
    assert.match(
      sql,
      /current_setting\('minted\.release_source_sha', true\) IS DISTINCT FROM '7a40fc7876c4b53810e1391426afbed865176c3b'/,
    );
    assert.match(sql, /current_setting\('transaction_read_only'\) = 'on'/);
    assert.match(sql, /current_database\(\) <> 'minted_recovery'/);
    assert.match(
      sql,
      /IF target_kind = 'hosted_staging' THEN[\s\S]*?SELECT system_identifier INTO actual_system_identifier\s+FROM pg_catalog\.pg_control_system\(\);[\s\S]*?7662742571317219726::bigint/,
    );
    assert.match(sql, /ALIGNMENT_HOSTED_SYSTEM_ID_UNAVAILABLE/);
    assert.match(sql, /ALIGNMENT_HOSTED_SYSTEM_ID_REJECTED/);
    assert.match(
      sql,
      /SELECT system_identifier INTO actual_system_identifier\s+FROM pg_catalog\.pg_control_system\(\)/,
    );
    assert.match(
      sql,
      /actual_system_identifier IS DISTINCT FROM current_setting\('minted\.restore_system_identifier'\)::bigint/,
    );
    assert.match(
      sql,
      /current_setting\('minted\.restore_status', true\) IS DISTINCT FROM 'LOCAL_APPLICATION_BASELINE_VERIFIED'/,
    );
    assert.match(
      sql,
      /current_setting\('minted\.restore_capture_digest', true\) IS DISTINCT FROM 'efe2bdaecddf7e3ea83d0afd42110e775c637e867f06499e75537b89f66da4a5'/,
    );
    assert.match(
      sql,
      /current_setting\('minted\.restore_receipt_id', true\) !~ '\^\[a-f0-9\]\{16\}\$'/,
    );
    assert.match(
      sql,
      /current_setting\('minted\.restore_system_identifier', true\) IS DISTINCT FROM '7688850032395546663'/,
    );
    assert.match(sql, /ALIGNMENT_LOCAL_SYSTEM_ID_(?:UNAVAILABLE|REJECTED)/);
    assert.doesNotMatch(sql, /fkvuhfsqcmujywzgczmc/);
    assert.doesNotMatch(executable, /^\s*(?:TRUNCATE|DELETE\s+FROM|COPY)\b/im);
    assert.doesNotMatch(executable, /^\s*DROP\s+(?:TABLE|DATABASE|SCHEMA)\b/im);

    for (const backupTable of backupTables) {
      const qualified = `'public.${backupTable}'`;
      assert.equal(
        (sql.match(new RegExp(qualified.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length,
        2,
      );
      assert.equal(
        (
          sql.match(
            new RegExp(`to_regclass\\(${qualified.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`, "g"),
          ) ?? []
        ).length,
        2,
      );
    }
  }
});

test("case status mapping is exact before and after the slice", async () => {
  const sql = await readFile(resolve(PACKET, "staging-alignment-slice-1.sql"), "utf8");
  for (const [status, count] of Object.entries(mappedCaseStatusCounts)) {
    if (status === "total") continue;
    assert.match(sql, new RegExp(`mapped_status='${status}'\\)<>${count}`));
    assert.match(sql, new RegExp(`case_status='${status}'\\)<>${count}`));
  }
  assert.match(sql, /minted_alignment_case_status_guard/);
  assert.match(sql, /ALIGNMENT_CASE_STATUS_MAPPING_CHANGED/);
  assert.match(sql, /ALIGNMENT_CASE_STATUS_POSTSTATE_INVALID/);
});

test("reviewed RPC ACLs are signature-specific and fail closed for public callers", async () => {
  const slice1 = await readFile(resolve(PACKET, "staging-alignment-slice-1.sql"), "utf8");
  const slice2 = await readFile(resolve(PACKET, "staging-alignment-slice-2.sql"), "utf8");
  for (const role of ["PUBLIC", "anon", "authenticated"]) {
    assert.ok(
      slice1.includes(
        `REVOKE ALL ON FUNCTION public._apply_case_status_auto(uuid, text, uuid) FROM ${role};`,
      ),
      `missing _apply_case_status_auto revoke for ${role}`,
    );
  }
  const privateHelpers = [
    ["_payer_norm_name", "text"],
    ["_payer_norm_states", "text[]"],
    ["_payer_norm_aliases", "text[]"],
    ["_payer_assert_name_available", "text[], uuid"],
  ];
  for (const [name, signature] of privateHelpers) {
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      assert.ok(
        slice2.includes(`REVOKE ALL ON FUNCTION public.${name}(${signature}) FROM ${role};`),
        `missing ${name} revoke for ${role}`,
      );
    }
  }
  const writerRpcs = [
    ["create_payer", "uuid, text, text, text[], text[], text, boolean, text, boolean, text"],
    ["update_payer", "uuid, uuid, text, text, text[], text[], text, boolean, text, boolean, text"],
    ["archive_payer", "uuid, uuid"],
    ["reactivate_payer", "uuid, uuid"],
    ["merge_payer", "uuid, uuid, uuid"],
  ];
  for (const [name, signature] of writerRpcs) {
    assert.ok(slice2.includes(`REVOKE ALL ON FUNCTION public.${name}(${signature}) FROM PUBLIC;`));
    assert.ok(slice2.includes(`REVOKE ALL ON FUNCTION public.${name}(${signature}) FROM anon;`));
    assert.ok(
      slice2.includes(
        `GRANT EXECUTE ON FUNCTION public.${name}(${signature}) TO authenticated, service_role;`,
      ),
    );
  }
  assert.doesNotMatch(slice2, /GRANT EXECUTE ON FUNCTION [^;]+ TO [^;]*\bPUBLIC\b/);
  assert.doesNotMatch(slice2, /GRANT EXECUTE ON FUNCTION [^;]+ TO [^;]*\banon\b/);
});

test("slice 3 resets ledger table ACLs before granting only authenticated reads/inserts", async () => {
  const slice3 = await readFile(resolve(PACKET, "staging-alignment-slice-3.sql"), "utf8");
  for (const table of [
    "case_status_history",
    "case_generation_runs",
    "case_generation_run_rows",
    "payer_pipeline_history",
    "enrollment_facts",
  ]) {
    assert.ok(
      slice3.includes(`REVOKE ALL ON public.${table} FROM PUBLIC, anon, authenticated;`),
      `${table} must clear inherited caller ACLs`,
    );
    const expectedGrant =
      table === "enrollment_facts"
        ? "GRANT SELECT, INSERT, UPDATE ON public.enrollment_facts TO authenticated;"
        : `GRANT SELECT, INSERT ON public.${table} TO authenticated;`;
    assert.ok(
      slice3.includes(expectedGrant),
      `${table} must keep the reviewed authenticated write floor`,
    );
  }
  assert.match(slice3, /ALIGNMENT_LEDGER_ANON_PRIVILEGE_DRIFT/);
  assert.match(slice3, /ALIGNMENT_LEDGER_AUTH_PRIVILEGE_DRIFT/);
  assert.match(slice3, /has_table_privilege\('authenticated', v_table, 'TRUNCATE'\)/);
  assert.match(slice3, /md5\(to_jsonb\(r\)::text\)/);
});

test("alignment preservation uses per-primary-key row hashes and the case guard", async () => {
  const slice3 = await readFile(resolve(PACKET, "staging-alignment-slice-3.sql"), "utf8");
  const slice4 = await readFile(resolve(PACKET, "staging-alignment-slice-4.sql"), "utf8");
  assert.match(slice3, /table_name, r\.id AS row_id, md5\(to_jsonb\(r\)::text\)/);
  assert.match(slice3, /FULL JOIN \([\s\S]*current_rows USING \(table_name, row_id\)/);
  assert.doesNotMatch(slice3, /row_count/);
  assert.match(slice4, /SELECT a\.id, md5\(to_jsonb\(a\)::text\) AS row_digest/);
  assert.match(slice4, /FULL JOIN public\.provider_facility_assignments a ON a\.id=g\.id/);
  assert.match(slice4, /to_regclass\('pg_temp\.minted_alignment_case_guard'\) IS NULL/);
  assert.match(
    slice4,
    /to_jsonb\(c\)-ARRAY\['case_status','contract_executed_date','case_number'\]/,
  );
});

test("packet preserves the legacy identity columns and records the held facility exceptions", async () => {
  const sql = await Promise.all(
    expectedFiles.map((file) => readFile(resolve(PACKET, file), "utf8")),
  );
  const requiredLegacyColumns = [
    "provisional_billing_allowed",
    "provisional_billing_notes",
    "retro_billing_allowed",
    "retro_billing_window_days",
    "caqh_pull_deadline_days",
    "provider_type_path",
    "prior_auth_vendor",
    "payer_billing_id",
    "portal_url",
    "cms_hios_id",
    "prerequisite_payer_id",
    "payer_provider_id",
    "resolution_id_label",
    "resolution_id_expected",
  ];
  for (const column of requiredLegacyColumns) {
    assert.ok(
      sql.some((text) => text.includes(`'${column}'`)),
      `legacy column guard missing: ${column}`,
    );
  }
  assert.ok(sql[3].includes("<>2 THEN RAISE EXCEPTION 'ALIGNMENT_FACILITY_EXCEPTIONS_CHANGED'"));
  assert.ok(sql[3].includes("(SELECT count(*) FROM public.case_facilities)<>61"));
  assert.ok(sql[2].includes("(SELECT count(*) FROM public.enrollment_facts)<>0"));
});
