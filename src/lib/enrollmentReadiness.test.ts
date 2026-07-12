// E1.8 TE-12 — the pure evaluator is the primary coverage: CAQH boundary at
// 119/120/121 days, expiration on/just-past today, missing-demographics
// permutations, the group-check dedupe (TE-7), the PSV flip (TS-43 core),
// and the advisory case-key summary (TE-10).
import { describe, expect, it } from "vitest";
import {
  daysBetween,
  evaluateEnrollmentReadiness,
  filterReadinessRows,
  isCaqhCurrent,
  readinessForCaseKey,
  readinessSummary,
  type EnrollmentReadinessInput,
  type ProviderReadinessFacts,
} from "./enrollmentReadiness";

const TODAY = "2026-07-12";

const facts = (over: Partial<ProviderReadinessFacts> = {}): ProviderReadinessFacts => ({
  providerId: "pr-1",
  providerName: "Brooke Ostrander",
  npiPresent: true,
  caqhIdPresent: true,
  caqhLastAttestedDate: "2026-06-15",
  dobPresent: true,
  ssnLast4Present: true,
  homeAddressPresent: true,
  malpracticeCoverageEnd: "2027-01-01",
  ...over,
});

const baseInput = (over: Partial<EnrollmentReadinessInput> = {}): EnrollmentReadinessInput => ({
  today: TODAY,
  targets: [{ groupId: "g-1", payerId: "pay-1", state: "NC", status: "active" }],
  groupAssignments: [{ providerId: "pr-1", groupId: "g-1" }],
  providers: [facts()],
  licenses: [
    { providerId: "pr-1", state: "NC", expirationDate: "2027-01-31", verifiedStatus: "verified" },
  ],
  facilities: [{ groupId: "g-1", state: "NC", isActive: true }],
  groupDocuments: [
    { groupId: "g-1", docType: "w9", expirationDate: null },
    { groupId: "g-1", docType: "coi", expirationDate: null },
    { groupId: "g-1", docType: "voided_check", expirationDate: null },
  ],
  groupInsurancePolicies: [],
  ...over,
});

const check = (input: EnrollmentReadinessInput, key: string) => {
  const rows = evaluateEnrollmentReadiness(input);
  expect(rows).toHaveLength(1);
  const c = rows[0].checks.find((c) => c.key === key);
  if (!c) throw new Error(`check ${key} missing`);
  return c;
};

describe("date helpers", () => {
  it("daysBetween is UTC-midnight math (no TZ drift)", () => {
    expect(daysBetween("2026-07-12", "2026-07-12")).toBe(0);
    expect(daysBetween("2026-03-14", "2026-07-12")).toBe(120);
    expect(daysBetween("2026-07-12", "2026-03-14")).toBe(-120);
  });

  it("CAQH window boundary: 119/120 current, 121 stale (locked 120 days)", () => {
    expect(isCaqhCurrent("2026-03-15", TODAY)).toBe(true); // 119
    expect(isCaqhCurrent("2026-03-14", TODAY)).toBe(true); // 120
    expect(isCaqhCurrent("2026-03-13", TODAY)).toBe(false); // 121
    expect(isCaqhCurrent(null, TODAY)).toBe(false);
    expect(isCaqhCurrent("2026-08-01", TODAY)).toBe(false); // future-dated
  });
});

describe("provider checklist", () => {
  it("a fully clean row is Ready with zero gaps", () => {
    const rows = evaluateEnrollmentReadiness(baseInput());
    expect(rows[0].ready).toBe(true);
    expect(rows[0].openGaps).toBe(0);
    expect(rows[0].checks).toHaveLength(12);
  });

  it("license expiration is date-only inclusive: today passes, yesterday fails", () => {
    const onToday = baseInput({
      licenses: [
        { providerId: "pr-1", state: "NC", expirationDate: TODAY, verifiedStatus: "verified" },
      ],
    });
    expect(check(onToday, "license_current").pass).toBe(true);
    const past = baseInput({
      licenses: [
        {
          providerId: "pr-1",
          state: "NC",
          expirationDate: "2026-07-11",
          verifiedStatus: "verified",
        },
      ],
    });
    const c = check(past, "license_current");
    expect(c.pass).toBe(false);
    expect(c.detail).toBe("Expires 2026-07-11");
  });

  it("TS-43 core: recording PSV flips license_verified with nothing stored", () => {
    const unverified = baseInput({
      licenses: [
        {
          providerId: "pr-1",
          state: "NC",
          expirationDate: "2027-01-31",
          verifiedStatus: "unverified",
        },
      ],
    });
    expect(check(unverified, "license_verified").pass).toBe(false);
    // Same inputs, PSV recorded — pure re-evaluation flips the check.
    expect(check(baseInput(), "license_verified").pass).toBe(true);
  });

  it("missing target-state license fails all three license checks", () => {
    const input = baseInput({
      licenses: [
        {
          providerId: "pr-1",
          state: "SC",
          expirationDate: "2027-01-31",
          verifiedStatus: "verified",
        },
      ],
    });
    expect(check(input, "license_present").pass).toBe(false);
    expect(check(input, "license_present").detail).toBe("No NC license");
    expect(check(input, "license_current").pass).toBe(false);
    expect(check(input, "license_verified").pass).toBe(false);
  });

  it("a verified license wins over a stale duplicate for the same state", () => {
    const input = baseInput({
      licenses: [
        { providerId: "pr-1", state: "NC", expirationDate: "2025-01-01", verifiedStatus: "failed" },
        {
          providerId: "pr-1",
          state: "NC",
          expirationDate: "2027-01-31",
          verifiedStatus: "verified",
        },
      ],
    });
    expect(check(input, "license_verified").pass).toBe(true);
    expect(check(input, "license_current").pass).toBe(true);
  });

  it("demographics permutations list exactly what is missing (presence only)", () => {
    const missingAll = baseInput({
      providers: [facts({ dobPresent: false, ssnLast4Present: false, homeAddressPresent: false })],
    });
    const c = check(missingAll, "demographics");
    expect(c.pass).toBe(false);
    expect(c.detail).toBe("Missing: date of birth, SSN last 4, home address");

    const missingOne = baseInput({ providers: [facts({ ssnLast4Present: false })] });
    expect(check(missingOne, "demographics").detail).toBe("Missing: SSN last 4");
    expect(check(baseInput(), "demographics").pass).toBe(true);
  });

  it("TS-44 core: 130-day-stale CAQH is a red item carrying the attestation date", () => {
    const input = baseInput({
      providers: [facts({ caqhLastAttestedDate: "2026-03-04" })], // 130 days
    });
    const c = check(input, "caqh_current");
    expect(c.pass).toBe(false);
    expect(c.detail).toBe("Attested 2026-03-04");
  });
});

describe("group checklist (computed once per group × state, TE-7)", () => {
  it("TS-44 core: target state without a group facility is a group red item", () => {
    const input = baseInput({ facilities: [{ groupId: "g-1", state: "SC", isActive: true }] });
    const c = check(input, "state_facility");
    expect(c.pass).toBe(false);
    expect(c.owner).toBe("group");
    expect(c.detail).toBe("No NC facility");
  });

  it("inactive facilities never satisfy state coverage", () => {
    const input = baseInput({ facilities: [{ groupId: "g-1", state: "NC", isActive: false }] });
    expect(check(input, "state_facility").pass).toBe(false);
  });

  it("COI passes via an unexpired insurance policy OR a current coi document", () => {
    const viaPolicy = baseInput({
      groupDocuments: [{ groupId: "g-1", docType: "w9", expirationDate: null }],
      groupInsurancePolicies: [{ groupId: "g-1", policyEndDate: "2027-01-01" }],
    });
    expect(check(viaPolicy, "group_coi").pass).toBe(true);

    const expiredBoth = baseInput({
      groupDocuments: [{ groupId: "g-1", docType: "coi", expirationDate: "2026-07-11" }],
      groupInsurancePolicies: [{ groupId: "g-1", policyEndDate: "2026-07-11" }],
    });
    expect(check(expiredBoth, "group_coi").pass).toBe(false);
  });

  it("group checks are the SAME object across a group's provider rows (dedupe)", () => {
    const input = baseInput({
      groupAssignments: [
        { providerId: "pr-1", groupId: "g-1" },
        { providerId: "pr-2", groupId: "g-1" },
      ],
      providers: [facts(), facts({ providerId: "pr-2", providerName: "Nathan Scott" })],
    });
    const rows = evaluateEnrollmentReadiness(input);
    expect(rows).toHaveLength(2);
    const groupCheckA = rows[0].checks.find((c) => c.key === "w9");
    const groupCheckB = rows[1].checks.find((c) => c.key === "w9");
    expect(groupCheckA).toBe(groupCheckB); // memoized fan-out, not recomputed
  });
});

describe("row derivation (TE-2 grain)", () => {
  it("archived targets and group-less providers produce no rows", () => {
    const archived = baseInput({
      targets: [{ groupId: "g-1", payerId: "pay-1", state: "NC", status: "archived" }],
    });
    expect(evaluateEnrollmentReadiness(archived)).toHaveLength(0);

    const noRoster = baseInput({ groupAssignments: [] });
    expect(evaluateEnrollmentReadiness(noRoster)).toHaveLength(0);
  });

  it("one target × two providers in the group = two case-key rows", () => {
    const input = baseInput({
      groupAssignments: [
        { providerId: "pr-1", groupId: "g-1" },
        { providerId: "pr-2", groupId: "g-1" },
      ],
      providers: [facts(), facts({ providerId: "pr-2", providerName: "Nathan Scott" })],
    });
    const rows = evaluateEnrollmentReadiness(input);
    expect(rows.map((r) => r.providerId).sort()).toEqual(["pr-1", "pr-2"]);
  });

  it("an assignment end-dated before today produces no rows; ending today still counts", () => {
    const ended = baseInput({
      groupAssignments: [{ providerId: "pr-1", groupId: "g-1", endDate: "2026-07-11" }],
    });
    expect(evaluateEnrollmentReadiness(ended)).toHaveLength(0);

    const endsToday = baseInput({
      groupAssignments: [{ providerId: "pr-1", groupId: "g-1", endDate: TODAY }],
    });
    expect(evaluateEnrollmentReadiness(endsToday)).toHaveLength(1);

    const openEnded = baseInput({
      groupAssignments: [{ providerId: "pr-1", groupId: "g-1", endDate: null }],
    });
    expect(evaluateEnrollmentReadiness(openEnded)).toHaveLength(1);
  });

  it("summary counts rows, ready rows, and total open gaps", () => {
    const input = baseInput({
      providers: [facts({ npiPresent: false, caqhIdPresent: false })],
    });
    const rows = evaluateEnrollmentReadiness(input);
    expect(readinessSummary(rows)).toEqual({ total: 1, ready: 0, openGaps: 2 });
  });
});

describe("filterReadinessRows (F1.8.1 filters)", () => {
  it("gap filter keeps only rows with that check OPEN, not merely present", () => {
    const input = baseInput({
      targets: [
        { groupId: "g-1", payerId: "pay-1", state: "NC", status: "active" },
        { groupId: "g-1", payerId: "pay-2", state: "NC", status: "active" },
      ],
    });
    const rows = evaluateEnrollmentReadiness(input);
    expect(rows).toHaveLength(2);
    // Every check passes → the gap filter returns nothing.
    expect(
      filterReadinessRows(rows, {
        groupId: "all",
        payerId: "all",
        state: "all",
        gap: "caqh_current",
      }),
    ).toHaveLength(0);
    expect(
      filterReadinessRows(rows, { groupId: "all", payerId: "pay-2", state: "all", gap: "all" }),
    ).toHaveLength(1);
    expect(
      filterReadinessRows(rows, { groupId: "all", payerId: "all", state: "SC", gap: "all" }),
    ).toHaveLength(0);
  });
});

describe("readinessForCaseKey (TE-10 soft-warn contract — advisory only)", () => {
  it("returns the open gaps for one case key", () => {
    const input = baseInput({ providers: [facts({ caqhLastAttestedDate: "2026-01-01" })] });
    const result = readinessForCaseKey(input, {
      providerId: "pr-1",
      groupId: "g-1",
      payerId: "pay-1",
      state: "NC",
    });
    expect(result.ready).toBe(false);
    expect(result.openGaps.map((c) => c.key)).toEqual(["caqh_current"]);
  });

  it("an unknown case key reports not-ready with no gap detail", () => {
    expect(
      readinessForCaseKey(baseInput(), {
        providerId: "ghost",
        groupId: "g-1",
        payerId: "pay-1",
        state: "NC",
      }),
    ).toEqual({ ready: false, openGaps: [] });
  });
});
