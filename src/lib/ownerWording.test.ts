// M5.5 owner wording map + "when" derivations, per spec tables.
import { describe, expect, it } from "vitest";
import { expandCredentials, ownerState, ownerWhen, type OwnerWordingInput } from "./ownerWording";

const NOW = new Date("2026-07-03T12:00:00Z");

function input(overrides: Partial<OwnerWordingInput> = {}): OwnerWordingInput {
  return {
    statusLabel: "Submitted",
    confirmedEffectiveDate: null,
    expectedEffectiveDate: null,
    submittedDate: null,
    avgDecisionDays: null,
    nextFollowUpDate: null,
    now: NOW,
    ...overrides,
  };
}

describe("ownerState map", () => {
  it("maps every internal label to owner wording", () => {
    expect(ownerState(input({ statusLabel: "In-Network" })).label).toBe("Billing now");
    expect(
      ownerState(input({ statusLabel: "Approved", confirmedEffectiveDate: "2026-06-01" })).label,
    ).toBe("Billing now");
    expect(
      ownerState(input({ statusLabel: "Approved", confirmedEffectiveDate: "2026-08-01" })).label,
    ).toContain("Approved · billing starts");
    expect(ownerState(input({ statusLabel: "Submitted" })).label).toBe("In review");
    expect(ownerState(input({ statusLabel: "In Progress" })).label).toBe("In preparation");
    expect(ownerState(input({ statusLabel: "Waiting on Provider" })).label).toBe(
      "Waiting on documents",
    );
    expect(ownerState(input({ statusLabel: "Denied" })).label).toBe("Needs attention");
    expect(ownerState(input({ statusLabel: "Not Started" })).label).toBe("Not started yet");
    expect(ownerState(input({ statusLabel: "Not Required" })).omit).toBe(true);
  });

  it("flags billingNow only for In-Network / effective-passed Approved", () => {
    expect(ownerState(input({ statusLabel: "In-Network" })).billingNow).toBe(true);
    expect(ownerState(input({ statusLabel: "Submitted" })).billingNow).toBe(false);
  });
});

describe("ownerWhen derivations (precedence top-down)", () => {
  it("Submitted with avg_decision_days → Est. date", () => {
    expect(ownerWhen(input({ submittedDate: "2026-06-20", avgDecisionDays: 30 }))).toBe(
      "Est. Jul 20",
    );
  });

  it("null avg_decision_days skips the Est. line", () => {
    expect(ownerWhen(input({ submittedDate: "2026-06-20", avgDecisionDays: null }))).toBe("");
  });

  it("future next follow-up wins when no Est. applies", () => {
    expect(ownerWhen(input({ statusLabel: "In Progress", nextFollowUpDate: "2026-07-10" }))).toBe(
      "Next follow-up Jul 10",
    );
  });

  it("Approved with future effective date → Billing starts", () => {
    expect(
      ownerWhen(input({ statusLabel: "Approved", confirmedEffectiveDate: "2026-08-01" })),
    ).toBe("Billing starts Aug 1");
  });

  it("Not Started → Queued; otherwise blank", () => {
    expect(ownerWhen(input({ statusLabel: "Not Started" }))).toBe("Queued");
    expect(ownerWhen(input({ statusLabel: "In Progress" }))).toBe("");
  });
});

describe("expandCredentials", () => {
  it("expands known abbreviations and passes unknowns through", () => {
    expect(expandCredentials("DPT")).toBe("Doctor of Physical Therapy");
    expect(expandCredentials("D.P.T.")).toBe("Doctor of Physical Therapy");
    expect(expandCredentials("XYZ")).toBe("XYZ");
    expect(expandCredentials(null)).toBeNull();
  });
});
