import { describe, expect, it } from "vitest";
import { groupOrgParties, assignableRoles, countRole } from "./parties";
import type { Party, PartyRoleType } from "@/types";

const party = (id: string, name: string): Party => ({
  id,
  partyType: "person",
  name,
  email: null,
  phoneOffice: null,
  phoneMobile: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  createdBy: "u1",
  createdAt: "2026-07-09T00:00:00Z",
});

const ROLE_TYPES: PartyRoleType[] = [
  { roleKey: "owner", label: "Owner", isActive: true },
  { roleKey: "customer_escalation_contact", label: "Customer Escalation Contact", isActive: true },
  { roleKey: "sales_rep", label: "Sales Rep", isActive: true },
  { roleKey: "billing_contact", label: "Billing Contact", isActive: false },
  { roleKey: "contracting_signer", label: "Contracting Signer", isActive: false },
  { roleKey: "credentialing_contact", label: "Credentialing Contact", isActive: false },
];

describe("groupOrgParties", () => {
  it("collapses multiple roles onto one party (F0.3.3)", () => {
    const zeb = party("z", "Zeb");
    const grouped = groupOrgParties([
      { roleKey: "sales_rep", party: zeb },
      { roleKey: "owner", party: zeb },
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].party.id).toBe("z");
    expect(grouped[0].roleKeys.sort()).toEqual(["owner", "sales_rep"]);
  });

  it("keeps distinct parties separate and dedupes repeated roles", () => {
    const a = party("a", "A");
    const b = party("b", "B");
    const grouped = groupOrgParties([
      { roleKey: "owner", party: a },
      { roleKey: "sales_rep", party: b },
      { roleKey: "owner", party: a },
    ]);
    expect(grouped.map((g) => g.party.id)).toEqual(["a", "b"]);
    expect(grouped[0].roleKeys).toEqual(["owner"]);
  });
});

describe("assignableRoles", () => {
  it("offers active roles not already held; never reserved ones (F0.3.2/F0.3.5)", () => {
    const offered = assignableRoles(ROLE_TYPES, ["sales_rep"]).map((t) => t.roleKey);
    expect(offered).toEqual(["owner", "customer_escalation_contact"]);
    expect(offered).not.toContain("billing_contact");
  });

  it("offers nothing when all active roles are held", () => {
    expect(
      assignableRoles(ROLE_TYPES, ["owner", "customer_escalation_contact", "sales_rep"]),
    ).toEqual([]);
  });
});

describe("countRole", () => {
  it("counts parties holding a role (last-sales-rep guard)", () => {
    const parties = groupOrgParties([
      { roleKey: "sales_rep", party: party("z", "Zeb") },
      { roleKey: "owner", party: party("o", "Owner") },
    ]);
    expect(countRole(parties, "sales_rep")).toBe(1);
    expect(countRole(parties, "owner")).toBe(1);
    expect(countRole(parties, "customer_escalation_contact")).toBe(0);
  });
});
