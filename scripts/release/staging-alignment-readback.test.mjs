import assert from "node:assert/strict";
import test from "node:test";
import { canonicalDigest } from "./contract.mjs";
import { buildSourceReadback, compareSourceReadback } from "./staging-alignment-readback.mjs";

function fixture() {
  const role = { oid: 100, rolname: "cli_login_capture_fixture", rolcanlogin: true };
  const catalog = {
    roles: [{ oid: 10, rolname: "postgres" }],
    memberships: [],
    relations: [{ schema: "public", name: "cases" }],
  };
  const tables = [{ schema: "public", name: "cases", rows: 2, sha256: "a".repeat(64) }];
  const lineage = [{ schema: "supabase_migrations", name: "schema_migrations", present: false }];
  const sequences = [
    {
      schema: "public",
      name: "case_seq",
      lastValue: "2",
      isCalled: true,
      snapshotTreatment: "NON_MVCC_OBSERVATION",
    },
  ];
  const backup = {
    captureDigest: "9cd07f296ce4eab010bfa1391094c02e7299e4edc8872965e0e08b9eefb8e0de",
    capture: {
      captured: {
        capturedAt: "2026-09-24T15:25:23.402Z",
        snapshot: { temporaryLoginRoleDigest: canonicalDigest(role) },
      },
      loginRoleLifecycle: {
        roleDigest: canonicalDigest(role.rolname),
        exactRoleAbsent: true,
        poststateRoleCount: 0,
      },
    },
    schema: {
      before: {
        ...structuredClone(catalog),
        roles: [...catalog.roles, role],
        memberships: [{ roleid: 10, member: 100, grantor: 10 }],
      },
    },
    integrity: { tables, sequences },
    lineage,
  };
  const live = {
    database: "postgres",
    systemIdentifier: "7662742571317219726",
    catalog,
    tables: structuredClone(tables),
    lineage: structuredClone(lineage),
    sequences: structuredClone(sequences),
    cliRoles: 0,
  };
  return { backup, live };
}

test("exact cleaned source matches but never authorizes hosted apply", () => {
  const { backup, live } = fixture();
  const before = structuredClone(backup);
  const result = compareSourceReadback(backup, live);
  assert.equal(result.unchanged, true);
  assert.equal(result.eligibleForApply, false);
  assert.equal(result.releaseAdmission, "BLOCKED");
  assert.equal(result.comparedTables, 1);
  assert.deepEqual(backup, before);
});

test("row, definition, migration, sequence and foreign-role drift fail closed", () => {
  const changes = [
    (live) => {
      live.tables[0].sha256 = "b".repeat(64);
    },
    (live) => {
      live.catalog.relations[0].name = "renamed";
    },
    (live) => {
      live.lineage[0].present = true;
    },
    (live) => {
      live.sequences[0].lastValue = "3";
    },
    (live) => {
      live.cliRoles = 1;
      live.catalog.roles.push({ oid: 101, rolname: "cli_login_other" });
    },
    (live) => {
      live.catalog.memberships.push({ roleid: 10, member: 999, grantor: 10 });
    },
  ];
  for (const change of changes) {
    const { backup, live } = fixture();
    change(live);
    assert.equal(compareSourceReadback(backup, live).unchanged, false);
  }
});

test("wrong source identity, capture or incomplete role cleanup is rejected", () => {
  for (const change of [
    ({ live }) => {
      live.systemIdentifier = "production";
    },
    ({ live }) => {
      live.database = "minted_recovery";
    },
    ({ backup }) => {
      backup.captureDigest = "b".repeat(64);
    },
    ({ backup }) => {
      backup.capture.loginRoleLifecycle.exactRoleAbsent = false;
    },
    ({ backup }) => {
      backup.capture.loginRoleLifecycle.poststateRoleCount = 1;
    },
    ({ backup }) => {
      backup.capture.loginRoleLifecycle.roleDigest = "c".repeat(64);
    },
  ]) {
    const data = fixture();
    change(data);
    assert.throws(() => compareSourceReadback(data.backup, data.live));
  }
});

test("source SQL uses a read-only snapshot and rejects unsafe identifiers", () => {
  const { backup } = fixture();
  const sql = buildSourceReadback(backup);
  assert.match(sql, /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
  assert.match(sql, /statement_timeout='60s'/);
  assert.match(sql, /FROM ONLY "public"\."cases"/);
  assert.match(sql, /COMMIT;$/);
  backup.integrity.tables[0].name = 'cases"; DROP TABLE cases;';
  assert.throws(() => buildSourceReadback(backup), /IDENTIFIER_REJECTED/);
});
