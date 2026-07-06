import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateUserMock } = vi.hoisted(() => ({ updateUserMock: vi.fn() }));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { auth: { updateUser: updateUserMock } },
}));

import { updateDisplayName } from "./userProfile";

describe("updateDisplayName", () => {
  beforeEach(() => {
    updateUserMock.mockReset();
    updateUserMock.mockResolvedValue({ data: { user: {} }, error: null });
  });

  it("trims the name and writes it to auth user_metadata.full_name", async () => {
    await expect(updateDisplayName("  Sowmya S  ")).resolves.toBe("Sowmya S");
    expect(updateUserMock).toHaveBeenCalledTimes(1);
    expect(updateUserMock).toHaveBeenCalledWith({ data: { full_name: "Sowmya S" } });
  });

  it("rejects an empty name without calling auth", async () => {
    await expect(updateDisplayName("   ")).rejects.toThrow("Name is required");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("surfaces the auth error message on failure", async () => {
    updateUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: "Auth session missing" },
    });
    await expect(updateDisplayName("Jane")).rejects.toThrow("Auth session missing");
  });
});
