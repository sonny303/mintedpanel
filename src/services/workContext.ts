import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isValidHandoffUrl } from "@/lib/extensionHandoff";
import { isOpenCaseStatus } from "@/lib/caseStatus";
import { normalizePortalKey } from "@/lib/tokenFormat";
import type { CaseType } from "@/lib/caseTypes";
import type {
  WorkContextTuple,
  WorkContextValidationData,
  WorkContextValidationErrorCode,
  WorkContextValidationRequest,
} from "@/lib/workContext";
import { workContextTuple } from "@/lib/workContext";
import { getCaseContext } from "@/services/caseContext";
import { getContractFormContext } from "@/services/contractFormContext";
import { resolveEffectivePortalMaps } from "@/services/portalFieldMaps";

export interface WorkContextServiceCtx {
  db: SupabaseClient<Database>;
  /** Membership-derived scope supplied by the route guard. */
  orgId: string;
}

export type WorkContextValidationResult =
  | { kind: "ok"; data: WorkContextValidationData }
  | { kind: WorkContextValidationErrorCode; message: string };

interface ValidatedOwner {
  caseType: CaseType;
  payerId: string;
  stepIdentity: string;
  portalKey: string;
}

function rejected(
  kind: WorkContextValidationErrorCode,
  message: string,
): WorkContextValidationResult {
  return { kind, message };
}

async function validateCaseOwner(
  ctx: WorkContextServiceCtx,
  request: Extract<WorkContextValidationRequest, { ownerKind: "case" }>,
  allowAutoStartedContextVersion = false,
): Promise<ValidatedOwner | WorkContextValidationResult> {
  const context = await getCaseContext({ db: ctx.db, orgId: ctx.orgId }, request.ownerId);
  if (!context) return rejected("not_found", "Case not found.");
  if (request.orgId !== ctx.orgId) return rejected("not_found", "Case not found.");
  const exactContextVersion = context.contextVersion === request.contextVersion;
  const fillStartedCase =
    allowAutoStartedContextVersion &&
    context.caseStatus === "in_progress" &&
    context.contextVersion === request.contextVersion + 1;
  if (!exactContextVersion && !fillStartedCase) {
    return rejected("stale", "Case context changed; refresh the work step.");
  }
  if (!context.caseStatus || !isOpenCaseStatus(context.caseStatus)) {
    return rejected("stale", "The case is no longer open for work.");
  }
  if (context.caseType !== "enrollment" && context.caseType !== "recredentialing") {
    return rejected("mismatch", "Case Work requires an Enrollment or Recredentialing case.");
  }
  const facilityIsCurrent =
    request.facilityId === null
      ? context.facilities.length === 0
      : context.facilities.some((facility) => facility.id === request.facilityId);
  if (
    !context.provider ||
    context.provider.id !== request.providerId ||
    !facilityIsCurrent ||
    !context.payer?.id
  ) {
    return rejected("mismatch", "Provider, case location, or payer does not match the case.");
  }

  const task = context.openTasks.find((candidate) => candidate.id === request.taskId);
  if (!task) return rejected("stale", "The requested case task is no longer open.");
  if (context.openTasks[0]?.id !== task.id) {
    return rejected("stale", "The requested task is not the current case work task.");
  }
  if (task.sopTemplateId !== request.sopTemplateId || task.sopVersion !== request.sopVersion) {
    return rejected("stale", "The task's stamped SOP version changed.");
  }
  if (task.executionType !== "extension_fill") {
    return rejected("mismatch", "The requested case task is not enabled for Extension fill.");
  }
  const step = task.steps.find((candidate) => candidate.id === request.stepId);
  if (!step || step.stepType !== "online_form") {
    return rejected("mismatch", "The requested step is not an online-form step on this task.");
  }
  if (task.steps.find((candidate) => !candidate.isCompleted)?.id !== step.id) {
    return rejected("stale", "The requested step is not the current incomplete SOP step.");
  }
  if (step.isCompleted) return rejected("stale", "The requested SOP step is already complete.");
  if (step.stepIdentity !== request.stepIdentity) {
    return rejected("stale", "The requested case step identity changed.");
  }
  const portalKey = normalizePortalKey(step.portalKey);
  if (!portalKey || portalKey !== request.portalKey) {
    return rejected("mismatch", "The requested portal key does not match this SOP step.");
  }

  return {
    caseType: context.caseType,
    payerId: context.payer.id,
    stepIdentity: step.stepIdentity,
    portalKey,
  };
}

async function validateContractOwner(
  ctx: WorkContextServiceCtx,
  request: Extract<WorkContextValidationRequest, { ownerKind: "contract" }>,
): Promise<ValidatedOwner | WorkContextValidationResult> {
  if (request.orgId !== ctx.orgId) return rejected("not_found", "Contract not found.");
  const contextResult = await getContractFormContext(
    { db: ctx.db, orgId: ctx.orgId },
    request.ownerId,
    {
      providerId: request.providerId,
      ...(request.facilityId ? { facilityId: request.facilityId } : {}),
    },
    {
      assignmentId: request.assignmentId,
      contextVersion: request.contextVersion,
      sopTemplateId: request.sopTemplateId,
      sopVersion: request.sopVersion,
      stepIdentity: request.stepIdentity,
    },
  );
  if (contextResult.kind === "not_found") {
    return rejected("not_found", "Contract not found.");
  }
  if (contextResult.kind === "not_configured") {
    return rejected("not_ready", "No active Contract SOP assignment is configured.");
  }
  if (contextResult.kind === "stale") {
    return rejected("stale", "The Contract SOP assignment or context changed.");
  }
  if (contextResult.kind === "mismatch") {
    return rejected(
      "mismatch",
      "The provider, location, or requested step does not match the Contract.",
    );
  }

  const context = contextResult.context;
  if (
    context.selectedProviderId !== request.providerId ||
    context.selectedFacilityId !== request.facilityId
  ) {
    return rejected(
      "mismatch",
      "Provider or location does not match the Contract launch selection.",
    );
  }
  if (
    context.assignment.id !== request.assignmentId ||
    context.assignment.contextVersion !== request.contextVersion ||
    context.assignment.sopTemplateId !== request.sopTemplateId ||
    context.assignment.sopVersion !== request.sopVersion
  ) {
    return rejected("stale", "The Contract SOP assignment or version changed.");
  }
  const step = context.steps.find(
    (candidate) =>
      candidate.taskIndex === request.taskIndex &&
      candidate.stepIndex === request.stepIndex &&
      candidate.stepIdentity === request.stepIdentity,
  );
  if (!step) return rejected("mismatch", "The requested step is not in the assigned Contract SOP.");
  if (normalizePortalKey(step.portalKey) !== request.portalKey) {
    return rejected("mismatch", "The requested portal key does not match this Contract SOP step.");
  }

  return {
    caseType: "contract",
    payerId: context.contract.payerId,
    stepIdentity: step.stepIdentity,
    portalKey: step.portalKey,
  };
}

/** Revalidate one complete owner → SOP step → portal/configuration tuple in
 * the authenticated org, then return the exact current approved web maps. */
async function validateWorkContextWithReceiptContext(
  ctx: WorkContextServiceCtx,
  request: WorkContextValidationRequest,
  allowAutoStartedContextVersion: boolean,
): Promise<WorkContextValidationResult> {
  if (request.orgId !== ctx.orgId) return rejected("not_found", "Work context not found.");

  const owner =
    request.ownerKind === "case"
      ? await validateCaseOwner(ctx, request, allowAutoStartedContextVersion)
      : await validateContractOwner(ctx, request);
  if ("kind" in owner) return owner;

  const configuration = await resolveEffectivePortalMaps(
    { db: ctx.db, orgId: ctx.orgId },
    { portalKey: owner.portalKey, mapType: "web" },
  );
  if (configuration.status === "configuration_missing" || !configuration.portalId) {
    return rejected("not_ready", "The exact portal configuration is unavailable.");
  }
  if (
    configuration.portalKey !== request.portalKey ||
    configuration.portalId !== request.portalId
  ) {
    return rejected("stale", "The exact portal configuration changed; refresh before launching.");
  }
  if (
    configuration.ownerScope === null ||
    (configuration.ownerScope === "organization" && configuration.ownerOrgId !== ctx.orgId) ||
    (configuration.ownerScope === "global" && configuration.ownerOrgId !== null)
  ) {
    return rejected("not_found", "The exact portal configuration is unavailable.");
  }
  if (!configuration.requiresExplicitSelection) {
    return rejected("not_ready", "This legacy configuration does not support Work v2.");
  }
  if (configuration.caseType !== owner.caseType || configuration.payerId !== owner.payerId) {
    return rejected("mismatch", "Portal type or payer does not match the owning SOP.");
  }
  if (
    configuration.mappingGeneration !== request.mappingGeneration ||
    configuration.effectiveMappingFingerprint !== request.effectiveMappingFingerprint
  ) {
    return rejected(
      "stale",
      "Portal mappings changed; reload and review the current configuration.",
    );
  }
  if (
    configuration.status !== "ready" ||
    !configuration.isReady ||
    !configuration.effectiveMappingFingerprint ||
    !Number.isInteger(configuration.mappingGeneration) ||
    (configuration.mappingGeneration ?? 0) < 1
  ) {
    return rejected("not_ready", "The selected form configuration has no active web mappings.");
  }
  if (!configuration.formUrl || !isValidHandoffUrl(configuration.formUrl)) {
    return rejected("not_ready", "The selected form configuration has no safe portal URL.");
  }
  if (owner.stepIdentity !== request.stepIdentity || owner.portalKey !== request.portalKey) {
    return rejected("mismatch", "The requested step identity is inconsistent.");
  }

  const effectiveWebMaps = configuration.maps.filter(
    (map) =>
      map.portalKey === request.portalKey && map.mapType === "web" && map.status === "approved",
  );
  if (effectiveWebMaps.length === 0) {
    return rejected("not_ready", "The exact portal configuration has no approved web mappings.");
  }

  const tuple: WorkContextTuple = workContextTuple(request);
  return {
    kind: "ok",
    data: {
      tuple,
      caseType: owner.caseType,
      formUrl: configuration.formUrl,
      requiresExplicitSelection: true,
      mappingGeneration: configuration.mappingGeneration!,
      sharedMappingGeneration: configuration.sharedMappingGeneration,
      effectiveMappingFingerprint: configuration.effectiveMappingFingerprint,
      effectiveWebMaps,
    },
  };
}

/** Strict launch/fill validation. The requested case context version must be
 * current with no post-launch exception. */
export function validateWorkContext(
  ctx: WorkContextServiceCtx,
  request: WorkContextValidationRequest,
): Promise<WorkContextValidationResult> {
  return validateWorkContextWithReceiptContext(ctx, request, false);
}

/** A submission may observe the one context-version bump caused by this exact
 * server-stamped V2 fill receipt auto-starting a not_started case. The caller
 * must first match the persisted receipt against every tuple field and pass
 * only its did_auto_start_case value; database validation repeats this rule
 * under locks before writing. */
export function validateWorkContextForFillReceipt(
  ctx: WorkContextServiceCtx,
  request: WorkContextValidationRequest,
  didAutoStartCase: boolean,
): Promise<WorkContextValidationResult> {
  if (request.ownerKind !== "case") {
    return Promise.resolve(rejected("mismatch", "Only case Work receipts can be submitted here."));
  }
  return validateWorkContextWithReceiptContext(ctx, request, didAutoStartCase);
}
