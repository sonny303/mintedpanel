import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiEnvelope } from "./envelope";
import type { AuthContext, UserContext } from "./guard";
import type { ProviderProfile, ProviderProfileResult } from "@/services/providerProfile";

vi.mock("@/services/portalFieldMaps", () => ({
  listPortalFieldMaps: vi.fn(),
  proposeFieldMap: vi.fn(),
}));
vi.mock("@/services/portals", () => ({ listPortalsForApi: vi.fn() }));
vi.mock("@/services/fillSessions", () => ({ recordFillEvent: vi.fn() }));
vi.mock("@/services/providerProfile", () => ({ getProviderProfile: vi.fn() }));
// The org contact families ride the same profile response (2026-08-07). Mocked
// like every other service here so the handler tests stay free of a DB fake.
vi.mock("@/services/orgContacts", () => ({
  resolveOrgContactProfileTokens: vi.fn().mockResolvedValue({ tokens: [], unresolved: [] }),
}));
vi.mock("@/services/providerCases", () => ({
  listOpenProviderCases: vi.fn(),
  searchOrgCases: vi.fn(),
}));
vi.mock("@/services/caseContext", () => ({ getCaseContext: vi.fn() }));
vi.mock("@/services/ssnRelease", () => ({ releaseSsnForFill: vi.fn() }));
vi.mock("@/services/submissionTouches", () => ({ recordSubmissionTouch: vi.fn() }));
vi.mock("@/services/orgMemberships", () => ({ listUserOrgMemberships: vi.fn() }));
vi.mock("@/services/nextBestAction", () => ({ getNextBestAction: vi.fn() }));
vi.mock("@/services/taskSteps", () => ({ completeTaskStep: vi.fn() }));
vi.mock("@/services/extensionViewPrefs", () => ({
  getExtensionViewPrefs: vi.fn(),
  getQuickCardCatalog: vi.fn(),
  putExtensionViewPrefs: vi.fn(),
}));

import { listPortalFieldMaps, proposeFieldMap } from "@/services/portalFieldMaps";
import { listPortalsForApi } from "@/services/portals";
import { recordFillEvent } from "@/services/fillSessions";
import { getProviderProfile } from "@/services/providerProfile";
import { listOpenProviderCases, searchOrgCases } from "@/services/providerCases";
import { getCaseContext } from "@/services/caseContext";
import { releaseSsnForFill } from "@/services/ssnRelease";
import { recordSubmissionTouch } from "@/services/submissionTouches";
import { listUserOrgMemberships } from "@/services/orgMemberships";
import { getNextBestAction } from "@/services/nextBestAction";
import { completeTaskStep } from "@/services/taskSteps";
import {
  getExtensionViewPrefs,
  getQuickCardCatalog,
  putExtensionViewPrefs,
} from "@/services/extensionViewPrefs";
import {
  handleProviderProfile,
  handleListPortalFieldMaps,
  handleListPortals,
  handleProposeFieldMap,
  handleCompleteTaskStep,
  handleCreateFillEvent,
  handleListProviderCases,
  handleCaseContext,
  handleCreateCaseTouch,
  handleListMyOrgs,
  handleNextBestAction,
  handleGetViewPrefs,
  handlePutViewPrefs,
  handleSsnRelease,
} from "./extensionRoutes";

const listMapsMock = vi.mocked(listPortalFieldMaps);
const proposeMapMock = vi.mocked(proposeFieldMap);
const listPortalsMock = vi.mocked(listPortalsForApi);
const recordFillEventMock = vi.mocked(recordFillEvent);
const getProfileMock = vi.mocked(getProviderProfile);
const listCasesMock = vi.mocked(listOpenProviderCases);
const searchCasesMock = vi.mocked(searchOrgCases);
const getCaseContextMock = vi.mocked(getCaseContext);
const releaseSsnMock = vi.mocked(releaseSsnForFill);
const recordTouchMock = vi.mocked(recordSubmissionTouch);
const listMyOrgsMock = vi.mocked(listUserOrgMemberships);
const getNbaMock = vi.mocked(getNextBestAction);
const completeStepMock = vi.mocked(completeTaskStep);
const getViewPrefsMock = vi.mocked(getExtensionViewPrefs);
const putViewPrefsMock = vi.mocked(putExtensionViewPrefs);
const catalogMock = vi.mocked(getQuickCardCatalog);
// Stands in for the caller-JWT-bound client's .rpc() (set_case_status).
const userRpcMock = vi.fn();

// A small stand-in for the schema-derived catalog. The real derivation is
// covered in lib/quickCardCatalog.test.ts (incl. the drift guard); here it only
// needs to be the set the handlers validate against.
const CATALOG = [
  { key: "provider.npi", label: "NPI (Type 1)", group: "provider", groupLabel: "Provider" },
  { key: "provider.ssnLast4", label: "SSN (last 4)", group: "provider", groupLabel: "Provider" },
  { key: "group.tin", label: "Tax ID (TIN)", group: "group", groupLabel: "Provider group" },
  {
    key: "license.licenseNumber",
    label: "License number",
    group: "license",
    groupLabel: "State license",
  },
];

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

beforeEach(() => {
  vi.clearAllMocks();
  catalogMock.mockResolvedValue(CATALOG);
});

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

describe("case touch handler — opt-in status bump", () => {
  const CASE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const TOUCH = { id: "t1" } as never;

  it("reports an applied bump in meta, leaving data as the touch", async () => {
    recordTouchMock.mockResolvedValue({ kind: "created", touch: TOUCH, bump: { applied: true } });
    const res = await handleCreateCaseTouch(CASE, { kind: "portal_submission" }, ctx());
    expect(res.status).toBe(201);
    const b = await body(res);
    expect(b.data).toEqual({ id: "t1" });
    expect(b.meta).toEqual({ status_bump: "applied" });
  });

  it("reports a skipped bump with its reason and still returns 201", async () => {
    recordTouchMock.mockResolvedValue({
      kind: "created",
      touch: TOUCH,
      bump: { applied: false, reason: "The case was not in a status that can move to Submitted." },
    });
    const res = await handleCreateCaseTouch(CASE, { kind: "portal_submission" }, ctx());
    // The touch landed; a rejected transition is not a failed request.
    expect(res.status).toBe(201);
    const b = await body(res);
    expect(b.data).toEqual({ id: "t1" });
    expect(b.meta).toEqual({
      status_bump: "skipped",
      status_bump_reason: "The case was not in a status that can move to Submitted.",
    });
  });

  it("omits meta entirely when no bump was requested (unchanged wire shape)", async () => {
    recordTouchMock.mockResolvedValue({ kind: "created", touch: TOUCH });
    const res = await handleCreateCaseTouch(CASE, { kind: "portal_submission" }, ctx());
    expect((await body(res)).meta).toBeNull();
  });

  it("passes the org-scoped service context through, and no caller-JWT client", async () => {
    recordTouchMock.mockResolvedValue({ kind: "created", touch: TOUCH });
    const c = ctx();
    await handleCreateCaseTouch(CASE, { kind: "portal_submission" }, c);
    expect(recordTouchMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", db: c.db }),
      CASE,
      expect.anything(),
    );
    // The status report is a plain read on the service-role client now: the
    // DB trigger performs the transition, so no SECURITY INVOKER RPC is called
    // and there is nothing to bind the caller's JWT for.
    expect(recordTouchMock.mock.calls[0][0]).not.toHaveProperty("asUser");
  });

  it("still refuses billing before anything runs", async () => {
    const res = await handleCreateCaseTouch(
      CASE,
      { kind: "portal_submission", bump_status: true },
      ctx("billing"),
    );
    expect(res.status).toBe(403);
    expect(recordTouchMock).not.toHaveBeenCalled();
  });
});

describe("propose field map handler (propose-only)", () => {
  const INPUT = { portal_key: "availity", selector: "#npi", field_label: "NPI" };

  it("201s a newly proposed field", async () => {
    proposeMapMock.mockResolvedValue({
      kind: "created",
      map: { id: "m1" } as never,
      suggestion: null,
    });
    const res = await handleProposeFieldMap(INPUT, ctx());
    expect(res.status).toBe(201);
    expect((await body(res)).data).toEqual({ map: { id: "m1" }, suggestion: null });
  });

  it("carries the learned suggestion + evidence so the capture UI isn't a blank grid", async () => {
    proposeMapMock.mockResolvedValue({
      kind: "created",
      map: { id: "m1" } as never,
      suggestion: { token: "provider.npi", portalCount: 3, fromDictionary: false },
    });
    const res = await handleProposeFieldMap(INPUT, ctx());
    const data = (await body(res)).data as { suggestion: unknown };
    expect(data.suggestion).toEqual({
      token: "provider.npi",
      portalCount: 3,
      fromDictionary: false,
    });
  });

  it("200s (not 201) when the selector is already known — idempotent re-observation", async () => {
    proposeMapMock.mockResolvedValue({
      kind: "existing",
      map: { id: "m1" } as never,
      suggestion: null,
    });
    const res = await handleProposeFieldMap(INPUT, ctx());
    expect(res.status).toBe(200);
  });

  it("scopes the write to the guard-resolved org and passes the audit closure", async () => {
    proposeMapMock.mockResolvedValue({
      kind: "created",
      map: { id: "m1" } as never,
      suggestion: null,
    });
    const c = ctx();
    await handleProposeFieldMap(INPUT, c);
    expect(proposeMapMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", writeAudit: c.writeAudit }),
      INPUT,
    );
  });

  it("refuses billing before touching the service", async () => {
    const res = await handleProposeFieldMap(INPUT, ctx("billing"));
    expect(res.status).toBe(403);
    expect(proposeMapMock).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["a string", "nope"],
    ["an array", []],
  ])("422s %s body before touching the service", async (_n, bad) => {
    const res = await handleProposeFieldMap(bad, ctx());
    expect(res.status).toBe(422);
    expect(proposeMapMock).not.toHaveBeenCalled();
  });

  it("surfaces the service's validation rejection", async () => {
    proposeMapMock.mockResolvedValue({
      kind: "rejected",
      status: 422,
      message: "selector is required",
    });
    const res = await handleProposeFieldMap({ portal_key: "availity" }, ctx());
    expect(res.status).toBe(422);
    expect((await body(res)).error).toBe("selector is required");
  });
});

describe("task step handler (S4.3 — the one /api task-state write)", () => {
  const TASK = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  it("ticks a step and returns the task + allDone", async () => {
    completeStepMock.mockResolvedValue({
      kind: "ok",
      task: { id: TASK } as never,
      allDone: true,
    });
    const res = await handleCompleteTaskStep(TASK, { stepId: "s1" }, ctx());
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ task: { id: TASK }, allDone: true });
  });

  it("passes the org-scoped ctx and the actor through", async () => {
    completeStepMock.mockResolvedValue({ kind: "ok", task: {} as never, allDone: false });
    await handleCompleteTaskStep(TASK, { stepId: "s1" }, ctx());
    expect(completeStepMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "u1" }),
      TASK,
      "s1",
      expect.any(String),
    );
  });

  it("surfaces a blocked step as 409 with the blocker named", async () => {
    completeStepMock.mockResolvedValue({
      kind: "rejected",
      status: 409,
      message: 'Complete "Upload W-9" first',
    });
    const res = await handleCompleteTaskStep(TASK, { stepId: "s2" }, ctx());
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe('Complete "Upload W-9" first');
  });

  it("404s a non-UUID task id before touching the service", async () => {
    const res = await handleCompleteTaskStep("nope", { stepId: "s1" }, ctx());
    expect(res.status).toBe(404);
    expect(completeStepMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing stepId", {}],
    ["a blank stepId", { stepId: "   " }],
    ["a non-string stepId", { stepId: 5 }],
    ["a non-object body", "nope"],
  ])("422s %s before touching the service", async (_n, bad) => {
    const res = await handleCompleteTaskStep(TASK, bad, ctx());
    expect(res.status).toBe(422);
    expect(completeStepMock).not.toHaveBeenCalled();
  });

  it("refuses billing before touching the service", async () => {
    const res = await handleCompleteTaskStep(TASK, { stepId: "s1" }, ctx("billing"));
    expect(res.status).toBe(403);
    expect(completeStepMock).not.toHaveBeenCalled();
  });
});

describe("portals registry handler", () => {
  const url = (qs = "") => new URL(`https://x.test/api/portals${qs}`);

  it("returns the registry rows with meta.total and registry_empty false", async () => {
    listPortalsMock.mockResolvedValue([{ id: "p1" }, { id: "p2" }] as never);
    const res = await handleListPortals(url(), ctx());
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.data).toEqual([{ id: "p1" }, { id: "p2" }]);
    expect(b.meta).toEqual({ total: 2, registry_empty: false });
  });

  it("marks meta.registry_empty when the registry has no rows", async () => {
    listPortalsMock.mockResolvedValue([] as never);
    const res = await handleListPortals(url(), ctx());
    const b = await body(res);
    expect(b.meta).toEqual({ total: 0, registry_empty: true });
  });

  it("scopes the read to the guard-resolved org", async () => {
    listPortalsMock.mockResolvedValue([] as never);
    await handleListPortals(url(), ctx());
    expect(listPortalsMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      expect.anything(),
    );
  });

  it("forwards ?portal_key to the service", async () => {
    listPortalsMock.mockResolvedValue([] as never);
    await handleListPortals(url("?portal_key=availity"), ctx());
    expect(listPortalsMock).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1" }), {
      portalKey: "availity",
    });
  });

  it("is readable by billing (read-only registry, no role gate)", async () => {
    listPortalsMock.mockResolvedValue([{ id: "p1" }] as never);
    const res = await handleListPortals(url(), ctx("billing"));
    expect(res.status).toBe(200);
  });

  it("writes no audit row (a portal registry is not PHI)", async () => {
    listPortalsMock.mockResolvedValue([{ id: "p1" }] as never);
    const c = ctx();
    await handleListPortals(url(), c);
    expect(c.writeAudit).not.toHaveBeenCalled();
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
        portalTasks: [
          {
            taskId: "t1",
            title: "Enroll on Availity",
            portalKey: "availity",
            status: "in_progress",
          },
        ],
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

  // E4.3 TE-11 — the additive ?q= case-search mode on the same route.
  it("routes ?q= to the case search, forwarding the org-scoped ctx", async () => {
    const rows = [
      {
        id: "c1",
        providerId: "p1",
        providerName: "Brooke Ostrander",
        payerName: "Humana",
        state: "KS",
        status: "In Progress",
        payerReferenceId: "REF-9",
        payerPipelineState: "submitted",
      },
    ];
    searchCasesMock.mockResolvedValue(rows);
    const res = await handleListProviderCases(url("?q=ostrander"), ctx("billing"));
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.data).toEqual(rows);
    expect(b.meta).toEqual({ total: 1 });
    expect(searchCasesMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      "ostrander",
    );
    // providerId path is untouched by a q-only request.
    expect(listCasesMock).not.toHaveBeenCalled();
  });

  it("prefers providerId over q when both are present (the fill flow's primary path)", async () => {
    listCasesMock.mockResolvedValue([]);
    await handleListProviderCases(url(`?providerId=${PROVIDER_ID}&q=x`), ctx());
    expect(listCasesMock).toHaveBeenCalled();
    expect(searchCasesMock).not.toHaveBeenCalled();
  });
});

describe("next-best-action handler", () => {
  it("returns the queue-top item, forwarding the org-scoped ctx (billing may read)", async () => {
    const top = {
      caseId: "c1",
      providerId: "p1",
      providerName: "Kay One",
      payerName: "BCBS of Kansas",
      groupName: "KFP Group",
      state: "KS",
      actionKind: "task" as const,
      action: "Enroll on BCBS portal",
      reason: "Follow-up overdue since Jul 1, 2026 — surfaced ahead of deadline-only cases.",
      deadline: { date: "2026-07-01", source: "follow_up" as const, overdue: true },
      deepLink: "/cases/c1",
    };
    const result = { item: top, items: [top] };
    getNbaMock.mockResolvedValue(result);
    const res = await handleNextBestAction(
      new URL("https://x.test/api/next-best-action"),
      ctx("billing"),
    );
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual(result);
    expect(getNbaMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      20,
    );
  });

  it("returns an explicit empty result for a clear queue", async () => {
    getNbaMock.mockResolvedValue({ item: null, items: [] });
    const res = await handleNextBestAction(new URL("https://x.test/api/next-best-action"), ctx());
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ item: null, items: [] });
  });

  it("bounds the ranked list with ?limit=, falling back to 20 on a bad value", async () => {
    getNbaMock.mockResolvedValue({ item: null, items: [] });
    const call = (qs: string) =>
      handleNextBestAction(new URL(`https://x.test/api/next-best-action${qs}`), ctx());

    await call("?limit=5");
    expect(getNbaMock).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 5);
    // Out of range / non-numeric never errors — the queue is a read, and a bad
    // param shouldn't cost the caller their queue.
    for (const bad of ["?limit=0", "?limit=999", "?limit=abc", ""]) {
      await call(bad);
      expect(getNbaMock).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 20);
    }
  });
});

describe("view-prefs handlers (user-scoped)", () => {
  function userCtx(userId = "u1"): UserContext {
    return { userId, email: "t@minted.com", userMetadata: null, db: {} as UserContext["db"] };
  }

  it("GET returns the saved layout AND the derived catalog, scoped by the JWT user id", async () => {
    getViewPrefsMock.mockResolvedValue({ fields: ["provider.npi", "license.licenseNumber"] });
    const res = await handleGetViewPrefs(userCtx("uA"));
    expect(res.status).toBe(200);
    const data = (await body(res)).data as { fields: string[] | null; catalog: unknown };
    expect(data.fields).toEqual(["provider.npi", "license.licenseNumber"]);
    // The picker and the PUT validator read the same derived catalog, so it
    // rides along on the read the picker already makes.
    expect(data.catalog).toEqual(CATALOG);
    expect(getViewPrefsMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "uA" }));
  });

  it("GET returns { fields: null } when nothing is saved (never a null envelope data)", async () => {
    getViewPrefsMock.mockResolvedValue({ fields: null });
    const res = await handleGetViewPrefs(userCtx());
    const data = (await body(res)).data as { fields: string[] | null; catalog: unknown };
    expect(data.fields).toBeNull();
    expect(data.catalog).toEqual(CATALOG);
  });

  it.each([
    ["null", null],
    ["a string", "nope"],
    ["an array", []],
  ])("PUT rejects %s body with 422 before writing", async (_n, badBody) => {
    const res = await handlePutViewPrefs(badBody, userCtx());
    expect(res.status).toBe(422);
    expect(putViewPrefsMock).not.toHaveBeenCalled();
  });

  // ssnLast4 is OFFERED as of 2026-07-28 (product decision) — the profile
  // endpoint already returns it and payer forms ask for it. The full SSN stays
  // unreachable structurally: it lives in provider_ssn_vault, which the token
  // catalog does not sweep, so no token can name it.
  it("PUT accepts ssnLast4 (now a catalog field)", async () => {
    putViewPrefsMock.mockResolvedValue({ fields: ["provider.ssnLast4"] });
    const res = await handlePutViewPrefs({ fields: ["provider.ssnLast4"] }, userCtx());
    expect(res.status).toBe(200);
    expect(putViewPrefsMock).toHaveBeenCalled();
  });

  it("PUT rejects a key outside the derived catalog with 422 before writing", async () => {
    const res = await handlePutViewPrefs({ fields: ["provider.launchId"] }, userCtx());
    expect(res.status).toBe(422);
    expect(putViewPrefsMock).not.toHaveBeenCalled();
  });

  it("PUT rejects a case-scoped payer token with 422 before writing", async () => {
    const res = await handlePutViewPrefs({ fields: ["payer.name"] }, userCtx());
    expect(res.status).toBe(422);
    expect(putViewPrefsMock).not.toHaveBeenCalled();
  });

  it("PUT rejects a duplicate key with 422 before writing", async () => {
    const res = await handlePutViewPrefs({ fields: ["provider.npi", "provider.npi"] }, userCtx());
    expect(res.status).toBe(422);
    expect(putViewPrefsMock).not.toHaveBeenCalled();
  });

  it("PUT persists a valid ordered layout scoped by the JWT user id", async () => {
    const fields = ["license.licenseNumber", "provider.npi", "group.tin"];
    putViewPrefsMock.mockResolvedValue({ fields });
    const res = await handlePutViewPrefs({ fields }, userCtx("uB"));
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ fields });
    expect(putViewPrefsMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "uB" }),
      fields,
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

  it("returns 200 with the context projection, no-store + one READ audit, forwarding the org-scoped ctx (billing may read)", async () => {
    const context = {
      referenceNumbers: ["REF-42"],
      payerPipelineState: "submitted",
      // E4.3 TE-2: identity header + open tasks with execution types.
      provider: { id: "prov-1", name: "Kay One" },
      payer: { id: "pay-1", name: "BCBS of Kansas" },
      state: "KS",
      // E4.3 TE-2: the case-selected facility's complete nullable practice
      // address rides the same projection, pass-through from the service.
      selectedFacility: {
        id: "aaaa1111-2222-4333-8444-555566667777",
        name: "Main Clinic",
        street: "100 Main St",
        suite: null,
        city: "Wichita",
        state: "KS",
        zip: "67202",
      },
      openTasks: [
        {
          id: "task-1",
          title: "Enroll on BCBS portal",
          status: "in_progress",
          executionType: "extension_fill",
          sortOrder: 1,
          dueDate: null,
          steps: [],
        },
      ],
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
    const c = ctx("billing");
    const res = await handleCaseContext(CASE_ID, c);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const b = await body(res);
    expect(b.data).toEqual(context);
    expect(b.meta).toBeNull();
    expect(getCaseContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      CASE_ID,
    );
    // Exactly one READ audit row (never the body/token values).
    expect(c.writeAudit).toHaveBeenCalledTimes(1);
    expect(c.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "READ", entityType: "case", entityId: CASE_ID }),
    );
  });

  it("writes no audit row when the case is outside the org (404 is not a read)", async () => {
    getCaseContextMock.mockResolvedValue(null);
    const c = ctx();
    const res = await handleCaseContext(CASE_ID, c);
    expect(res.status).toBe(404);
    expect(c.writeAudit).not.toHaveBeenCalled();
  });
});

describe("ssn release handler (E4.4 F4.4.2 fill-only)", () => {
  const PROVIDER_ID = "11111111-2222-4333-8444-555566667777";
  const CASE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const releaseUrl = (id = PROVIDER_ID, caseId: string | null = CASE_ID) =>
    new URL(
      `http://x/api/providers/${id}/ssn-release${caseId === null ? "" : `?caseId=${caseId}`}`,
    );

  it("rejects billing (read-only) with 403 and never touches the service", async () => {
    const c = ctx("billing");
    const res = await handleSsnRelease(PROVIDER_ID, releaseUrl(), c);
    expect(res.status).toBe(403);
    expect(releaseSsnMock).not.toHaveBeenCalled();
    expect(c.writeAudit).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-UUID provider id without touching the service", async () => {
    const c = ctx();
    const res = await handleSsnRelease("not-a-uuid", releaseUrl("not-a-uuid"), c);
    expect(res.status).toBe(404);
    expect(releaseSsnMock).not.toHaveBeenCalled();
  });

  it("returns 422 when caseId is missing (an active fill context is required)", async () => {
    const c = ctx();
    const res = await handleSsnRelease(PROVIDER_ID, releaseUrl(PROVIDER_ID, null), c);
    expect(res.status).toBe(422);
    expect(releaseSsnMock).not.toHaveBeenCalled();
    expect(c.writeAudit).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-UUID caseId without touching the service", async () => {
    const c = ctx();
    const res = await handleSsnRelease(PROVIDER_ID, releaseUrl(PROVIDER_ID, "nope"), c);
    expect(res.status).toBe(404);
    expect(releaseSsnMock).not.toHaveBeenCalled();
  });

  it("returns the rejection status and writes NO audit row when the service rejects", async () => {
    releaseSsnMock.mockResolvedValue({
      kind: "rejected",
      status: 404,
      message: "Case not found for this provider",
    });
    const c = ctx();
    const res = await handleSsnRelease(PROVIDER_ID, releaseUrl(), c);
    expect(res.status).toBe(404);
    expect(c.writeAudit).not.toHaveBeenCalled();
  });

  it("releases with 200 + no-store + one READ audit (actor/provider/case, never the value)", async () => {
    releaseSsnMock.mockResolvedValue({
      kind: "released",
      ssn: "900000000",
      ssnLast4: "0000",
    });
    const c = ctx("specialist");
    const res = await handleSsnRelease(PROVIDER_ID, releaseUrl(), c);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const b = await body(res);
    expect(b.data).toEqual({ ssn: "900000000", ssnLast4: "0000" });
    expect(releaseSsnMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      PROVIDER_ID,
      CASE_ID,
    );
    expect(c.writeAudit).toHaveBeenCalledTimes(1);
    const auditArg = vi.mocked(c.writeAudit).mock.calls[0][0];
    expect(auditArg).toEqual(
      expect.objectContaining({
        actionType: "READ",
        entityType: "provider_ssn_vault",
        entityId: PROVIDER_ID,
      }),
    );
    // The value is never carried in the audit payload.
    expect(JSON.stringify(auditArg)).not.toContain("900000000");
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
