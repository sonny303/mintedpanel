import { describe, expect, it } from "vitest";
import { resolvableTokenKeys, resolveTemplate } from "./sopResolver";
import type { Facility, Provider, ProviderGroup, SOPTemplate } from "@/types";

function provider(over: Partial<Provider> = {}): Provider {
  return {
    id: "p1",
    orgId: "org",
    groupId: "g1",
    launchId: null,
    firstName: "Jordan",
    lastName: "Rivera",
    credentials: null,
    dateOfBirth: null,
    ssnLast4: null,
    email: "jordan.rivera@example.com",
    phone: null,
    homeStreet: null,
    homeCity: null,
    homeState: null,
    homeZip: null,
    npi: "1003456701",
    caqhId: "CAQH-987654",
    caqhLastAttestedDate: null,
    deaNumber: null,
    taxonomyCode: "225100000X",
    specialty: "Physical Therapy",
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
    ...over,
  };
}

const GROUP: ProviderGroup = {
  id: "g1",
  orgId: "org",
  name: "BEST Physical Therapy",
  tin: "12-3456789",
  npiType2: "9876543210",
  states: null,
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
};

const FACILITY: Facility = {
  id: "f1",
  orgId: "org",
  groupId: "g1",
  name: "Riverbend Clinic",
  street: null,
  city: null,
  state: "TX",
  zip: null,
  isActive: true,
  statusId: null,
  effectiveDate: null,
  referenceOnly: false,
  createdAt: "2026-01-01T00:00:00Z",
};

function template(steps: SOPTemplate["taskDefinitions"][number]["steps"]): SOPTemplate {
  return {
    id: "t1",
    orgId: "org",
    name: "T",
    groupId: null,
    state: null,
    specialty: null,
    payerId: null,
    taskDefinitions: [{ title: "Task", dueOffsetDays: 0, steps }],
    isArchived: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("resolveTemplate step typing", () => {
  it("defaults a step with no stepType to online_form and no emailTemplate", () => {
    const tpl = template([{ label: "Log into CAQH with {{provider.caqhId}}" }]);
    const [task] = resolveTemplate(tpl, provider(), GROUP, FACILITY);
    const step = task.sopContent[0];
    expect(step.stepType).toBe("online_form");
    expect(step.emailTemplate).toBeUndefined();
    expect(step.label).toBe("Log into CAQH with CAQH-987654");
  });

  it("carries stepType through and interpolates the email subject and body tokens", () => {
    const tpl = template([
      {
        label: "Notify provider",
        stepType: "draft_email",
        emailTemplate: {
          subject: "Re-attestation for {{provider.firstName}} {{provider.lastName}}",
          body: "Hi {{provider.firstName}}, your CAQH {{provider.caqhId}} at {{group.name}} needs re-attestation.",
        },
      },
    ]);
    const [task] = resolveTemplate(tpl, provider(), GROUP, FACILITY);
    const step = task.sopContent[0];
    expect(step.stepType).toBe("draft_email");
    expect(step.emailTemplate?.subject).toBe("Re-attestation for Jordan Rivera");
    expect(step.emailTemplate?.body).toBe(
      "Hi Jordan, your CAQH CAQH-987654 at BEST Physical Therapy needs re-attestation.",
    );
  });

  it("leaves emailTemplate undefined for a non-email step even if one is defined", () => {
    const tpl = template([
      {
        label: "Fill the form",
        stepType: "online_form",
        emailTemplate: { subject: "should be ignored", body: "should be ignored" },
      },
    ]);
    const [task] = resolveTemplate(tpl, provider(), GROUP, FACILITY);
    expect(task.sopContent[0].stepType).toBe("online_form");
    expect(task.sopContent[0].emailTemplate).toBeUndefined();
  });
});

// E1.7b F1.7b.3 — the step-shape extension survives resolution verbatim (the
// portalKey precedent), and token-less artifact names never ride dataFields.
describe("resolveTemplate E1.7b step-shape carry-through", () => {
  it("carries expectedTurnaroundDays / followUpEveryDays / requiredArtifacts verbatim", () => {
    const tpl = template([
      {
        label: "Status call to the payer",
        stepType: "phone",
        expectedTurnaroundDays: 45,
        followUpEveryDays: 14,
        requiredArtifacts: ["Call reference number", "Submission confirmation PDF"],
      },
    ]);
    const [task] = resolveTemplate(tpl, provider(), GROUP, FACILITY);
    const step = task.sopContent[0];
    expect(step.stepType).toBe("phone");
    expect(step.expectedTurnaroundDays).toBe(45);
    expect(step.followUpEveryDays).toBe(14);
    expect(step.requiredArtifacts).toEqual([
      "Call reference number",
      "Submission confirmation PDF",
    ]);
  });

  it("carries fax and mail step types through", () => {
    const tpl = template([
      { label: "Fax the W-9", stepType: "fax" },
      { label: "Mail the wet-signature form", stepType: "mail" },
    ]);
    const [task] = resolveTemplate(tpl, provider(), GROUP, FACILITY);
    expect(task.sopContent[0].stepType).toBe("fax");
    expect(task.sopContent[1].stepType).toBe("mail");
  });

  it("leaves the new fields absent when the definition does not carry them", () => {
    const tpl = template([{ label: "Plain step" }]);
    const [task] = resolveTemplate(tpl, provider(), GROUP, FACILITY);
    const step = task.sopContent[0];
    expect(step.expectedTurnaroundDays).toBeUndefined();
    expect(step.followUpEveryDays).toBeUndefined();
    expect(step.requiredArtifacts).toBeUndefined();
  });

  it("filters a token-less dataFields entry at resolution (artifacts belong in requiredArtifacts)", () => {
    const tpl = template([
      {
        label: "Submit application",
        dataFields: [
          { label: "Type 1 NPI", token: "provider.npi" },
          // A named attachment mistakenly authored as a data field: its
          // "token" resolves to nothing and the entry is dropped.
          { label: "COA form", token: "attachment.coaForm" },
        ],
        requiredArtifacts: ["COA form"],
      },
    ]);
    const [task] = resolveTemplate(tpl, provider(), GROUP, FACILITY);
    const step = task.sopContent[0];
    expect(step.dataFields).toEqual([{ label: "Type 1 NPI", value: "1003456701" }]);
    expect(step.requiredArtifacts).toEqual(["COA form"]);
  });
});

// E1.7b TE-7 — catalog-name aliases resolve to the same values the resolver
// already holds; existing token names keep working.
describe("buildTokenMap catalog aliases (via resolveTemplate)", () => {
  const richFacility: Facility = {
    ...FACILITY,
    street: "12 River Rd",
    city: "Austin",
    zip: "78701",
  };

  it("resolves license.licenseNumber to the same value as provider.licenseNumber", () => {
    const tpl = template([
      {
        label: "PSV",
        dataFields: [
          { label: "License (resolver name)", token: "provider.licenseNumber" },
          { label: "License (catalog name)", token: "license.licenseNumber" },
        ],
      },
    ]);
    const [task] = resolveTemplate(tpl, provider(), GROUP, richFacility, null, "KS-12345");
    expect(task.sopContent[0].dataFields).toEqual([
      { label: "License (resolver name)", value: "KS-12345" },
      { label: "License (catalog name)", value: "KS-12345" },
    ]);
  });

  it("resolves the facility address-part catalog tokens alongside facility.address", () => {
    const tpl = template([
      {
        label: "Address",
        dataFields: [
          { label: "Joined", token: "facility.address" },
          { label: "Street", token: "facility.street" },
          { label: "City", token: "facility.city" },
          { label: "State", token: "facility.state" },
          { label: "Zip", token: "facility.zip" },
        ],
      },
    ]);
    const [task] = resolveTemplate(tpl, provider(), GROUP, richFacility);
    expect(task.sopContent[0].dataFields).toEqual([
      { label: "Joined", value: "12 River Rd, Austin, TX, 78701" },
      { label: "Street", value: "12 River Rd" },
      { label: "City", value: "Austin" },
      { label: "State", value: "TX" },
      { label: "Zip", value: "78701" },
    ]);
  });
});

describe("resolvableTokenKeys", () => {
  it("exposes the closed resolver map including the catalog aliases", () => {
    const keys = resolvableTokenKeys();
    for (const expected of [
      "provider.firstName",
      "provider.licenseNumber",
      "license.licenseNumber",
      "facility.address",
      "facility.street",
      "facility.city",
      "facility.state",
      "facility.zip",
      "group.tin",
      "mso.portalUrl",
    ]) {
      expect(keys).toContain(expected);
    }
    // Case-scoped families never resolve client-side.
    expect(keys.some((k) => k.startsWith("payer."))).toBe(false);
    expect(keys.some((k) => k.startsWith("contract."))).toBe(false);
  });
});
