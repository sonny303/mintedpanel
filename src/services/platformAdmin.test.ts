import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from "@/integrations/supabase/externalClient";
import { getPlatformMetrics, parsePlatformMetrics } from "./platformAdmin";

const NOW = new Date("2026-10-30T12:00:00.000Z");

describe("parsePlatformMetrics", () => {
  it("keeps a full document as-is", () => {
    const doc = {
      generatedAt: "2026-10-30T09:15:00.000Z",
      organizations: { total: 6, active: 4, prospect: 1, inactive: 1 },
      users: { total: 8, platformAdmins: 1 },
      providers: { total: 120, active: 90, onboarding: 12, pendingVerification: 7 },
      cases: { total: 340, open: 210 },
      pendingInvites: 3,
    };
    expect(parsePlatformMetrics(doc, () => NOW)).toEqual(doc);
  });

  it("fills every missing or malformed count with 0 and dates a missing generatedAt now", () => {
    expect(
      parsePlatformMetrics(
        { organizations: { total: "6", active: -1 }, providers: null, pendingInvites: NaN },
        () => NOW,
      ),
    ).toEqual({
      generatedAt: NOW.toISOString(),
      organizations: { total: 0, active: 0, prospect: 0, inactive: 0 },
      users: { total: 0, platformAdmins: 0 },
      providers: { total: 0, active: 0, onboarding: 0, pendingVerification: 0 },
      cases: { total: 0, open: 0 },
      pendingInvites: 0,
    });
  });

  it("treats a non-object answer as an empty document", () => {
    expect(parsePlatformMetrics(null, () => NOW).generatedAt).toBe(NOW.toISOString());
    expect(parsePlatformMetrics([1, 2], () => NOW).cases).toEqual({ total: 0, open: 0 });
  });
});

describe("getPlatformMetrics", () => {
  it("surfaces an RPC error instead of rendering zeros", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: "Not a platform admin" },
    } as never);
    await expect(getPlatformMetrics()).rejects.toThrow("Not a platform admin");
    expect(supabase.rpc).toHaveBeenCalledWith("platform_metrics");
  });
});
