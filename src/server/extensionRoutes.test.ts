import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiEnvelope } from "./envelope";
import type { AuthContext } from "./guard";

vi.mock("@/services/portalFieldMaps", () => ({ listPortalFieldMaps: vi.fn() }));
vi.mock("@/services/fillSessions", () => ({ recordFillEvent: vi.fn() }));
vi.mock("@/services/providerProfile", () => ({ getProviderProfile: vi.fn() }));
vi.mock("@/services/providerCases", () => ({ listOpenProviderCases: vi.fn() }));
vi.mock("@/services/submissionTouches", () => ({ recordSubmissionTouch: vi.fn() }));

import { listPortalFieldMaps } from "@/services/portalFieldMaps";
import { recordFillEvent } from "@/services/fillSessions";
import { getProviderProfile } from "@/services/providerProfile";
import { listOpenProviderCases } from "@/services/providerCases";
import { recordSubmissionTouch } from "@/services/submissionTouches";
import {
  handleProviderProfile,
  handleListPortalFieldMaps,
  handleCreateFillEvent,
  handleListProviderCases,
  handleCreateCaseTouch,
} from "./extensionRoutes";

const listMapsMock = vi.mocked(listPortalFieldMaps);
const recordFillEventMock = vi.mocked(recordFillEvent);
const getProfileMock = vi.mocked(getProviderProfile);
const listCasesMock = vi.mocked(listOpenProviderCases);
const recordTouchMock = vi.mocked(recordSubmissionTouch);

function ctx(role: AuthContext["role"] = "specialist"): AuthContext {
  return {
    userId: "u1",
    orgId: "org-1",
    role,
    userName: "Tester",
    email: "tester@minted.com",
    userMetadata: { full_name: "Tess Tester" },
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
  // What the ctx() JWT resolves to (see resolveUserTokens).
  const USER_TOKENS = [
    { token: "user.name", value: "Tess Tester" },
    { token: "user.email", value: "tester@minted.com" },
  ];

  it("returns 404 when the profile is missing (cross-org or nonexistent), without auditing", async () => {
    getProfileMock.mockResolvedValue(null);
    const c = ctx();
    const res = await handleProviderProfile(PROVIDER_ID, url(), c);
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("Provider not found");
    // A 404 is not a PHI read — no READ audit row.
    expect(c.writeAudit).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-UUID id without touching the service", async () => {
    const res = await handleProviderProfile("not-a-uuid", url(), ctx());
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("Provider not found");
    expect(getProfileMock).not.toHaveBeenCalled();
  });

  it("returns 200 with Cache-Control: no-store (PHI-dense payload) and the user tokens appended", async () => {
    getProfileMock.mockResolvedValue({
      provider: { id: PROVIDER_ID } as never,
      tokens: [],
      unresolved: [],
    });
    const res = await handleProviderProfile(PROVIDER_ID, url(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const b = await body(res);
    expect(b.data).toEqual({
      provider: { id: PROVIDER_ID },
      tokens: USER_TOKENS,
      unresolved: [],
    });
    // Both user tokens resolved -> no notes.
    expect(b.meta).toBeNull();
  });

  it("appends user tokens AFTER the catalog tokens without disturbing them", async () => {
    getProfileMock.mockResolvedValue({
      provider: { id: PROVIDER_ID } as never,
      tokens: [{ token: "provider.firstName", value: "Pat" }],
      unresolved: [],
    });
    const res = await handleProviderProfile(PROVIDER_ID, url(), ctx());
    const b = await body(res);
    expect((b.data as { tokens: unknown }).tokens).toEqual([
      { token: "provider.firstName", value: "Pat" },
      ...USER_TOKENS,
    ]);
  });

  it("resolves missing auth metadata to empty-string tokens and notes it in meta", async () => {
    getProfileMock.mockResolvedValue({
      provider: { id: PROVIDER_ID } as never,
      tokens: [],
      unresolved: [],
    });
    const bare = { ...ctx(), email: null, userMetadata: null };
    const res = await handleProviderProfile(PROVIDER_ID, url(), bare);
    const b = await body(res);
    expect((b.data as { tokens: unknown }).tokens).toEqual([
      { token: "user.name", value: "" },
      { token: "user.email", value: "" },
    ]);
    expect(b.meta?.notes).toHaveLength(2);
  });

  it("writes exactly one READ audit row per successful read — never the body or token values", async () => {
    getProfileMock.mockResolvedValue({
      provider: { id: PROVIDER_ID, ssnLast4: "6789" } as never,
      tokens: [{ token: "provider.ssnLast4", value: "6789" }],
      unresolved: [],
    });
    const c = ctx();
    const res = await handleProviderProfile(PROVIDER_ID, url("?state=ks"), c);
    expect(res.status).toBe(200);
    expect(c.writeAudit).toHaveBeenCalledTimes(1);
    expect(c.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "READ",
        entityType: "provider",
        entityId: PROVIDER_ID,
        after: { route: "/api/providers/:id/profile", state: "KS" },
      }),
    );
    // The audit payload must not carry PHI/token values from the response.
    const auditArg = JSON.stringify(vi.mocked(c.writeAudit).mock.calls[0][0]);
    expect(auditArg).not.toContain("6789");
    expect(auditArg).not.toContain("Tess Tester");
  });

  it("a failed audit write fails the request (no un-audited PHI read)", async () => {
    getProfileMock.mockResolvedValue({
      provider: { id: PROVIDER_ID } as never,
      tokens: [],
      unresolved: [],
    });
    const c = ctx();
    vi.mocked(c.writeAudit).mockRejectedValue(new Error("audit_log insert failed"));
    await expect(handleProviderProfile(PROVIDER_ID, url(), c)).rejects.toThrow(
      "audit_log insert failed",
    );
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

describe("provider cases handler", () => {
  const PROVIDER_ID = "0f0f0f0f-1111-4222-8333-444444444444";
  const url = (qs: string) => new URL(`https://x.test/api/cases${qs}`);

  it("rejects a missing providerId with 422 before touching the service", async () => {
    const res = await handleListProviderCases(url(""), ctx());
    expect(res.status).toBe(422);
    expect(listCasesMock).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID providerId with 422 before touching the service", async () => {
    const res = await handleListProviderCases(url("?providerId=not-a-uuid"), ctx());
    expect(res.status).toBe(422);
    expect(listCasesMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the provider is outside the org (service returns null)", async () => {
    listCasesMock.mockResolvedValue(null);
    const res = await handleListProviderCases(url(`?providerId=${PROVIDER_ID}`), ctx());
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("Provider not found");
  });

  it("returns the open cases with meta.total, forwarding the org-scoped ctx", async () => {
    const rows = [
      { id: "c1", payerName: "Aetna", state: "KS", status: "Submitted", submittedDate: null },
    ];
    listCasesMock.mockResolvedValue(rows);
    const res = await handleListProviderCases(url(`?providerId=${PROVIDER_ID}`), ctx("billing"));
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.data).toEqual(rows);
    expect(b.meta).toEqual({ total: 1 });
    expect(listCasesMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      PROVIDER_ID,
    );
  });
});

describe("case touches handler", () => {
  const CASE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  it("rejects a billing (read-only) role with 403 without calling the service", async () => {
    const res = await handleCreateCaseTouch(CASE_ID, { kind: "portal_submission" }, ctx("billing"));
    expect(res.status).toBe(403);
    expect(recordTouchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["a string", "not-json-object"],
    ["an array", [1, 2]],
  ])("rejects %s body with 422 without calling the service", async (_name, badBody) => {
    const res = await handleCreateCaseTouch(CASE_ID, badBody, ctx());
    expect(res.status).toBe(422);
    expect(recordTouchMock).not.toHaveBeenCalled();
  });

  it.each([[404], [409], [422]])("maps a rejected result to a %i failure", async (status) => {
    recordTouchMock.mockResolvedValue({
      kind: "rejected",
      status: status as 404 | 409 | 422,
      message: "nope",
    });
    const res = await handleCreateCaseTouch(CASE_ID, { kind: "portal_submission" }, ctx());
    expect(res.status).toBe(status);
    expect((await body(res)).error).toBe("nope");
  });

  it("returns 201 for a created touch, forwarding the writer ctx and case id", async () => {
    recordTouchMock.mockResolvedValue({ kind: "created", touch: { id: "t1" } as never });
    const payload = { kind: "portal_submission", portal_key: "bcbs_ks_enrollment" };
    const res = await handleCreateCaseTouch(CASE_ID, payload, ctx("admin"));
    expect(res.status).toBe(201);
    expect((await body(res)).data).toEqual({ id: "t1" });
    expect(recordTouchMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "u1" }),
      CASE_ID,
      payload,
    );
  });

  it("returns 200 for a duplicate (idempotent replay)", async () => {
    recordTouchMock.mockResolvedValue({ kind: "duplicate", touch: { id: "t1" } as never });
    const res = await handleCreateCaseTouch(CASE_ID, { kind: "portal_submission" }, ctx());
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ id: "t1" });
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
