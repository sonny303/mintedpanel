import { describe, expect, it } from "vitest";
import {
  activeOrgPayers,
  archivedPayerIds,
  catalogSetupPayers,
  networkPayerIdsFromTargets,
} from "./payerSetup";
import type { Payer, PayerNetworkTarget } from "@/types";

function payer(over: Partial<Payer> = {}): Payer {
  return {
    id: "pay-1",
    orgId: null,
    name: "BCBS KS",
    status: "active",
    archivedAt: null,
    ...over,
  } as Payer;
}

function target(
  over: Partial<Pick<PayerNetworkTarget, "payerId" | "status">> = {},
): Pick<PayerNetworkTarget, "payerId" | "status"> {
  return { payerId: "pay-1", status: "active", ...over };
}

describe("activeOrgPayers — OPA-RETIRE (targets, never assignments)", () => {
  it("includes a payer with an active target", () => {
    const rows = activeOrgPayers([payer()], [target()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payer.id).toBe("pay-1");
  });

  it("excludes payers with only archived targets", () => {
    const rows = activeOrgPayers([payer()], [target({ status: "archived" })]);
    expect(rows).toEqual([]);
  });

  it("excludes payers with no targets", () => {
    const rows = activeOrgPayers([payer({ orgId: "org-1", payerSlug: null })], []);
    expect(rows).toEqual([]);
  });

  it("excludes the Pre-Cred sentinel", () => {
    const rows = activeOrgPayers([payer({ name: "Pre-Credentialing Setup" })], [target()]);
    expect(rows).toEqual([]);
  });

  it("sorts by payer name", () => {
    const rows = activeOrgPayers(
      [payer({ id: "b", name: "Beta" }), payer({ id: "a", name: "Alpha" })],
      [target({ payerId: "a" }), target({ payerId: "b" })],
    );
    expect(rows.map((r) => r.payer.name)).toEqual(["Alpha", "Beta"]);
  });
});

describe("activeOrgPayers — archived payers (E6.8)", () => {
  it("excludes archived payers by default", () => {
    const rows = activeOrgPayers([payer({ archivedAt: "2026-07-27T00:00:00Z" })], [target()]);
    expect(rows).toEqual([]);
  });

  it("includeArchived opts archived payers back in when they have targets", () => {
    const rows = activeOrgPayers([payer({ archivedAt: "2026-07-27T00:00:00Z" })], [target()], {
      includeArchived: true,
    });
    expect(rows).toHaveLength(1);
  });

  it("non-archived still included", () => {
    const rows = activeOrgPayers([payer({ archivedAt: null })], [target()]);
    expect(rows).toHaveLength(1);
  });
});

describe("catalogSetupPayers — Payer Setup lists the catalog, not group attach", () => {
  it("includes a payer with no targets", () => {
    const rows = catalogSetupPayers([payer()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payer.id).toBe("pay-1");
  });

  it("still excludes the Pre-Cred sentinel", () => {
    const rows = catalogSetupPayers([payer({ name: "Pre-Credentialing Setup" }), payer()]);
    expect(rows.map((r) => r.payer.id)).toEqual(["pay-1"]);
  });

  it("excludes archived payers by default and opts them in", () => {
    const archived = payer({ archivedAt: "2026-07-27T00:00:00Z" });
    expect(catalogSetupPayers([archived])).toEqual([]);
    expect(catalogSetupPayers([archived], { includeArchived: true })).toHaveLength(1);
  });

  it("sorts by payer name", () => {
    const rows = catalogSetupPayers([
      payer({ id: "b", name: "Beta" }),
      payer({ id: "a", name: "Alpha" }),
    ]);
    expect(rows.map((r) => r.payer.name)).toEqual(["Alpha", "Beta"]);
  });
});

describe("networkPayerIdsFromTargets / archivedPayerIds", () => {
  it("collects only active target payer ids", () => {
    expect([
      ...networkPayerIdsFromTargets([target(), target({ status: "archived", payerId: "x" })]),
    ]).toEqual(["pay-1"]);
  });

  it("archivedPayerIds", () => {
    expect([
      ...archivedPayerIds([payer({ archivedAt: "2026-01-01" }), payer({ id: "p2" })]),
    ]).toEqual(["pay-1"]);
  });
});
