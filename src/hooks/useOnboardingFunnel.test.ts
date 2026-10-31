// useOnboardingFunnel wires the read to the report: rows from the funnel
// rules, and the stages to show, which hide Invited until the read says the
// intake tables can be seen.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingFunnelInput } from "@/lib/onboardingFunnel";

const holder = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useMemo: (factory: () => unknown) => factory(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: holder.data, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/auth-store", () => ({ useActiveOrgId: () => "org-1" }));
vi.mock("@/hooks/useEnrollmentReadiness", () => ({ localTodayIso: () => "2026-10-20" }));
vi.mock("@/services/onboardingFunnel", () => ({ getOnboardingFunnelInput: vi.fn() }));

import { useOnboardingFunnel } from "@/hooks/useOnboardingFunnel";

function data(intakeReadable: boolean): OnboardingFunnelInput {
  return {
    providers: [
      {
        providerId: "p-1",
        name: "Ann Example",
        npi: "1234567893",
        caqhIdPresent: true,
        caqhLastAttestedDate: "2026-09-01",
        dobPresent: true,
        ssnLast4Present: true,
        pendingVerification: false,
      },
    ],
    licenses: [
      { providerId: "p-1", state: "NC", verifiedStatus: "verified", expirationDate: "2027-06-30" },
    ],
    workStates: [],
    groupMemberships: [],
    cases: [],
    intakeReadable,
  };
}

beforeEach(() => {
  holder.data = undefined;
});

describe("useOnboardingFunnel", () => {
  it("shows the four stages without Invited while the read cannot see intake data", () => {
    holder.data = data(false);
    const result = useOnboardingFunnel();
    expect(result.stages.map((s) => s.key)).toEqual([
      "profile_incomplete",
      "submitted",
      "ready_for_credentialing",
      "credentialing",
    ]);
    expect(result.rows).toMatchObject([
      { providerId: "p-1", stage: "submitted", gaps: ["Needs a group and a location"] },
    ]);
  });

  it("adds Invited first once the read says the intake tables can be seen", () => {
    holder.data = data(true);
    expect(useOnboardingFunnel().stages.map((s) => s.key)).toEqual([
      "invited",
      "profile_incomplete",
      "submitted",
      "ready_for_credentialing",
      "credentialing",
    ]);
  });

  it("hides Invited while the read is still loading", () => {
    const result = useOnboardingFunnel();
    expect(result.rows).toBeUndefined();
    expect(result.stages.map((s) => s.key)).not.toContain("invited");
    expect(result.stages).toHaveLength(4);
  });
});
