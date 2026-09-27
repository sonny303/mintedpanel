import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, activeOrg } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  activeOrg: { id: "org-1" },
}));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: fromMock },
}));

vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => {
    if (!activeOrg.id) throw new Error("No active organization");
    return activeOrg.id;
  },
}));

import { listPayers } from "./payers";

beforeEach(() => {
  fromMock.mockReset();
  activeOrg.id = "org-1";
});

describe("listPayers — manual-case catalog read boundary", () => {
  it("requests own-org and global payer rows without a network-target join", async () => {
    const or = vi.fn().mockReturnThis();
    const order = vi.fn().mockResolvedValue({
      data: [
        { id: "own", org_id: "org-1", name: "Own Plan" },
        { id: "global-unattached", org_id: null, name: "Global Plan" },
      ],
      error: null,
    });
    const select = vi.fn().mockReturnValue({ or, order });
    fromMock.mockReturnValue({ select });

    const payers = await listPayers();

    expect(fromMock).toHaveBeenCalledExactlyOnceWith("payers");
    expect(select).toHaveBeenCalledExactlyOnceWith("*");
    expect(or).toHaveBeenCalledExactlyOnceWith("org_id.eq.org-1,org_id.is.null");
    expect(order).toHaveBeenCalledExactlyOnceWith("name");
    expect(payers.map((payer) => [payer.id, payer.orgId])).toEqual([
      ["own", "org-1"],
      ["global-unattached", null],
    ]);
  });

  it("switches the own-org predicate with the active org and refuses a missing org", async () => {
    const or = vi.fn().mockReturnThis();
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    fromMock.mockReturnValue({ select: () => ({ or, order }) });
    activeOrg.id = "org-2";

    await listPayers();
    expect(or).toHaveBeenCalledExactlyOnceWith("org_id.eq.org-2,org_id.is.null");

    activeOrg.id = "";
    await expect(listPayers()).rejects.toThrow("No active organization");
    expect(fromMock).toHaveBeenCalledTimes(1);
  });
});
