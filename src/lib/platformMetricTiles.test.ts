import { describe, expect, it } from "vitest";
import type { PlatformMetrics } from "@/types";
import { platformMetricTiles } from "./platformMetricTiles";

const METRICS: PlatformMetrics = {
  generatedAt: "2026-10-30T09:15:00.000Z",
  organizations: { total: 6, active: 4, prospect: 1, inactive: 1 },
  users: { total: 1284, platformAdmins: 2 },
  providers: { total: 3105, active: 2900, onboarding: 140, pendingVerification: 65 },
  cases: { total: 12480, open: 8312 },
  pendingInvites: 1,
};

const en = (n: number) => n.toLocaleString("en-US");

describe("platformMetricTiles", () => {
  it("derives the six tiles in display order", () => {
    expect(platformMetricTiles(METRICS, en)).toEqual([
      {
        key: "organizations",
        label: "Organizations",
        value: "6",
        detail: "4 active · 1 prospect · 1 inactive",
      },
      { key: "users", label: "Users", value: "1,284", detail: "2 platform admins" },
      {
        key: "providers-in-pipeline",
        label: "Providers in pipeline",
        value: "205",
        detail: "Onboarding or awaiting verification, of 3,105 providers",
      },
      {
        key: "pending-verifications",
        label: "Pending verifications",
        value: "65",
        detail: "Providers awaiting verification",
      },
      {
        key: "open-cases",
        label: "Open cases",
        value: "8,312",
        detail: "of 12,480 cases in total",
      },
      {
        key: "pending-invites",
        label: "Pending invites",
        value: "1",
        detail: "Invite not yet accepted",
      },
    ]);
  });

  it("uses the singular for one", () => {
    const tiles = platformMetricTiles(
      {
        ...METRICS,
        users: { total: 1, platformAdmins: 1 },
        providers: { total: 1, active: 0, onboarding: 0, pendingVerification: 1 },
        cases: { total: 1, open: 1 },
      },
      en,
    );
    expect(tiles.find((t) => t.key === "users")?.detail).toBe("1 platform admin");
    expect(tiles.find((t) => t.key === "providers-in-pipeline")?.detail).toBe(
      "Onboarding or awaiting verification, of 1 provider",
    );
    expect(tiles.find((t) => t.key === "pending-verifications")?.detail).toBe(
      "Provider awaiting verification",
    );
    expect(tiles.find((t) => t.key === "open-cases")?.detail).toBe("of 1 case in total");
  });
});
