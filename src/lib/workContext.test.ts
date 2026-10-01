import { describe, expect, it } from "vitest";
import {
  parseWorkContextValidationRequest,
  workContextTuple,
  type WorkContextValidationRequest,
} from "./workContext";

const caseRequest: WorkContextValidationRequest = {
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
  effectiveMappingFingerprint: "fingerprint-v2",
  providerId: "49ad83a8-d8b6-419d-8dcc-88c04a54c4da",
  facilityId: null,
  stepIdentity:
    "b7a90000-0000-4000-a000-0000000000c2:b7a90000-0000-4000-a000-0000000000c5:b7a90000-0000-4000-a000-0000000000c3:3:step-one",
  taskId: "b7a90000-0000-4000-a000-0000000000c5",
  stepId: "b7a90000-0000-4000-a000-0000000000c6",
};

describe("work context v2 request parser", () => {
  it("accepts the strict case tuple and strips only the protocol version for identity", () => {
    const parsed = parseWorkContextValidationRequest(caseRequest);
    expect(parsed).toEqual({ ok: true, request: caseRequest });
    if (!parsed.ok) throw new Error("fixture should parse");
    const { protocolVersion: _protocolVersion, ...expectedTuple } = caseRequest;
    expect(workContextTuple(parsed.request)).toEqual(expectedTuple);
  });

  it("accepts the Contract selector shape with zero-based indexes", () => {
    const { taskId: _taskId, stepId: _stepId, ...common } = caseRequest;
    const parsed = parseWorkContextValidationRequest({
      ...common,
      ownerKind: "contract",
      assignmentId: "b7a90000-0000-4000-a000-0000000000c7",
      taskIndex: 0,
      stepIndex: 2,
    });
    expect(parsed.ok).toBe(true);
  });

  it.each([
    ["wrong protocol", { ...caseRequest, protocolVersion: 1 }],
    ["client portal URL", { ...caseRequest, portalUrl: "https://portal.example" }],
    ["unknown field", { ...caseRequest, caseType: "enrollment" }],
    ["missing case step", (({ stepId: _stepId, ...row }) => row)(caseRequest)],
    ["non-normalized portal key", { ...caseRequest, portalKey: "Regional_Enrollment" }],
  ])("rejects %s", (_label, request) => {
    expect(parseWorkContextValidationRequest(request).ok).toBe(false);
  });

  it("rejects malformed UUID and non-positive generation", () => {
    expect(parseWorkContextValidationRequest({ ...caseRequest, orgId: "org-1" }).ok).toBe(false);
    expect(parseWorkContextValidationRequest({ ...caseRequest, mappingGeneration: 0 }).ok).toBe(
      false,
    );
  });
});
