import test from "node:test";
import assert from "node:assert/strict";
import { canonicalDigest } from "../release/contract.mjs";
import {
  APPLICATION_CATALOG_SQL,
  compareApplicationCatalog,
  compareSequenceLowerBounds,
  compareRestoredLedgers,
  compareServiceCounts,
  normalizeApplicationCatalog,
  parseArchiveTableOfContents,
  verifyApplicationBaseline,
} from "./application-baseline.mjs";

const digest = (value) => canonicalDigest(value);

function catalog() {
  return {
    schemas: [{ name: "public", owner: "postgres", acl: null }],
    relations: [
      {
        schema: "public",
        name: "notes",
        kind: "r",
        owner: "postgres",
        acl: null,
        rls: true,
        forceRls: false,
        persistence: "p",
        options: null,
        partitionBound: null,
      },
    ],
    columns: [
      {
        schema: "public",
        table: "notes",
        position: 1,
        name: "id",
        type: "uuid",
        notNull: true,
        identity: "",
        generated: "",
        acl: null,
        collation: null,
        default: "gen_random_uuid()",
      },
    ],
    aggregates: [
      {
        identity: "public.count(bigint)",
        owner: "postgres",
        acl: null,
        definition: "CREATE AGGREGATE public.count(bigint)",
        aggregate: { kind: "n", transitionType: "internal" },
      },
    ],
    types: [{ schema: "public", name: "note_kind", kind: "e", category: "E" }],
    enums: [{ schema: "public", type: "note_kind", label: "internal", sortOrder: 1 }],
    rules: [],
    inheritance: [],
    defaultAcls: [],
    sequences: [
      {
        schema: "public",
        name: "notes_id_seq",
        owner: "postgres",
        acl: null,
        definition: {
          type: "bigint",
          start: 1,
          increment: 1,
          max: "9223372036854775807",
          min: 1,
          cache: 1,
          cycle: false,
        },
      },
    ],
  };
}

function captureAndBinding() {
  const lineage = [
    {
      schema: "supabase_migrations",
      name: "schema_migrations",
      present: true,
      rows: [{ version: "1" }],
    },
  ];
  const artifacts = [{ name: "backup", sha256: "a".repeat(64), bytes: 1 }];
  const source = {
    ref: "vmznysvietfaddakkegt",
    host: "aws-0-ca-central-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    serverVersion: "17.6",
    schemaDigest: "b".repeat(64),
    lineageDigest: digest(lineage),
  };
  const capture = {
    version: 1,
    status: "CAPTURED_ONLY",
    captured: { status: "CAPTURED_ONLY", source, artifacts },
  };
  return {
    capture,
    lineage,
    artifacts,
    binding: {
      captureDigest: digest(capture),
      artifactDigest: digest(artifacts),
      schemaDigest: source.schemaDigest,
      lineageDigest: source.lineageDigest,
    },
  };
}

function baselineInput() {
  const { capture, lineage, artifacts, binding } = captureAndBinding();
  const reviewedCodeHashes = { "application-baseline.mjs": "c".repeat(64) };
  const receipt = { ...binding };
  const observedBackup = {
    artifactDigest: binding.artifactDigest,
    schemaDigest: binding.schemaDigest,
    lineageDigest: binding.lineageDigest,
  };
  return {
    capture,
    restore: {
      status: "REHEARSED_ONLY",
      releaseAdmission: "BLOCKED",
      proof: {
        ...receipt,
        observedBackup,
        status: "RESTORE_VERIFIED_ONLY",
        releaseAdmission: "BLOCKED",
      },
    },
    authRest: {
      ...receipt,
      status: "LOCAL_AUTH_REST_VERIFIED_ONLY",
      releaseAdmission: "BLOCKED",
      cleanup: { status: "DESTROYED", remaining: [] },
    },
    capturedCatalog: catalog(),
    restoredCatalog: catalog(),
    capturedLineage: lineage,
    restoredLineage: structuredClone(lineage),
    capturedSequences: [{ schema: "public", name: "notes_id_seq", lastValue: "9", isCalled: true }],
    restoredSequences: [
      { schema: "public", name: "notes_id_seq", lastValue: "12", isCalled: true },
    ],
    capturedServices: { storage: { buckets: 0, objects: 0 }, vault: { ssn_vault_key_count: 0 } },
    restoredServices: { storage: { buckets: 0, objects: 0 }, vault: { ssn_vault_key_count: 0 } },
    clones: {
      authRest: {
        ...receipt,
        cloneId: "auth-rest-1234",
        status: "DESTROYED",
        remaining: [],
        codeHashes: reviewedCodeHashes,
      },
      untouchedBaseline: {
        ...receipt,
        cloneId: "baseline-1234",
        status: "UNTOUCHED_BASELINE_VERIFIED",
        codeHashes: reviewedCodeHashes,
      },
      rehearsal: {
        ...receipt,
        cloneId: "rehearsal-1234",
        status: "REHEARSAL_VERIFIED",
        codeHashes: reviewedCodeHashes,
      },
    },
    reviewedCodeHashes,
    artifacts,
  };
}

test("normalizes and compares every public application category canonically", () => {
  const source = catalog();
  const reordered = structuredClone(source);
  reordered.relations.reverse();
  assert.deepEqual(compareApplicationCatalog(source, reordered).categories, [
    "schema",
    "relations",
    "columns",
    "aggregates",
    "types",
    "enums",
    "rules",
    "inheritance",
    "defaultAcls",
    "sequences",
  ]);
  reordered.columns[0].default = "different_default()";
  assert.throws(() => compareApplicationCatalog(source, reordered), /APPLICATION_CATALOG_MISMATCH/);
});

test("fails closed for missing and extra public catalog rows", () => {
  const source = catalog();
  const missing = structuredClone(source);
  missing.relations = [];
  assert.throws(() => compareApplicationCatalog(source, missing), /APPLICATION_CATALOG_MISMATCH/);
  const extra = structuredClone(source);
  extra.rules.push({
    schema: "public",
    table: "notes",
    name: "unexpected",
    enabled: "O",
    definition: "CREATE RULE",
  });
  assert.throws(() => compareApplicationCatalog(source, extra), /APPLICATION_CATALOG_MISMATCH/);
});

test("detects public type semantics and retains global default ACLs", () => {
  const source = catalog();
  const typeAclMutation = structuredClone(source);
  typeAclMutation.types[0].acl = ["=U/postgres"];
  assert.throws(
    () => compareApplicationCatalog(source, typeAclMutation),
    /APPLICATION_CATALOG_MISMATCH/,
  );
  const typeFunctionMutation = structuredClone(source);
  typeFunctionMutation.types[0].input = "custom_in";
  assert.throws(
    () => compareApplicationCatalog(source, typeFunctionMutation),
    /APPLICATION_CATALOG_MISMATCH/,
  );

  const raw = structuredClone(source);
  raw.roles = [{ oid: 1, rolname: "postgres" }];
  raw.defaultAcls = [
    { oid: 1, defaclrole: 1, defaclnamespace: 0, defaclobjtype: "r", defaclacl: null },
  ];
  assert.deepEqual(
    normalizeApplicationCatalog(raw, {
      namespaces: new Map([["2200", "public"]]),
      objects: new Map(),
      collations: new Map(),
    }).defaultAcls,
    [{ role: "postgres", schema: null, objectType: "r", acl: null }],
  );
});

test("keeps sequence validation explicitly lower-bound based", () => {
  const source = [{ schema: "public", name: "id_seq", lastValue: "10", isCalled: true }];
  assert.equal(
    compareSequenceLowerBounds(source, [{ ...source[0], lastValue: "11", isCalled: false }])
      .nonMvccSequenceDriftCount,
    1,
  );
  assert.throws(
    () => compareSequenceLowerBounds(source, [{ ...source[0], lastValue: "9" }]),
    /SEQUENCE_REGRESSION/,
  );
});

test("requires an independently recomputed named ledger proof", () => {
  const lineage = [
    { schema: "auth", name: "schema_migrations", present: true, rows: [{ version: "1" }] },
  ];
  assert.equal(
    compareRestoredLedgers({
      capturedLineage: lineage,
      restoredLineage: structuredClone(lineage),
      expectedDigest: digest(lineage),
    }).ledgers[0],
    "auth.schema_migrations",
  );
  assert.throws(
    () =>
      compareRestoredLedgers({
        capturedLineage: lineage,
        restoredLineage: [],
        expectedDigest: digest(lineage),
      }),
    /LEDGER_MISMATCH/,
  );
  assert.throws(
    () =>
      compareRestoredLedgers({
        capturedLineage: lineage,
        restoredLineage: lineage,
        expectedDigest: "d".repeat(64),
      }),
    /LEDGER_BINDING_MISMATCH/,
  );
});

test("storage and vault proof permits counts only", () => {
  const empty = { storage: { buckets: 0, objects: 0 }, vault: { ssn_vault_key_count: 0 } };
  assert.deepEqual(compareServiceCounts(empty, structuredClone(empty)), {
    storageBuckets: 0,
    storageObjects: 0,
    ssnVaultKeyCount: 0,
  });
  assert.throws(
    () =>
      compareServiceCounts(empty, {
        storage: { buckets: 0, objects: 0 },
        vault: { ssn_vault_key_count: 0, value: "secret" },
      }),
    /SERVICE_SHAPE_INVALID/,
  );
  assert.throws(
    () =>
      compareServiceCounts(empty, {
        storage: { buckets: 0, objects: 1 },
        vault: { ssn_vault_key_count: 0 },
      }),
    /SERVICE_COUNTS_NONZERO/,
  );
});

test("returns the scoped baseline receipt and keeps release blocked", () => {
  const result = verifyApplicationBaseline(baselineInput());
  assert.equal(result.status, "LOCAL_APPLICATION_BASELINE_VERIFIED");
  assert.equal(result.releaseAdmission, "BLOCKED");
  assert.deepEqual(result.qualifiedRecoveryScopes, []);
  assert.equal(result.clones.cloneIds.length, 3);
  assert.equal(result.services.ssnVaultKeyCount, 0);
});

test("rejects clone reuse, code drift, and incomplete Auth/REST cleanup", () => {
  const input = baselineInput();
  input.clones.rehearsal.cloneId = input.clones.authRest.cloneId;
  assert.throws(() => verifyApplicationBaseline(input), /CLONE_ID_INVALID/);
  const codeDrift = baselineInput();
  codeDrift.clones.rehearsal.codeHashes = { "application-baseline.mjs": "d".repeat(64) };
  assert.throws(() => verifyApplicationBaseline(codeDrift), /CLONE_CODE_HASH_MISMATCH/);
  const cleanup = baselineInput();
  cleanup.authRest.cleanup.remaining = ["container"];
  assert.throws(() => verifyApplicationBaseline(cleanup), /AUTH_REST_CLEANUP_INVALID/);
});

test("the local query path is pinned to the bounded application catalog", () => {
  assert.match(APPLICATION_CATALOG_SQL, /relpersistence/);
  assert.match(APPLICATION_CATALOG_SQL, /attidentity/);
  assert.match(APPLICATION_CATALOG_SQL, /pg_default_acl/);
  assert.match(APPLICATION_CATALOG_SQL, /pg_sequence/);
});

test("parses and rejects ambiguous archive mappings without exporting data", () => {
  const toc = parseArchiveTableOfContents(
    [
      "2; 2615 2200 SCHEMA - public postgres",
      "3; 1259 50001 TABLE public notes postgres",
      "4; 826 60001 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES postgres",
    ].join("\n"),
  );
  assert.equal(toc.find((row) => row.type === "SCHEMA").name, "public");
  assert.equal(toc.find((row) => row.type === "DEFAULT ACL").schema, "public");
  assert.throws(
    () =>
      parseArchiveTableOfContents(
        ["2; 2615 2200 SCHEMA - public postgres", "3; 2615 2200 SCHEMA - auth postgres"].join("\n"),
      ),
    /TOC_AMBIGUOUS/,
  );
});
