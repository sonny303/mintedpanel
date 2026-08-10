import { describe, expect, it } from "vitest";
import {
  ALL_STATES_SENTINEL,
  formatSopStateLabel,
  isSupportedOrgSopMatchKey,
  orgSopMatchKeyError,
} from "./sopMatchKey";

describe("orgSopMatchKeyError — authoring rejects unsupported wildcard combos", () => {
  it("rejects an Any-payer match key", () => {
    expect(orgSopMatchKeyError({ payerId: null, state: "NC" })).toMatch(/payer/i);
    expect(isSupportedOrgSopMatchKey({ payerId: null, state: "NC" })).toBe(false);
  });

  it("rejects an Any-state (null) match key", () => {
    expect(orgSopMatchKeyError({ payerId: "pay1", state: null })).toMatch(/state/i);
    expect(isSupportedOrgSopMatchKey({ payerId: "pay1", state: null })).toBe(false);
  });

  it("rejects Any-payer AND Any-state (payer reported first)", () => {
    expect(orgSopMatchKeyError({ payerId: null, state: null })).toMatch(/payer/i);
  });

  it("accepts a concrete payer + state (group optional, not checked here)", () => {
    expect(orgSopMatchKeyError({ payerId: "pay1", state: "NC" })).toBeNull();
    expect(isSupportedOrgSopMatchKey({ payerId: "pay1", state: "NC" })).toBe(true);
  });

  it("accepts All-states sentinel as a complete state (not null Any-state)", () => {
    expect(orgSopMatchKeyError({ payerId: "pay1", state: ALL_STATES_SENTINEL })).toBeNull();
    expect(isSupportedOrgSopMatchKey({ payerId: "pay1", state: ALL_STATES_SENTINEL })).toBe(true);
  });
});

describe("formatSopStateLabel", () => {
  it("labels the All-states sentinel for provenance / review", () => {
    expect(formatSopStateLabel(ALL_STATES_SENTINEL)).toBe("All states");
    expect(formatSopStateLabel("NC")).toBe("NC");
    expect(formatSopStateLabel(null)).toBe("—");
  });
});
