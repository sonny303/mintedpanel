import { describe, expect, it } from "vitest";
import { resolveLanding, selectActiveOrgId } from "./landing";
import type { PortfolioOrg } from "@/types";

const org = (over: Partial<PortfolioOrg>): PortfolioOrg => ({
  id: over.id ?? "o1",
  name: over.name ?? "Org",
  lifecycleState: over.lifecycleState ?? "active",
  createdAt: over.createdAt ?? "2026-01-01T00:00:00Z",
});

describe("resolveLanding (E0.4 TE-1)", () => {
  it("(1) routes a brand-new user with no orgs to first-run", () => {
    expect(resolveLanding([], null)).toEqual({ kind: "first-run" });
    // A stale persisted org id can't resurrect a membership-less user.
    expect(resolveLanding([], "ghost")).toEqual({ kind: "first-run" });
  });

  it("(2) lands in the valid last-active org's workspace (TS-4)", () => {
    const orgs = [
      org({ id: "ob", lifecycleState: "active" }),
      org({ id: "rose", lifecycleState: "prospect" }),
    ];
    expect(resolveLanding(orgs, "rose")).toEqual({ kind: "workspace", orgId: "rose" });
  });

  it("(2) treats a prospect last-active as a valid workspace (not inactive)", () => {
    const orgs = [org({ id: "rose", lifecycleState: "prospect" })];
    expect(resolveLanding(orgs, "rose")).toEqual({ kind: "workspace", orgId: "rose" });
  });

  it("(3) falls back to the Portfolio when every org is inactive (TS-12)", () => {
    const orgs = [
      org({ id: "a", lifecycleState: "inactive" }),
      org({ id: "b", lifecycleState: "inactive" }),
    ];
    // Even with a valid-but-inactive last-active id, there is no live workspace.
    expect(resolveLanding(orgs, "a")).toEqual({ kind: "portfolio" });
    expect(resolveLanding(orgs, null)).toEqual({ kind: "portfolio" });
  });

  it("(4) opens the most recently created live org when last-active is missing", () => {
    const orgs = [
      org({ id: "old", lifecycleState: "active", createdAt: "2026-01-01T00:00:00Z" }),
      org({ id: "new", lifecycleState: "active", createdAt: "2026-03-01T00:00:00Z" }),
    ];
    expect(resolveLanding(orgs, null)).toEqual({ kind: "workspace", orgId: "new" });
    // A stale (non-member) last-active id behaves the same as none.
    expect(resolveLanding(orgs, "ghost")).toEqual({ kind: "workspace", orgId: "new" });
  });

  it("(4) skips a newer INACTIVE org and picks the newest LIVE one", () => {
    const orgs = [
      org({ id: "live", lifecycleState: "prospect", createdAt: "2026-02-01T00:00:00Z" }),
      org({ id: "dead", lifecycleState: "inactive", createdAt: "2026-05-01T00:00:00Z" }),
    ];
    expect(resolveLanding(orgs, null)).toEqual({ kind: "workspace", orgId: "live" });
  });

  it("(4) fires when the persisted last-active org has gone inactive", () => {
    const orgs = [
      org({ id: "gone", lifecycleState: "inactive", createdAt: "2026-01-01T00:00:00Z" }),
      org({ id: "here", lifecycleState: "active", createdAt: "2026-02-01T00:00:00Z" }),
    ];
    expect(resolveLanding(orgs, "gone")).toEqual({ kind: "workspace", orgId: "here" });
  });
});

describe("selectActiveOrgId (E0.4 TE-2 — store boot-time validation)", () => {
  it("keeps a valid, non-inactive last-active org", () => {
    const orgs = [org({ id: "a", lifecycleState: "active" }), org({ id: "b" })];
    expect(selectActiveOrgId(orgs, "a")).toBe("a");
  });

  it("returns null when there are no orgs or every org is inactive", () => {
    expect(selectActiveOrgId([], "x")).toBeNull();
    expect(selectActiveOrgId([org({ id: "a", lifecycleState: "inactive" })], "a")).toBeNull();
  });

  it("falls back to the most recently created live org, not the first membership", () => {
    const orgs = [
      org({ id: "first", lifecycleState: "active", createdAt: "2026-01-01T00:00:00Z" }),
      org({ id: "newest", lifecycleState: "active", createdAt: "2026-04-01T00:00:00Z" }),
    ];
    expect(selectActiveOrgId(orgs, null)).toBe("newest");
  });
});
