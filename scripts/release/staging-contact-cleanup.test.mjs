import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContactCleanupSql,
  buildContactCleanupInspectionSql,
} from "./staging-contact-cleanup.mjs";

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const fingerprint = () => ({ count: 10, hash: "a".repeat(32) });
function fixture() {
  const rows = (start, count) =>
    Array.from({ length: count }, (_, index) => ({ id: id(start + index), hash: "b".repeat(32) }));
  const orgContexts = [
    { partyId: id(1), orgId: id(101), basis: "party_role_assignment", referenceId: id(11) },
    { partyId: id(1), orgId: id(102), basis: "party_role_assignment", referenceId: id(12) },
    { partyId: id(1), orgId: id(101), basis: "party_role_assignment", referenceId: id(13) },
    ...[2, 3, 4, 5].map((number) => ({
      partyId: id(number),
      orgId: id(100 + number),
      basis: "party_capture_link",
      referenceId: id(19 + number),
    })),
  ];
  const pairs = [
    ...new Map(orgContexts.map((row) => [`${row.partyId}:${row.orgId}`, row])).values(),
  ];
  return {
    version: 1,
    projectRef: "vmznysvietfaddakkegt",
    sourceRef: "a".repeat(40),
    capturedAt: "2026-09-23T04:32:54Z",
    runMarker: "aud-07-synthetic-fixture-only",
    tables: {
      parties: { targets: rows(1, 5), untouched: fingerprint() },
      party_role_assignments: { targets: rows(11, 3), untouched: fingerprint() },
      party_capture_links: { targets: rows(21, 4), untouched: fingerprint() },
    },
    auditBaseline: fingerprint(),
    orgContexts,
    auditRows: pairs.map((row, index) => ({
      id: id(201 + index),
      partyId: row.partyId,
      orgId: row.orgId,
    })),
    preserved: Object.fromEntries(
      [
        "providers",
        "facilities",
        "organizations",
        "memberships",
        "notes",
        "communication_event",
      ].map((table) => [table, fingerprint()]),
    ),
  };
}
const local = (mode = "rehearse-rollback") => ({
  mode,
  isolation: {
    systemIdentifier: "7669999999999999999",
    restoreRunId: "1".repeat(16),
    targetDigest: "2".repeat(64),
  },
});
const reject = (mutate, options = { mode: "hosted-commit" }) => {
  const value = fixture();
  mutate(value);
  assert.throws(() => buildContactCleanupSql(value, options), /STAGING_CONTACT_CLEANUP_REJECTED/);
};

test("fixed staging transaction carries one exact deletion scope and six known audits", () => {
  const result = buildContactCleanupSql(fixture(), { mode: "hosted-commit" });
  assert.match(result.sql, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(result.sql, /v_cluster='7662742571317219726'/);
  assert.match(result.sql, /IN SHARE ROW EXCLUSIVE MODE/);
  assert.equal((result.sql.match(/DELETE FROM public\./g) ?? []).length, 1);
  assert.match(result.sql, /INSERT INTO public.audit_log \(id,org_id/);
  assert.doesNotMatch(
    result.sql,
    /DELETE FROM public\.(audit_log|credential_cases|providers|facilities)/,
  );
  assert.match(result.sql, /AUD07 FK closure changed/);
  assert.match(result.sql, /AUD07 trigger effects changed/);
  assert.match(result.sql, /AUD07 other public rows changed/);
  assert.match(result.sql, /COMMIT;\s*$/);
});
test("rehearsal can roll back, or restore original rows while retaining the audit append", () => {
  assert.match(buildContactCleanupSql(fixture(), local()).sql, /ROLLBACK;\s*$/);
  const restored = buildContactCleanupSql(fixture(), local("rehearse-restore")).sql;
  assert.match(restored, /jsonb_populate_recordset\(NULL::public.parties,v_saved_parties\)/);
  assert.match(restored, /six audit rows retained/);
  assert.match(restored, /COMMIT;\s*$/);
  assert.doesNotMatch(restored, /COPY|pg_read_file|dblink|http|DELETE FROM public.audit_log/);
});
test("production identity and unsupported mode/overrides cannot generate SQL", () => {
  reject((m) => {
    m.projectRef = "production";
  });
  for (const systemIdentifier of ["7662742571317219726", "7642734024280108049"]) {
    const options = local();
    options.isolation.systemIdentifier = systemIdentifier;
    reject(() => {}, options);
  }
  reject(() => {}, { mode: "hosted-commit", projectRef: "production" });
  reject(() => {}, { mode: "rehearse-commit", isolation: local().isolation });
});
test("scope expansion, unknown keys, duplicate IDs and SQL-bearing values fail closed", () => {
  reject((m) => {
    m.tables.parties.targets.push({ id: id(6), hash: "b".repeat(32) });
  });
  reject((m) => {
    m.tables.credential_cases = m.tables.parties;
  });
  reject((m) => {
    m.tables.parties.targets[1].id = m.tables.parties.targets[0].id;
  });
  reject((m) => {
    m.tables.parties.targets[0].id = "'); DELETE FROM public.providers; --";
  });
  reject((m) => {
    m.runMarker = "'; COMMIT; --";
  });
  reject((m) => {
    m.preserved.providers.count = -1;
  });
});
test("all dependent IDs must bind to the target contacts and to six real organization contexts", () => {
  reject((m) => {
    m.orgContexts[0].partyId = id(999);
  });
  reject((m) => {
    m.orgContexts[0].referenceId = id(999);
  });
  reject((m) => {
    m.orgContexts[0].referenceId = m.orgContexts[1].referenceId;
  });
  reject((m) => {
    m.orgContexts[0].basis = "guessed_creator_org";
  });
  reject((m) => {
    m.orgContexts[0].orgId = id(999);
  });
});
test("each audit ID is unique and exactly one audit binds each allowed party/org pair", () => {
  reject((m) => {
    m.auditRows[1].id = m.auditRows[0].id;
  });
  reject((m) => {
    m.auditRows[0].id = m.tables.parties.targets[0].id;
  });
  reject((m) => {
    m.auditRows[0].orgId = id(999);
  });
  reject((m) => {
    m.auditRows[1] = { ...m.auditRows[0], id: id(999) };
  });
  reject((m) => {
    m.auditRows.pop();
  });
});
test("artifact fingerprints are stable, content sensitive, and bind generated SQL", () => {
  const value = fixture();
  const first = buildContactCleanupSql(value, { mode: "hosted-commit" });
  assert.deepEqual(
    first,
    buildContactCleanupSql(structuredClone(value), { mode: "hosted-commit" }),
  );
  value.tables.parties.targets[0].hash = "c".repeat(32);
  const second = buildContactCleanupSql(value, { mode: "hosted-commit" });
  assert.notEqual(first.manifestSha256, second.manifestSha256);
  assert.notEqual(first.sqlSha256, second.sqlSha256);
  assert.match(first.sql, new RegExp(first.manifestSha256));
});

test("uncertain-result inspection is staging-pinned, read-only and emits only aggregates", () => {
  const sql = buildContactCleanupInspectionSql(fixture());
  assert.match(sql, /BEGIN READ ONLY/);
  assert.match(sql, /system_identifier::text FROM pg_control_system/);
  assert.match(sql, /7662742571317219726/);
  assert.match(sql, /known_audit_id_count/);
  assert.match(sql, /exact_audits_match/);
  assert.match(sql, /original_audits_match/);
  assert.match(sql, /target_hashes_match/);
  assert.match(sql, /THEN 'APPLIED'/);
  assert.match(sql, /THEN 'NOT_APPLIED'/);
  assert.match(sql, /ELSE 'INCONSISTENT'/);
  assert.doesNotMatch(
    sql,
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\s+(INTO|FROM|TABLE|public\.)/,
  );
  const value = fixture();
  value.projectRef = "production";
  assert.throws(() => buildContactCleanupInspectionSql(value), /STAGING_CONTACT_CLEANUP_REJECTED/);
});
