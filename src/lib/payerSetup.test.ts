// E6.5 slim-down: the org-grain funnel derivation retired with PayerSetupList
// (the module funnel is payerReadinessFunnel.ts). What stays pinned here is
// the shared inclusion rule (assignment-driven, sentinel excluded, name sort)
// and the resolution-ID source chain the org-settings table renders.
import { describe, expect, it } from "vitest";
import { activeOrgPayers, resolutionIdSource } from "./payerSetup";
import { PRE_CRED_PAYER_NAME } from "./statusLabels";
import type { OrgPayerAssignment, OrgPayerSetting, Payer } from "@/types";

function payer(over: Partial<Payer> = {}): Payer {
  return {
    id: "payer-1",
    orgId: null,
    name: "Aetna",
    isActive: true,
    createdAt: "2026-07-01T00:00:00Z",
    ...over,
  } as Payer;
}

function assignment(over: Partial<OrgPayerAssignment> = {}): OrgPayerAssignment {
  return {
    id: "assign-1",
    orgId: "org-1",
    payerId: "payer-1",
    starter: false,
    status: "active",
    createdAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

const orgSetting = (over: Partial<OrgPayerSetting> = {}): OrgPayerSetting => ({
  id: "set-1",
  orgId: "org-1",
  payerId: "payer-1",
  resolutionIdLabel: "Provider PIN",
  resolutionIdExpected: true,
  updatedBy: null,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  ...over,
});

describe("activeOrgPayers (inclusion is subscription-driven, never targets)", () => {
  it("a just-selected catalog payer appears with its assignment", () => {
    const rows = activeOrgPayers([payer()], [assignment()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].payer.id).toBe("payer-1");
    expect(rows[0].assignment?.id).toBe("assign-1");
  });

  it("archived subscriptions and unassigned catalog payers are excluded", () => {
    const rows = activeOrgPayers(
      [payer(), payer({ id: "payer-2", name: "UHC" })],
      [assignment({ status: "archived" })],
    );
    expect(rows).toEqual([]);
  });

  it("an unassigned org-scoped row is excluded — inclusion is subscription-only since the legacy cutover close-out", () => {
    const rows = activeOrgPayers([payer({ orgId: "org-1", payerSlug: null })], []);
    expect(rows).toEqual([]);
  });

  it("the Pre-Credentialing sentinel is excluded even when assigned", () => {
    const rows = activeOrgPayers(
      [payer({ id: "payer-3", name: PRE_CRED_PAYER_NAME })],
      [assignment({ payerId: "payer-3" })],
    );
    expect(rows).toEqual([]);
  });

  it("rows sort by payer name", () => {
    const rows = activeOrgPayers(
      [payer({ id: "b", name: "Zeta" }), payer({ id: "a", name: "Alpha" })],
      [assignment({ payerId: "a" }), assignment({ id: "x", payerId: "b" })],
    );
    expect(rows.map((r) => r.payer.name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("resolutionIdSource", () => {
  it("walks org setting → Minted label → generic", () => {
    expect(resolutionIdSource(payer(), orgSetting())).toBe("org");
    expect(resolutionIdSource(payer({ resolutionIdLabel: "Medicare PTAN" }), null)).toBe("minted");
    expect(resolutionIdSource(payer({ resolutionIdLabel: "Medicare PTAN" }), orgSetting())).toBe(
      "org",
    );
    expect(resolutionIdSource(payer(), orgSetting({ resolutionIdLabel: "  " }))).toBe("generic");
    expect(resolutionIdSource(payer(), null)).toBe("generic");
  });
});
