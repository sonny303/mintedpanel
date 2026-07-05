import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiEnvelope } from "./envelope";
import type { AuthContext } from "./guard";

vi.mock("@/services/portalFieldMaps", () => ({ listPortalFieldMaps: vi.fn() }));
vi.mock("@/services/fillSessions", () => ({ recordFillEvent: vi.fn() }));
vi.mock("@/services/providerProfile", () => ({ getProviderProfile: vi.fn() }));
vi.mock("@/services/cases", () => ({ listCasesForPicker: vi.fn() }));

import { listPortalFieldMaps } from "@/services/portalFieldMaps";
import { recordFillEvent } from "@/services/fillSessions";
import { getProviderProfile } from "@/services/providerProfile";
import { listCasesForPicker } from "@/services/cases";
import {
  handleProviderProfile,
  handleListPortalFieldMaps,
  handleCreateFillEvent,
  handleListCases,
} from "./extensionRoutes";

const listMapsMock = vi.mocked(listPortalFieldMaps);
const recordFillEventMock = vi.mocked(recordFillEvent);
const getProfileMock = vi.mocked(getProviderProfile);
const listCasesMock = vi.mocked(listCasesForPicker);

function ctx(role: AuthContext["role"] = "specialist"): AuthContext {
  return {
    userId: "u1",
    orgId: "org-1",
    role,
    userName: "Tester",
    db: {} as AuthContext["db"],
    writeAudit: vi.fn().mockResolvedValue(undefined),
  };
}

async function body(res: Response): Promise<ApiEnvelope<unknown>> {
  return (await res.json()) as ApiEnvelope<unknown>;
}

beforeEach(() => vi.clearAllMocks());

describe("provider profile handler", () => {
  const PROVIDER_ID = "0f0f0f0f-1111-4222-8333-444444444444";
  const url = (qs = "") => new URL(`https://x.test/api/providers/${PROVIDER_ID}/profile${qs}`);

  it("returns 404 when the profile is missing (cross-org or nonexistent)", async () => {
    getProfileMock.mockResolvedValue(null);
    const res = await handleProviderProfile(PROVIDER_ID, url(), ctx());
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("Provider not found");
  });

  it("returns 404 for a non-UUID id without touching the service", async () => {
    const res = await handleProviderProfile("not-a-uuid", url(), ctx());
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("Provider not found");
    expect(getProfileMock).not.toHaveBeenCalled();
  });

  it("returns 200 with Cache-Control: no-store (PHI-dense payload)", async () => {
    getProfileMock.mockResolvedValue({
      provider: { id: PROVIDER_ID } as never,
      tokens: [],
      unresolved: [],
    });
    const res = await handleProviderProfile(PROVIDER_ID, url(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await body(res)).data).toEqual({
      provider: { id: PROVIDER_ID },
      tokens: [],
      unresolved: [],
    });
  });

  it("uppercases a valid ?state and forwards it with the org-scoped ctx", async () => {
    getProfileMock.mockResolvedValue({
      provider: { id: PROVIDER_ID } as never,
      tokens: [],
      unresolved: [],
    });
    await handleProviderProfile(PROVIDER_ID, url("?state=ks"), ctx());
    expect(getProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      PROVIDER_ID,
      { state: "KS" },
    );
  });

  it("rejects a malformed ?state with 422 before touching the service", async () => {
    const res = await handleProviderProfile(PROVIDER_ID, url("?state=kansas"), ctx());
    expect(res.status).toBe(422);
    expect(getProfileMock).not.toHaveBeenCalled();
  });
});

describe("portal field maps handler", () => {
  it("returns the rows with meta.total", async () => {
    listMapsMock.mockResolvedValue([{ id: "m1" }, { id: "m2" }] as never);
    const res = await handleListPortalFieldMaps(
      new URL("https://x.test/api/portal-field-maps"),
      ctx(),
    );
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.data).toEqual([{ id: "m1" }, { id: "m2" }]);
    expect(b.meta).toEqual({ total: 2 });
  });

  it("forwards ?portal_key to the service", async () => {
    listMapsMock.mockResolvedValue([] as never);
    await handleListPortalFieldMaps(
      new URL("https://x.test/api/portal-field-maps?portal_key=availity"),
      ctx(),
    );
    expect(listMapsMock).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1" }), {
      portalKey: "availity",
    });
  });
});

describe("cases picker handler", () => {
  const PROVIDER_ID = "0f0f0f0f-1111-4222-8333-444444444444";
  const url = (qs: string) => new URL(`https://x.test/api/cases${qs}`);

  it("rejects a missing providerId with 422 without calling the service", async () => {
    const res = await handleListCases(url(""), ctx());
    expect(res.status).toBe(422);
    expect(listCasesMock).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID providerId with 422 without calling the service", async () => {
    const res = await handleListCases(url("?providerId=not-a-uuid"), ctx());
    expect(res.status).toBe(422);
    expect(listCasesMock).not.toHaveBeenCalled();
  });

  it("returns the rows with meta.total, forwarding the org-scoped ctx", async () => {
    listCasesMock.mockResolvedValue([
      {
        id: "c1",
        payerId: "p1",
        payerName: "BCBS",
        state: "KS",
        statusLabel: "Submitted",
        submittedDate: null,
      },
    ]);
    const res = await handleListCases(url(`?providerId=${PROVIDER_ID}`), ctx("billing"));
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.data).toEqual([
      {
        id: "c1",
        payerId: "p1",
        payerName: "BCBS",
        state: "KS",
        statusLabel: "Submitted",
        submittedDate: null,
      },
    ]);
    expect(b.meta).toEqual({ total: 1 });
    expect(listCasesMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      PROVIDER_ID,
    );
  });

  it("returns an empty list (200) for a provider with no visible cases", async () => {
    listCasesMock.mockResolvedValue([]);
    const res = await handleListCases(url(`?providerId=${PROVIDER_ID}`), ctx());
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.data).toEqual([]);
    expect(b.meta).toEqual({ total: 0 });
  });
});

describe("fill events handler", () => {
  it("rejects a billing (read-only) role with 403 without calling the service", async () => {
    const res = await handleCreateFillEvent({ id: "x" }, ctx("billing"));
    expect(res.status).toBe(403);
    expect(recordFillEventMock).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["a string", "not-json-object"],
    ["an array", [1, 2]],
  ])("rejects %s body with 422 without calling the service", async (_name, badBody) => {
    const res = await handleCreateFillEvent(badBody, ctx());
    expect(res.status).toBe(422);
    expect(recordFillEventMock).not.toHaveBeenCalled();
  });

  it.each([[404], [409], [422]])("maps a rejected result to a %i failure", async (status) => {
    recordFillEventMock.mockResolvedValue({
      kind: "rejected",
      status: status as 404 | 409 | 422,
      message: "nope",
    });
    const res = await handleCreateFillEvent({ id: "x" }, ctx());
    expect(res.status).toBe(status);
    expect((await body(res)).error).toBe("nope");
  });

  it("returns 201 for a created session, forwarding the writer ctx", async () => {
    recordFillEventMock.mockResolvedValue({ kind: "created", session: { id: "fs1" } as never });
    const res = await handleCreateFillEvent({ id: "fs1" }, ctx("admin"));
    expect(res.status).toBe(201);
    expect((await body(res)).data).toEqual({ id: "fs1" });
    expect(recordFillEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "u1" }),
      { id: "fs1" },
    );
  });

  it("returns 200 for a duplicate (idempotent replay)", async () => {
    recordFillEventMock.mockResolvedValue({ kind: "duplicate", session: { id: "fs1" } as never });
    const res = await handleCreateFillEvent({ id: "fs1" }, ctx());
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ id: "fs1" });
  });
});
