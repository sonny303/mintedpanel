import { describe, expect, it } from "vitest";
import { resolveTemplate } from "./sopResolver";
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
