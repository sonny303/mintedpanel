import { describe, expect, it } from "vitest";
import { isMissionControlPath, missionControlSection } from "./missionControl";

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

describe("missionControlSection", () => {
  it("resolves each section, with or without a trailing slash", () => {
    expect(missionControlSection("/mission-control").label).toBe("Home");
    expect(missionControlSection("/mission-control/").label).toBe("Home");
    expect(missionControlSection("/mission-control/organizations").label).toBe("Organizations");
    expect(missionControlSection("/mission-control/users/").label).toBe("Users");
    expect(missionControlSection("/mission-control/audit").label).toBe("Audit");
    expect(missionControlSection("/mission-control/cashboard").label).toBe("Cashboard");
  });

  it("keeps a nested page under its section", () => {
    expect(missionControlSection("/mission-control/organizations/abc").label).toBe("Organizations");
  });
});
