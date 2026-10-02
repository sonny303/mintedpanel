import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCaseContext } from "@/services/caseContext";
import { getContractFormContext } from "@/services/contractFormContext";
import { resolveEffectivePortalMaps } from "@/services/portalFieldMaps";
import type { WorkContextValidationRequest } from "@/lib/workContext";
import { validateWorkContext, validateWorkContextForFillReceipt } from "./workContext";

vi.mock("@/services/caseContext", () => ({ getCaseContext: vi.fn() }));
vi.mock("@/services/contractFormContext", () => ({ getContractFormContext: vi.fn() }));
vi.mock("@/services/portalFieldMaps", () => ({ resolveEffectivePortalMaps: vi.fn() }));

const caseContextMock = vi.mocked(getCaseContext);
const contractContextMock = vi.mocked(getContractFormContext);
const portalMapsMock = vi.mocked(resolveEffectivePortalMaps);

const ORG = "20563fd6-8e95-46a0-8e1c-cb3b968b3c3d";
const OWNER = "b7a90000-0000-4000-a000-0000000000c2";
const PROVIDER = "49ad83a8-d8b6-419d-8dcc-88c04a54c4da";
const PORTAL = "b7a90000-0000-4000-a000-0000000000c4";
const TEMPLATE = "b7a90000-0000-4000-a000-0000000000c3";
const ASSIGNMENT = "b7a90000-0000-4000-a000-0000000000c7";
const TASK = "b7a90000-0000-4000-a000-0000000000c5";
const STEP = "b7a90000-0000-4000-a000-0000000000c6";
const FACILITY = "b7a90000-0000-4000-a000-0000000000c8";
const STEP_IDENTITY = `${OWNER}:${TASK}:${TEMPLATE}:3:${STEP}`;
const CASE_REQUEST: WorkContextValidationRequest = {
  protocolVersion: 2,
  launchReceiptId: "b7a90000-0000-4000-a000-0000000000c1",
  orgId: ORG,
  ownerKind: "case",
  ownerId: OWNER,
  contextVersion: 4,
  sopTemplateId: TEMPLATE,
  sopVersion: 3,
  portalId: PORTAL,
  portalKey: "regional_enrollment",
  mappingGeneration: 9,
  effectiveMappingFingerprint: "fingerprint-v2",
  providerId: PROVIDER,
  facilityId: FACILITY,
  stepIdentity: STEP_IDENTITY,
  taskId: TASK,
  stepId: STEP,
};

function caseContext(overrides: Record<string, unknown> = {}) {
  return {
    caseType: "enrollment",
    caseStatus: "in_progress",
    contextVersion: 4,
    provider: { id: PROVIDER, name: "Display only" },
    payer: { id: "b7a90000-0000-4000-a000-0000000000c9", name: "Payer" },
    selectedFacility: null,
    facilities: [{ id: FACILITY, name: "Secondary location" }],
    openTasks: [
      {
        id: TASK,
        status: "in_progress",
        executionType: "extension_fill",
        sopTemplateId: TEMPLATE,
        sopVersion: 3,
        steps: [
          {
            id: STEP,
            stepIdentity: STEP_IDENTITY,
            stepType: "online_form",
            isCompleted: false,
            portalKey: "regional_enrollment",
          },
          {
            id: "b7a90000-0000-4000-a000-0000000000ca",
            stepIdentity: `${STEP_IDENTITY}:later`,
            stepType: "online_form",
            isCompleted: false,
            portalKey: "regional_enrollment",
          },
        ],
      },
    ],
    ...overrides,
  };
}

function contractContext() {
  return {
    kind: "ok",
    context: {
      contract: { id: OWNER, payerId: "b7a90000-0000-4000-a000-0000000000c9" },
      assignment: {
        id: ASSIGNMENT,
        contextVersion: 4,
        sopTemplateId: TEMPLATE,
        sopVersion: 3,
      },
      selectedProviderId: PROVIDER,
      selectedFacilityId: null,
      steps: [
        {
          taskIndex: 1,
          stepIndex: 2,
          stepIdentity: `${OWNER}:${ORG}:${ASSIGNMENT}:4:${TEMPLATE}:3:1:2`,
          portalKey: "regional_enrollment",
        },
      ],
    },
  };
}

function portalConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    portalKey: "regional_enrollment",
    portalId: PORTAL,
    ownerScope: "organization",
    ownerOrgId: ORG,
    caseType: "enrollment",
    payerId: "b7a90000-0000-4000-a000-0000000000c9",
    formUrl: "https://portal.example/enroll",
    requiresExplicitSelection: true,
    mappingGeneration: 9,
    sharedMappingGeneration: 4,
    effectiveMappingFingerprint: "fingerprint-v2",
    isReady: true,
    status: "ready",
    maps: [
      {
        id: "b7a90000-0000-4000-a000-0000000000cb",
        portalKey: "regional_enrollment",
        mapType: "web",
        status: "approved",
        token: "provider.firstName",
        selector: "#first-name",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  caseContextMock.mockResolvedValue(caseContext() as never);
  contractContextMock.mockResolvedValue(contractContext() as never);
  portalMapsMock.mockResolvedValue(portalConfiguration() as never);
});

describe("validateWorkContext", () => {
  it("returns a canonical case tuple and only current approved web maps", async () => {
    portalMapsMock.mockResolvedValue(
      portalConfiguration({
        maps: [
          ...portalConfiguration().maps,
          { portalKey: "regional_enrollment", mapType: "extension", status: "approved" },
        ],
      }) as never,
    );

    const result = await validateWorkContext({ db: {} as never, orgId: ORG }, CASE_REQUEST);

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        tuple: {
          launchReceiptId: CASE_REQUEST.launchReceiptId,
          orgId: ORG,
          ownerKind: "case",
          ownerId: OWNER,
          taskId: TASK,
          stepId: STEP,
          stepIdentity: STEP_IDENTITY,
        },
        caseType: "enrollment",
        formUrl: "https://portal.example/enroll",
        mappingGeneration: 9,
        sharedMappingGeneration: 4,
        effectiveMappingFingerprint: "fingerprint-v2",
        effectiveWebMaps: [{ mapType: "web", status: "approved" }],
      },
    });
    expect(caseContextMock).toHaveBeenCalledWith({ db: expect.anything(), orgId: ORG }, OWNER);
    expect(portalMapsMock).toHaveBeenCalledWith(
      { db: expect.anything(), orgId: ORG },
      { portalKey: "regional_enrollment", mapType: "web" },
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Display only");
    expect(serialized).not.toContain("caseStatus");
  });

  it("supports exact recredentialing case work without treating it as a Contract owner", async () => {
    caseContextMock.mockResolvedValue(caseContext({ caseType: "recredentialing" }) as never);
    portalMapsMock.mockResolvedValue(portalConfiguration({ caseType: "recredentialing" }) as never);

    const result = await validateWorkContext({ db: {} as never, orgId: ORG }, CASE_REQUEST);

    expect(result).toMatchObject({ kind: "ok", data: { caseType: "recredentialing" } });
  });

  it("returns 404 semantics before any owner read when the requested org is not the authenticated org", async () => {
    const result = await validateWorkContext(
      { db: {} as never, orgId: ORG },
      { ...CASE_REQUEST, orgId: "20563fd6-8e95-46a0-8e1c-cb3b968b3c3e" },
    );
    expect(result.kind).toBe("not_found");
    expect(caseContextMock).not.toHaveBeenCalled();
    expect(contractContextMock).not.toHaveBeenCalled();
  });

  it("returns not found for an org-scoped owner miss without resolving portal configuration", async () => {
    caseContextMock.mockResolvedValue(null);
    await expect(
      validateWorkContext({ db: {} as never, orgId: ORG }, CASE_REQUEST),
    ).resolves.toEqual({ kind: "not_found", message: "Case not found." });
    expect(portalMapsMock).not.toHaveBeenCalled();
  });

  it("rejects stale case version, later task/step, and untrusted provider or facility", async () => {
    await expect(
      validateWorkContext({ db: {} as never, orgId: ORG }, { ...CASE_REQUEST, contextVersion: 5 }),
    ).resolves.toMatchObject({ kind: "stale" });
    expect(portalMapsMock).not.toHaveBeenCalled();

    caseContextMock.mockResolvedValue(
      caseContext({
        openTasks: [
          {
            ...caseContext().openTasks[0],
            id: "b7a90000-0000-4000-a000-0000000000cd",
            steps: [],
          },
          caseContext().openTasks[0],
        ],
      }) as never,
    );
    await expect(
      validateWorkContext({ db: {} as never, orgId: ORG }, CASE_REQUEST),
    ).resolves.toMatchObject({ kind: "stale" });

    caseContextMock.mockResolvedValue(caseContext() as never);
    await expect(
      validateWorkContext({ db: {} as never, orgId: ORG }, { ...CASE_REQUEST, facilityId: null }),
    ).resolves.toMatchObject({ kind: "mismatch" });
    await expect(
      validateWorkContext(
        { db: {} as never, orgId: ORG },
        { ...CASE_REQUEST, providerId: "b7a90000-0000-4000-a000-0000000000cd" },
      ),
    ).resolves.toMatchObject({ kind: "mismatch" });
  });

  it("allows only the receipt-stamped not_started-to-in_progress version bump for submission", async () => {
    caseContextMock.mockResolvedValue(caseContext({ contextVersion: 5 }) as never);

    await expect(
      validateWorkContext({ db: {} as never, orgId: ORG }, CASE_REQUEST),
    ).resolves.toMatchObject({ kind: "stale" });
    await expect(
      validateWorkContextForFillReceipt({ db: {} as never, orgId: ORG }, CASE_REQUEST, false),
    ).resolves.toMatchObject({ kind: "stale" });
    await expect(
      validateWorkContextForFillReceipt({ db: {} as never, orgId: ORG }, CASE_REQUEST, true),
    ).resolves.toMatchObject({ kind: "ok" });

    caseContextMock.mockResolvedValue(caseContext({ contextVersion: 6 }) as never);
    await expect(
      validateWorkContextForFillReceipt({ db: {} as never, orgId: ORG }, CASE_REQUEST, true),
    ).resolves.toMatchObject({ kind: "stale" });

    caseContextMock.mockResolvedValue(
      caseContext({ contextVersion: 5, caseStatus: "submitted" }) as never,
    );
    await expect(
      validateWorkContextForFillReceipt({ db: {} as never, orgId: ORG }, CASE_REQUEST, true),
    ).resolves.toMatchObject({ kind: "stale" });
  });

  it("revalidates Contract assignment and exact zero-based step position", async () => {
    const { taskId: _taskId, stepId: _stepId, ...caseTuple } = CASE_REQUEST;
    const request: WorkContextValidationRequest = {
      ...caseTuple,
      ownerKind: "contract",
      facilityId: null,
      assignmentId: ASSIGNMENT,
      taskIndex: 1,
      stepIndex: 2,
      stepIdentity: `${OWNER}:${ORG}:${ASSIGNMENT}:4:${TEMPLATE}:3:1:2`,
    };
    contractContextMock.mockResolvedValue(contractContext() as never);
    portalMapsMock.mockResolvedValue(portalConfiguration({ caseType: "contract" }) as never);

    const result = await validateWorkContext({ db: {} as never, orgId: ORG }, request);

    expect(result).toMatchObject({ kind: "ok", data: { caseType: "contract" } });
    expect(contractContextMock).toHaveBeenCalledWith(
      { db: expect.anything(), orgId: ORG },
      OWNER,
      { providerId: PROVIDER },
      {
        assignmentId: ASSIGNMENT,
        contextVersion: 4,
        sopTemplateId: TEMPLATE,
        sopVersion: 3,
        stepIdentity: request.stepIdentity,
      },
    );
    const resultData = result.kind === "ok" ? result.data : null;
    expect(resultData?.tuple).toMatchObject({
      ownerKind: "contract",
      assignmentId: ASSIGNMENT,
      taskIndex: 1,
      stepIndex: 2,
    });
  });

  it.each([
    ["stale map generation", { mappingGeneration: 8 }, "stale"],
    [
      "wrong map owner scope",
      { ownerScope: "organization", ownerOrgId: "20563fd6-8e95-46a0-8e1c-cb3b968b3c3e" },
      "not_found",
    ],
    ["legacy configuration", { requiresExplicitSelection: false }, "not_ready"],
    ["empty approved web maps", { maps: [] }, "not_ready"],
  ])("fails closed for %s", async (_label, overrides, kind) => {
    portalMapsMock.mockResolvedValue(portalConfiguration(overrides) as never);
    await expect(
      validateWorkContext({ db: {} as never, orgId: ORG }, CASE_REQUEST),
    ).resolves.toMatchObject({ kind });
  });
});
