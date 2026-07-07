import { describe, expect, it } from "vitest";
import { deriveStarterCases, type StarterLicense } from "./starterCases";
import type { Mso, MsoRoutingRule, Payer, Provider, SOPTemplate } from "@/types";

function payer(over: Partial<Payer>): Payer {
  return {
    id: over.id ?? "p1",
    orgId: "org",
    name: over.name ?? "Payer",
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

function provider(over: Partial<Provider>): Provider {
  return {
    id: "prov1",
    orgId: "org",
    groupId: over.groupId ?? "g1",
    launchId: null,
    firstName: "Jane",
    lastName: "Doe",
    credentials: null,
    dateOfBirth: null,
    ssnLast4: null,
    email: null,
    phone: null,
    homeStreet: null,
    homeCity: null,
    homeState: over.homeState ?? "KS",
    homeZip: null,
    npi: null,
    caqhId: null,
    caqhLastAttestedDate: null,
    deaNumber: null,
    taxonomyCode: null,
    specialty: over.specialty ?? "Physical Therapy",
    startDate: null,
    status: "active",
    isNewGrad: null,
    terminatedDate: null,
    degree: null,
    schoolName: null,
    graduationDate: null,
    malpracticeCarrier: null,
    malpracticePolicyNumber: null,
    malpracticeCoverageStart: null,
    malpracticeCoverageEnd: null,
    middleInitial: null,
    suffix: null,
    gender: null,
    ethnicity: null,
    deaExpirationDate: null,
    boardCertified: null,
    subSpecialty: null,
    languages: null,
    medicaidAttested: null,
    culturalCompetencyTraining: null,
    additionalCertifications: null,
    ageGroupsServed: null,
    licenseNumber: null,
    licenseState: null,
    licenseIssueDate: null,
    licenseExpirationDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function tmpl(over: Partial<SOPTemplate>): SOPTemplate {
  return {
    id: over.id ?? "t1",
    orgId: "org",
    name: "T",
    groupId: over.groupId ?? null,
    state: over.state ?? "KS",
    specialty: null,
    payerId: over.payerId ?? "p1",
    taskDefinitions: [],
    isArchived: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function mso(over: Partial<Mso>): Mso {
  return {
    id: over.id ?? "m1",
    orgId: "org",
    name: over.name ?? "MSO",
    portalUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function rule(over: Partial<MsoRoutingRule>): MsoRoutingRule {
  return {
    id: over.id ?? "r1",
    orgId: "org",
    payerId: over.payerId ?? "p1",
    state: over.state ?? "KS",
    specialty: over.specialty ?? "All",
    routeType: over.routeType ?? "direct",
    msoId: over.msoId ?? null,
    notes: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const KS_LICENSE: StarterLicense = { state: "KS", licenseNumber: "KS-123" };
const noRouting = () => null;

describe("deriveStarterCases", () => {
  it("returns an empty plan when there are no starter payers", () => {
    const plan = deriveStarterCases({
      provider: provider({}),
      starterPayers: [],
      licenses: [KS_LICENSE],
      templates: [],
      msos: [],
      existingCases: [],
      resolveRouting: noRouting,
    });
    expect(plan.toCreate).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it("creates a direct case at the home state for a starter payer with a home-state license", () => {
    const p = payer({ id: "p1", name: "Aetna" });
    const plan = deriveStarterCases({
      provider: provider({ homeState: "KS" }),
      starterPayers: [p],
      licenses: [KS_LICENSE],
      templates: [],
      msos: [],
      existingCases: [],
      resolveRouting: noRouting,
    });
    expect(plan.skipped).toEqual([]);
    expect(plan.toCreate).toHaveLength(1);
    const entry = plan.toCreate[0];
    expect(entry.payer.id).toBe("p1");
    expect(entry.state).toBe("KS");
    expect(entry.msoId).toBeNull();
    expect(entry.mso).toBeNull();
    expect(entry.licenseNumber).toBe("KS-123");
  });

  it("resolves the MSO routing rule into msoId + mso", () => {
    const p = payer({ id: "p1" });
    const plan = deriveStarterCases({
      provider: provider({ homeState: "KS" }),
      starterPayers: [p],
      licenses: [KS_LICENSE],
      templates: [],
      msos: [mso({ id: "m1", name: "Availity" })],
      existingCases: [],
      resolveRouting: () => rule({ routeType: "mso", msoId: "m1" }),
    });
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].msoId).toBe("m1");
    expect(plan.toCreate[0].mso?.name).toBe("Availity");
  });

  it("resolves the matching SOP template through pickTemplate", () => {
    const p = payer({ id: "p1" });
    const template = tmpl({ id: "t-ks", groupId: "g1", payerId: "p1", state: "KS" });
    const otherState = tmpl({ id: "t-mo", groupId: "g1", payerId: "p1", state: "MO" });
    const plan = deriveStarterCases({
      provider: provider({ homeState: "KS", groupId: "g1" }),
      starterPayers: [p],
      licenses: [KS_LICENSE],
      templates: [otherState, template],
      msos: [],
      existingCases: [],
      resolveRouting: noRouting,
    });
    expect(plan.toCreate[0].template?.id).toBe("t-ks");
  });

  it("skips a payer with no home state on the provider", () => {
    const p = payer({ id: "p1", name: "Aetna" });
    const plan = deriveStarterCases({
      provider: provider({ homeState: null }),
      starterPayers: [p],
      licenses: [],
      templates: [],
      msos: [],
      existingCases: [],
      resolveRouting: noRouting,
    });
    expect(plan.toCreate).toEqual([]);
    expect(plan.skipped).toEqual([{ payer: p, reason: "No home state on the provider" }]);
  });

  it("skips a payer when there is no license in the home state", () => {
    const p = payer({ id: "p1" });
    const plan = deriveStarterCases({
      provider: provider({ homeState: "KS" }),
      starterPayers: [p],
      licenses: [{ state: "MO", licenseNumber: "MO-9" }],
      templates: [],
      msos: [],
      existingCases: [],
      resolveRouting: noRouting,
    });
    expect(plan.toCreate).toEqual([]);
    expect(plan.skipped).toEqual([{ payer: p, reason: "No KS license on file" }]);
  });

  it("excludes an existing (provider, payer, state) combo without adding it to skipped", () => {
    const existing = payer({ id: "p1", name: "Existing" });
    const fresh = payer({ id: "p2", name: "Fresh" });
    const plan = deriveStarterCases({
      provider: provider({ homeState: "KS" }),
      starterPayers: [existing, fresh],
      licenses: [KS_LICENSE],
      templates: [],
      msos: [],
      existingCases: [{ payerId: "p1", state: "KS" }],
      resolveRouting: noRouting,
    });
    expect(plan.toCreate.map((e) => e.payer.id)).toEqual(["p2"]);
    expect(plan.skipped).toEqual([]);
  });

  it("only dedupes when the existing case is in the same state", () => {
    const p = payer({ id: "p1" });
    const plan = deriveStarterCases({
      provider: provider({ homeState: "KS" }),
      starterPayers: [p],
      licenses: [KS_LICENSE],
      templates: [],
      msos: [],
      existingCases: [{ payerId: "p1", state: "MO" }],
      resolveRouting: noRouting,
    });
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].state).toBe("KS");
  });

  it("passes the provider specialty through to the routing resolver", () => {
    const p = payer({ id: "p1" });
    const seen: Array<[string, string, string | null]> = [];
    deriveStarterCases({
      provider: provider({ homeState: "KS", specialty: "Physical Therapy" }),
      starterPayers: [p],
      licenses: [KS_LICENSE],
      templates: [],
      msos: [],
      existingCases: [],
      resolveRouting: (payerId, state, specialty) => {
        seen.push([payerId, state, specialty]);
        return null;
      },
    });
    expect(seen).toEqual([["p1", "KS", "Physical Therapy"]]);
  });
});
