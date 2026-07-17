import { describe, expect, it } from "vitest";
import { splitPortfolio, stateBreakdown } from "./portfolio";
import type { LifecycleState, PortfolioOrg } from "@/types";

const org = (over: Partial<PortfolioOrg>): PortfolioOrg => ({
  id: over.id ?? "o1",
  name: over.name ?? "Org",
  lifecycleState: over.lifecycleState ?? "active",
  createdAt: over.createdAt ?? "2026-01-01T00:00:00Z",
});

describe("splitPortfolio", () => {
  it("buckets active -> in motion and prospect -> prospects, excluding inactive (F0.0.5)", () => {
    const orgs = [
      org({ id: "a", name: "Org A", lifecycleState: "active" }),
      org({ id: "b", name: "Org B", lifecycleState: "prospect" }),
      org({ id: "c", name: "Org C", lifecycleState: "inactive" }),
    ];
    const b = splitPortfolio(orgs);
    expect(b.inMotion.map((o) => o.id)).toEqual(["a"]);
    expect(b.prospects.map((o) => o.id)).toEqual(["b"]);
    expect(b.inMotionCount).toBe(1);
    expect(b.prospectCount).toBe(1);
    // Org C (inactive) is excluded from both counts.
    expect(b.inMotion.some((o) => o.id === "c")).toBe(false);
    expect(b.prospects.some((o) => o.id === "c")).toBe(false);
    expect(b.isEmpty).toBe(false);
  });

  it("counts multiples in each bucket and excludes every inactive org", () => {
    const orgs = [
      org({ id: "1", lifecycleState: "active" }),
      org({ id: "2", lifecycleState: "active" }),
      org({ id: "3", lifecycleState: "prospect" }),
      org({ id: "4", lifecycleState: "inactive" }),
      org({ id: "5", lifecycleState: "inactive" }),
    ];
    const b = splitPortfolio(orgs);
    expect(b.inMotionCount).toBe(2);
    expect(b.prospectCount).toBe(1);
  });

  it("is empty when there are no orgs at all (first-run cold start, TS-0)", () => {
    const b = splitPortfolio([]);
    expect(b.inMotionCount).toBe(0);
    expect(b.prospectCount).toBe(0);
    expect(b.isEmpty).toBe(true);
    // No inactive orgs either — the truly-zero state, NOT the all-inactive fallback.
    expect(b.inactiveCount).toBe(0);
    expect(b.allInactive).toBe(false);
  });

  it("flags allInactive when the caller's only orgs are inactive (E0.4 TS-12)", () => {
    const b = splitPortfolio([
      org({ id: "a", lifecycleState: "inactive" }),
      org({ id: "b", lifecycleState: "inactive" }),
    ]);
    expect(b.isEmpty).toBe(true);
    expect(b.inactive.map((o) => o.id)).toEqual(["a", "b"]);
    expect(b.inactiveCount).toBe(2);
    expect(b.allInactive).toBe(true);
  });

  it("does not flag allInactive when a live org coexists with inactive ones", () => {
    const b = splitPortfolio([
      org({ id: "a", lifecycleState: "active" }),
      org({ id: "z", lifecycleState: "inactive" }),
    ]);
    expect(b.isEmpty).toBe(false);
    expect(b.allInactive).toBe(false);
    expect(b.inactiveCount).toBe(1);
  });
});

const so = (lifecycleState: LifecycleState, state: string | null) => ({ lifecycleState, state });

describe("stateBreakdown (E0.6 F0.6.4 / TE-4)", () => {
  it("counts non-inactive orgs by state in canonical seed order (NC,SC,CO,TX,WI,OR)", () => {
    const b = stateBreakdown([
      so("active", "NC"),
      so("prospect", "OR"),
      so("active", "TX"),
      so("active", "SC"),
    ]);
    expect(b).toEqual([
      { state: "NC", count: 1 },
      { state: "SC", count: 1 },
      { state: "TX", count: 1 },
      { state: "OR", count: 1 },
    ]);
  });

  it("excludes inactive orgs from the breakdown (consistent with the metrics)", () => {
    const b = stateBreakdown([so("active", "NC"), so("inactive", "NC"), so("inactive", "TX")]);
    expect(b).toEqual([{ state: "NC", count: 1 }]);
  });

  it("buckets missing/blank state as Unknown, sorted last", () => {
    const b = stateBreakdown([so("active", "OR"), so("active", null), so("prospect", "  ")]);
    expect(b).toEqual([
      { state: "OR", count: 1 },
      { state: "Unknown", count: 2 },
    ]);
  });

  it("normalizes case and tallies duplicates", () => {
    const b = stateBreakdown([so("active", "nc"), so("active", "NC"), so("prospect", "Nc")]);
    expect(b).toEqual([{ state: "NC", count: 3 }]);
  });

  it("orders non-canonical states alphabetically after the seed states, before Unknown", () => {
    const b = stateBreakdown([
      so("active", "WI"),
      so("active", "CA"),
      so("active", null),
      so("active", "AL"),
    ]);
    expect(b.map((s) => s.state)).toEqual(["WI", "AL", "CA", "Unknown"]);
  });
});
