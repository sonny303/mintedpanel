import { describe, expect, it } from "vitest";
import {
  buildContractSopLaunchTuple,
  type BuildContractSopLaunchTupleInput,
} from "./contractSopLaunch";

const base: BuildContractSopLaunchTupleInput = {
  contractId: "contract-1",
  orgId: "org-1",
  payerId: "payer-1",
  assignment: {
    id: "assignment-1",
    contextVersion: 3,
    sopTemplateId: "template-1",
    sopVersion: 8,
  },
  taskIndex: 0,
  stepIndex: 0,
  step: { stepType: "online_form", portalKey: " Aetna_Contract_Form " },
  providerId: "provider-1",
  facilityId: "facility-1",
  configuration: {
    portalId: "portal-org-1",
    portalKey: "aetna_contract_form",
    ownerScope: "organization",
    ownerOrgId: "org-1",
    caseType: "contract",
    payerId: "payer-1",
    mappingGeneration: 4,
    effectiveMappingFingerprint: "opaque-canonical-fingerprint",
    isReady: true,
    requiresExplicitSelection: true,
    status: "ready",
  },
};

describe("Contract SOP launch tuple", () => {
  it("pins assignment, version, repeated-step position, exact config, and selected launch inputs", () => {
    const first = buildContractSopLaunchTuple(base);
    const repeated = buildContractSopLaunchTuple({
      ...base,
      taskIndex: 1,
      stepIndex: 2,
    });

    expect(first).toMatchObject({
      assignmentId: "assignment-1",
      contextVersion: 3,
      sopTemplateId: "template-1",
      sopVersion: 8,
      taskIndex: 0,
      stepIndex: 0,
      portalKey: "aetna_contract_form",
      portalId: "portal-org-1",
      portalScope: "organization",
      providerId: "provider-1",
      facilityId: "facility-1",
      mappingGeneration: 4,
      effectiveMappingFingerprint: "opaque-canonical-fingerprint",
      readiness: {
        outcome: "ready_handoff_deferred",
        mapReady: true,
        canOpenPortal: false,
      },
    });
    expect(repeated.portalKey).toBe(first.portalKey);
    expect(repeated.stepIdentity).not.toBe(first.stepIdentity);
    expect(first.stepIdentity).toContain("assignment-1:3:template-1:8:0:0");
  });

  it.each([
    ["missing resolver", null, "resolver_unavailable"],
    [
      "empty mapping",
      { ...base.configuration!, status: "empty", isReady: false },
      "mapping_not_ready",
    ],
    [
      "legacy configuration",
      { ...base.configuration!, requiresExplicitSelection: false },
      "legacy_configuration",
    ],
    ["wrong key", { ...base.configuration!, portalKey: "other_form" }, "configuration_mismatch"],
    ["wrong payer", { ...base.configuration!, payerId: "other-payer" }, "configuration_mismatch"],
    [
      "wrong owner scope",
      { ...base.configuration!, ownerOrgId: "other-org" },
      "configuration_mismatch",
    ],
  ] as const)("explicitly gates %s", (_label, configuration, outcome) => {
    const tuple = buildContractSopLaunchTuple({ ...base, configuration });
    expect(tuple.readiness.outcome).toBe(outcome);
    expect(tuple.readiness.canOpenPortal).toBe(false);
  });

  it("requires a selected provider even when the exact map is ready", () => {
    const tuple = buildContractSopLaunchTuple({ ...base, providerId: null });
    expect(tuple.readiness).toMatchObject({
      outcome: "provider_required",
      mapReady: true,
      canOpenPortal: false,
    });
  });
});
