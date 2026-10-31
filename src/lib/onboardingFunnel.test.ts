import { describe, expect, it } from "vitest";
import {
  buildOnboardingFunnelRows,
  ONBOARDING_FUNNEL_STAGES,
  onboardingFunnelStageCounts,
  onboardingFunnelStates,
  visibleOnboardingFunnelStages,
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

const member = (providerId: string, endDate: string | null = null) => ({ providerId, endDate });

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
      { providerId: "stale", state: "NC" },
      { providerId: "ready", state: "NC" },
    ],
    groupMemberships: [member("unverified"), member("stale"), member("ready")],
    cases: [{ providerId: "enrolling", state: "CO" }],
    intakeReadable: false,
  };
}

function rowFor(data: OnboardingFunnelInput, providerId: string) {
  return buildOnboardingFunnelRows(data, TODAY).find((r) => r.providerId === providerId);
}

describe("provider onboarding funnel", () => {
  it("places every provider in exactly one stage with the gaps that hold them there", () => {
    const rows = buildOnboardingFunnelRows(input(), TODAY);
    expect(rows.map((r) => [r.providerId, r.stage, r.gaps])).toEqual([
      ["missing", "profile_incomplete", ["No NPI", "No SSN last 4", "No state license"]],
      ["nolicense", "profile_incomplete", ["No state license"]],
      ["wrongstate", "profile_incomplete", ["No MO license"]],
      ["unverified", "submitted", ["TX license not board-verified"]],
      ["stale", "submitted", ["CAQH attestation older than 120 days"]],
      // The expired SC license is outside the state Fay works in.
      ["ready", "ready_for_credentialing", []],
      // A case means credentialing has started, whatever else is open.
      ["enrolling", "credentialing", []],
    ]);
    const counts = onboardingFunnelStageCounts(rows);
    expect(counts).toEqual({
      invited: 0,
      profile_incomplete: 3,
      submitted: 2,
      ready_for_credentialing: 1,
      credentialing: 1,
    });
    expect(Object.values(counts).reduce((n, c) => n + c, 0)).toBe(rows.length);
  });

  it("keeps a verified provider in Submitted until they have both a group and a location", () => {
    const data = input();
    data.providers = [
      complete("both", "Ada Both"),
      complete("grouponly", "Ben Grouponly"),
      complete("locationonly", "Cy Locationonly"),
      complete("neither", "Di Neither"),
    ];
    data.licenses = data.providers.map((p) => verified(p.providerId, "NC"));
    data.workStates = [
      { providerId: "both", state: "NC" },
      { providerId: "locationonly", state: "NC" },
    ];
    data.groupMemberships = [member("both"), member("grouponly")];
    data.cases = [];
    const rows = buildOnboardingFunnelRows(data, TODAY);
    expect(rows.map((r) => [r.providerId, r.stage, r.gaps])).toEqual([
      ["both", "ready_for_credentialing", []],
      ["grouponly", "submitted", ["Needs a location"]],
      ["locationonly", "submitted", ["Needs a group"]],
      ["neither", "submitted", ["Needs a group and a location"]],
    ]);
  });

  it("does not count a group membership that ended before today", () => {
    const data = input();
    data.groupMemberships = [member("ready", "2026-10-19")];
    expect(rowFor(data, "ready")).toMatchObject({ stage: "submitted", gaps: ["Needs a group"] });
    data.groupMemberships = [member("ready", TODAY)];
    expect(rowFor(data, "ready")).toMatchObject({ stage: "ready_for_credentialing" });
  });

  it("judges every license on file when no location is assigned, and never calls that Ready", () => {
    const data = input();
    data.workStates = [];
    expect(rowFor(data, "ready")).toMatchObject({
      stage: "submitted",
      gaps: ["SC license expired", "Needs a location"],
    });
    data.licenses = data.licenses.filter((l) => !(l.providerId === "ready" && l.state === "SC"));
    expect(rowFor(data, "ready")).toMatchObject({ stage: "submitted", gaps: ["Needs a location"] });
  });

  it("never lets a location with no valid state reach Ready", () => {
    // Fay: complete profile, verified unexpired NC license, current group
    // membership. Her only active location has no usable state, so there is
    // no working state to judge and no all-licenses fallback.
    for (const state of [null, "", "Kansas", "N1"]) {
      const data = input();
      data.licenses = [verified("ready", "NC")];
      data.workStates = [{ providerId: "ready", state }];
      expect(rowFor(data, "ready")).toMatchObject({
        stage: "submitted",
        gaps: ["Location has no valid state on record"],
      });
    }
  });

  it("holds a provider in Submitted when any one of their locations has no state", () => {
    // Fay's NC location passes, but a second location has no state, so its
    // license cannot be judged and she is not verified for every place she works.
    for (const state of [null, "N1"]) {
      const data = input();
      data.workStates = [
        { providerId: "ready", state },
        { providerId: "ready", state: "NC" },
      ];
      expect(rowFor(data, "ready")).toMatchObject({
        stage: "submitted",
        gaps: ["Location has no valid state on record"],
      });
    }
  });

  it("still judges the valid locations next to a stateless one", () => {
    const data = input();
    data.licenses = [{ ...verified("ready", "NC"), verifiedStatus: "unverified" }];
    data.workStates = [
      { providerId: "ready", state: "" },
      { providerId: "ready", state: "NC" },
    ];
    expect(rowFor(data, "ready")).toMatchObject({
      stage: "submitted",
      gaps: ["NC license not board-verified", "Location has no valid state on record"],
    });
  });

  it("lists a stateless location next to the other gaps", () => {
    const data = input();
    data.groupMemberships = [];
    data.workStates = [{ providerId: "ready", state: "nowhere" }];
    data.licenses = [{ ...verified("ready", "NC"), verifiedStatus: "unverified" }];
    // With a location there is no fallback, so the unverified NC license is
    // not judged: only the missing group and the missing state hold her.
    expect(rowFor(data, "ready")).toMatchObject({
      stage: "submitted",
      gaps: ["Needs a group", "Location has no valid state on record"],
    });
  });

  it("lists verification gaps and the missing assignment together", () => {
    const data = input();
    data.groupMemberships = [];
    expect(rowFor(data, "unverified")).toMatchObject({
      stage: "submitted",
      gaps: ["TX license not board-verified", "Needs a group"],
    });
  });

  it("counts any case as Credentialing, even for an incomplete, unassigned profile", () => {
    const data = input();
    data.cases = [{ providerId: "missing", state: "TX" }];
    expect(rowFor(data, "missing")).toMatchObject({ stage: "credentialing", gaps: [] });
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

  it("names a license with no expiration date instead of calling it expired", () => {
    const data = input();
    data.licenses = data.licenses.map((l) =>
      l.providerId === "ready" && l.state === "NC" ? { ...l, expirationDate: null } : l,
    );
    expect(rowFor(data, "ready")).toMatchObject({
      stage: "submitted",
      gaps: ["NC license has no expiration date"],
    });
  });

  it("treats a future CAQH attestation date as not current, with its own reason", () => {
    const data = input();
    data.providers = [{ ...complete("ready", "Fay Ready"), caqhLastAttestedDate: "2026-11-01" }];
    expect(buildOnboardingFunnelRows(data, TODAY)[0]).toMatchObject({
      stage: "submitted",
      gaps: ["CAQH attestation date is in the future"],
    });
  });

  it("does not let a license with an invalid state code satisfy the license requirement", () => {
    const data = input();
    data.providers = [complete("bad", "Hal Badstate")];
    data.licenses = [verified("bad", "Z9")];
    data.workStates = [];
    data.groupMemberships = [];
    const [row] = buildOnboardingFunnelRows(data, TODAY);
    expect(row).toMatchObject({
      stage: "profile_incomplete",
      gaps: ["License state is missing or invalid"],
    });
    data.licenses = [...data.licenses, verified("bad", "nc")];
    data.workStates = [{ providerId: "bad", state: "NC" }];
    data.groupMemberships = [member("bad")];
    expect(buildOnboardingFunnelRows(data, TODAY)[0]).toMatchObject({
      stage: "ready_for_credentialing",
      states: ["NC"],
    });
  });
});

describe("provider onboarding funnel stages", () => {
  it("runs Invited, Profile incomplete, Submitted, Ready for credentialing, Credentialing", () => {
    expect(ONBOARDING_FUNNEL_STAGES.map((s) => [s.key, s.title])).toEqual([
      ["invited", "Invited"],
      ["profile_incomplete", "Profile incomplete"],
      ["submitted", "Submitted"],
      ["ready_for_credentialing", "Ready for credentialing"],
      ["credentialing", "Credentialing"],
    ]);
  });

  it("hides Invited until the intake tables can be read, and places nobody there today", () => {
    expect(visibleOnboardingFunnelStages(false).map((s) => s.key)).toEqual([
      "profile_incomplete",
      "submitted",
      "ready_for_credentialing",
      "credentialing",
    ]);
    expect(visibleOnboardingFunnelStages(true).map((s) => s.key)).toEqual(
      ONBOARDING_FUNNEL_STAGES.map((s) => s.key),
    );
    const rows = buildOnboardingFunnelRows(input(), TODAY);
    expect(rows.some((r) => r.stage === "invited")).toBe(false);
  });

  it("describes each stage in the PM's words, with no case-status breakdown", () => {
    const copy = Object.fromEntries(ONBOARDING_FUNNEL_STAGES.map((s) => [s.title, s.description]));
    expect(copy).toEqual({
      Invited: "Invited to the intake form. Nothing submitted yet.",
      "Profile incomplete": "Missing NPI, CAQH ID, demographics, or a license.",
      Submitted: "Information is in, but not yet verified or assigned to a group and location.",
      "Ready for credentialing": "Verified and assigned to a group and location. No case yet.",
      Credentialing: "Has at least one credentialing case, in any status.",
    });
    const text = Object.entries(copy).flat().join(" ");
    expect(text).not.toMatch(/Awaiting verification|Ready to credential\b/);
    expect(text).not.toMatch(/approved|denied|withdrawn|underway/i);
  });

  it("lists gaps only for the stages that have them", () => {
    expect(ONBOARDING_FUNNEL_STAGES.filter((s) => s.listsGaps).map((s) => s.key)).toEqual([
      "profile_incomplete",
      "submitted",
    ]);
  });
});
