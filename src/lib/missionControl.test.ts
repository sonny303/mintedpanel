import { describe, expect, it } from "vitest";
import {
  MISSION_CONTROL_SECTIONS,
  isMissionControlPath,
  missionControlSection,
  type MissionControlSection,
  type MissionControlSectionPath,
} from "./missionControl";

describe("isMissionControlPath", () => {
  it("matches the prefix and its children only", () => {
    expect(isMissionControlPath("/mission-control")).toBe(true);
    expect(isMissionControlPath("/mission-control/")).toBe(true);
    expect(isMissionControlPath("/mission-control/users")).toBe(true);
    expect(isMissionControlPath("/mission-controlled")).toBe(false);
    expect(isMissionControlPath("/admin/payer-admin")).toBe(false);
    expect(isMissionControlPath("/")).toBe(false);
  });
});

describe("MISSION_CONTROL_SECTIONS", () => {
  it("names only sections whose page exists: Home, for now", () => {
    expect(MISSION_CONTROL_SECTIONS.map((section) => section.to)).toEqual(["/mission-control"]);
  });
});

describe("missionControlSection", () => {
  it("resolves Home for the index, with or without a trailing slash", () => {
    expect(missionControlSection("/mission-control").label).toBe("Home");
    expect(missionControlSection("/mission-control/").label).toBe("Home");
  });

  it("falls back to Home for a path no section claims", () => {
    expect(missionControlSection("/mission-control/organizations").label).toBe("Home");
  });

  // A later section, as a milestone will add one: its own path and nested
  // pages resolve to it, and Home never claims them by prefix.
  const withUsers: readonly MissionControlSection[] = [
    ...MISSION_CONTROL_SECTIONS,
    {
      to: "/mission-control/users" as MissionControlSectionPath,
      label: "Users",
      title: "Users",
      description: "Synthetic section for the prefix rules.",
    },
  ];

  it("resolves a later section and its nested pages", () => {
    expect(missionControlSection("/mission-control/users", withUsers).label).toBe("Users");
    expect(missionControlSection("/mission-control/users/", withUsers).label).toBe("Users");
    expect(missionControlSection("/mission-control/users/abc", withUsers).label).toBe("Users");
    expect(missionControlSection("/mission-control/usersx", withUsers).label).toBe("Home");
    expect(missionControlSection("/mission-control", withUsers).label).toBe("Home");
  });
});
