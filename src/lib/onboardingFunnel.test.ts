import { describe, expect, it } from "vitest";
import {
  buildOnboardingFunnelRows,
  onboardingFunnelStageCounts,
  onboardingFunnelStates,
  type OnboardingFunnelInput,
  type OnboardingFunnelProviderFacts,
} from "@/lib/onboardingFunnel";

const TODAY = "2026-10-20";

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

const verified = (providerId: string, state: string) => ({
  providerId,
  state,
  verifiedStatus: "verified",
  expirationDate: "2027-06-30",
});

function input(): OnboardingFunnelInput {
  return {
    providers: [
      { ...complete("missing", "Ann Missing"), npi: null, ssnLast4Present: false },
      complete("nolicense", "Bea Nolicense"),
      complete("wrongstate", "Cal Wrongstate"),
      complete("unverified", "Dee Unverified"),
      { ...complete("stale", "Eve Stale"), caqhLastAttestedDate: "2026-01-01" },
      complete("ready", "Fay Ready"),
      { ...complete("enrolling", "Gus Enrolling"), caqhIdPresent: false },
    ],
    licenses: [
      verified("wrongstate", "KS"),
      { ...verified("unverified", "TX"), verifiedStatus: "unverified" },
      verified("stale", "NC"),
      verified("ready", "NC"),
      { ...verified("ready", "SC"), expirationDate: "2025-01-01" },
    ],
    workStates: [
      { providerId: "wrongstate", state: "MO" },
      { providerId: "unverified", state: "tx" },
      { providerId: "ready", state: "NC" },
    ],
    cases: [{ providerId: "enrolling", state: "CO" }],
  };
}

describe("provider onboarding funnel", () => {
  it("places every provider in exactly one stage with the gaps that hold them there", () => {
    const rows = buildOnboardingFunnelRows(input(), TODAY);
    expect(rows.map((r) => [r.providerId, r.stage, r.gaps])).toEqual([
      ["missing", "profile_incomplete", ["No NPI", "No SSN last 4", "No state license"]],
      ["nolicense", "profile_incomplete", ["No state license"]],
      ["wrongstate", "profile_incomplete", ["No MO license"]],
      ["unverified", "awaiting_verification", ["TX license not board-verified"]],
      ["stale", "awaiting_verification", ["CAQH attestation older than 120 days"]],
      // The expired SC license is outside the state Fay works in.
      ["ready", "ready_to_credential", []],
      // A case means credentialing has started, whatever else is open.
      ["enrolling", "credentialing", []],
    ]);
    const counts = onboardingFunnelStageCounts(rows);
    expect(counts).toEqual({
      profile_incomplete: 3,
      awaiting_verification: 2,
      ready_to_credential: 1,
      credentialing: 1,
    });
    expect(Object.values(counts).reduce((n, c) => n + c, 0)).toBe(rows.length);
  });

  it("judges every license on file when no work location is assigned", () => {
    const data = input();
    data.workStates = [];
    const ready = buildOnboardingFunnelRows(data, TODAY).find((r) => r.providerId === "ready");
    expect(ready).toMatchObject({ stage: "awaiting_verification", gaps: ["SC license expired"] });
  });

  it("flags never-attested CAQH and pending records, and lists states for the filter", () => {
    const data = input();
    data.providers = [
      { ...complete("ready", "Fay Ready"), caqhLastAttestedDate: null, pendingVerification: true },
    ];
    const rows = buildOnboardingFunnelRows(data, TODAY);
    expect(rows[0].gaps).toEqual(["CAQH never attested", "Record pending verification"]);
    expect(onboardingFunnelStates(buildOnboardingFunnelRows(input(), TODAY))).toEqual([
      "CO",
      "KS",
      "MO",
      "NC",
      "SC",
      "TX",
    ]);
  });
});
