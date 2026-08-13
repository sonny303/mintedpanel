import { describe, expect, it } from "vitest";
import {
  ALL_STATES_SENTINEL,
  formatSopStateLabel,
  isAllStates,
  isSupportedOrgSopMatchKey,
  orgSopMatchKeyError,
  templateStates,
} from "./sopMatchKey";

describe("orgSopMatchKeyError — authoring rejects unsupported wildcard combos", () => {
  it("rejects an Any-payer match key", () => {
    expect(orgSopMatchKeyError({ payerId: null, states: ["NC"] })).toMatch(/payer/i);
    expect(isSupportedOrgSopMatchKey({ payerId: null, states: ["NC"] })).toBe(false);
  });

  it("rejects an empty / null state set (Any state)", () => {
    expect(orgSopMatchKeyError({ payerId: "pay1", states: null })).toMatch(/state/i);
    expect(orgSopMatchKeyError({ payerId: "pay1", states: [] })).toMatch(/state/i);
    expect(isSupportedOrgSopMatchKey({ payerId: "pay1", states: [] })).toBe(false);
  });

  it("rejects Any-payer AND Any-state (payer reported first)", () => {
    expect(orgSopMatchKeyError({ payerId: null, states: [] })).toMatch(/payer/i);
  });

  it("accepts a concrete payer + single state (group optional, not checked here)", () => {
    expect(orgSopMatchKeyError({ payerId: "pay1", states: ["NC"] })).toBeNull();
    expect(isSupportedOrgSopMatchKey({ payerId: "pay1", states: ["NC"] })).toBe(true);
  });

  it("accepts MANY states — the point of the multi-state change", () => {
    expect(orgSopMatchKeyError({ payerId: "pay1", states: ["NC", "SC", "VA"] })).toBeNull();
    expect(isSupportedOrgSopMatchKey({ payerId: "pay1", states: ["NC", "SC", "VA"] })).toBe(true);
  });

  it("accepts the All-states sentinel as a complete state set", () => {
    expect(orgSopMatchKeyError({ payerId: "pay1", states: [ALL_STATES_SENTINEL] })).toBeNull();
    expect(isSupportedOrgSopMatchKey({ payerId: "pay1", states: [ALL_STATES_SENTINEL] })).toBe(
      true,
    );
  });

  it("rejects All mixed with specific states — contradictory, and it would break ranking", () => {
    // 'All' ranks BELOW an exact-state match. Storing {All, NC} would make the
    // row simultaneously both tiers; the storage CHECK rejects it too.
    expect(orgSopMatchKeyError({ payerId: "pay1", states: [ALL_STATES_SENTINEL, "NC"] })).toMatch(
      /all states/i,
    );
  });
});

describe("isAllStates", () => {
  it("is true only for the lone sentinel", () => {
    expect(isAllStates([ALL_STATES_SENTINEL])).toBe(true);
    expect(isAllStates(["NC"])).toBe(false);
    expect(isAllStates([])).toBe(false);
    expect(isAllStates(null)).toBe(false);
    // A 50-state list is NOT "All states" — it ranks as exact-state, by design.
    expect(isAllStates(["NC", "SC"])).toBe(false);
  });
});

describe("templateStates — reads `states`, falls back to the frozen scalar", () => {
  it("prefers the array", () => {
    expect(templateStates({ states: ["NC", "SC"], state: "NC" })).toEqual(["NC", "SC"]);
  });

  it("falls back to the pre-migration scalar so old rows still resolve", () => {
    expect(templateStates({ states: null, state: "VA" })).toEqual(["VA"]);
    expect(templateStates({ state: "VA" })).toEqual(["VA"]);
  });

  it("returns empty for a state-less row (the payerless generic fallback)", () => {
    expect(templateStates({ states: null, state: null })).toEqual([]);
    expect(templateStates(null)).toEqual([]);
    expect(templateStates({ states: [], state: null })).toEqual([]);
  });
});

describe("formatSopStateLabel", () => {
  it("labels the All-states sentinel for provenance / review", () => {
    expect(formatSopStateLabel([ALL_STATES_SENTINEL])).toBe("All states");
    expect(formatSopStateLabel(ALL_STATES_SENTINEL)).toBe("All states");
    expect(formatSopStateLabel(["NC"])).toBe("NC");
    expect(formatSopStateLabel(null)).toBe("—");
    expect(formatSopStateLabel([])).toBe("—");
  });

  it("joins a multi-state set in a stable order regardless of pick order", () => {
    expect(formatSopStateLabel(["SC", "NC", "VA"])).toBe("NC, SC, VA");
    expect(formatSopStateLabel(["VA", "NC", "SC"])).toBe("NC, SC, VA");
  });

  it("does not mutate the caller's array while sorting", () => {
    const input = ["SC", "NC"];
    formatSopStateLabel(input);
    expect(input).toEqual(["SC", "NC"]);
  });
});
