import { describe, expect, it, vi } from "vitest";
import { proveSharedPortal, recordSharedTestFill, resolveTelemetryOrgId } from "./sharedDryRun";

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
});

describe("proveSharedPortal", () => {
  it("rejects when neither portalKey nor id is given", async () => {
    const result = await proveSharedPortal({ db: {} as never, userId: "u1" }, {});
    expect(result).toMatchObject({ kind: "rejected", status: 422 });
  });
});
