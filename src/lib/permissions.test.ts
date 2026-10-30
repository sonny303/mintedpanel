import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { auth: {}, rpc: vi.fn(), from: vi.fn() },
}));

import { canEnterMissionControl } from "./permissions";

describe("canEnterMissionControl", () => {
  it("waits while the store has not initialized, whatever the flag says", () => {
    // A hard-load beforeLoad sees an empty store: never read that as "no".
    expect(canEnterMissionControl(null, false)).toBe("pending");
    expect(canEnterMissionControl(false, false)).toBe("pending");
    expect(canEnterMissionControl(true, false)).toBe("pending");
  });

  it("waits while the flag is unknown after initialization", () => {
    expect(canEnterMissionControl(null, true)).toBe("pending");
  });

  it("allows a known platform admin", () => {
    expect(canEnterMissionControl(true, true)).toBe("allow");
  });

  it("denies only an explicit false", () => {
    expect(canEnterMissionControl(false, true)).toBe("deny");
  });
});
