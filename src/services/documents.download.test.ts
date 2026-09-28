import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({
  getSession: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { auth: { getSession: holder.getSession } },
}));

vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => "org-test",
}));

import { downloadDocumentFile } from "./documents";

const signed = {
  url: "https://storage.example.test/storage/v1/object/sign/bucket/path/file.PDF?token=opaque&download=stored.PDF",
  fileName: "stored.PDF",
  expiresIn: 120,
};

function apiResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ data, error: null }),
  } as Response;
}

describe("downloadDocumentFile", () => {
  beforeEach(() => {
    holder.getSession.mockResolvedValue({
      data: { session: { access_token: "session-token" } },
      error: null,
    });
    holder.fetch.mockReset();
    vi.stubGlobal("fetch", holder.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gets one audited URL, overrides its download name, and fetches bytes without cache or cookies", async () => {
    const blob = new Blob(["synthetic document bytes"], { type: "application/pdf" });
    holder.fetch.mockResolvedValueOnce(apiResponse(signed)).mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => blob,
    } as Response);

    const result = await downloadDocumentFile("doc-123", "Brooke_Ostrander_W-9.PDF");

    expect(result).toEqual({ blob, fileName: "Brooke_Ostrander_W-9.PDF" });
    expect(holder.fetch).toHaveBeenCalledTimes(2);
    expect(holder.fetch.mock.calls[0][0]).toBe("/api/documents/doc-123/download");
    expect(holder.fetch.mock.calls[0][1]).toMatchObject({
      method: "GET",
      headers: {
        authorization: "Bearer session-token",
        "x-org-id": "org-test",
      },
    });

    const [storageUrl, storageInit] = holder.fetch.mock.calls[1];
    const parsedUrl = new URL(String(storageUrl));
    expect(parsedUrl.pathname).toBe("/storage/v1/object/sign/bucket/path/file.PDF");
    expect(parsedUrl.searchParams.get("token")).toBe("opaque");
    expect(parsedUrl.searchParams.get("download")).toBe("Brooke_Ostrander_W-9.PDF");
    expect(storageInit).toEqual({ method: "GET", cache: "no-store", credentials: "omit" });
  });

  it("rejects a failed signed-byte response after its single audit call", async () => {
    holder.fetch
      .mockResolvedValueOnce(apiResponse(signed))
      .mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    await expect(downloadDocumentFile("doc-123", "Brooke_Ostrander_W-9.PDF")).rejects.toThrow(
      "Download failed (403)",
    );
    expect(holder.fetch).toHaveBeenCalledTimes(2);
    expect(holder.fetch.mock.calls[0][0]).toBe("/api/documents/doc-123/download");
  });
});
