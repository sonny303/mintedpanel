import { describe, expect, it } from "vitest";
import { buildClientProgress, ownerStatusKey, PRE_CRED_PAYER_NAME } from "./clientProgress";
import type { CredentialCase, Payer, StatusConfig } from "@/types";

function payer(over: Partial<Payer>): Payer {
  return {
    id: over.id ?? "p1",
    orgId: "org",
    name: "Payer",
    isActive: true,
    avgDecisionDays: null,
    provisionalBillingAllowed: false,
    provisionalBillingNotes: null,
    retroBillingAllowed: false,
    retroBillingWindowDays: null,
    caqhPullDeadlineDays: null,
    providerTypePath: null,
    priorAuthVendor: null,
    payerBillingId: null,
    portalUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function status(label: string, actionBucket = "ours"): StatusConfig {
  return {
    id: `s-${label}`,
    orgId: "org",
    track: "credentialing",
    label,
    color: "#059669",
    sortOrder: 10,
    requiredFields: [],
    actionBucket,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function credCase(over: Partial<CredentialCase>): CredentialCase {
  return {
    id: over.id ?? "c1",
    orgId: "org",
    providerId: "prov1",
    groupId: null,
    facilityId: null,
    payerId: "p1",
    state: "KS",
    specialty: null,
    credentialingStatusId: null,
    msoId: null,
    submittedDate: null,
    approvedDate: null,
    expectedEffectiveDate: null,
    confirmedEffectiveDate: null,
    terminationDate: null,
    assignedTo: null,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    caseEmailToken: "tok-c1",
    ...over,
  };
}

const provider = { id: "prov1" };

describe("ownerStatusKey", () => {
  it("maps every seeded credentialing label to a locked owner wording", () => {
    expect(ownerStatusKey("In-Network", "complete")).toBe("active");
    expect(ownerStatusKey("Approved", "complete")).toBe("approved");
    expect(ownerStatusKey("Submitted", "waiting_payer")).toBe("submitted");
    expect(ownerStatusKey("In Progress", "ours")).toBe("in_progress");
    expect(ownerStatusKey("Not Started", "ours")).toBe("in_progress");
    expect(ownerStatusKey("Waiting on Provider", "waiting_provider")).toBe("in_progress");
    expect(ownerStatusKey("Denied", "ours")).toBe("in_progress");
  });

  it("hides Not Required and OON from the owner", () => {
    expect(ownerStatusKey("Not Required", "complete")).toBeNull();
    expect(ownerStatusKey("OON", "complete")).toBeNull();
  });

  it("falls back to the action bucket for org-configured labels", () => {
    expect(ownerStatusKey("Payer Review", "waiting_payer")).toBe("with_payer");
    expect(ownerStatusKey("Termed", "complete")).toBe("approved");
    expect(ownerStatusKey("CAQH Attestation", "ours")).toBe("in_progress");
    expect(ownerStatusKey(null, null)).toBe("in_progress");
  });
});

describe("buildClientProgress", () => {
  const configs = [
    status("In-Network", "complete"),
    status("Submitted", "waiting_payer"),
    status("Not Required", "complete"),
  ];

  it("derives the denominator from active payers, excluding the pre-cred sentinel", () => {
    const payers = [
      payer({ id: "p1", name: "Aetna" }),
      payer({ id: "p2", name: "BCBS" }),
      payer({ id: "p3", name: "Old Payer", isActive: false }),
      payer({ id: "p4", name: PRE_CRED_PAYER_NAME }),
    ];
    const [card] = buildClientProgress([provider], [], payers, configs);
    expect(card.denominator).toBe(2);
    expect(card.lines).toHaveLength(0);
    expect(card.inNetwork).toBe(0);
  });

  it("counts In-Network cases and keeps payers without cases in the denominator", () => {
    const payers = [payer({ id: "p1", name: "Aetna" }), payer({ id: "p2", name: "BCBS" })];
    const cases = [credCase({ id: "c1", payerId: "p1", credentialingStatusId: "s-In-Network" })];
    const [card] = buildClientProgress([provider], cases, payers, configs);
    expect(card.inNetwork).toBe(1);
    expect(card.denominator).toBe(2);
    expect(card.lines.map((l) => l.payerName)).toEqual(["Aetna"]);
  });

  it("drops a payer from the card and denominator when its only case is opted out", () => {
    const payers = [payer({ id: "p1", name: "Aetna" }), payer({ id: "p2", name: "BCBS" })];
    const cases = [
      credCase({ id: "c1", payerId: "p1", credentialingStatusId: "s-Not Required" }),
      credCase({ id: "c2", payerId: "p2", credentialingStatusId: "s-Submitted" }),
    ];
    const [card] = buildClientProgress([provider], cases, payers, configs);
    expect(card.denominator).toBe(1);
    expect(card.lines.map((l) => l.payerName)).toEqual(["BCBS"]);
  });

  it("represents a multi-state payer by its most advanced case", () => {
    const payers = [payer({ id: "p1", name: "Aetna" })];
    const cases = [
      credCase({ id: "c1", payerId: "p1", state: "KS", credentialingStatusId: "s-Submitted" }),
      credCase({ id: "c2", payerId: "p1", state: "MO", credentialingStatusId: "s-In-Network" }),
    ];
    const [card] = buildClientProgress([provider], cases, payers, configs);
    expect(card.lines).toHaveLength(1);
    expect(card.lines[0].caseId).toBe("c2");
    expect(card.inNetwork).toBe(1);
  });

  it("keeps a payer visible when one case is opted out but another is not", () => {
    const payers = [payer({ id: "p1", name: "Aetna" })];
    const cases = [
      credCase({ id: "c1", payerId: "p1", state: "KS", credentialingStatusId: "s-Not Required" }),
      credCase({ id: "c2", payerId: "p1", state: "MO", credentialingStatusId: "s-Submitted" }),
    ];
    const [card] = buildClientProgress([provider], cases, payers, configs);
    expect(card.denominator).toBe(1);
    expect(card.lines.map((l) => l.caseId)).toEqual(["c2"]);
  });

  it("prefers the confirmed effective date and falls back to expected", () => {
    const payers = [payer({ id: "p1", name: "Aetna" }), payer({ id: "p2", name: "BCBS" })];
    const cases = [
      credCase({
        id: "c1",
        payerId: "p1",
        credentialingStatusId: "s-In-Network",
        confirmedEffectiveDate: "2026-06-01",
        expectedEffectiveDate: "2026-07-01",
      }),
      credCase({
        id: "c2",
        payerId: "p2",
        credentialingStatusId: "s-Submitted",
        expectedEffectiveDate: "2026-08-15",
      }),
    ];
    const [card] = buildClientProgress([provider], cases, payers, configs);
    expect(card.lines.find((l) => l.payerId === "p1")?.effectiveDate).toBe("2026-06-01");
    expect(card.lines.find((l) => l.payerId === "p2")?.effectiveDate).toBe("2026-08-15");
  });

  it("sorts lines alphabetically by payer and builds a card for every provider", () => {
    const payers = [payer({ id: "p1", name: "Zeta Health" }), payer({ id: "p2", name: "Aetna" })];
    const cases = [
      credCase({ id: "c1", payerId: "p1", credentialingStatusId: "s-Submitted" }),
      credCase({ id: "c2", payerId: "p2", credentialingStatusId: "s-Submitted" }),
    ];
    const cards = buildClientProgress([provider, { id: "prov2" }], cases, payers, configs);
    expect(cards).toHaveLength(2);
    expect(cards[0].lines.map((l) => l.payerName)).toEqual(["Aetna", "Zeta Health"]);
    expect(cards[1].lines).toHaveLength(0);
    expect(cards[1].denominator).toBe(2);
  });

  it("ignores cases whose payer is inactive or the pre-cred sentinel", () => {
    const payers = [
      payer({ id: "p1", name: "Aetna" }),
      payer({ id: "p2", name: "Old Payer", isActive: false }),
      payer({ id: "p3", name: PRE_CRED_PAYER_NAME }),
    ];
    const cases = [
      credCase({ id: "c1", payerId: "p2", credentialingStatusId: "s-In-Network" }),
      credCase({ id: "c2", payerId: "p3", credentialingStatusId: "s-Submitted" }),
    ];
    const [card] = buildClientProgress([provider], cases, payers, configs);
    expect(card.lines).toHaveLength(0);
    expect(card.denominator).toBe(1);
    expect(card.inNetwork).toBe(0);
  });
});
