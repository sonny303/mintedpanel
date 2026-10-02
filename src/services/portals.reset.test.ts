import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));

vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => "org-a",
  writeAudit: vi.fn(),
}));

import { countCurrentPortalMappingRows, resetPortalMapping } from "./portals";
import type { Portal } from "@/types";

const portal: Portal = {
  id: "portal-global-a",
  orgId: null,
  portalKey: "payer-enrollment-a",
  name: "Payer enrollment A",
  payerId: "payer-a",
  formUrl: "https://payer.example.test/enroll",
  isVerified: true,
  lastVerifiedAt: "2026-01-01T00:00:00Z",
  provenAt: "2026-01-01T00:00:00Z",
  mappingGeneration: 4,
  urlChangedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
});

describe("portal mapping reset services", () => {
  it("counts all exact-key/current-generation shared rows without fetching row values", async () => {
    const filters: Array<[string, string, unknown]> = [];
    const result = { count: 137, error: null };
    const builder: Record<string, unknown> = {
      select: vi.fn((columns: string, options: { count: string; head: boolean }) => {
        expect(columns).toBe("id");
        expect(options).toEqual({ count: "exact", head: true });
        return builder;
      }),
      eq: vi.fn((column: string, value: unknown) => {
        filters.push(["eq", column, value]);
        return builder;
      }),
      is: vi.fn((column: string, value: unknown) => {
        filters.push(["is", column, value]);
        return builder;
      }),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    mocks.from.mockReturnValue(builder);

    await expect(countCurrentPortalMappingRows(portal)).resolves.toBe(137);

    expect(mocks.from).toHaveBeenCalledWith("portal_field_maps");
    expect(filters).toEqual([
      ["eq", "portal_key", "payer-enrollment-a"],
      ["eq", "mapping_generation", 4],
      ["is", "org_id", null],
    ]);
  });

  it("does not count an organization target outside the selected org", async () => {
    const from = vi.fn();
    mocks.from.mockImplementation(from);
    await expect(countCurrentPortalMappingRows({ ...portal, orgId: "org-b" })).rejects.toThrow(
      "outside the active organization",
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("requests reset for the exact portal ID, generation, and idempotency key", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        id: "receipt-1",
        portal_id: portal.id,
        owner_scope: "global",
        org_id: null,
        portal_key: portal.portalKey,
        old_mapping_generation: 4,
        new_mapping_generation: 5,
        actor_id: "actor-1",
        created_at: "2026-10-01T00:00:00Z",
        affected_field_count: 137,
        idempotency_key: "4fb29911-4b2e-4d83-965e-7019a8651e3f",
      },
      error: null,
    });

    const receipt = await resetPortalMapping({
      portalId: portal.id,
      expectedMappingGeneration: 4,
      idempotencyKey: "4fb29911-4b2e-4d83-965e-7019a8651e3f",
    });

    expect(mocks.rpc).toHaveBeenCalledWith("reset_portal_mapping", {
      p_portal_id: portal.id,
      p_expected_mapping_generation: 4,
      p_idempotency_key: "4fb29911-4b2e-4d83-965e-7019a8651e3f",
    });
    expect(receipt).toMatchObject({
      portalId: portal.id,
      oldMappingGeneration: 4,
      newMappingGeneration: 5,
    });
  });

  it("turns a stale-generation conflict into refresh guidance", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "mapping_generation_stale" },
    });

    await expect(
      resetPortalMapping({
        portalId: portal.id,
        expectedMappingGeneration: 4,
        idempotencyKey: "4fb29911-4b2e-4d83-965e-7019a8651e3f",
      }),
    ).rejects.toThrow("mapping changed since confirmation");
  });
});
