import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOnboardingFunnelRows,
  visibleOnboardingFunnelStages,
  type OnboardingFunnelInput,
  type OnboardingFunnelProviderFacts,
  type OnboardingFunnelStage,
} from "@/lib/onboardingFunnel";

const state = vi.hoisted(() => ({
  stage: null as string | null,
  intakeReadable: false,
}));

// The report opens on Profile incomplete; a test can open another stage.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) =>
      actual.useState(initial === "profile_incomplete" && state.stage ? state.stage : initial),
  };
});
vi.mock("@/hooks/useOnboardingFunnel", () => ({
  useOnboardingFunnel: () => ({
    orgId: "org-1",
    rows: buildOnboardingFunnelRows(funnelInput(), "2026-10-20"),
    stages: visibleOnboardingFunnelStages(state.intakeReadable),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import { OnboardingFunnelReport } from "./OnboardingFunnelReport";

const complete = (providerId: string, name: string): OnboardingFunnelProviderFacts => ({
  providerId,
  name,
  npi: "1234567893",
  caqhIdPresent: true,
  caqhLastAttestedDate: "2026-09-01",
  dobPresent: true,
  ssnLast4Present: true,
  pendingVerification: false,
});

function funnelInput(): OnboardingFunnelInput {
  return {
    providers: [
      { ...complete("p-new", "Ann Newhire"), npi: null },
      complete("p-unassigned", "Bea Unassigned"),
      complete("p-ready", "Cal Ready"),
      complete("p-denied", "Dee Enrolling"),
    ],
    licenses: ["p-new", "p-unassigned", "p-ready"].map((providerId) => ({
      providerId,
      state: "TX",
      verifiedStatus: "verified",
      expirationDate: "2027-06-30",
    })),
    workStates: [{ providerId: "p-ready", state: "TX" }],
    groupMemberships: [{ providerId: "p-ready", endDate: null }],
    // Dee's only case was denied; the service reads no status, so it is a case.
    cases: [{ providerId: "p-denied", state: "TX" }],
    intakeReadable: false,
  };
}

function render(stage: OnboardingFunnelStage | null = null): string {
  state.stage = stage;
  return renderToStaticMarkup(<OnboardingFunnelReport />);
}

/** The stage card titles, in the order they render. */
function cardTitles(html: string): string[] {
  return [...html.matchAll(/Step \d+<\/span><span[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]);
}

beforeEach(() => {
  state.stage = null;
  state.intakeReadable = false;
});

describe("Provider Onboarding report", () => {
  it("shows the four provider stages in funnel order, without Invited", () => {
    const html = render();
    expect(cardTitles(html)).toEqual([
      "Profile incomplete",
      "Submitted",
      "Ready for credentialing",
      "Credentialing",
    ]);
    expect(html).not.toContain("Awaiting verification");
    expect(html).not.toContain("Ready to credential<");
    expect(html).toContain("lg:grid-cols-4");
  });

  it("lists a verified provider with no group or location under Submitted", () => {
    const html = render("submitted");
    expect(html).toContain("Submitted · 1");
    expect(html).toContain("What&#x27;s needed");
    expect(html).toContain("Bea Unassigned");
    expect(html).toContain("Needs a group and a location");
  });

  it("keeps Credentialing to one count with no case-status breakdown", () => {
    const html = render("credentialing");
    expect(html).toContain("Credentialing · 1");
    expect(html).toContain("Dee Enrolling");
    expect(html).not.toContain("What&#x27;s needed");
    expect(html).not.toMatch(/denied|approved|withdrawn|case status/i);
  });

  it("adds Invited as the first stage once the intake tables can be read", () => {
    state.intakeReadable = true;
    const html = render();
    expect(cardTitles(html)).toEqual([
      "Invited",
      "Profile incomplete",
      "Submitted",
      "Ready for credentialing",
      "Credentialing",
    ]);
    expect(html).toContain("lg:grid-cols-5");
  });
});
