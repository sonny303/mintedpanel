import { describe, it, expect } from "vitest";
import {
  buildFixitQueue,
  coverageFor,
  FIELD_NOT_FOUND_REASON,
  type BuildFixitInput,
  type OpenCaseLite,
} from "./fixitQueue";
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
    referenceOnly: false,
    verificationState: "verified",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...p,
  };
}

function map(p: Partial<PortalFieldMap> & { portalKey: string }): PortalFieldMap {
  return {
    id:
      p.id ??
      `m-${Math.round((p.confidence ?? 0) + (p.token?.length ?? 0))}-${p.portalKey}-${p.token ?? "x"}`,
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
        openCase({
          caseId: "c1",
          payerId: "pay-1",
          payerName: "BCBS KS",
          nextDueDate: "2026-07-20",
        }),
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

  it("raises no gap for a reference-only provider (never worked)", () => {
    // Same shape as the first gap test — a missing CAQH ID mapped by an open
    // case's portal — but the provider is reference-only, so no card.
    const cards = buildFixitQueue({
      ...emptyInput,
      providers: [provider({ caqhId: null, referenceOnly: true })],
      openCases: [openCase({ caseId: "c1", payerId: "pay-1", nextDueDate: "2026-07-09" })],
      portals: [{ portalKey: "availity", name: "Availity", payerId: "pay-1" }],
      fieldMaps: [map({ portalKey: "availity", token: "provider.caqhId", id: "m1" })],
    });
    expect(cards).toHaveLength(0);
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

describe("buildFixitQueue — broken mappings from fill telemetry", () => {
  const portals = [{ portalKey: "bcbs_ks", name: "BCBS KS", payerId: "pay-1" }];

  it("raises one card per portal, joins by mapId then label, and collapses duplicates", () => {
    const cards = buildFixitQueue({
      ...emptyInput,
      portals,
      fieldMaps: [
        map({ portalKey: "bcbs_ks", id: "m1", token: "provider.npi", selector: "label:NPI" }),
        map({
          portalKey: "bcbs_ks",
          id: "m2",
          token: "facility.city",
          selector: "label:City",
          fieldLabel: "Service location city",
        }),
        map({ portalKey: "bcbs_ks", id: "m3", token: "provider.caqhId", selector: "label:CAQH" }),
      ],
      lastFills: [
        {
          portalKey: "bcbs_ks",
          fieldsSkipped: [
            // exact join via mapId
            { label: "NPI", reason: FIELD_NOT_FOUND_REASON, kind: "skipped", mapId: "m1" },
            // legacy report without mapId → joins via the selector's label
            { label: "City", reason: FIELD_NOT_FOUND_REASON, kind: "skipped" },
            // duplicate report of m1 → collapses to one mapping
            { label: "NPI", reason: FIELD_NOT_FOUND_REASON, kind: "skipped", mapId: "m1" },
            // other skip reasons and manual entries never create a drift card
            { label: "CAQH", reason: "no value", kind: "skipped" },
            { label: "CAQH", reason: FIELD_NOT_FOUND_REASON, kind: "manual" },
          ],
        },
      ],
    });
    const broken = cards.filter((c) => c.kind === "broken_mapping");
    expect(broken).toHaveLength(1);
    expect(broken[0].broken).toMatchObject({
      portalKey: "bcbs_ks",
      count: 2,
      globalCount: 0,
      labels: ["NPI", "Service location city"],
    });
    expect(broken[0].broken?.orgRows.map((r) => r.id)).toEqual(["m1", "m2"]);
  });

  it("splits org rows (actionable) from global rows (read-only)", () => {
    const cards = buildFixitQueue({
      ...emptyInput,
      portals,
      fieldMaps: [
        map({ portalKey: "bcbs_ks", id: "g1", orgId: null, selector: "label:City" }),
        map({ portalKey: "bcbs_ks", id: "o1", selector: "label:State" }),
      ],
      lastFills: [
        {
          portalKey: "bcbs_ks",
          fieldsSkipped: [
            { label: "City", reason: FIELD_NOT_FOUND_REASON, kind: "skipped" },
            { label: "State", reason: FIELD_NOT_FOUND_REASON, kind: "skipped" },
          ],
        },
      ],
    });
    const broken = cards.find((c) => c.kind === "broken_mapping");
    expect(broken?.broken?.count).toBe(2);
    expect(broken?.broken?.globalCount).toBe(1);
    expect(broken?.broken?.orgRows.map((r) => r.id)).toEqual(["o1"]);
  });

  it("only an exact field-not-found event creates drift; other reasons do not", () => {
    const cards = buildFixitQueue({
      ...emptyInput,
      portals,
      fieldMaps: [map({ portalKey: "bcbs_ks", id: "m1", selector: "label:City" })],
      lastFills: [
        {
          portalKey: "bcbs_ks",
          fieldsSkipped: [
            { label: "City", reason: "no value in Minted Panel", kind: "skipped" },
            { label: "City", reason: "field is disabled or read-only", kind: "skipped" },
          ],
        },
      ],
    });
    expect(cards.find((c) => c.kind === "broken_mapping")).toBeUndefined();
  });

  it("raises a global-only card that stays informational (no org rows to re-propose)", () => {
    const cards = buildFixitQueue({
      ...emptyInput,
      portals,
      fieldMaps: [
        map({ portalKey: "bcbs_ks", id: "g1", orgId: null, selector: "label:City" }),
        map({ portalKey: "bcbs_ks", id: "g2", orgId: null, selector: "label:State" }),
      ],
      lastFills: [
        {
          portalKey: "bcbs_ks",
          fieldsSkipped: [
            { label: "City", reason: FIELD_NOT_FOUND_REASON, kind: "skipped" },
            { label: "State", reason: FIELD_NOT_FOUND_REASON, kind: "skipped" },
          ],
        },
      ],
    });
    const broken = cards.find((c) => c.kind === "broken_mapping");
    // The card is still raised (the drift is real), but every row is global —
    // orgRows empty means the UI shows the read-only "managed centrally" path.
    expect(broken?.broken?.count).toBe(2);
    expect(broken?.broken?.globalCount).toBe(2);
    expect(broken?.broken?.orgRows).toEqual([]);
  });

  it("ignores retired rows, unmatched labels, and malformed telemetry", () => {
    const cards = buildFixitQueue({
      ...emptyInput,
      portals,
      fieldMaps: [
        map({ portalKey: "bcbs_ks", id: "r1", status: "retired", selector: "label:City" }),
      ],
      lastFills: [
        {
          portalKey: "bcbs_ks",
          fieldsSkipped: [
            { label: "City", reason: FIELD_NOT_FOUND_REASON, kind: "skipped" }, // only a retired row
            { label: "Ghost", reason: FIELD_NOT_FOUND_REASON, kind: "skipped" }, // no map
            "not-an-object",
            { reason: FIELD_NOT_FOUND_REASON }, // no label
          ],
        },
        { portalKey: "bcbs_ks", fieldsSkipped: "corrupt" },
        { portalKey: "unknown_portal", fieldsSkipped: [] },
      ],
    });
    expect(cards.find((c) => c.kind === "broken_mapping")).toBeUndefined();
  });

  it("prefers the reported mapId and never falls back to label for a stale id", () => {
    const cards = buildFixitQueue({
      ...emptyInput,
      portals,
      fieldMaps: [map({ portalKey: "bcbs_ks", id: "m2", selector: "label:City" })],
      lastFills: [
        {
          portalKey: "bcbs_ks",
          fieldsSkipped: [
            // id "gone" matches no live map; its label WOULD match m2, but a
            // reported id is authoritative — no label fallback → no card.
            { label: "City", reason: FIELD_NOT_FOUND_REASON, kind: "skipped", mapId: "gone" },
          ],
        },
      ],
    });
    expect(cards.find((c) => c.kind === "broken_mapping")).toBeUndefined();
  });

  it("dates the card by the payer's soonest open case", () => {
    const cards = buildFixitQueue({
      ...emptyInput,
      providers: [provider()],
      openCases: [openCase({ caseId: "c1", payerId: "pay-1", nextDueDate: "2026-07-20" })],
      portals,
      fieldMaps: [map({ portalKey: "bcbs_ks", id: "m1", selector: "label:City" })],
      lastFills: [
        {
          portalKey: "bcbs_ks",
          fieldsSkipped: [{ label: "City", reason: FIELD_NOT_FOUND_REASON, kind: "skipped" }],
        },
      ],
    });
    const broken = cards.find((c) => c.kind === "broken_mapping");
    expect(broken?.sortDate).toBe("2026-07-20");
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
