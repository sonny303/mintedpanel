import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { camelizeRow } from "../../src/lib/case";
import type { AuditInput } from "../../src/lib/audit";
import { LICENSE_SNAPSHOT_COLUMNS } from "../../src/lib/licenseCommands";
import { updateProviderWithLicenses, type LicenseInput } from "../../src/services/providers";
import type { StateLicense } from "../../src/services/lookups";
import {
  LicenseSqlBridge,
  WriterSession,
  literal,
  sql,
  storedRows,
  waitForBlockedMutation,
} from "./license-sql-bridge";

// The injected client below is real supabase-js. The unused browser singleton
// must be inert: no .env loading, hosted URL, auth store, or external request.
vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: null }));

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const PROVIDER = "33333333-3333-4333-8333-333333333333";
const OTHER_PROVIDER = "44444444-4444-4444-8444-444444444444";
const TARGET = "55555555-5555-4555-8555-555555555555";
const UNRELATED = "66666666-6666-4666-8666-666666666666";
const FOREIGN_PROVIDER = "77777777-7777-4777-8777-777777777777";
const FOREIGN_ORG = "88888888-8888-4888-8888-888888888888";
const USER = "99999999-9999-4999-8999-999999999999";
const CREATED = "2026-09-18T16:00:00+00:00";
const valuesOf = (row: StateLicense): LicenseInput => ({
  state: row.state,
  licenseNumber: row.licenseNumber,
  licenseType: row.licenseType,
  issueDate: row.issueDate,
  expirationDate: row.expirationDate,
  verifiedStatus: row.verifiedStatus,
  verificationSourceUrl: row.verificationSourceUrl,
});

let bridge: LicenseSqlBridge;
let writer: WriterSession | undefined;
let baseline: Record<string, unknown>[];
let expected: StateLicense;
let audit: Mock<(input: AuditInput) => Promise<void>>;
const ctx = () => ({ db: bridge.client, orgId: ORG, userId: USER, writeAudit: audit });
const update = () => ({
  type: "update" as const,
  id: TARGET,
  expected,
  values: { ...valuesOf(expected), licenseNumber: "USER-EDIT" },
});

beforeEach(async () => {
  bridge = new LicenseSqlBridge();
  audit = vi.fn(async () => undefined);
  await sql(`
    TRUNCATE state_licenses, providers;
    INSERT INTO providers (id, org_id, first_name, last_name)
    VALUES (${literal(PROVIDER)}, ${literal(ORG)}, 'Synthetic', 'Provider'),
           (${literal(OTHER_PROVIDER)}, ${literal(ORG)}, 'Synthetic', 'Other');
    INSERT INTO state_licenses (id, org_id, provider_id, state, license_number, created_at)
    VALUES (${literal(TARGET)}, ${literal(ORG)}, ${literal(PROVIDER)}, 'CO', NULL, ${literal(CREATED)}),
           (${literal(UNRELATED)}, ${literal(ORG)}, ${literal(PROVIDER)}, 'TX', 'TX-222', ${literal(CREATED)}),
           (${literal(FOREIGN_PROVIDER)}, ${literal(ORG)}, ${literal(OTHER_PROVIDER)}, 'OR', 'OR-333', ${literal(CREATED)}),
           (${literal(FOREIGN_ORG)}, ${literal(OTHER_ORG)}, ${literal(PROVIDER)}, 'ID', 'ID-444', ${literal(CREATED)});
  `);
  baseline = await storedRows();
  expected = camelizeRow<StateLicense>(baseline.find((row) => row.id === TARGET));
});

afterEach(async () => {
  await writer?.close();
  writer = undefined;
});

/** B starts only when production code has completed preflight and sent a write.
 * A then blocks on B's uncommitted row version. A's actual WHERE must be
 * rechecked by PostgreSQL after B commits, yielding zero affected rows. */
function interleave(change: string) {
  let readBeforeWrite = false;
  let blocked = false;
  bridge.beforeMutation = async (request) => {
    if (request.table !== "state_licenses") return;
    readBeforeWrite = bridge.requests.some(
      (r) => r.table === "state_licenses" && r.method === "GET",
    );
    expect(readBeforeWrite).toBe(true);
    writer = new WriterSession();
    const isolation = await writer.query(
      `SET application_name = 'p03_writer'; BEGIN ISOLATION LEVEL READ COMMITTED; SHOW transaction_isolation; ${change}`,
    );
    expect(isolation).toBe("read committed");
  };
  bridge.afterMutationStarted = async (request) => {
    if (request.table !== "state_licenses") return;
    await waitForBlockedMutation();
    blocked = true;
    await writer!.query("COMMIT;");
  };
  return () => {
    expect(readBeforeWrite).toBe(true);
    expect(blocked).toBe(true);
    const request = bridge.requests.find((r) => r.table === "state_licenses" && r.method !== "GET");
    expect(request?.resultRowCount).toBe(0);
  };
}

function assertFullPredicate(method: string) {
  const request = bridge.requests.find((r) => r.table === "state_licenses" && r.method === method);
  expect(request).toBeDefined();
  // Independently enumerate the persisted fields, so a shortened production
  // constant cannot silently weaken this acceptance condition.
  const required = [
    "id",
    "org_id",
    "provider_id",
    "state",
    "license_number",
    "license_type",
    "issue_date",
    "expiration_date",
    "status",
    "created_at",
    "verified_status",
    "verified_at",
    "verified_by",
    "verification_source_url",
  ];
  expect(Object.keys(LICENSE_SNAPSHOT_COLUMNS).sort()).toEqual([...required].sort());
  const row = baseline.find((item) => item.id === TARGET)!;
  for (const column of required) {
    const actual = request!.url.searchParams.getAll(column);
    expect(actual, column).toContain(row[column] === null ? "is.null" : `eq.${row[column]}`);
  }
}

describe("P03 production license commands against isolated PostgreSQL", () => {
  it("applies null-safe conditional update while all unrelated rows stay identical", async () => {
    await updateProviderWithLicenses(PROVIDER, { patch: {}, licenseCommands: [update()] }, ctx());
    assertFullPredicate("PATCH");
    const rows = await storedRows();
    expect(rows.filter((r) => r.id !== TARGET)).toEqual(baseline.filter((r) => r.id !== TARGET));
    expect(rows.find((r) => r.id === TARGET)?.license_number).toBe("USER-EDIT");
    expect(audit).toHaveBeenCalled();
  });

  it("inserts only the intended third license without modifying the two stored licenses", async () => {
    await updateProviderWithLicenses(
      PROVIDER,
      {
        patch: {},
        licenseCommands: [
          { type: "add", values: { ...valuesOf(expected), state: "NM", licenseNumber: "NM-NEW" } },
        ],
      },
      ctx(),
    );
    const rows = await storedRows();
    expect(rows.filter((row) => baseline.some((before) => before.id === row.id))).toEqual(baseline);
    expect(rows.filter((row) => row.org_id === ORG && row.provider_id === PROVIDER)).toHaveLength(
      3,
    );
    expect(bridge.requests.filter((r) => ["PATCH", "DELETE"].includes(r.method))).toHaveLength(0);
  });

  it("generates no UPDATE for an unchanged license", async () => {
    await updateProviderWithLicenses(
      PROVIDER,
      { patch: {}, licenseCommands: [{ ...update(), values: valuesOf(expected) }] },
      ctx(),
    );
    expect(bridge.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
    expect(await storedRows()).toEqual(baseline);
  });

  it("preserves another writer's unrelated addition and edit after the service preflight", async () => {
    bridge.beforeMutation = async (request) => {
      if (request.table !== "state_licenses") return;
      expect(bridge.requests.some((r) => r.table === "state_licenses" && r.method === "GET")).toBe(
        true,
      );
      await sql(`
        UPDATE state_licenses SET license_number = 'TX-CONCURRENT' WHERE id = ${literal(UNRELATED)};
        INSERT INTO state_licenses (id, org_id, provider_id, state, license_number, created_at)
        VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ${literal(ORG)}, ${literal(PROVIDER)}, 'NM', 'NM-CONCURRENT', ${literal(CREATED)});
      `);
    };
    await updateProviderWithLicenses(PROVIDER, { patch: {}, licenseCommands: [update()] }, ctx());
    const rows = await storedRows();
    expect(rows).toHaveLength(baseline.length + 1);
    expect(rows.find((r) => r.id === TARGET)).toEqual({
      ...baseline.find((r) => r.id === TARGET),
      license_number: "USER-EDIT",
    });
    expect(rows.find((r) => r.id === UNRELATED)).toEqual({
      ...baseline.find((r) => r.id === UNRELATED),
      license_number: "TX-CONCURRENT",
    });
    expect(rows.find((r) => r.id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")?.license_number).toBe(
      "NM-CONCURRENT",
    );
    expect(rows.filter((r) => r.id === FOREIGN_ORG || r.id === FOREIGN_PROVIDER)).toEqual(
      baseline.filter((r) => r.id === FOREIGN_ORG || r.id === FOREIGN_PROVIDER),
    );
  });

  it("explicitly removes only its authorized target with null-safe predicates", async () => {
    await updateProviderWithLicenses(
      PROVIDER,
      { patch: {}, licenseCommands: [{ type: "remove", id: TARGET, expected }] },
      ctx(),
    );
    assertFullPredicate("DELETE");
    expect(await storedRows()).toEqual(baseline.filter((row) => row.id !== TARGET));
  });

  for (const foreignId of [FOREIGN_PROVIDER, FOREIGN_ORG]) {
    it(`rejects a target outside the active provider/org: ${foreignId}`, async () => {
      const foreign = camelizeRow<StateLicense>(baseline.find((r) => r.id === foreignId));
      await expect(
        updateProviderWithLicenses(
          PROVIDER,
          { patch: {}, licenseCommands: [{ type: "remove", id: foreignId, expected: foreign }] },
          ctx(),
        ),
      ).rejects.toMatchObject({ name: "ProviderSaveError", requiresReload: true });
      expect(bridge.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
      expect(await storedRows()).toEqual(baseline);
    });
  }

  const changedFields: Array<[string, string]> = [
    ["id", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    ["org_id", OTHER_ORG],
    ["provider_id", OTHER_PROVIDER],
    ["state", "UT"],
    ["license_number", "CONCURRENT"],
    ["license_type", "full"],
    ["issue_date", "2026-09-19"],
    ["expiration_date", "2030-09-19"],
    ["status", "inactive"],
    ["created_at", "2026-09-19T16:00:00+00:00"],
    ["verified_status", "failed"],
    ["verified_at", "2026-09-19T16:00:00+00:00"],
    ["verified_by", USER],
    ["verification_source_url", "https://synthetic.invalid/board"],
  ];
  it.each(changedFields)(
    "rechecks the actual UPDATE after writer B changes %s while holding the row lock",
    async (column, value) => {
      const verifyBarrier = interleave(
        `UPDATE state_licenses SET ${column} = ${literal(value)} WHERE id = ${literal(TARGET)};`,
      );
      await expect(
        updateProviderWithLicenses(PROVIDER, { patch: {}, licenseCommands: [update()] }, ctx()),
      ).rejects.toMatchObject({ name: "ProviderSaveError", requiresReload: true });
      verifyBarrier();
      assertFullPredicate("PATCH");
      const rows = await storedRows();
      const changedId = column === "id" ? value : TARGET;
      const survivor = rows.find((r) => r.id === changedId)!;
      const original = baseline.find((r) => r.id === TARGET)!;
      expect(survivor).toEqual({ ...original, [column]: value });
      expect(rows.filter((r) => r.id !== changedId)).toEqual(
        baseline.filter((r) => r.id !== TARGET),
      );
    },
  );

  it("does not delete a row edited by writer B after the service read", async () => {
    const verifyBarrier = interleave(
      `UPDATE state_licenses SET license_number = 'CONCURRENT' WHERE id = ${literal(TARGET)};`,
    );
    await expect(
      updateProviderWithLicenses(
        PROVIDER,
        { patch: {}, licenseCommands: [{ type: "remove", id: TARGET, expected }] },
        ctx(),
      ),
    ).rejects.toMatchObject({ name: "ProviderSaveError", requiresReload: true });
    verifyBarrier();
    assertFullPredicate("DELETE");
    expect(await storedRows()).toEqual(
      baseline.map((row) => (row.id === TARGET ? { ...row, license_number: "CONCURRENT" } : row)),
    );
  });

  it.each(["update", "remove"] as const)(
    "rejects %s when writer B deletes the target after the service read without recreating it",
    async (type) => {
      const verifyBarrier = interleave(`DELETE FROM state_licenses WHERE id = ${literal(TARGET)};`);
      const command = type === "update" ? update() : { type, id: TARGET, expected };
      await expect(
        updateProviderWithLicenses(PROVIDER, { patch: {}, licenseCommands: [command] }, ctx()),
      ).rejects.toMatchObject({ name: "ProviderSaveError", requiresReload: true });
      verifyBarrier();
      assertFullPredicate(type === "update" ? "PATCH" : "DELETE");
      expect(await storedRows()).toEqual(baseline.filter((row) => row.id !== TARGET));
    },
  );

  it("reports an incomplete save and only confirmed audit effects after an earlier provider write persists", async () => {
    const verifyBarrier = interleave(
      `UPDATE state_licenses SET license_number = 'CONCURRENT' WHERE id = ${literal(TARGET)};`,
    );
    await expect(
      updateProviderWithLicenses(
        PROVIDER,
        { patch: { firstName: "Persisted" }, licenseCommands: [update()] },
        ctx(),
      ),
    ).rejects.toMatchObject({
      name: "ProviderSaveError",
      requiresReload: true,
      outcome: {
        failedStage: "license:update",
        auditStatus: "recorded",
        applied: [
          expect.objectContaining({ table: "providers", operation: "update", ids: [PROVIDER] }),
        ],
      },
    });
    verifyBarrier();
    expect(await sql(`SELECT first_name FROM providers WHERE id = ${literal(PROVIDER)};`)).toBe(
      "Persisted",
    );
    expect(await storedRows()).toEqual(
      baseline.map((row) => (row.id === TARGET ? { ...row, license_number: "CONCURRENT" } : row)),
    );
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0][0]).toMatchObject({
      after: {
        outcome: "incomplete",
        failedStage: "license:update",
        applied: [
          expect.objectContaining({ table: "providers", operation: "update", ids: [PROVIDER] }),
        ],
        diff: { updated: 0, inserted: 0, deleted: 0 },
      },
    });
  });
});
