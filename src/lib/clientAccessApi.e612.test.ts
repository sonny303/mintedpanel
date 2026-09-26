import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

import { supabase } from "@/integrations/supabase/externalClient";
import {
  beginContextRefresh,
  getContextRevisionSnapshot,
  resetContextRevision,
  setContextRevision,
} from "@/lib/contextRevision";
import { createClientInvite, fetchEnrollmentContext } from "./clientAccessApi";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: { access_token: "e612-token" } },
    error: null,
  } as never);
  resetContextRevision();
  fetchMock.mockReset();
});

describe("E6.12 request-aware access API revision handling", () => {
  it("preserves a committed mutation when its response advertises a newer revision", async () => {
    setContextRevision("revision-before");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { inviteId: "invite-1" }, error: null }), {
        status: 201,
        headers: {
          "content-type": "application/json",
          "X-Minted-Context-Revision": "revision-after",
        },
      }),
    );

    await expect(
      createClientInvite({
        orgId: "org-1",
        recipientEmail: "person@example.test",
        groupIds: ["g-1"],
      }),
    ).resolves.toMatchObject({ inviteId: "invite-1" });
  });

  it("rejects a read whose body resolves after the context epoch changes", async () => {
    setContextRevision("revision-before");
    let resolveBody!: (response: Response) => void;
    const body = new Promise<Response>((resolve) => {
      resolveBody = resolve;
    });
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers(),
      json: () => body.then((response) => response.json()),
    } as Response);

    const request = fetchEnrollmentContext();
    await Promise.resolve();
    beginContextRefresh();
    resolveBody(
      new Response(JSON.stringify({ data: { contextRevision: "revision-before" }, error: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(request).rejects.toMatchObject({ status: 409 });
  });

  it("accepts an authoritative context snapshot without observing its response header", async () => {
    setContextRevision("revision-before");
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            actorUserId: "11111111-1111-4111-8111-111111111111",
            email: "person@example.test",
            audience: null,
            selectedOrgId: null,
            staffOrgs: [],
            clientOrgs: [],
            globalTraining: true,
            restrictedExternal: false,
            contextRevision: "revision-after",
          },
          error: null,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "X-Minted-Context-Revision": "revision-after",
          },
        },
      ),
    );

    await expect(fetchEnrollmentContext()).resolves.toMatchObject({
      contextRevision: "revision-after",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getContextRevisionSnapshot()).toMatchObject({
      revision: "revision-before",
    });
  });
});
