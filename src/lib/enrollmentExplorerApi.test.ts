import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

import { supabase } from "@/integrations/supabase/externalClient";
import { resetContextRevision, setContextRevision } from "@/lib/contextRevision";
import {
  downloadEnrollmentProof,
  fetchUnresolvedEnrollmentPage,
  fetchEnrollmentScopeDetail,
  saveEnrollmentScope,
} from "./enrollmentExplorerApi";

const context = {
  orgId: "22222222-2222-4222-8222-222222222222",
  audience: "client" as const,
  contextRevision: "revision-a",
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: { access_token: "test-token" } },
    error: null,
  } as never);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetContextRevision();
});

describe("E6.13 client request cancellation and body revision binding", () => {
  it("sends the optional abort signal on a detail read", async () => {
    resetContextRevision();
    setContextRevision(context.contextRevision);
    const controller = new AbortController();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { scopeId: "scope" }, error: null }), {
        headers: { "x-minted-context-revision": context.contextRevision },
      }),
    );

    await fetchEnrollmentScopeDetail(context, "33333333-3333-4333-8333-333333333333", {
      signal: controller.signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/enrollment-explorer/scopes/33333333-3333-4333-8333-333333333333",
      expect.objectContaining({ signal: controller.signal, cache: "no-store" }),
    );
  });

  it("allows org-wide unresolved triage without a group filter and forwards cancellation", async () => {
    resetContextRevision();
    setContextRevision(context.contextRevision);
    const controller = new AbortController();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { items: [], nextCursor: null }, error: null }), {
        headers: { "x-minted-context-revision": context.contextRevision },
      }),
    );

    await fetchUnresolvedEnrollmentPage(context, {}, { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/enrollment-explorer/unresolved",
      expect.objectContaining({ signal: controller.signal, cache: "no-store" }),
    );
  });

  it("rejects a detail body that finishes after the selected context changes", async () => {
    resetContextRevision();
    setContextRevision(context.contextRevision);
    let finishBody!: (value: unknown) => void;
    let bodyStarted!: () => void;
    const started = new Promise<void>((resolve) => (bodyStarted = resolve));
    const body = new Promise<unknown>((resolve) => (finishBody = resolve));
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ "x-minted-context-revision": context.contextRevision }),
      json: vi.fn(() => {
        bodyStarted();
        return body;
      }),
    } as unknown as Response;
    fetchMock.mockResolvedValue(response);

    const pending = fetchEnrollmentScopeDetail(context, "33333333-3333-4333-8333-333333333333");
    await started;
    setContextRevision("revision-b");
    finishBody({ data: { scopeId: "scope" }, error: null });

    await expect(pending).rejects.toMatchObject({ status: 409 });
  });

  it("rejects proof bytes when the selected context changes during the body read", async () => {
    resetContextRevision();
    setContextRevision(context.contextRevision);
    let finishBody!: (value: Blob) => void;
    let bodyStarted!: () => void;
    const started = new Promise<void>((resolve) => (bodyStarted = resolve));
    const body = new Promise<Blob>((resolve) => (finishBody = resolve));
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ "x-minted-context-revision": context.contextRevision }),
      blob: vi.fn(() => {
        bodyStarted();
        return body;
      }),
    } as unknown as Response;
    fetchMock.mockResolvedValue(response);

    const pending = downloadEnrollmentProof(context, "55555555-5555-4555-8555-555555555555");
    await started;
    setContextRevision("revision-b");
    finishBody(new Blob(["secret proof bytes"]));

    await expect(pending).rejects.toMatchObject({ status: 409 });
  });

  it("preserves a committed mutation when the server marks its context revision unknown", async () => {
    resetContextRevision();
    setContextRevision(context.contextRevision);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ data: { scopeId: "scope-1", revisionId: "revision-2" }, error: null }),
        {
          status: 201,
          headers: { "x-minted-context-revision": "unknown" },
        },
      ),
    );

    const result = await saveEnrollmentScope(context, {
      providerId: "33333333-3333-4333-8333-333333333333",
      groupId: "44444444-4444-4444-8444-444444444444",
      payerProductId: "55555555-5555-4555-8555-555555555555",
      facilityId: "66666666-6666-4666-8666-666666666666",
      state: "CO",
      revision: { status: "submitted", owner: "Payer", retroStatus: "unknown" },
      sources: [],
    });

    expect(result).toMatchObject({ scopeId: "scope-1", revisionId: "revision-2" });
  });
});
