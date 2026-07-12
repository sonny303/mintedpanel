// E1.0 TE-10 — unit coverage for the pure progress contract: the org-details
// truth table, the binary row-count resolvers, registry order/shape, and
// first-incomplete next-action ordering.
import { describe, expect, it } from "vitest";
import {
  ACTIVE_SECTIONS,
  ONBOARDING_SECTIONS,
  getNextIncompleteSection,
  resolveOrgDetailsStatus,
  resolveRowCountStatus,
  type ActiveSectionKey,
  type OnboardingSectionStatus,
} from "./onboardingProgress";
import type { Party } from "@/types";

function party(over: Partial<Party>): Party {
  return {
    id: "p-1",
    partyType: "person",
    name: "",
    email: null,
    phoneOffice: null,
    phoneMobile: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    createdBy: "u-1",
    createdAt: "2026-07-10T00:00:00Z",
    ...over,
  };
}

const validOwner = party({ name: "Owner Rose City", email: "owner@example.test" });
const validCustomer = party({
  name: "Candace Devereaux",
  email: "contact@example.test",
  phoneOffice: "503-555-0121",
  addressLine1: "3550 N Mississippi Ave",
  city: "Portland",
  state: "OR",
  postalCode: "97227",
});

describe("resolveOrgDetailsStatus", () => {
  it("is complete when org name, owner, and customer contact are all satisfied", () => {
    expect(
      resolveOrgDetailsStatus({
        orgName: "Rose City Rehab Collective",
        owner: validOwner,
        customer: validCustomer,
      }),
    ).toBe("complete");
  });

  it("is not_started when none of the inputs exists", () => {
    expect(resolveOrgDetailsStatus({ orgName: null, owner: null, customer: null })).toBe(
      "not_started",
    );
    expect(resolveOrgDetailsStatus({ orgName: "   ", owner: null, customer: null })).toBe(
      "not_started",
    );
  });

  it("is in_progress for any partial set of inputs", () => {
    // Org name only.
    expect(
      resolveOrgDetailsStatus({ orgName: "Tree Hill Sports Therapy", owner: null, customer: null }),
    ).toBe("in_progress");
    // Owner only, org name blank.
    expect(resolveOrgDetailsStatus({ orgName: "", owner: validOwner, customer: null })).toBe(
      "in_progress",
    );
    // Customer only.
    expect(resolveOrgDetailsStatus({ orgName: null, owner: null, customer: validCustomer })).toBe(
      "in_progress",
    );
  });

  it("treats an owner with a blank name or invalid email as unsatisfied (in_progress)", () => {
    expect(
      resolveOrgDetailsStatus({
        orgName: "Tree Hill Sports Therapy",
        owner: party({ name: "  ", email: "owner@example.test" }),
        customer: validCustomer,
      }),
    ).toBe("in_progress");
    expect(
      resolveOrgDetailsStatus({
        orgName: "Tree Hill Sports Therapy",
        owner: party({ name: "Owner", email: "not-an-email" }),
        customer: validCustomer,
      }),
    ).toBe("in_progress");
    expect(
      resolveOrgDetailsStatus({
        orgName: "Tree Hill Sports Therapy",
        owner: party({ name: "Owner", email: null }),
        customer: validCustomer,
      }),
    ).toBe("in_progress");
  });

  it("requires every E0.8 required contact field on the customer contact", () => {
    // Each required field knocked out one at a time flips complete → in_progress
    // (reusing contactErrors semantics — name, valid email, office phone,
    // street, city, state, postal code).
    const knockouts: Partial<Party>[] = [
      { name: "" },
      { email: null },
      { email: "bad-email" },
      { phoneOffice: null },
      { addressLine1: null },
      { city: null },
      { state: null },
      { postalCode: null },
    ];
    for (const knockout of knockouts) {
      expect(
        resolveOrgDetailsStatus({
          orgName: "Rose City Rehab Collective",
          owner: validOwner,
          customer: party({ ...validCustomer, ...knockout }),
        }),
      ).toBe("in_progress");
    }
  });

  it("ignores whitespace-only values (trimmed semantics)", () => {
    expect(
      resolveOrgDetailsStatus({
        orgName: "Rose City Rehab Collective",
        owner: validOwner,
        customer: party({ ...validCustomer, city: "   " }),
      }),
    ).toBe("in_progress");
  });
});

describe("resolveRowCountStatus", () => {
  it("is not_started at zero rows and complete at any positive count", () => {
    expect(resolveRowCountStatus(0)).toBe("not_started");
    expect(resolveRowCountStatus(1)).toBe("complete");
    expect(resolveRowCountStatus(12)).toBe("complete");
  });
});

describe("section registry", () => {
  it("orders the journey exactly per F1.0.1 with the R3 trio as previews", () => {
    expect(ONBOARDING_SECTIONS.map((s) => s.title)).toEqual([
      "Org details",
      "Provider Group",
      "Facilities",
      "Providers",
      "Assignments",
      "Payer Network",
      "Scope Review",
    ]);
    expect(ONBOARDING_SECTIONS.map((s) => s.kind)).toEqual([
      "active",
      "active",
      "active",
      "active",
      "preview",
      "preview",
      "preview",
    ]);
  });

  it("gives every section a unique stable DOM id", () => {
    const ids = ONBOARDING_SECTIONS.map((s) => s.domId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("derives ACTIVE_SECTIONS as the four R1 sections in order", () => {
    expect(ACTIVE_SECTIONS.map((s) => s.key)).toEqual([
      "org_details",
      "provider_group",
      "facilities",
      "providers",
    ]);
  });
});

describe("getNextIncompleteSection", () => {
  const all = (
    status: OnboardingSectionStatus,
  ): Record<ActiveSectionKey, OnboardingSectionStatus> => ({
    org_details: status,
    provider_group: status,
    facilities: status,
    providers: status,
  });

  it("returns the first non-complete active section in registry order", () => {
    expect(getNextIncompleteSection(all("not_started"))?.key).toBe("org_details");
    expect(
      getNextIncompleteSection({ ...all("complete"), provider_group: "not_started" })?.key,
    ).toBe("provider_group");
    expect(getNextIncompleteSection({ ...all("complete"), facilities: "not_started" })?.key).toBe(
      "facilities",
    );
    expect(getNextIncompleteSection({ ...all("complete"), providers: "not_started" })?.key).toBe(
      "providers",
    );
  });

  it("treats in_progress as incomplete", () => {
    expect(getNextIncompleteSection({ ...all("complete"), org_details: "in_progress" })?.key).toBe(
      "org_details",
    );
  });

  it("skips later gaps in favor of the earliest one", () => {
    expect(
      getNextIncompleteSection({
        org_details: "complete",
        provider_group: "not_started",
        facilities: "not_started",
        providers: "not_started",
      })?.key,
    ).toBe("provider_group");
  });

  it("returns null when all four R1 sections are complete (preview handoff)", () => {
    expect(getNextIncompleteSection(all("complete"))).toBeNull();
  });
});
