import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiEnvelope } from "./envelope";
import type { AuthContext, UserContext } from "./guard";
import type { ProviderProfile, ProviderProfileResult } from "@/services/providerProfile";

vi.mock("@/services/portalFieldMaps", () => ({ listPortalFieldMaps: vi.fn() }));
vi.mock("@/services/fillSessions", () => ({ recordFillEvent: vi.fn() }));
vi.mock("@/services/providerProfile", () => ({ getProviderProfile: vi.fn() }));
vi.mock("@/services/providerCases", () => ({ listOpenProviderCases: vi.fn() }));
vi.mock("@/services/caseContext", () => ({ getCaseContext: vi.fn() }));
vi.mock("@/services/submissionTouches", () => ({ recordSubmissionTouch: vi.fn() }));
vi.mock("@/services/orgMemberships", () => ({ listUserOrgMemberships: vi.fn() }));

import { listPortalFieldMaps } from "@/services/portalFieldMaps";
import { recordFillEvent } from "@/services/fillSessions";
import { getProviderProfile } from "@/services/providerProfile";
import { listOpenProviderCases } from "@/services/providerCases";
import { getCaseContext } from "@/services/caseContext";
import { recordSubmissionTouch } from "@/services/submissionTouches";
import { listUserOrgMemberships } from "@/services/orgMemberships";
import {
  handleProviderProfile,
  handleListPortalFieldMaps,
  handleCreateFillEvent,
  handleListProviderCases,
  handleCaseContext,
  handleCreateCaseTouch,
  handleListMyOrgs,
} from "./extensionRoutes";

const listMapsMock = vi.mocked(listPortalFieldMaps);
const recordFillEventMock = vi.mocked(recordFillEvent);
const getProfileMock = vi.mocked(getProviderProfile);
const listCasesMock = vi.mocked(listOpenProviderCases);
const getCaseContextMock = vi.mocked(getCaseContext);
const recordTouchMock = vi.mocked(recordSubmissionTouch);
const listMyOrgsMock = vi.mocked(listUserOrgMemberships);

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
  const FACILITY_ID = "aaaa1111-2222-4333-8444-555566667777";
  const url = (qs = "") => new URL(`https://x.test/api/providers/${PROVIDER_ID}/profile${qs}`);
  // What the ctx() JWT resolves to (see resolveUserTokens).
  const USER_TOKENS = [
    { token: "user.name", value: "Tess Tester" },
    { token: "user.email", value: "tester@minted.com" },
  ];

  // The service's ok result: single facility, auto-selected (the common case).
  function okResult(
    profile: Partial<ProviderProfile> = {},
    needsFacility = false,
  ): ProviderProfileResult {
    return {
      kind: "ok",
      profile: {
        provider: { id: PROVIDER_ID } as never,
        tokens: [],
        unresolved: [],
        facilities: [{ id: FACILITY_ID, name: "Main Clinic" }],
        selected_facility_id: FACILITY_ID,
        ...profile,
      },
      needsFacility,
    };
  }

  it("returns 404 when the provider is missing (cross-org or nonexistent), without auditing", async () => {
    getProfileMock.mockResolvedValue({ kind: "provider_not_found" });
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
    getProfileMock.mockResolvedValue(okResult());
    const res = await handleProviderProfile(PROVIDER_ID, url(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const b = await body(res);
    expect(b.data).toEqual({
      provider: { id: PROVIDER_ID },
      tokens: USER_TOKENS,
      unresolved: [],
      facilities: [{ id: FACILITY_ID, name: "Main Clinic" }],
      selected_facility_id: FACILITY_ID,
    });
    // Both user tokens resolved, facility selected -> no meta at all.
    expect(b.meta).toBeNull();
  });

  it("appends user tokens AFTER the catalog tokens without disturbing them", async () => {
    getProfileMock.mockResolvedValue(
      okResult({ tokens: [{ token: "provider.firstName", value: "Pat" }] }),
    );
    const res = await handleProviderProfile(PROVIDER_ID, url(), ctx());
    const b = await body(res);
    expect((b.data as { tokens: unknown }).tokens).toEqual([
      { token: "provider.firstName", value: "Pat" },
      ...USER_TOKENS,
    ]);
  });

  it("resolves missing auth metadata to empty-string tokens and notes it in meta", async () => {
    getProfileMock.mockResolvedValue(okResult());
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
    getProfileMock.mockResolvedValue(
      okResult({
        provider: { id: PROVIDER_ID, ssnLast4: "6789" } as never,
        tokens: [{ token: "provider.ssnLast4", value: "6789" }],
      }),
    );
    const c = ctx();
    const res = await handleProviderProfile(PROVIDER_ID, url("?state=ks"), c);
    expect(res.status).toBe(200);
    expect(c.writeAudit).toHaveBeenCalledTimes(1);
    expect(c.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "READ",
        entityType: "provider",
        entityId: PROVIDER_ID,
        after: {
          route: "/api/providers/:id/profile",
          state: "KS",
          facilityId: FACILITY_ID,
        },
      }),
    );
    // The audit payload must not carry PHI/token values from the response.
    const auditArg = JSON.stringify(vi.mocked(c.writeAudit).mock.calls[0][0]);
    expect(auditArg).not.toContain("6789");
    expect(auditArg).not.toContain("Tess Tester");
  });

  it("a failed audit write fails the request (no un-audited PHI read)", async () => {
    getProfileMock.mockResolvedValue(okResult());
    const c = ctx();
    vi.mocked(c.writeAudit).mockRejectedValue(new Error("audit_log insert failed"));
    await expect(handleProviderProfile(PROVIDER_ID, url(), c)).rejects.toThrow(
      "audit_log insert failed",
    );
  });

  it("uppercases a valid ?state and forwards it with the org-scoped ctx", async () => {
    getProfileMock.mockResolvedValue(okResult());
    await handleProviderProfile(PROVIDER_ID, url("?state=ks"), ctx());
    expect(getProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      PROVIDER_ID,
      { state: "KS", facilityId: undefined },
    );
  });

  it("rejects a malformed ?state with 422 before touching the service", async () => {
    const res = await handleProviderProfile(PROVIDER_ID, url("?state=kansas"), ctx());
    expect(res.status).toBe(422);
    expect(getProfileMock).not.toHaveBeenCalled();
  });

  it("forwards ?facilityId to the service", async () => {
    getProfileMock.mockResolvedValue(okResult());
    await handleProviderProfile(PROVIDER_ID, url(`?facilityId=${FACILITY_ID}`), ctx());
    expect(getProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      PROVIDER_ID,
      { state: undefined, facilityId: FACILITY_ID },
    );
  });

  it("returns 404 for a non-UUID ?facilityId without touching the service", async () => {
    const res = await handleProviderProfile(PROVIDER_ID, url("?facilityId=not-a-uuid"), ctx());
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("Facility not found for this provider");
    expect(getProfileMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the facility is outside the org or the provider's set, without auditing", async () => {
    // The isolation-gate contract (assertion 11): a cross-org facilityId
    // resolves nothing — not a read, no data, no audit row.
    getProfileMock.mockResolvedValue({ kind: "facility_not_found" });
    const c = ctx();
    const res = await handleProviderProfile(PROVIDER_ID, url(`?facilityId=${FACILITY_ID}`), c);
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("Facility not found for this provider");
    expect(c.writeAudit).not.toHaveBeenCalled();
  });

  it("flags meta.needs_facility when several facilities need a user choice", async () => {
    const facilities = [
      { id: FACILITY_ID, name: "Main Clinic" },
      { id: "bbbb1111-2222-4333-8444-555566667777", name: "Second Clinic" },
    ];
    getProfileMock.mockResolvedValue(okResult({ facilities, selected_facility_id: null }, true));
    const c = ctx();
    const res = await handleProviderProfile(PROVIDER_ID, url(), c);
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.meta).toEqual({ needs_facility: true });
    expect((b.data as { selected_facility_id: unknown }).selected_facility_id).toBeNull();
    expect((b.data as { facilities: unknown }).facilities).toEqual(facilities);
    // Still a PHI read (non-facility tokens are served): audited, no facility.
    expect(c.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ after: expect.objectContaining({ facilityId: null }) }),
    );
  });

  it("merges needs_facility with user-token notes in one meta object", async () => {
    getProfileMock.mockResolvedValue(okResult({ selected_facility_id: null }, true));
    const bare = { ...ctx(), email: null, userMetadata: null };
    const res = await handleProviderProfile(PROVIDER_ID, url(), bare);
    const b = await body(res);
    expect(b.meta?.needs_facility).toBe(true);
    expect(b.meta?.notes).toHaveLength(2);
  });
});

describe("me orgs handler", () => {
  function userCtx(): UserContext {
    return {
      userId: "u1",
      email: "tester@minted.com",
      userMetadata: null,
      db: {} as UserContext["db"],
    };
  }

  it("returns the caller's memberships with meta.total, queried by the JWT user id", async () => {
    const rows = [
      { orgId: "org-1", orgName: "Kansas Fitness Physio", role: "admin" },
      { orgId: "org-2", orgName: "South Park Physician Group", role: "billing" },
    ];
    listMyOrgsMock.mockResolvedValue(rows);
    const res = await handleListMyOrgs(userCtx());
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.data).toEqual(rows);
    expect(b.meta).toEqual({ total: 2 });
    expect(listMyOrgsMock).toHaveBeenCalledWith(expect.objectContaining({ db: {} }), "u1");
  });

  it("returns an empty list (not an error) for a user with no memberships", async () => {
    listMyOrgsMock.mockResolvedValue([]);
    const res = await handleListMyOrgs(userCtx());
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.data).toEqual([]);
    expect(b.meta).toEqual({ total: 0 });
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
      {
        id: "c1",
        payerName: "Aetna",
        state: "KS",
        status: "Submitted",
        submittedDate: null,
        payerReferenceId: "REF-123",
        latestNote: { text: "waiting on payer", author: "Ann", at: "2026-07-06T00:00:00Z" },
        lastSubmittedAt: "2026-07-05T00:00:00Z",
      },
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

describe("case context handler", () => {
  const CASE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  it("returns 404 for a non-UUID case id without touching the service", async () => {
    const res = await handleCaseContext("not-a-uuid", ctx());
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("Case not found");
    expect(getCaseContextMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the case is outside the org (service returns null)", async () => {
    getCaseContextMock.mockResolvedValue(null);
    const res = await handleCaseContext(CASE_ID, ctx());
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("Case not found");
  });

  it("returns 200 with the context projection, forwarding the org-scoped ctx (billing may read)", async () => {
    const context = {
      referenceNumbers: ["REF-42"],
      latestNote: {
        content: "call the rep tomorrow",
        createdAt: "2026-07-06T10:00:00Z",
        authorName: "Nadia Rep",
      },
      latestTouch: {
        touchDate: "2026-07-05",
        touchType: "portal",
        outcome: "submitted",
        note: "Application submitted via Availity",
      },
    };
    getCaseContextMock.mockResolvedValue(context);
    const res = await handleCaseContext(CASE_ID, ctx("billing"));
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.data).toEqual(context);
    expect(b.meta).toBeNull();
    expect(getCaseContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      CASE_ID,
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
