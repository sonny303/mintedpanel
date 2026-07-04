import { describe, expect, it } from "vitest";
import {
  comparePipelineRows,
  isNewStateLaunch,
  launchDateDisplay,
  needsGoLiveNudge,
  splitLaunchSections,
  transitionWarnings,
  type LocationRow,
} from "./launchLocations";
import type { Facility, StatusConfig } from "@/types";

const TODAY = new Date(2026, 6, 4); // Jul 4, 2026

function facility(over: Partial<Facility>): Facility {
  return {
    id: over.id ?? "f1",
    orgId: "org",
    groupId: "g1",
    name: "Loc",
    street: null,
    city: null,
    state: "KS",
    zip: null,
    isActive: true,
    statusId: null,
    effectiveDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function status(label: string): StatusConfig {
  return {
    id: `s-${label}`,
    orgId: "org",
    track: "location",
    label,
    color: "#059669",
    sortOrder: 10,
    requiredFields: [],
    actionBucket: "ours",
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function row(label: string | null, over: Partial<Facility> = {}): LocationRow {
  return { facility: facility(over), status: label ? status(label) : null };
}

describe("splitLaunchSections", () => {
  it("puts Live rows inside the 30-day window in Recently Launched", () => {
    const { recentlyLaunched, pipeline } = splitLaunchSections(
      [row("Live", { id: "a", effectiveDate: "2026-06-08" })],
      TODAY,
    );
    expect(recentlyLaunched.map((r) => r.facility.id)).toEqual(["a"]);
    expect(pipeline).toHaveLength(0);
  });

  it("drops Live rows older than 30 days or without a date off the page", () => {
    const { recentlyLaunched, pipeline } = splitLaunchSections(
      [
        row("Live", { id: "old", effectiveDate: "2026-05-01" }),
        row("Live", { id: "undated" }),
      ],
      TODAY,
    );
    expect(recentlyLaunched).toHaveLength(0);
    expect(pipeline).toHaveLength(0);
  });

  it("keeps a Live row with a future start date visible", () => {
    const { recentlyLaunched } = splitLaunchSections(
      [row("Live", { id: "early", effectiveDate: "2026-07-10" })],
      TODAY,
    );
    expect(recentlyLaunched.map((r) => r.facility.id)).toEqual(["early"]);
  });

  it("excludes Inactive and plain active (no location status) rows entirely", () => {
    const { recentlyLaunched, pipeline } = splitLaunchSections(
      [row("Inactive", { id: "closed" }), row(null, { id: "plain" })],
      TODAY,
    );
    expect(recentlyLaunched).toHaveLength(0);
    expect(pipeline).toHaveLength(0);
  });

  it("sorts the pipeline by date ascending with no-date rows last", () => {
    const { pipeline } = splitLaunchSections(
      [
        row("Prospect", { id: "nodate", name: "B" }),
        row("Ready for Launch", { id: "soon", effectiveDate: "2026-07-06" }),
        row("Planned", { id: "later", effectiveDate: "2026-09-01" }),
        row("Prospect", { id: "nodate2", name: "A" }),
      ],
      TODAY,
    );
    expect(pipeline.map((r) => r.facility.id)).toEqual(["soon", "later", "nodate2", "nodate"]);
  });

  it("orders Recently Launched newest first", () => {
    const { recentlyLaunched } = splitLaunchSections(
      [
        row("Live", { id: "june", effectiveDate: "2026-06-08" }),
        row("Live", { id: "july", effectiveDate: "2026-07-01" }),
      ],
      TODAY,
    );
    expect(recentlyLaunched.map((r) => r.facility.id)).toEqual(["july", "june"]);
  });
});

describe("comparePipelineRows", () => {
  it("falls back to name when both rows are undated", () => {
    const a = row("Prospect", { id: "a", name: "Alpha" });
    const b = row("Prospect", { id: "b", name: "Beta" });
    expect(comparePipelineRows(a, b)).toBeLessThan(0);
  });
});

describe("launchDateDisplay", () => {
  it("labels early pipeline dates as targets and later ones as starts", () => {
    expect(launchDateDisplay("Planned", "2026-09-01")).toBe("Target Sep 1, 2026");
    expect(launchDateDisplay("Interviewing", "2026-08-01")).toBe("Target Aug 1, 2026");
    expect(launchDateDisplay("Pending Fulfillment", "2026-07-20")).toBe("Starts Jul 20, 2026");
    expect(launchDateDisplay("Ready for Launch", "2026-07-06")).toBe("Starts Jul 6, 2026");
    expect(launchDateDisplay("Live", "2026-06-08")).toBe("Starts Jun 8, 2026");
  });

  it("shows no date for Prospect even when one is stored", () => {
    expect(launchDateDisplay("Prospect", "2026-08-01")).toBe("—");
    expect(launchDateDisplay("Prospect", null)).toBe("—");
  });

  it("handles missing dates and statuses", () => {
    expect(launchDateDisplay("Planned", null)).toBe("No date");
    expect(launchDateDisplay(null, "2026-08-01")).toBe("—");
    expect(launchDateDisplay("Inactive", "2026-08-01")).toBe("—");
  });
});

describe("isNewStateLaunch", () => {
  it("fires when the group has no Live location in that state", () => {
    const candidate = facility({ id: "la", state: "LA" });
    const rows = [
      { facility: candidate, status: status("Planned") },
      row("Live", { id: "ks", state: "KS" }),
    ];
    expect(isNewStateLaunch(candidate, rows)).toBe(true);
  });

  it("stays quiet when a Live or plain active location exists in the state", () => {
    const candidate = facility({ id: "new", state: "KS" });
    expect(isNewStateLaunch(candidate, [row("Live", { id: "live", state: "KS" })])).toBe(false);
    expect(isNewStateLaunch(candidate, [row(null, { id: "plain", state: "KS" })])).toBe(false);
  });

  it("ignores pipeline locations and other groups", () => {
    const candidate = facility({ id: "new", state: "KS" });
    const rows = [
      row("Interviewing", { id: "pipe", state: "KS" }),
      row("Live", { id: "other", state: "KS", groupId: "g2" }),
    ];
    expect(isNewStateLaunch(candidate, rows)).toBe(true);
  });

  it("never fires without a state and never counts the row itself", () => {
    expect(isNewStateLaunch(facility({ id: "x", state: null }), [])).toBe(false);
    const self = facility({ id: "self", state: "KS" });
    expect(isNewStateLaunch(self, [{ facility: self, status: status("Live") }])).toBe(true);
  });
});

describe("needsGoLiveNudge", () => {
  it("nudges pre-Live rows whose start date has passed", () => {
    expect(needsGoLiveNudge("Ready for Launch", "2026-07-01", TODAY)).toBe(true);
    expect(needsGoLiveNudge("Interviewing", "2026-07-01", TODAY)).toBe(true);
  });

  it("stays quiet for future dates, today, Live, Inactive, and undated rows", () => {
    expect(needsGoLiveNudge("Ready for Launch", "2026-07-06", TODAY)).toBe(false);
    expect(needsGoLiveNudge("Ready for Launch", "2026-07-04", TODAY)).toBe(false);
    expect(needsGoLiveNudge("Live", "2026-06-08", TODAY)).toBe(false);
    expect(needsGoLiveNudge("Inactive", "2026-06-08", TODAY)).toBe(false);
    expect(needsGoLiveNudge("Ready for Launch", null, TODAY)).toBe(false);
    expect(needsGoLiveNudge(null, "2026-06-08", TODAY)).toBe(false);
  });
});

describe("transitionWarnings", () => {
  it("warns on Ready for Launch without a provider", () => {
    const w = transitionWarnings({
      toStatusLabel: "Ready for Launch",
      hasProvider: false,
      linkedCaseCount: 3,
    });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/provider/i);
  });

  it("warns on Live with zero linked cases", () => {
    const w = transitionWarnings({ toStatusLabel: "Live", hasProvider: true, linkedCaseCount: 0 });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/cases/i);
  });

  it("stays quiet when the conditions are satisfied", () => {
    expect(
      transitionWarnings({ toStatusLabel: "Ready for Launch", hasProvider: true, linkedCaseCount: 0 }),
    ).toHaveLength(0);
    expect(
      transitionWarnings({ toStatusLabel: "Live", hasProvider: false, linkedCaseCount: 2 }),
    ).toHaveLength(0);
    expect(
      transitionWarnings({ toStatusLabel: "Prospect", hasProvider: false, linkedCaseCount: 0 }),
    ).toHaveLength(0);
  });
});
