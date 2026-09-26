import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-store", () => ({
  useActiveOrgId: () => null,
  useAuthStore: Object.assign(() => null, {
    getState: () => ({ session: null, activeOrgId: null }),
  }),
}));
vi.mock("@/services/billingReadiness", () => ({ getBillingReadinessSnapshot: vi.fn() }));

import { isCurrentBillingReadinessDate } from "./useBillingReadiness";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("billing readiness freshness date", () => {
  it("rejects an assessment date once Denver local midnight passes", () => {
    vi.stubEnv("TZ", "America/Denver");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T05:59:59.999Z"));
    expect(isCurrentBillingReadinessDate("2026-09-25")).toBe(true);

    vi.setSystemTime(new Date("2026-09-26T06:00:00.000Z"));
    expect(isCurrentBillingReadinessDate("2026-09-25")).toBe(false);
    expect(isCurrentBillingReadinessDate("2026-09-26")).toBe(true);
  });
});
