import { describe, expect, it, vi } from "vitest";
import { proveSharedPortal, recordSharedTestFill, resolveTelemetryOrgId } from "./sharedDryRun";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const FILL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAP_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STARTED_AT = "2026-09-25T12:00:00.000Z";
const COMPLETED_AT = "2026-09-25T12:01:00.000Z";

function recordingDb() {
  const sessions = new Map<string, Record<string, unknown>>();
  const insertedRows: Record<string, unknown>[] = [];
  const auditRows: Record<string, unknown>[] = [];
  return {
    auditRows,
    insertedRows,
    sessions,
    db: {
      from(table: string) {
        if (table === "memberships") {
          return {
            select() {
              return {
                async eq() {
                  return {
                    data: [{ org_id: ORG_ID, role: "admin", organizations: { name: "Minted" } }],
                    error: null,
                  };
                },
              };
            },
          };
        }
        if (table === "audit_log") {
          return {
            async insert(row: Record<string, unknown>) {
              auditRows.push(row);
              return { error: null };
            },
          };
        }
        if (table !== "fill_sessions") throw new Error(`unexpected table ${table}`);
        const filters: Record<string, unknown> = {};
        let pendingInsert: Record<string, unknown> | null = null;
        const query: Record<string, unknown> = {};
        query.select = () => query;
        query.eq = (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        };
        query.maybeSingle = async () => ({
          data:
            [...sessions.values()].find((row) =>
              Object.entries(filters).every(([column, value]) => row[column] === value),
            ) ?? null,
          error: null,
        });
        query.insert = (row: Record<string, unknown>) => {
          pendingInsert = row;
          insertedRows.push(row);
          return query;
        };
        query.single = async () => {
          const insert = pendingInsert as Record<string, unknown> | null;
          const row: Record<string, unknown> = {
            ...(insert ?? {}),
            started_at: insert?.started_at ?? STARTED_AT,
          };
          sessions.set(String(row.id), row);
          return { data: row, error: null };
        };
        return query;
      },
    },
  };
}

function v2ManualEvent(targetKey = "t_cccccccc-cccc-4ccc-8ccc-cccccccccccc") {
  return {
    schemaVersion: 2,
    fieldsAttempted: 0,
    fieldsVerified: 0,
    fieldsRejected: 0,
    fieldOutcomes: [
      {
        mapId: MAP_ID,
        targetKey,
        frameKey: null,
        stepKey: null,
        attempted: false,
        outcome: "manual",
        reasonCode: "manual_required",
      },
    ],
  } as const;
}

function membershipsDb(orgs: Array<{ orgId: string; orgName: string }>) {
  return {
    from(table: string) {
      if (table !== "memberships") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({
                data: orgs.map((o) => ({
                  org_id: o.orgId,
                  role: "admin",
                  organizations: { name: o.orgName },
                })),
                error: null,
              });
            },
          };
        },
      };
    },
  };
}

describe("resolveTelemetryOrgId", () => {
  const o1 = "11111111-1111-4111-8111-111111111111";
  const o2 = "22222222-2222-4222-8222-222222222222";

  it("uses the sole membership when orgId is omitted", async () => {
    const result = await resolveTelemetryOrgId(
      { db: membershipsDb([{ orgId: o1, orgName: "A" }]) as never, userId: "u1" },
      null,
    );
    expect(result).toEqual({ kind: "ok", orgId: o1 });
  });

  it("requires orgId for multi-org callers", async () => {
    const result = await resolveTelemetryOrgId(
      {
        db: membershipsDb([
          { orgId: o1, orgName: "A" },
          { orgId: o2, orgName: "B" },
        ]) as never,
        userId: "u1",
      },
      null,
    );
    expect(result).toMatchObject({ kind: "rejected", status: 400 });
  });

  it("accepts a membership-checked preferred orgId", async () => {
    const result = await resolveTelemetryOrgId(
      {
        db: membershipsDb([
          { orgId: o1, orgName: "A" },
          { orgId: o2, orgName: "B" },
        ]) as never,
        userId: "u1",
      },
      o2,
    );
    expect(result).toEqual({ kind: "ok", orgId: o2 });
  });
});

describe("recordSharedTestFill", () => {
  it("rejects a non-uuid id before any write", async () => {
    const db = { from: vi.fn() };
    const result = await recordSharedTestFill(
      { db: db as never, userId: "u1" },
      {
        id: "not-a-uuid",
        portalKey: "aetna",
        fieldsFilled: 1,
      },
    );
    expect(result).toMatchObject({ kind: "rejected", status: 422 });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("sanitizes legacy skips before persistence and preserves v1 audit behavior", async () => {
    const fixture = recordingDb();
    const result = await recordSharedTestFill(
      { db: fixture.db as never, userId: "u1" },
      {
        id: FILL_ID,
        orgId: ORG_ID,
        portalKey: "Aetna",
        fieldsFilled: 1,
        fieldsSkipped: [
          {
            selector: "#secret-value-control",
            label: "Secret provider value",
            reason: "secret free text must be dropped",
            kind: "no_value",
            actualValue: "synthetic-secret",
          },
        ],
      },
    );

    expect(result.kind).toBe("created");
    expect(fixture.insertedRows[0]?.fields_skipped).toEqual([
      { label: "", reason: "missing_value", kind: "no_value", mapId: null },
    ]);
    expect(JSON.stringify(fixture.insertedRows[0])).not.toContain("synthetic-secret");
    expect(JSON.stringify(fixture.insertedRows[0])).not.toContain("Secret provider value");
    expect(fixture.auditRows).toHaveLength(1);
  });

  it("persists derived V2 metadata without duplicate service audit and conflicts on changed replay", async () => {
    const fixture = recordingDb();
    const ctx = { db: fixture.db as never, userId: "u1" };
    const event = v2ManualEvent();
    const input = {
      id: FILL_ID,
      orgId: ORG_ID,
      portalKey: "Aetna",
      fieldsFilled: 0,
      fieldsSkipped: [{ label: "raw label ignored", reason: "raw reason ignored" }],
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
      ...event,
    };

    const created = await recordSharedTestFill(ctx, input);
    expect(created.kind).toBe("created");
    expect(fixture.insertedRows[0]).toMatchObject({
      event_schema_version: 2,
      fields_attempted: 0,
      fields_verified: 0,
      fields_rejected: 0,
      fields_filled: 0,
      fields_skipped: [{ label: "", reason: "manual_required", kind: "manual", mapId: MAP_ID }],
      docs_attached: null,
    });
    expect(fixture.insertedRows[0]?.field_outcomes).toEqual(event.fieldOutcomes);
    expect(fixture.auditRows).toHaveLength(0);

    const duplicate = await recordSharedTestFill(ctx, input);
    expect(duplicate.kind).toBe("duplicate");
    expect(fixture.insertedRows).toHaveLength(1);

    const changed = await recordSharedTestFill(ctx, {
      ...input,
      fieldOutcomes: v2ManualEvent("t_dddddddd-dddd-4ddd-8ddd-dddddddddddd").fieldOutcomes,
    });
    expect(changed).toMatchObject({ kind: "rejected", status: 409 });
    expect(fixture.insertedRows).toHaveLength(1);

    const downgraded = await recordSharedTestFill(ctx, {
      id: FILL_ID,
      orgId: ORG_ID,
      portalKey: "Aetna",
      fieldsFilled: 0,
      fieldsSkipped: [],
    });
    expect(downgraded).toMatchObject({ kind: "rejected", status: 409 });
    expect(fixture.insertedRows).toHaveLength(1);
  });
});

describe("proveSharedPortal", () => {
  it("rejects when neither portalKey nor id is given", async () => {
    const result = await proveSharedPortal({ db: {} as never, userId: "u1" }, {});
    expect(result).toMatchObject({ kind: "rejected", status: 422 });
  });
});
