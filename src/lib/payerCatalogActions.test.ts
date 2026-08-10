import { describe, expect, it } from "vitest";
import {
  catalogAction,
  isActiveAssignment,
  payerSetupEmptyState,
} from "./payerCatalogActions";
import type { OrgPayerAssignment, Payer } from "@/types";

function mkPayer(over: Partial<Payer> = {}): Payer {
  return {
    id: "p1",
    orgId: null,
    name: "BCBS",
    status: "active",
    ...over,
  } as Payer;
}

function mkAssign(
  payerId: string,
  status: OrgPayerAssignment["status"] = "active",
): OrgPayerAssignment {
  return {
    id: "a1",
    orgId: "org-1",
    payerId,
    status,
    archivedAt: status === "archived" ? "2026-01-01T00:00:00Z" : null,
    starter: false,
    createdAt: "2026-01-01T00:00:00Z",
  } as OrgPayerAssignment;
}

describe("isActiveAssignment (dormant helper)", () => {
  it("treats missing status as active", () => {
    expect(isActiveAssignment({ status: undefined } as OrgPayerAssignment)).toBe(true);
  });
  it("reads status", () => {
    expect(isActiveAssignment({ status: "active" } as OrgPayerAssignment)).toBe(true);
    expect(isActiveAssignment({ status: "archived" } as OrgPayerAssignment)).toBe(false);
    expect(isActiveAssignment(null)).toBe(false);
    expect(isActiveAssignment(undefined)).toBe(false);
  });
});

describe("catalogAction — OPA-RETIRE target membership", () => {
  const empty = new Map<string, Payer>();

  it("inNetwork → added", () => {
    const p = mkPayer();
    expect(catalogAction(p, true, empty)).toEqual({ kind: "added" });
  });

  it("not in network + active → add", () => {
    expect(catalogAction(mkPayer(), false, empty)).toEqual({ kind: "add" });
  });

  it("merged / retired → unavailable", () => {
    const byId = new Map([["p2", mkPayer({ id: "p2", name: "Successor" })]]);
    expect(catalogAction(mkPayer({ status: "merged", mergedIntoId: "p2" }), false, byId)).toEqual({
      kind: "unavailable",
      reason: "merged",
      successor: byId.get("p2"),
    });
    expect(catalogAction(mkPayer({ status: "retired" }), false, empty)).toEqual({
      kind: "unavailable",
      reason: "retired",
      successor: null,
    });
  });

  it("inNetwork wins over merged status (already attached history)", () => {
    expect(catalogAction(mkPayer({ status: "retired" }), true, empty)).toEqual({ kind: "added" });
  });

  // Keep the dormant helper reachable so merge_payer / legacy reads stay typed.
  it("dormant assignment helper still classifies archived", () => {
    expect(isActiveAssignment(mkAssign("p1", "archived"))).toBe(false);
  });
});

describe("payerSetupEmptyState — targets", () => {
  it("no active targets → no_payers", () => {
    expect(payerSetupEmptyState([])).toBe("no_payers");
    expect(payerSetupEmptyState([{ status: "archived" }])).toBe("no_payers");
  });
  it("any active target → no_scope (targets exist; readiness may still be empty)", () => {
    expect(payerSetupEmptyState([{ status: "active" }])).toBe("no_scope");
  });
});
