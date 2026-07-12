// E1.6 TS-36 core — search by name AND alias, state + kind filters,
// commercial default semantics.
import { describe, expect, it } from "vitest";
import { DEFAULT_DIRECTORY_KIND, filterDirectoryRows, formatStates } from "./payerDirectory";
import type { Payer } from "@/types";

const payer = (over: Partial<Payer>): Payer => ({
  id: "p-1",
  orgId: null as unknown as string,
  name: "Blue Cross and Blue Shield of North Carolina",
  isActive: true,
  avgDecisionDays: null,
  provisionalBillingAllowed: false,
  provisionalBillingNotes: null,
  retroBillingAllowed: false,
  retroBillingWindowDays: null,
  caqhPullDeadlineDays: null,
  providerTypePath: null,
  priorAuthVendor: null,
  payerBillingId: null,
  portalUrl: null,
  createdAt: "2026-07-12T00:00:00Z",
  payerKind: "commercial",
  aliases: ["Blue Cross NC", "BCBSNC"],
  states: ["NC"],
  status: "active",
  ...over,
});

const rows = [
  payer({ id: "1" }),
  payer({
    id: "2",
    name: "Superior HealthPlan (Centene)",
    payerKind: "medicaid_mco",
    aliases: ["Ambetter from Superior HealthPlan"],
    states: ["TX"],
  }),
  payer({
    id: "3",
    name: "TRICARE West (TriWest)",
    payerKind: "tricare",
    aliases: ["TriWest"],
    states: ["AK", "NM", "TX"],
  }),
];

describe("filterDirectoryRows", () => {
  it("TS-36: finds BCBS-NC by alias under the commercial default", () => {
    const out = filterDirectoryRows(rows, {
      query: "Blue Cross NC",
      state: "all",
      kind: DEFAULT_DIRECTORY_KIND,
    });
    expect(out.map((p) => p.id)).toEqual(["1"]);
  });

  it("kind filter defaults hide government/MCO rows; 'all' shows them", () => {
    expect(
      filterDirectoryRows(rows, { query: "", state: "all", kind: "commercial" }).map((p) => p.id),
    ).toEqual(["1"]);
    expect(filterDirectoryRows(rows, { query: "", state: "all", kind: "all" })).toHaveLength(3);
    expect(
      filterDirectoryRows(rows, { query: "", state: "all", kind: "tricare" }).map((p) => p.id),
    ).toEqual(["3"]);
  });

  it("state filter matches states[] membership", () => {
    expect(
      filterDirectoryRows(rows, { query: "", state: "TX", kind: "all" }).map((p) => p.id),
    ).toEqual(["2", "3"]);
    expect(filterDirectoryRows(rows, { query: "", state: "WY", kind: "all" })).toHaveLength(0);
  });

  it("search is case-insensitive across name and aliases", () => {
    expect(
      filterDirectoryRows(rows, { query: "ambetter", state: "all", kind: "all" }).map((p) => p.id),
    ).toEqual(["2"]);
  });
});

describe("formatStates", () => {
  it("joins short lists and truncates long ones", () => {
    expect(formatStates(["NC"])).toBe("NC");
    expect(formatStates(null)).toBe("—");
    expect(formatStates(["AK", "AL", "AR", "AZ", "CA", "CO"])).toBe("AK, AL, AR, AZ +2");
  });
});
