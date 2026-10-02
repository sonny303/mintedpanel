import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiEnvelope } from "./envelope";
import type { AuthContext, UserContext } from "./guard";
import type { ProviderProfile, ProviderProfileResult } from "@/services/providerProfile";

vi.mock("@/services/portalFieldMaps", () => ({
  listEffectivePortalMapResolutions: vi.fn(),
  listLegacyClientPortalMapResolutions: vi.fn(),
  resolveEffectivePortalMaps: vi.fn(),
  proposeFieldMap: vi.fn(),
}));
vi.mock("@/services/portalFieldMapLearning", () => ({ batchLearnPortalFieldMaps: vi.fn() }));
vi.mock("@/services/portals", () => ({
  listPortalsForApi: vi.fn(),
  listSharedPortals: vi.fn(),
}));
vi.mock("@/services/fillSessions", () => ({
  recordFillEvent: vi.fn(),
  supportsFillEventV2: vi.fn(),
}));
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
vi.mock("@/services/contractFormContext", () => ({ getContractFormContext: vi.fn() }));
vi.mock("@/services/workContext", () => ({ validateWorkContext: vi.fn() }));
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

import {
  listEffectivePortalMapResolutions,
  listLegacyClientPortalMapResolutions,
  resolveEffectivePortalMaps,
  proposeFieldMap,
} from "@/services/portalFieldMaps";
import { batchLearnPortalFieldMaps } from "@/services/portalFieldMapLearning";
import { listPortalsForApi, listSharedPortals } from "@/services/portals";
import { recordFillEvent, supportsFillEventV2 } from "@/services/fillSessions";
import { getProviderProfile } from "@/services/providerProfile";
import { listOpenProviderCases, searchOrgCases } from "@/services/providerCases";
import { getCaseContext } from "@/services/caseContext";
import { getContractFormContext } from "@/services/contractFormContext";
import { validateWorkContext } from "@/services/workContext";
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
  handleListSharedFieldMaps,
  handleListPortals,
  handleListSharedPortals,
  handleProposeFieldMap,
  handleBatchLearnPortalFieldMaps,
  handleCompleteTaskStep,
  handleCreateFillEvent,
  handleListProviderCases,
  handleCaseContext,
  handleContractFormContext,
  handleValidateWorkContext,
  handleCreateCaseTouch,
  handleListMyOrgs,
  handleNextBestAction,
  handleGetViewPrefs,
  handlePutViewPrefs,
  handleSsnRelease,
} from "./extensionRoutes";

const effectiveMapsMock = vi.mocked(listEffectivePortalMapResolutions);
const legacyMapsMock = vi.mocked(listLegacyClientPortalMapResolutions);
const exactMapsMock = vi.mocked(resolveEffectivePortalMaps);
const proposeMapMock = vi.mocked(proposeFieldMap);
const batchLearnMapMock = vi.mocked(batchLearnPortalFieldMaps);
const listPortalsMock = vi.mocked(listPortalsForApi);
const listSharedPortalsMock = vi.mocked(listSharedPortals);
const recordFillEventMock = vi.mocked(recordFillEvent);
const supportsFillEventV2Mock = vi.mocked(supportsFillEventV2);
const getProfileMock = vi.mocked(getProviderProfile);
const listCasesMock = vi.mocked(listOpenProviderCases);
const searchCasesMock = vi.mocked(searchOrgCases);
const getCaseContextMock = vi.mocked(getCaseContext);
const getContractFormContextMock = vi.mocked(getContractFormContext);
const validateWorkContextMock = vi.mocked(validateWorkContext);
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

function emptyPortalResolution(
  portalId: string,
  ownerScope: "global" | "organization",
  ownerOrgId: string | null,
) {
  return {
    portalKey: "availity",
    portalId,
    ownerScope,
    ownerOrgId,
    caseType: null,
    formUrl: "https://portal.example/forms/app",
    payerId: null,
    requiresExplicitSelection: false,
    mappingGeneration: 3,
    effectiveMappingFingerprint: "sha256:empty",
    maps: [],
    activeFieldCount: 0,
    isVerified: false,
    isReady: false,
    status: "empty" as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  catalogMock.mockResolvedValue(CATALOG);
  supportsFillEventV2Mock.mockResolvedValue(false);
  effectiveMapsMock.mockResolvedValue([]);
  legacyMapsMock.mockResolvedValue([]);
  exactMapsMock.mockReset();
});

describe("provider profile handler", () => {
  const PROVIDER_ID = "0f0f0f0f-1111-4222-8333-444444444444";
  const FACILITY_ID = "aaaa1111-2222-4333-8444-555566667777";
  const CASE_ID = "cccc1111-2222-4333-8444-555566667777";
  const url = (qs = "") => new URL(`https://x.test/api/providers/${PROVIDER_ID}/profile${qs}`);
  // What the ctx() caller resolves to (see resolveUserTokens). ctx().db is an
  // empty stub, so the profiles read fails and resolution falls back to auth
  // metadata + the JWT email — the documented degradation. name/email land;
  // firstName/lastName/title have no metadata source and resolve empty, each
  // with a note. The profiles-backed path is covered in userTokens.test.ts.
  const USER_TOKENS = [
    { token: "user.name", value: "Tess Tester" },
    { token: "user.firstName", value: "" },
    { token: "user.lastName", value: "" },
    { token: "user.title", value: "" },
    { token: "user.email", value: "tester@minted.com" },
  ];
  // firstName + lastName + title.
  const CTX_NOTE_COUNT = 3;

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
        facilities: [{ id: FACILITY_ID, name: "Main Clinic", state: "MO" }],
        selected_facility_id: FACILITY_ID,
        case_id: null,
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
      facilities: [{ id: FACILITY_ID, name: "Main Clinic", state: "MO" }],
      selected_facility_id: FACILITY_ID,
      case_id: null,
    });
    // Facility auto-selected, so no needs_facility; the only meta is the
    // resolution notes for the tokens with no source on this ctx.
    expect(b.meta?.needs_facility).toBeUndefined();
    expect(b.meta?.notes).toHaveLength(CTX_NOTE_COUNT);
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
      { token: "user.firstName", value: "" },
      { token: "user.lastName", value: "" },
      { token: "user.title", value: "" },
      { token: "user.email", value: "" },
    ]);
    // One honest note per empty token — never a silently blank form field.
    expect(b.meta?.notes).toHaveLength(5);
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
          caseId: null,
          contractId: null,
          assignmentId: null,
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
      { state: "KS", facilityId: undefined, caseId: undefined },
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
      { state: undefined, facilityId: FACILITY_ID, caseId: undefined },
    );
  });

  it("returns 404 for a non-UUID ?facilityId without touching the service", async () => {
    const res = await handleProviderProfile(PROVIDER_ID, url("?facilityId=not-a-uuid"), ctx());
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("Facility not found for this provider");
    expect(getProfileMock).not.toHaveBeenCalled();
  });

  it("requires an exact case_id UUID when the parameter is present", async () => {
    for (const query of ["?case_id=", "?case_id=not-a-uuid"]) {
      const res = await handleProviderProfile(PROVIDER_ID, url(query), ctx());
      expect(res.status).toBe(422);
      expect(getProfileMock).not.toHaveBeenCalled();
    }
  });

  it("rejects an explicitly empty case-bound facility selection instead of using primary", async () => {
    const res = await handleProviderProfile(
      PROVIDER_ID,
      url(`?case_id=${CASE_ID}&facilityId=`),
      ctx(),
    );
    expect(res.status).toBe(404);
    expect(getProfileMock).not.toHaveBeenCalled();
  });

  it("forwards case_id and returns the exact service binding proof", async () => {
    getProfileMock.mockResolvedValue(
      okResult({ case_id: CASE_ID, facilities: [], selected_facility_id: null }),
    );
    const c = ctx();
    const res = await handleProviderProfile(PROVIDER_ID, url(`?case_id=${CASE_ID}`), c);
    expect(res.status).toBe(200);
    expect(getProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      PROVIDER_ID,
      { state: undefined, facilityId: undefined, caseId: CASE_ID },
    );
    expect((await body(res)).data).toMatchObject({ case_id: CASE_ID, facilities: [] });
    expect(c.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ after: expect.objectContaining({ caseId: CASE_ID }) }),
    );
  });

  it("forwards a Contract owner and expected SOP tuple without accepting case context", async () => {
    const contractId = "41414141-4242-4535-8686-797979797979";
    const assignmentId = "51515151-4242-4535-8686-797979797979";
    const templateId = "61616161-4242-4535-8686-797979797979";
    getProfileMock.mockResolvedValue(
      okResult({
        contract_context: {
          contract_id: contractId,
          assignment_id: assignmentId,
          context_version: 3,
          sop_template_id: templateId,
          sop_version: 2,
        },
      }),
    );
    const expectedStepIdentity = `${contractId}:org-1:${assignmentId}:3:${templateId}:2:0:1`;
    const c = ctx();
    const res = await handleProviderProfile(
      PROVIDER_ID,
      url(
        `?contract_id=${contractId}&assignment_id=${assignmentId}&context_version=3&sop_template_id=${templateId}&sop_version=2&stepIdentity=${encodeURIComponent(expectedStepIdentity)}`,
      ),
      c,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      PROVIDER_ID,
      {
        state: undefined,
        facilityId: undefined,
        groupId: undefined,
        caseId: undefined,
        contractContext: {
          contractId,
          expected: {
            assignmentId,
            contextVersion: 3,
            sopTemplateId: templateId,
            sopVersion: 2,
            stepIdentity: expectedStepIdentity,
          },
        },
      },
    );
    expect(c.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "provider",
        entityId: PROVIDER_ID,
        after: expect.objectContaining({ contractId, assignmentId }),
      }),
    );
  });

  it("rejects malformed or contradictory Contract profile selectors before service access", async () => {
    for (const query of [
      "?contract_id=not-a-uuid",
      "?contract_id=41414141-4242-4535-8686-797979797979&context_version=0",
      "?assignment_id=51515151-4242-4535-8686-797979797979",
      `?case_id=${CASE_ID}&contract_id=41414141-4242-4535-8686-797979797979`,
    ]) {
      const res = await handleProviderProfile(PROVIDER_ID, url(query), ctx());
      expect(res.status).toBe(422);
      expect(getProfileMock).not.toHaveBeenCalled();
    }
  });

  it("maps Contract owner failures without auditing a profile read", async () => {
    for (const [result, status] of [
      [{ kind: "contract_not_found" }, 404],
      [{ kind: "contract_context_not_configured", reason: "No assignment" }, 409],
      [{ kind: "contract_context_stale", reason: "Assignment changed" }, 409],
      [{ kind: "contract_context_mismatch", reason: "Wrong group" }, 422],
    ] as const) {
      getProfileMock.mockResolvedValue(result as ProviderProfileResult);
      const c = ctx();
      const res = await handleProviderProfile(
        PROVIDER_ID,
        url("?contract_id=41414141-4242-4535-8686-797979797979"),
        c,
      );
      expect(res.status).toBe(status);
      expect(c.writeAudit).not.toHaveBeenCalled();
    }
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
    expect(b.meta?.needs_facility).toBe(true);
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
    expect(b.meta?.notes).toHaveLength(5);
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
  const resolution = (over: Record<string, unknown> = {}) => ({
    portalKey: "availity",
    portalId: "portal-1",
    ownerScope: "organization",
    ownerOrgId: "org-1",
    caseType: "enrollment",
    formUrl: "https://portal.example/forms/app",
    payerId: "payer-1",
    requiresExplicitSelection: false,
    mappingGeneration: 4,
    effectiveMappingFingerprint: "sha256:abc123",
    maps: [{ id: "m1", urlPattern: "https://portal.example/forms/app", learnedVia: "nano" }],
    activeFieldCount: 1,
    isVerified: true,
    isReady: true,
    status: "ready",
    ...over,
  });

  it("returns the rows with meta.total", async () => {
    legacyMapsMock.mockResolvedValue([
      resolution({
        maps: [
          { id: "m1", urlPattern: "https://portal.example/forms/app", learnedVia: "nano" },
          { id: "m2" },
        ],
      }),
    ] as never);
    const res = await handleListPortalFieldMaps(
      new URL("https://x.test/api/portal-field-maps"),
      ctx(),
    );
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.data).toEqual([
      { id: "m1", urlPattern: "https://portal.example/forms/app", learnedVia: "nano" },
      { id: "m2" },
    ]);
    expect(b.meta).toEqual({
      total: 2,
      portal_mappings: [
        {
          portal_key: "availity",
          portal_id: "portal-1",
          case_type: "enrollment",
          requires_explicit_selection: false,
          mapping_generation: 4,
          active_field_count: 1,
          mapping_ready: true,
          is_verified: true,
          effective_mapping_fingerprint: "sha256:abc123",
        },
      ],
    });
  });

  it("resolves the exact ?portal_key using the authenticated organization", async () => {
    await handleListPortalFieldMaps(
      new URL("https://x.test/api/portal-field-maps?portal_key=availity"),
      ctx(),
    );
    expect(legacyMapsMock).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1" }), {
      portalKey: "availity",
      mapType: "all",
    });
  });

  it("hides an explicit-only exact key without leaking its capability metadata", async () => {
    legacyMapsMock.mockResolvedValue([]);
    const res = await handleListPortalFieldMaps(
      new URL("https://x.test/api/portal-field-maps?portal_key=availity"),
      ctx(),
    );
    const response = await body(res);
    expect(response.data).toEqual([]);
    expect(response.meta).toEqual({ total: 0, registry_empty: true });
  });

  it("hides mixed global-explicit and org-legacy maps from the old extension endpoint", async () => {
    // The exact Panel resolver can still return the unflagged org's effective
    // maps; the legacy capability resolver blocks the entire shared key.
    effectiveMapsMock.mockResolvedValue([
      resolution({ requiresExplicitSelection: false, maps: [{ id: "org-map" }] }),
    ] as never);
    legacyMapsMock.mockResolvedValue([]);

    const response = await body(
      await handleListPortalFieldMaps(
        new URL("https://x.test/api/portal-field-maps?portal_key=availity"),
        ctx(),
      ),
    );
    expect(response.data).toEqual([]);
    expect(response.meta).toEqual({ total: 0, registry_empty: true });
    expect(legacyMapsMock).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1" }), {
      portalKey: "availity",
      mapType: "all",
    });
  });

  it("advertises V2 only when the authenticated database exposes the new columns", async () => {
    supportsFillEventV2Mock.mockResolvedValue(true);
    const authenticated = ctx();

    const res = await handleListPortalFieldMaps(
      new URL("https://x.test/api/portal-field-maps"),
      authenticated,
    );

    expect((await body(res)).meta).toEqual({ total: 0, fill_event_schema_version: 2 });
    expect(supportsFillEventV2Mock).toHaveBeenCalledWith({ db: authenticated.db });
  });

  it("advertises the same checked capability on the shared field-map route", async () => {
    supportsFillEventV2Mock.mockResolvedValue(true);
    const db = {} as UserContext["db"];
    const user: UserContext = {
      userId: "u1",
      email: "tester@minted.com",
      userMetadata: null,
      db,
    };

    const res = await handleListSharedFieldMaps(
      new URL("https://x.test/api/shared-field-maps"),
      user,
    );

    expect((await body(res)).meta).toEqual({ total: 0, fill_event_schema_version: 2 });
    expect(supportsFillEventV2Mock).toHaveBeenCalledWith({ db });
    expect(legacyMapsMock).toHaveBeenCalledWith(
      { db, orgId: null },
      {
        portalKey: undefined,
        mapType: "all",
      },
    );
  });

  it("keeps shared map reads global-only and hides explicit-only configs", async () => {
    legacyMapsMock.mockResolvedValue([]);
    const user: UserContext = {
      userId: "u1",
      email: "tester@minted.com",
      userMetadata: null,
      db: {} as UserContext["db"],
    };
    const res = await handleListSharedFieldMaps(
      new URL("https://x.test/api/shared-field-maps?portal_key=availity"),
      user,
    );
    expect((await body(res)).data).toEqual([]);
    expect(legacyMapsMock).toHaveBeenCalledWith(
      { db: user.db, orgId: null },
      { portalKey: "availity", mapType: "all" },
    );
  });
});

describe("explicit shared Train/Test targets", () => {
  const sharedPortalsUrl = (query: string) => new URL(`https://x.test/api/shared-portals${query}`);
  const sharedMapsUrl = (query: string) => new URL(`https://x.test/api/shared-field-maps${query}`);

  const user = (): UserContext => ({
    userId: "u1",
    email: "tester@minted.com",
    userMetadata: null,
    db: {} as UserContext["db"],
  });

  it("keeps the legacy shared registry filtered while listing both equal-URL explicit candidates", async () => {
    const contract = {
      id: "aetna-contract",
      portalKey: "aetna_contract",
      name: "Aetna — New group contract",
      orgId: null,
      caseType: "contract",
      formUrl: "https://payer.example/app",
      requiresExplicitSelection: true,
      mappingGeneration: null,
      isVerified: false,
      lastVerifiedAt: null,
      provenAt: null,
    };
    const enrollment = {
      ...contract,
      id: "aetna-enrollment",
      portalKey: "aetna_enrollment",
      name: "Aetna — Add provider to existing contract",
      caseType: "enrollment",
    };
    // Reverse the display order intentionally. Neither same-URL row may be
    // treated as the identity winner on this candidate-list endpoint.
    listSharedPortalsMock.mockResolvedValue([enrollment, contract] as never);
    effectiveMapsMock.mockResolvedValue([
      {
        ...emptyPortalResolution(enrollment.id, "global", null),
        portalKey: enrollment.portalKey,
        caseType: "enrollment",
        requiresExplicitSelection: true,
        mappingGeneration: 2,
      },
      {
        ...emptyPortalResolution(contract.id, "global", null),
        portalKey: contract.portalKey,
        caseType: "contract",
        requiresExplicitSelection: true,
        mappingGeneration: 4,
      },
    ] as never);
    const caller = user();

    const legacy = await body(await handleListSharedPortals(caller));
    const candidates = await body(
      await handleListSharedPortals(caller, sharedPortalsUrl("?selection=explicit")),
    );

    expect(legacy.data).toEqual([]);
    const candidateRows = candidates.data as Array<Record<string, unknown>>;
    expect(candidateRows.map(({ portalKey }) => portalKey)).toEqual([
      "aetna_enrollment",
      "aetna_contract",
    ]);
    expect(candidateRows).toEqual([
      expect.objectContaining({
        portalKey: "aetna_enrollment",
        caseType: "enrollment",
        mappingGeneration: 2,
        requiresExplicitSelection: true,
      }),
      expect.objectContaining({
        portalKey: "aetna_contract",
        caseType: "contract",
        mappingGeneration: 4,
        requiresExplicitSelection: true,
      }),
    ]);
    expect(candidates.meta).toMatchObject({
      portal_mappings: [
        { portal_key: "aetna_enrollment", case_type: "enrollment", mapping_generation: 2 },
        { portal_key: "aetna_contract", case_type: "contract", mapping_generation: 4 },
      ],
    });
  });

  it("looks up the selected shared target by normalized exact key", async () => {
    listSharedPortalsMock.mockResolvedValue([
      {
        id: "aetna-contract",
        portalKey: "aetna_contract",
        orgId: null,
        caseType: "contract",
        mappingGeneration: 1,
        requiresExplicitSelection: true,
      },
    ] as never);
    effectiveMapsMock.mockResolvedValue([
      {
        ...emptyPortalResolution("aetna-contract", "global", null),
        portalKey: "aetna_contract",
        caseType: "contract",
        mappingGeneration: 1,
      },
    ] as never);
    const caller = user();

    const response = await handleListSharedPortals(
      caller,
      sharedPortalsUrl("?selection=explicit&portal_key=%20AETNA_CONTRACT%20"),
    );

    expect(response.status).toBe(200);
    expect(listSharedPortalsMock).toHaveBeenCalledWith(caller.db, {
      portalKey: "aetna_contract",
    });
    expect((await body(response)).data).toEqual([
      expect.objectContaining({ portalKey: "aetna_contract", caseType: "contract" }),
    ]);
  });

  it("returns 404 for an unknown explicit target and 422 for a blank target", async () => {
    listSharedPortalsMock.mockResolvedValue([]);
    const caller = user();

    const missing = await handleListSharedPortals(
      caller,
      sharedPortalsUrl("?selection=explicit&portal_key=missing"),
    );
    const blank = await handleListSharedPortals(
      caller,
      sharedPortalsUrl("?selection=explicit&portal_key=%20%20"),
    );

    expect(missing.status).toBe(404);
    expect(blank.status).toBe(422);
    expect(listSharedPortalsMock).toHaveBeenCalledTimes(1);
  });

  it("loads maps only for the explicitly named target and returns current mapping metadata", async () => {
    const caller = user();
    const resolution = {
      ...emptyPortalResolution("aetna-contract", "global", null),
      portalKey: "aetna_contract",
      caseType: "contract",
      requiresExplicitSelection: true,
      mappingGeneration: 5,
      maps: [{ id: "contract-map", portalKey: "aetna_contract" }],
      activeFieldCount: 1,
      isReady: true,
      status: "ready" as const,
    };
    exactMapsMock.mockResolvedValue(resolution as never);

    const response = await handleListSharedFieldMaps(
      sharedMapsUrl("?selection=explicit&portal_key=AETNA_CONTRACT"),
      caller,
    );

    expect(response.status).toBe(200);
    expect(exactMapsMock).toHaveBeenCalledWith(
      { db: caller.db, orgId: null },
      { portalKey: "aetna_contract", mapType: "all" },
    );
    expect(legacyMapsMock).not.toHaveBeenCalled();
    expect((await body(response)).meta).toMatchObject({
      portal_mappings: [
        {
          portal_key: "aetna_contract",
          case_type: "contract",
          mapping_generation: 5,
          effective_mapping_fingerprint: "sha256:empty",
        },
      ],
    });
  });

  it("requires an exact key and returns 404 when its explicit map target is missing", async () => {
    const caller = user();
    exactMapsMock.mockResolvedValue({
      ...emptyPortalResolution("missing", "global", null),
      status: "configuration_missing",
    } as never);

    const noKey = await handleListSharedFieldMaps(sharedMapsUrl("?selection=explicit"), caller);
    const missing = await handleListSharedFieldMaps(
      sharedMapsUrl("?selection=explicit&portal_key=missing"),
      caller,
    );

    expect(noKey.status).toBe(422);
    expect(missing.status).toBe(404);
    expect(exactMapsMock).toHaveBeenCalledTimes(1);
    expect(legacyMapsMock).not.toHaveBeenCalled();
  });
});

describe("portal field map batch-learn handler", () => {
  const INPUT = {
    case_id: "11111111-1111-4111-8111-111111111111",
    provider_id: "22222222-2222-4222-8222-222222222222",
    fill_session_id: "33333333-3333-4333-8333-333333333333",
    portal_key: "availity",
    page_url: "https://portal.example/forms/application?case=private#step",
    mappings: [
      { selector: "#provider-npi", token: "provider.npi", confidence: 0.91, field_type: "text" },
    ],
  };

  it("calls the service with actor and org from auth context and returns confirmed receipt counts", async () => {
    batchLearnMapMock.mockResolvedValue({
      kind: "ok",
      response: {
        inserted_count: 1,
        confirmed_saved_count: 1,
        preserved_count: 0,
        results: [{ selector: "#provider-npi", token: "provider.npi", outcome: "inserted" }],
      },
    });
    const c = ctx();
    const res = await handleBatchLearnPortalFieldMaps(INPUT, c);
    expect(res.status).toBe(200);
    expect(batchLearnMapMock).toHaveBeenCalledWith(
      { db: c.db, orgId: "org-1", userId: "u1" },
      INPUT,
    );
    expect((await body(res)).data).toMatchObject({ inserted_count: 1, confirmed_saved_count: 1 });
  });

  it("refuses billing before the service is called", async () => {
    const res = await handleBatchLearnPortalFieldMaps(INPUT, ctx("billing"));
    expect(res.status).toBe(403);
    expect(batchLearnMapMock).not.toHaveBeenCalled();
  });

  it("surfaces validation and stale-evidence rejections without logging request contents", async () => {
    batchLearnMapMock.mockResolvedValue({
      kind: "rejected",
      status: 404,
      message: "Submission evidence not found",
    });
    const res = await handleBatchLearnPortalFieldMaps(INPUT, ctx());
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("Submission evidence not found");
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

  it("returns a body-free 409 when a legacy capture has no generation token", async () => {
    proposeMapMock.mockResolvedValue({
      kind: "rejected",
      status: 409,
      message: "This form configuration requires expected_mapping_generation.",
    });
    const res = await handleProposeFieldMap(INPUT, ctx());

    expect(res.status).toBe(409);
    const envelope = await body(res);
    expect(envelope).toEqual({
      data: null,
      error: "This form configuration requires expected_mapping_generation.",
      meta: null,
    });
    expect(JSON.stringify(envelope)).not.toContain("provider.ssnLast4");
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
      expect.objectContaining({ orgId: "org-1", userId: "u1", source: "extension" }),
      TASK,
      "s1",
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

  it("keeps a historical same-URL row and hides its explicit-selection sibling", async () => {
    const formUrl = "https://portal.example/aetna/enrollment";
    const legacy = {
      id: "legacy",
      portalKey: "aetna_legacy",
      formUrl,
      requiresExplicitSelection: false,
    };
    const explicit = {
      id: "explicit",
      portalKey: "aetna_contract",
      formUrl,
      requiresExplicitSelection: true,
    };
    listPortalsMock.mockResolvedValue([legacy, explicit] as never);

    const res = await handleListPortals(url(), ctx());
    const b = await body(res);
    expect(b.data).toEqual([legacy]);
    expect(b.meta).toEqual({ total: 1, registry_empty: false });
  });

  it("does not expose an explicit-selection row through an exact-key lookup", async () => {
    const explicit = {
      id: "explicit",
      portalKey: "aetna_contract",
      formUrl: "https://portal.example/aetna/enrollment",
      requiresExplicitSelection: true,
    };
    listPortalsMock.mockResolvedValue([explicit] as never);

    const res = await handleListPortals(url("?portal_key=aetna_contract"), ctx());
    const b = await body(res);
    expect(b.data).toEqual([]);
    expect(b.meta).toEqual({ total: 0, registry_empty: true });
    expect(listPortalsMock).toHaveBeenCalledWith(expect.anything(), {
      portalKey: "aetna_contract",
    });
  });

  it("blocks every same-key row when only one registry sibling needs explicit selection", async () => {
    listPortalsMock.mockResolvedValue([
      {
        id: "global-explicit",
        portalKey: "same-key",
        orgId: null,
        requiresExplicitSelection: true,
      },
      {
        id: "org-legacy",
        portalKey: "same-key",
        orgId: "org-1",
        requiresExplicitSelection: false,
      },
    ] as never);

    const b = await body(await handleListPortals(url(), ctx()));
    expect(b.data).toEqual([]);
    expect(b.meta).toEqual({ total: 0, registry_empty: true });
  });

  it("masks persisted verification proof when the current API configuration has no active maps", async () => {
    const staleProofRow = {
      id: "portal-1",
      portalKey: "availity",
      orgId: "org-1",
      requiresExplicitSelection: false,
      isVerified: true,
      lastVerifiedAt: "2026-08-01T00:00:00Z",
      provenAt: "2026-08-01T00:00:00Z",
    };
    listPortalsMock.mockResolvedValue([staleProofRow] as never);
    effectiveMapsMock.mockResolvedValue([
      emptyPortalResolution("portal-1", "organization", "org-1"),
    ] as never);

    const response = await body(await handleListPortals(url(), ctx()));
    expect(response.data).toEqual([
      { ...staleProofRow, isVerified: false, lastVerifiedAt: null, provenAt: null },
    ]);
    expect(response.meta).toMatchObject({
      portal_mappings: [{ active_field_count: 0, mapping_ready: false, is_verified: false }],
    });
  });

  it("masks stale proof on the global shared registry response too", async () => {
    const staleProofRow = {
      id: "portal-1",
      portalKey: "availity",
      orgId: null,
      requiresExplicitSelection: false,
      isVerified: true,
      lastVerifiedAt: "2026-08-01T00:00:00Z",
      provenAt: "2026-08-01T00:00:00Z",
    };
    listSharedPortalsMock.mockResolvedValue([staleProofRow] as never);
    effectiveMapsMock.mockResolvedValue([
      emptyPortalResolution("portal-1", "global", null),
    ] as never);
    const user: UserContext = {
      userId: "u1",
      email: "tester@minted.com",
      userMetadata: null,
      db: {} as UserContext["db"],
    };

    const response = await body(await handleListSharedPortals(user));
    expect(response.data).toEqual([
      { ...staleProofRow, isVerified: false, lastVerifiedAt: null, provenAt: null },
    ]);
    expect(response.meta).toMatchObject({
      portal_mappings: [{ active_field_count: 0, mapping_ready: false, is_verified: false }],
    });
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
        caseNumber: 1001,
        facilityId: "fac-1",
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
      caseType: null,
      caseStatus: "in_progress" as const,
      contextVersion: 1,
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
      // E1.4: the case's full location set, primary first — pass-through from
      // the service like everything else in this projection.
      facilities: [
        {
          id: "aaaa1111-2222-4333-8444-555566667777",
          name: "Main Clinic",
          street: "100 Main St",
          suite: null,
          city: "Wichita",
          state: "KS",
          zip: "67202",
          isPrimary: true,
        },
        {
          id: "bbbb1111-2222-4333-8444-555566667777",
          name: "Satellite Office",
          street: "200 Oak St",
          suite: "Ste 4",
          city: "Wichita",
          state: "KS",
          zip: "67203",
          isPrimary: false,
        },
      ],
      openTasks: [
        {
          id: "task-1",
          title: "Enroll on BCBS portal",
          status: "in_progress",
          executionType: "extension_fill",
          sortOrder: 1,
          dueDate: null,
          sopTemplateId: null,
          sopVersion: null,
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

describe("Contract form-context handler", () => {
  const CONTRACT_ID = "41414141-4242-4535-8686-797979797979";
  const ASSIGNMENT_ID = "51515151-4242-4535-8686-797979797979";
  const TEMPLATE_ID = "61616161-4242-4535-8686-797979797979";
  const PROVIDER_ID = "71717171-4242-4535-8686-797979797979";
  const FACILITY_ID = "81818181-4242-4535-8686-797979797979";
  const url = (query = "") =>
    new URL(`https://x.test/api/contracts/${CONTRACT_ID}/form-context${query}`);

  it("returns 404 for an invalid or cross-org Contract without an audit", async () => {
    const c = ctx();
    expect((await handleContractFormContext("bad", url(), c)).status).toBe(404);
    expect(getContractFormContextMock).not.toHaveBeenCalled();

    getContractFormContextMock.mockResolvedValue({ kind: "not_found" });
    expect((await handleContractFormContext(CONTRACT_ID, url(), c)).status).toBe(404);
    expect(c.writeAudit).not.toHaveBeenCalled();
  });

  it("validates exact selectors and uses stable prefixed outcomes", async () => {
    const c = ctx();
    const invalidQuery = new URL(
      `http://x/api/contracts/${CONTRACT_ID}/form-context?contextVersion=0`,
    );
    expect((await handleContractFormContext(CONTRACT_ID, invalidQuery, c)).status).toBe(422);
    expect(getContractFormContextMock).not.toHaveBeenCalled();

    for (const [result, status, prefix] of [
      [{ kind: "not_configured", reason: "assignment missing" }, 409, "not_configured:"],
      [{ kind: "mismatch", reason: "wrong group" }, 422, "mismatch:"],
      [{ kind: "stale", reason: "version changed" }, 409, "stale:"],
    ] as const) {
      getContractFormContextMock.mockResolvedValue(result as never);
      const response = await handleContractFormContext(CONTRACT_ID, url(), c);
      expect(response.status).toBe(status);
      expect((await body(response)).error).toContain(prefix);
    }
    expect(c.writeAudit).not.toHaveBeenCalled();
  });

  it("returns the org-derived context with no-store and identifier-only audit", async () => {
    const c = ctx("billing");
    const auditMock = vi.fn().mockResolvedValue(undefined);
    c.writeAudit = auditMock;
    const context = {
      contract: {
        id: CONTRACT_ID,
        groupId: "91919191-4242-4535-8686-797979797979",
        payerId: "a1a1a1a1-4242-4535-8686-797979797979",
        state: "KS",
        groupName: "Selected group",
      },
      assignment: {
        id: ASSIGNMENT_ID,
        contextVersion: 7,
        sopTemplateId: TEMPLATE_ID,
        sopVersion: 4,
      },
      sop: { templateId: TEMPLATE_ID, version: 4, name: "Contract SOP", caseType: "contract" },
      selectedProviderId: PROVIDER_ID,
      selectedFacilityId: FACILITY_ID,
      steps: [
        {
          stepIdentity: `${CONTRACT_ID}:org-1:${ASSIGNMENT_ID}:7:${TEMPLATE_ID}:4:0:0`,
          taskIndex: 0,
          stepIndex: 0,
          taskTitle: "Contract packet",
          stepLabel: "Contract form",
          portalKey: "payer_contract_key",
          launch: { readiness: { outcome: "ready" } },
        },
      ],
    };
    getContractFormContextMock.mockResolvedValue({ kind: "ok", context } as never);
    const requestUrl = new URL(
      `http://x/api/contracts/${CONTRACT_ID}/form-context?providerId=${PROVIDER_ID}&facilityId=${FACILITY_ID}&assignmentId=${ASSIGNMENT_ID}&contextVersion=7&sopTemplateId=${TEMPLATE_ID}&sopVersion=4&stepIdentity=${encodeURIComponent(context.steps[0].stepIdentity)}`,
    );

    const response = await handleContractFormContext(CONTRACT_ID, requestUrl, c);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await body(response)).data).toEqual(context);
    expect(getContractFormContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      CONTRACT_ID,
      { providerId: PROVIDER_ID, facilityId: FACILITY_ID },
      {
        assignmentId: ASSIGNMENT_ID,
        contextVersion: 7,
        sopTemplateId: TEMPLATE_ID,
        sopVersion: 4,
        stepIdentity: context.steps[0].stepIdentity,
      },
    );
    expect(c.writeAudit).toHaveBeenCalledTimes(1);
    const audited = auditMock.mock.calls[0][0];
    expect(audited).toMatchObject({
      actionType: "READ",
      entityType: "contract",
      entityId: CONTRACT_ID,
      after: {
        assignmentId: ASSIGNMENT_ID,
        contextVersion: 7,
        providerId: PROVIDER_ID,
        facilityId: FACILITY_ID,
      },
    });
    expect(JSON.stringify(audited)).not.toContain("contracting_contact_email");
  });
});

describe("POST work-context validation handler", () => {
  const request = {
    protocolVersion: 2,
    launchReceiptId: "b7a90000-0000-4000-a000-0000000000c1",
    orgId: "20563fd6-8e95-46a0-8e1c-cb3b968b3c3d",
    ownerKind: "case",
    ownerId: "b7a90000-0000-4000-a000-0000000000c2",
    contextVersion: 4,
    sopTemplateId: "b7a90000-0000-4000-a000-0000000000c3",
    sopVersion: 3,
    portalId: "b7a90000-0000-4000-a000-0000000000c4",
    portalKey: "regional_enrollment",
    mappingGeneration: 9,
    effectiveMappingFingerprint: `sha256:${"a".repeat(64)}`,
    providerId: "49ad83a8-d8b6-419d-8dcc-88c04a54c4da",
    facilityId: null,
    stepIdentity: "case:task:sop:3:step",
    taskId: "b7a90000-0000-4000-a000-0000000000c5",
    stepId: "b7a90000-0000-4000-a000-0000000000c6",
  };

  it("rejects a URL hint or extra field before calling the validator", async () => {
    const c = ctx();
    const response = await handleValidateWorkContext(
      { ...request, portalUrl: "https://portal.example/form" },
      c,
    );
    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect((await body(response)).meta).toEqual({ work_context_error: "malformed_request" });
    expect(validateWorkContextMock).not.toHaveBeenCalled();
    expect(c.writeAudit).not.toHaveBeenCalled();
  });

  it("passes only a parsed URL-free tuple to org-derived validation and returns no-store canonical data", async () => {
    const { protocolVersion: _protocolVersion, ...tuple } = request;
    const data = {
      tuple,
      caseType: "enrollment",
      formUrl: "https://portal.example/form",
      requiresExplicitSelection: true,
      mappingGeneration: 9,
      sharedMappingGeneration: 2,
      effectiveMappingFingerprint: `sha256:${"a".repeat(64)}`,
      effectiveWebMaps: [{ portalKey: "regional_enrollment", mapType: "web", status: "approved" }],
    };
    validateWorkContextMock.mockResolvedValue({ kind: "ok", data } as never);
    const c = ctx();

    const response = await handleValidateWorkContext(request, c);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    const { sharedMappingGeneration: _serverPin, ...wireData } = data;
    expect((await body(response)).data).toEqual(wireData);
    expect(validateWorkContextMock).toHaveBeenCalledWith(
      { db: c.db, orgId: c.orgId },
      { ...request },
    );
    expect(c.writeAudit).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404],
    ["mismatch", 422],
    ["stale", 409],
    ["not_ready", 409],
  ] as const)("maps %s to the frozen HTTP status", async (kind, status) => {
    validateWorkContextMock.mockResolvedValue({ kind, message: "Safe typed failure." } as never);
    const response = await handleValidateWorkContext(request, ctx());
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect((await body(response)).meta).toEqual({ work_context_error: kind });
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

  it.each([[403], [404], [409], [422]])(
    "maps a rejected result to a %i failure",
    async (status) => {
      recordTouchMock.mockResolvedValue({
        kind: "rejected",
        status: status as 403 | 404 | 409 | 422,
        message: "nope",
      });
      const res = await handleCreateCaseTouch(CASE_ID, { kind: "portal_submission" }, ctx());
      expect(res.status).toBe(status);
      expect((await body(res)).error).toBe("nope");
    },
  );

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

  it("passes the nested v2 Work receipt through to the service unchanged", async () => {
    recordTouchMock.mockResolvedValue({ kind: "created", touch: { id: "t-v2" } as never });
    const payload = {
      kind: "portal_submission",
      idempotency_id: "11111111-2222-4333-8444-555555555555",
      portal_key: "aetna_enrollment_form",
      fill_session_id: "99999999-8888-4777-8666-121212121212",
      work_context: {
        launchReceiptId: "71717171-4242-4535-8686-797979797979",
        ownerKind: "case",
        ownerId: CASE_ID,
        taskId: "31313131-4242-4535-8686-797979797979",
        stepId: "a1a1a1a1-1111-4111-8111-111111111111",
      },
    };
    const res = await handleCreateCaseTouch(CASE_ID, payload, ctx());
    expect(res.status).toBe(201);
    expect(recordTouchMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "u1" }),
      CASE_ID,
      payload,
    );
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

  it("passes the nested camel-case v2 Work receipt through to the service unchanged", async () => {
    recordFillEventMock.mockResolvedValue({ kind: "created", session: { id: "fs-v2" } as never });
    const payload = {
      id: "11111111-2222-4333-8444-555555555555",
      workContext: {
        launchReceiptId: "71717171-4242-4535-8686-797979797979",
        ownerKind: "case",
        ownerId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        taskId: "31313131-4242-4535-8686-797979797979",
        stepId: "a1a1a1a1-1111-4111-8111-111111111111",
      },
    };
    const res = await handleCreateFillEvent(payload, ctx());
    expect(res.status).toBe(201);
    expect(recordFillEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "u1" }),
      payload,
    );
  });
});
