import { describe, expect, it } from "vitest";
import { isNewState, launchReadiness } from "./launchReadiness";

describe("launchReadiness", () => {
  it("computes the in-network share excluding pre-cred cases", () => {
    const r = launchReadiness({
      cases: [
        { statusLabel: "In-Network", isPreCred: false },
        { statusLabel: "Submitted", isPreCred: false },
        { statusLabel: "In-Network", isPreCred: false },
        { statusLabel: "Not Started", isPreCred: true }, // excluded
      ],
      activePayerIds: ["a", "b"],
      contractedPayerIdsInState: new Set(["a", "b"]),
    });
    expect(r.inNetwork).toBe(2);
    expect(r.denominator).toBe(3);
    expect(r.share).toBeCloseTo(2 / 3);
    expect(r.contractGap).toBe(false);
  });

  it("returns a null share with no countable cases", () => {
    const r = launchReadiness({
      cases: [{ statusLabel: null, isPreCred: true }],
      activePayerIds: [],
      contractedPayerIdsInState: new Set(),
    });
    expect(r.share).toBeNull();
    expect(r.denominator).toBe(0);
  });

  it("flags a contract gap when any active payer lacks a contract in state", () => {
    const r = launchReadiness({
      cases: [],
      activePayerIds: ["a", "b", "c"],
      contractedPayerIdsInState: new Set(["a", "c"]),
    });
    expect(r.contractGap).toBe(true);
  });

  it("isNewState fires only on zero contracts in the state", () => {
    expect(isNewState(new Set())).toBe(true);
    expect(isNewState(new Set(["a"]))).toBe(false);
  });
});
