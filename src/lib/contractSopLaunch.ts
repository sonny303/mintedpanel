import type { ContractSopAssignment } from "@/types";
import { isValidHandoffUrl } from "@/lib/extensionHandoff";

/** Narrow structural input implemented by MINT-52's canonical map resolver. */
export interface ContractPortalConfiguration {
  portalId: string | null;
  portalKey: string;
  ownerScope: "global" | "organization" | null;
  ownerOrgId: string | null;
  caseType: string | null;
  payerId: string | null;
  formUrl: string | null;
  mappingGeneration: number | null;
  effectiveMappingFingerprint: string | null;
  isReady: boolean;
  requiresExplicitSelection: boolean;
  status: "ready" | "empty" | "configuration_missing";
}

export type ContractLaunchReadinessOutcome =
  | "invalid_step"
  | "resolver_unavailable"
  | "configuration_missing"
  | "configuration_mismatch"
  | "legacy_configuration"
  | "mapping_not_ready"
  | "provider_required"
  | "ready";

export interface ContractSopLaunchTuple {
  /** Distinguishes repeated steps that intentionally reuse the same portal key. */
  stepIdentity: string;
  contractId: string;
  orgId: string;
  payerId: string;
  assignmentId: string;
  contextVersion: number;
  sopTemplateId: string;
  sopVersion: number;
  taskIndex: number;
  stepIndex: number;
  portalKey: string | null;
  portalId: string | null;
  portalScope: "organization" | "global" | null;
  providerId: string | null;
  facilityId: string | null;
  mappingGeneration: number | null;
  effectiveMappingFingerprint: string | null;
  formUrl: string | null;
  readiness: {
    outcome: ContractLaunchReadinessOutcome;
    mapReady: boolean;
    canOpenPortal: boolean;
    reason: string;
  };
}

export interface BuildContractSopLaunchTupleInput {
  contractId: string;
  orgId: string;
  payerId: string;
  assignment: Pick<ContractSopAssignment, "id" | "contextVersion" | "sopTemplateId" | "sopVersion">;
  taskIndex: number;
  stepIndex: number;
  step: { stepType?: string | null; portalKey?: string | null };
  providerId: string | null;
  facilityId: string | null;
  /** The exact configuration returned by the canonical MINT-52 resolver. */
  configuration: ContractPortalConfiguration | null;
}

function normalizePortalKey(value: string | null | undefined): string | null {
  const key = value?.trim().toLowerCase();
  return key || null;
}

/**
 * Build one immutable SOP-step launch identity and explicit readiness gate.
 * M56 sends ready tuples through the versioned Extension tab bridge.
 */
export function buildContractSopLaunchTuple(
  input: BuildContractSopLaunchTupleInput,
): ContractSopLaunchTuple {
  const portalKey = normalizePortalKey(input.step.portalKey);
  const configurationKey = normalizePortalKey(input.configuration?.portalKey);
  const base = {
    stepIdentity: [
      input.contractId,
      input.orgId,
      input.assignment.id,
      input.assignment.contextVersion,
      input.assignment.sopTemplateId,
      input.assignment.sopVersion,
      input.taskIndex,
      input.stepIndex,
    ].join(":"),
    contractId: input.contractId,
    orgId: input.orgId,
    payerId: input.payerId,
    assignmentId: input.assignment.id,
    contextVersion: input.assignment.contextVersion,
    sopTemplateId: input.assignment.sopTemplateId,
    sopVersion: input.assignment.sopVersion,
    taskIndex: input.taskIndex,
    stepIndex: input.stepIndex,
    portalKey,
    portalId: input.configuration?.portalId ?? null,
    portalScope: input.configuration?.ownerScope ?? null,
    providerId: input.providerId,
    facilityId: input.facilityId,
    mappingGeneration: input.configuration?.mappingGeneration ?? null,
    effectiveMappingFingerprint: input.configuration?.effectiveMappingFingerprint ?? null,
    formUrl: input.configuration?.formUrl ?? null,
  };

  let outcome: ContractLaunchReadinessOutcome;
  let reason: string;
  let mapReady = false;
  if (
    input.step.stepType !== "online_form" ||
    !portalKey ||
    !Number.isInteger(input.taskIndex) ||
    input.taskIndex < 0 ||
    !Number.isInteger(input.stepIndex) ||
    input.stepIndex < 0
  ) {
    outcome = "invalid_step";
    reason = "This SOP step has no valid online-form portal identity.";
  } else if (!input.configuration) {
    outcome = "resolver_unavailable";
    reason = "The exact portal configuration has not been resolved.";
  } else if (input.configuration.status === "configuration_missing") {
    outcome = "configuration_missing";
    reason = "No visible portal configuration matches this exact SOP key.";
  } else if (
    !input.configuration.portalId ||
    !input.configuration.formUrl ||
    !isValidHandoffUrl(input.configuration.formUrl) ||
    configurationKey !== portalKey ||
    input.configuration.caseType !== "contract" ||
    input.configuration.payerId !== input.payerId ||
    (input.configuration.ownerScope === "organization" &&
      input.configuration.ownerOrgId !== input.orgId) ||
    (input.configuration.ownerScope === "global" && input.configuration.ownerOrgId !== null) ||
    input.configuration.ownerScope === null ||
    !Number.isInteger(input.configuration.mappingGeneration) ||
    (input.configuration.mappingGeneration ?? 0) < 1
  ) {
    outcome = "configuration_mismatch";
    reason = "The resolved configuration does not match this exact SOP portal key.";
  } else if (!input.configuration.requiresExplicitSelection) {
    outcome = "legacy_configuration";
    reason = "Contract work requires an explicitly selected form configuration.";
  } else if (
    input.configuration.status !== "ready" ||
    !input.configuration.isReady ||
    !input.configuration.effectiveMappingFingerprint?.trim()
  ) {
    outcome = "mapping_not_ready";
    reason = "The exact form configuration has no ready, fingerprinted map.";
  } else {
    mapReady = true;
    if (!input.providerId) {
      outcome = "provider_required";
      reason = "Select an active provider before this form can be prepared.";
    } else {
      outcome = "ready";
      reason = "The exact Contract step and current form configuration are ready.";
    }
  }

  return {
    ...base,
    readiness: {
      outcome,
      mapReady,
      canOpenPortal: outcome === "ready",
      reason,
    },
  };
}
