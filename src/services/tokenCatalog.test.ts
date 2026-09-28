import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { rpc: rpcMock },
}));

import { listTokenCatalog } from "./tokenCatalog";

describe("listTokenCatalog", () => {
  beforeEach(() => rpcMock.mockReset().mockResolvedValue({ data: [], error: null }));

  it("includes only the canonical computed, user, and current contact keys once", async () => {
    const catalog = await listTokenCatalog();
    const tokens = catalog.map((entry) => entry.token);

    expect(tokens).toEqual(
      expect.arrayContaining([
        "provider.fullName",
        "provider.fullNameWithCredentials",
        "provider.lastFirst",
        "facility.address",
        "facility.streetAddress",
        "facility.fullAddress",
        "user.name",
        "user.firstName",
        "user.lastName",
        "user.title",
        "user.email",
        "billingContact.fullName",
        "credentialingContact.phoneOffice",
        "contractingSigner.email",
      ]),
    );
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("preserves schema-derived entries and does not invent group contact aliases", async () => {
    rpcMock.mockResolvedValue({
      data: [{ token: "group.tin", table: "provider_groups", column: "tin" }],
      error: null,
    });
    const catalog = await listTokenCatalog();
    expect(catalog).toContainEqual({ token: "group.tin", table: "provider_groups", column: "tin" });
    expect(catalog.some((entry) => entry.token === "group.billingContactName")).toBe(false);
    expect(catalog.some((entry) => entry.token === "group.ptan")).toBe(false);
  });
});
