import { describe, it, expect } from "vitest";
import { buildFixitQueue, coverageFor, type BuildFixitInput, type OpenCaseLite } from "./fixitQueue";
import type { FieldDictionaryEntry, PortalFieldMap, Provider } from "@/types";

function provider(p: Partial<Provider> = {}): Provider {
  return {
    id: "prov-1",
    orgId: "org-1",
    groupId: null,
    launchId: null,
    firstName: "Brian",
    lastName: "Nguyen",
    credentials: null,
    dateOfBirth: null,
    ssnLast4: null,
    email: null,
    phone: null,
    homeStreet: null,
    homeCity: null,
    homeState: null,
    homeZip: null,
    npi: null,
    caqhId: null,
    caqhLastAttestedDate: null,
    deaNumber: null,
    taxonomyCode: null,
    specialty: null,
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
    ...p,
  };
}

function map(p: Partial<PortalFieldMap> & { portalKey: string }): PortalFieldMap {
  return {
    id: p.id ?? `m-${Math.round((p.confidence ?? 0) + (p.token?.length ?? 0))}-${p.portalKey}-${p.token ?? "x"}`,
    orgId: "org-1",
    urlPattern: null,
    pageStep: null,
    mapType: "web",
    selector: "#f",
    selectorFallbacks: null,
    source: p.source ?? "token",
    token: p.token ?? null,
    hardcodedValue: null,
    transform: null,
    fieldType: "text",
    notes: null,
    status: p.status ?? "approved",
    fieldLabel: p.fieldLabel ?? null,
    formSection: p.formSection ?? null,
    confidence: p.confidence ?? null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...p,
  };
}

function dict(p: Partial<FieldDictionaryEntry> = {}): FieldDictionaryEntry {
  return {
    id: p.id ?? "d-1",
    orgId: "org-1",
    labelNormalized: p.labelNormalized ?? "tax id number",
    token: p.token ?? "group.taxId",
    status: p.status ?? "suggested",
    seenCount: p.seenCount ?? 2,
    decidedAt: null,
    decidedBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...p,
  };
}

function openCase(p: Partial<OpenCaseLite> & { caseId: string; payerId: string }): OpenCaseLite {
  return {
    providerId: "prov-1",
    payerName: "BCBS KS",
    state: "KS",
    nextDueDate: null,
    ...p,
  };
}

const emptyInput: BuildFixitInput = {
  providers: [],
  openCases: [],
  portals: [],
  fieldMaps: [],
  dictionary: [],
};

describe("buildFixitQueue — provider gaps", () => {
  it("raises a gap only when an open case's portal maps the missing field", () => {
    const cards = buildFixitQueue({
      ...emptyInput,
      providers: [provider({ caqhId: null })],
      openCases: [openCase({ caseId: "c1", payerId: "pay-1", nextDueDate: "2026-07-09" })],
      portals: [{ portalKey: "availity", name: "Availity", payerId: "pay-1" }],
      fieldMaps: [map({ portalKey: "availity", token: "provider.caqhId", id: "m1" })],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe("provider_gap");
    expect(cards[0].gap?.fieldLabel).toBe("CAQH ID");
    expect(cards[0].sortDate).toBe("2026-07-09");
  });

  it("raises no gap when the field is present", () => {
    const cards = buildFixitQueue({
      ...emptyInput,
      providers: [provider({ caqhId: "14382950" })],
      openCases: [openCase({ caseId: "c1", payerId: "pay-1", nextDueDate: "2026-07-09" })],
      portals: [{ portalKey: "availity", name: "Availity", payerId: "pay-1" }],
      fieldMaps: [map({ portalKey: "availity", token: "provider.caqhId" })],
    });
    expect(cards).toHaveLength(0);
  });

  it("raises no gap when no portal maps the missing field (blocks no upcoming fill)", () => {
    // Provider has NPI but not CAQH; the only mapped token is NPI, so the CAQH
    // gap blocks nothing and the NPI field is present → no cards at all.
    const cards = buildFixitQueue({
      ...emptyInput,
      providers: [provider({ caqhId: null, npi: "1234567890" })],
      openCases: [openCase({ caseId: "c1", payerId: "pay-1", nextDueDate: "2026-07-09" })],
      portals: [{ portalKey: "availity", name: "Availity", payerId: "pay-1" }],
      fieldMaps: [map({ portalKey: "availity", token: "provider.npi" })], // maps only NPI
    });
    expect(cards).toHaveLength(0);
  });

  it("emits one card per (provider, field) and names the soonest blocked fill with a +more count", () => {
    const cards = buildFixitQueue({
      ...emptyInput,
      providers: [provider({ caqhId: null })],
      openCases: [
        openCase({ caseId: "c1", payerId: "pay-1", payerName: "BCBS KS", nextDueDate: "2026-07-20" }),
        openCase({ caseId: "c2", payerId: "pay-2", payerName: "Aetna", nextDueDate: "2026-07-09" }),
      ],
      portals: [
        { portalKey: "availity", name: "Availity", payerId: "pay-1" },
        { portalKey: "aetnaportal", name: "Aetna Portal", payerId: "pay-2" },
      ],
      fieldMaps: [
        map({ portalKey: "availity", token: "provider.caqhId", id: "a1" }),
        map({ portalKey: "aetnaportal", token: "provider.caqhId", id: "a2" }),
      ],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].sortDate).toBe("2026-07-09");
    expect(cards[0].gap?.payerName).toBe("Aetna");
    expect(cards[0].gap?.moreCount).toBe(1);
  });
});

describe("buildFixitQueue — dictionary + train", () => {
  it("confirms only suggested rules seen at least twice", () => {
    const cards = buildFixitQueue({
      ...emptyInput,
      dictionary: [
        dict({ id: "d1", seenCount: 2, status: "suggested" }), // yes
        dict({ id: "d2", seenCount: 1, status: "suggested" }), // no (once)
        dict({ id: "d3", seenCount: 5, status: "confirmed" }), // no (already confirmed)
        dict({ id: "d4", seenCount: 3, status: "rejected" }), // no (rejected)
      ],
    });
    const dictCards = cards.filter((c) => c.kind === "dictionary_confirm");
    expect(dictCards).toHaveLength(1);
    expect(dictCards[0].dictionary?.entryId).toBe("d1");
  });

  it("emits a train card per portal with proposed maps", () => {
    const cards = buildFixitQueue({
      ...emptyInput,
      portals: [{ portalKey: "sunflower", name: "Sunflower", payerId: "pay-9" }],
      fieldMaps: [
        map({ portalKey: "sunflower", status: "approved", token: "provider.npi", id: "s1" }),
        map({ portalKey: "sunflower", status: "proposed", token: null, id: "s2" }),
        map({ portalKey: "sunflower", status: "proposed", token: null, id: "s3" }),
      ],
    });
    const train = cards.find((c) => c.kind === "train_form");
    expect(train?.train).toMatchObject({ portalKey: "sunflower", matched: 1, total: 3 });
    expect(train?.fieldsUnlocked).toBe(2);
  });
});

describe("buildFixitQueue — ordering is by impact, never ease", () => {
  it("dated gaps sort before undated cards, soonest first", () => {
    const cards = buildFixitQueue({
      ...emptyInput,
      providers: [provider({ caqhId: null, npi: null })],
      openCases: [
        openCase({ caseId: "c1", payerId: "pay-1", nextDueDate: "2026-07-15" }),
        openCase({ caseId: "c2", payerId: "pay-1", nextDueDate: "2026-07-15" }),
      ],
      portals: [{ portalKey: "availity", name: "Availity", payerId: "pay-1" }],
      fieldMaps: [
        map({ portalKey: "availity", token: "provider.caqhId", id: "m1" }),
        map({ portalKey: "availity", token: "provider.npi", id: "m2" }),
      ],
      dictionary: [dict({ id: "d1", seenCount: 2 })], // undated → last
    });
    // two dated gap cards (same date) then the undated dictionary card
    expect(cards[cards.length - 1].kind).toBe("dictionary_confirm");
    expect(cards.slice(0, 2).every((c) => c.kind === "provider_gap")).toBe(true);
  });
});

describe("coverageFor", () => {
  it("counts token/hardcoded fills, excludes manual, and reports the gain for a gap token", () => {
    const p = provider({ npi: "1234567890", caqhId: null });
    const maps = [
      map({ portalKey: "x", token: "provider.npi" }), // filled (present)
      map({ portalKey: "x", token: "facility.county" }), // filled (assumed)
      map({ portalKey: "x", source: "hardcoded", token: null }), // filled
      map({ portalKey: "x", source: "manual", token: null }), // not filled (manual)
      map({ portalKey: "x", token: "provider.caqhId", id: "g1" }), // gap
      map({ portalKey: "x", token: "provider.caqhId", id: "g2" }), // gap
    ];
    const cov = coverageFor(p, maps, "provider.caqhId");
    expect(cov.total).toBe(6);
    expect(cov.filled).toBe(3);
    expect(cov.gain).toBe(2);
  });
});
