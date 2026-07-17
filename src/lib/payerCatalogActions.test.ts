import { describe, expect, it } from "vitest";
import {
  assignmentsByPayerId,
  catalogAction,
  isActiveAssignment,
  payerSetupEmptyState,
} from "./payerCatalogActions";
import { filterDirectoryRows } from "./payerDirectory";
import type { OrgPayerAssignment, Payer } from "@/types";

function mkPayer(over: Partial<Payer> & { id: string }): Payer {
  return {
    orgId: null as unknown as string, // global-catalog row (org_id NULL)
    name: over.id,
    isActive: true,
    avgDecisionDays: null,
    createdAt: "2026-07-15T00:00:00Z",
    ...over,
  };
}

function mkAssign(payerId: string, status?: "active" | "archived"): OrgPayerAssignment {
  return {
    id: `opa-${payerId}`,
    orgId: "org-1",
    payerId,
    starter: false,
    status,
    archivedAt: status === "archived" ? "2026-07-15T00:00:00Z" : null,
    createdAt: "2026-07-15T00:00:00Z",
  };
}

describe("isActiveAssignment", () => {
  it("treats a missing status as active (pre-hardening rows/fixtures)", () => {
    expect(isActiveAssignment({ status: undefined })).toBe(true);
  });
  it("is true for active, false for archived, false for null", () => {
    expect(isActiveAssignment({ status: "active" })).toBe(true);
    expect(isActiveAssignment({ status: "archived" })).toBe(false);
    expect(isActiveAssignment(null)).toBe(false);
    expect(isActiveAssignment(undefined)).toBe(false);
  });
});

describe("catalogAction", () => {
  const empty = new Map<string, Payer>();

  it("active subscription → added", () => {
    const p = mkPayer({ id: "p1" });
    expect(catalogAction(p, mkAssign("p1", "active"), empty)).toEqual({ kind: "added" });
    // A missing-status (pre-hardening) subscription also reads as added.
    expect(catalogAction(p, mkAssign("p1"), empty)).toEqual({ kind: "added" });
  });

  it("no subscription on an active payer → add", () => {
    const p = mkPayer({ id: "p1", status: "active" });
    expect(catalogAction(p, undefined, empty)).toEqual({ kind: "add" });
    // A payer with no catalog status defaults to active/addable.
    expect(catalogAction(mkPayer({ id: "p1" }), null, empty)).toEqual({ kind: "add" });
  });

  it("archived subscription on an active payer → reactivate", () => {
    const p = mkPayer({ id: "p1", status: "active" });
    expect(catalogAction(p, mkAssign("p1", "archived"), empty)).toEqual({ kind: "reactivate" });
  });

  it("merged payer → unavailable with the canonical successor", () => {
    const successor = mkPayer({ id: "p2", name: "BCBS-NC (new entity)" });
    const merged = mkPayer({ id: "p1", status: "merged", mergedIntoId: "p2" });
    const byId = new Map([["p2", successor]]);
    expect(catalogAction(merged, undefined, byId)).toEqual({
      kind: "unavailable",
      reason: "merged",
      successor,
    });
  });

  it("retired payer → unavailable with no successor", () => {
    const retired = mkPayer({ id: "p1", status: "retired" });
    expect(catalogAction(retired, undefined, empty)).toEqual({
      kind: "unavailable",
      reason: "retired",
      successor: null,
    });
  });

  it("merged payer with an unknown merged_into_id → unavailable, successor null", () => {
    const merged = mkPayer({ id: "p1", status: "merged", mergedIntoId: "gone" });
    expect(catalogAction(merged, undefined, empty)).toEqual({
      kind: "unavailable",
      reason: "merged",
      successor: null,
    });
  });

  it("an ACTIVE subscription takes precedence over a retired/merged catalog status", () => {
    // Already subscribed before the payer retired — still 'added', never blocked.
    const retired = mkPayer({ id: "p1", status: "retired" });
    expect(catalogAction(retired, mkAssign("p1", "active"), empty)).toEqual({ kind: "added" });
  });

  it("alias search then add: a payer found by alias is addable", () => {
    const p = mkPayer({ id: "p1", name: "Blue Cross NC", aliases: ["BCBS-NC", "Anthem NC"] });
    const found = filterDirectoryRows([p], { query: "anthem", state: "all", kind: "all" });
    expect(found).toHaveLength(1);
    expect(catalogAction(found[0], undefined, new Map([["p1", p]]))).toEqual({ kind: "add" });
  });
});

describe("assignmentsByPayerId", () => {
  it("indexes assignments by payer id", () => {
    const a = mkAssign("p1", "active");
    const b = mkAssign("p2", "archived");
    const map = assignmentsByPayerId([a, b]);
    expect(map.get("p1")).toBe(a);
    expect(map.get("p2")).toBe(b);
    expect(map.get("nope")).toBeUndefined();
  });
});

describe("payerSetupEmptyState", () => {
  it("no active subscriptions → no_payers", () => {
    expect(payerSetupEmptyState([])).toBe("no_payers");
    expect(payerSetupEmptyState([mkAssign("p1", "archived")])).toBe("no_payers");
  });
  it("at least one active subscription → no_scope", () => {
    expect(payerSetupEmptyState([mkAssign("p1", "active")])).toBe("no_scope");
    // A pre-hardening (missing status) subscription counts as active.
    expect(payerSetupEmptyState([mkAssign("p1")])).toBe("no_scope");
    expect(payerSetupEmptyState([mkAssign("p1", "archived"), mkAssign("p2", "active")])).toBe(
      "no_scope",
    );
  });
});
