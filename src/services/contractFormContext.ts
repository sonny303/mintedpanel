// Authorized read model for one Contract owner's immutable SOP context. It
// joins the org-scoped Contract to its current MINT-49 assignment/version and
// produces exact, version-scoped online-form step references. This is context
// only: portal handoff remains disabled until the Extension's later gate.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ContractSopAssignmentDetails } from "@/services/contractSopAssignments";
import { getContractSopAssignment } from "@/services/contractSopAssignments";
import { resolveEffectivePortalMaps } from "@/services/portalFieldMaps";
import { buildContractSopLaunchTuple, type ContractSopLaunchTuple } from "@/lib/contractSopLaunch";

export interface ContractFormContextServiceCtx {
  db: SupabaseClient<Database>;
  /** Derived from authenticated membership, never accepted from the request. */
  orgId: string;
}

export interface ExpectedContractSopContext {
  assignmentId?: string;
  contextVersion?: number;
  sopTemplateId?: string;
  sopVersion?: number;
  stepIdentity?: string;
}

export interface ContractOwner {
  id: string;
  groupId: string;
  payerId: string;
  state: string;
  groupName: string;
}

export interface ContractSopStepReference {
  stepIdentity: string;
  taskIndex: number;
  stepIndex: number;
  taskTitle: string;
  stepLabel: string;
  portalKey: string;
  launch: ContractSopLaunchTuple;
}

export interface ContractOwnerContext {
  contract: ContractOwner;
  assignment: ContractSopAssignmentDetails["assignment"];
  sop: Pick<
    ContractSopAssignmentDetails["version"],
    "templateId" | "version" | "name" | "caseType"
  >;
  steps: Array<{
    stepIdentity: string;
    taskIndex: number;
    stepIndex: number;
    taskTitle: string;
    stepLabel: string;
    stepType: string | null;
    portalKey: string;
  }>;
  hasRecordedActivity: boolean;
}

export type ContractOwnerContextResult =
  | { kind: "ok"; context: ContractOwnerContext }
  | { kind: "not_found" }
  | { kind: "not_configured"; reason: string }
  | { kind: "mismatch"; reason: string }
  | { kind: "stale"; reason: string };

export type ContractSelectionResult =
  | { kind: "ok"; providerId: string | null; facilityId: string | null }
  | { kind: "mismatch"; reason: string };

export interface ContractFormContext {
  contract: ContractOwner;
  assignment: ContractOwnerContext["assignment"];
  sop: ContractOwnerContext["sop"];
  selectedProviderId: string | null;
  selectedFacilityId: string | null;
  steps: ContractSopStepReference[];
}

export type ContractFormContextResult =
  | { kind: "ok"; context: ContractFormContext }
  | Exclude<ContractOwnerContextResult, { kind: "ok" }>
  | Exclude<ContractSelectionResult, { kind: "ok" }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isCurrentDate(start: string | null, end: string | null, today: string): boolean {
  return (start == null || start <= today) && (end == null || end >= today);
}

function objectRow(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function taskSteps(raw: unknown): ContractOwnerContext["steps"] {
  if (!Array.isArray(raw)) return [];
  const steps: ContractOwnerContext["steps"] = [];
  raw.forEach((taskValue, taskIndex) => {
    const task = objectRow(taskValue);
    if (!task || !Array.isArray(task.steps)) return;
    task.steps.forEach((stepValue, stepIndex) => {
      const step = objectRow(stepValue);
      if (!step) return;
      const stepType = typeof step.stepType === "string" ? step.stepType : null;
      const portalKey = typeof step.portalKey === "string" ? step.portalKey.trim() : null;
      // Steps without a portal selector remain SOP instructions, not fill
      // launch targets. Each accepted ref includes its exact immutable source.
      if (stepType !== "online_form" || !portalKey) return;
      const taskTitle = typeof task.title === "string" ? task.title : `Task ${taskIndex + 1}`;
      const stepLabel = typeof step.label === "string" ? step.label : `Step ${stepIndex + 1}`;
      steps.push({
        stepIdentity: "",
        taskIndex,
        stepIndex,
        taskTitle,
        stepLabel,
        stepType,
        portalKey,
      });
    });
  });
  return steps;
}

function expectedContextMismatch(
  expected: ExpectedContractSopContext,
  details: ContractSopAssignmentDetails,
  steps: ContractOwnerContext["steps"],
): "stale" | "mismatch" | null {
  if (
    (expected.assignmentId != null && expected.assignmentId !== details.assignment.id) ||
    (expected.contextVersion != null &&
      expected.contextVersion !== details.assignment.contextVersion) ||
    (expected.sopTemplateId != null &&
      expected.sopTemplateId !== details.assignment.sopTemplateId) ||
    (expected.sopVersion != null && expected.sopVersion !== details.assignment.sopVersion)
  ) {
    return "stale";
  }
  if (
    expected.stepIdentity != null &&
    !steps.some((step) => step.stepIdentity === expected.stepIdentity)
  ) {
    return "mismatch";
  }
  return null;
}

/** Reads only rows explicitly related to one authenticated org Contract. */
export async function loadContractOwnerContext(
  ctx: ContractFormContextServiceCtx,
  contractId: string,
  expected: ExpectedContractSopContext = {},
): Promise<ContractOwnerContextResult> {
  if (!UUID_RE.test(contractId)) return { kind: "not_found" };
  const { data: row, error } = await ctx.db
    .from("contracts")
    .select("id, group_id, payer_id, state")
    .eq("id", contractId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return { kind: "not_found" };
  const contractRow = row as {
    id: string;
    group_id: string | null;
    payer_id: string | null;
    state: string;
  };
  if (!contractRow.group_id || !contractRow.payer_id || !contractRow.state?.trim()) {
    return { kind: "not_configured", reason: "Contract group, payer, and state are required." };
  }

  const [groupResult, payerResult] = await Promise.all([
    ctx.db
      .from("provider_groups")
      .select("id, name")
      .eq("id", contractRow.group_id)
      .eq("org_id", ctx.orgId)
      .maybeSingle(),
    ctx.db
      .from("payers")
      .select("id")
      .eq("id", contractRow.payer_id)
      .or(`org_id.is.null,org_id.eq.${ctx.orgId}`)
      .maybeSingle(),
  ]);
  if (groupResult.error) throw groupResult.error;
  if (payerResult.error) throw payerResult.error;
  if (!groupResult.data || !payerResult.data) {
    return { kind: "mismatch", reason: "Contract group or payer is outside this organization." };
  }

  const details = await getContractSopAssignment(ctx, contractId);
  if (!details) {
    return { kind: "not_configured", reason: "No SOP version is assigned to this Contract." };
  }
  if (details.version.caseType !== "contract") {
    return { kind: "mismatch", reason: "The assigned SOP is not a Contract SOP." };
  }
  const steps = taskSteps(details.version.taskDefinitions);
  steps.forEach((step) => {
    step.stepIdentity = [
      contractRow.id,
      ctx.orgId,
      details.assignment.id,
      details.assignment.contextVersion,
      details.assignment.sopTemplateId,
      details.assignment.sopVersion,
      step.taskIndex,
      step.stepIndex,
    ].join(":");
  });
  const expectedMismatch = expectedContextMismatch(expected, details, steps);
  if (expectedMismatch === "stale") {
    return { kind: "stale", reason: "The Contract SOP assignment or version has changed." };
  }
  if (expectedMismatch === "mismatch") {
    return { kind: "mismatch", reason: "The requested step is not in the assigned SOP version." };
  }

  return {
    kind: "ok",
    context: {
      contract: {
        id: contractRow.id,
        groupId: contractRow.group_id,
        payerId: contractRow.payer_id,
        state: contractRow.state,
        groupName: String((groupResult.data as { name: string | null }).name ?? ""),
      },
      assignment: details.assignment,
      sop: {
        templateId: details.version.templateId,
        version: details.version.version,
        name: details.version.name,
        caseType: details.version.caseType,
      },
      steps,
      hasRecordedActivity: details.hasRecordedActivity,
    },
  };
}

/** A chosen provider must currently belong to the Contract's exact group. */
export async function validateContractOwnerSelection(
  ctx: ContractFormContextServiceCtx,
  owner: ContractOwnerContext,
  providerId?: string,
  facilityId?: string,
): Promise<ContractSelectionResult> {
  if (!providerId) {
    return facilityId
      ? { kind: "mismatch", reason: "A facility cannot be selected without a provider." }
      : { kind: "ok", providerId: null, facilityId: null };
  }
  if (!UUID_RE.test(providerId))
    return { kind: "mismatch", reason: "Provider selection is invalid." };
  const { data: provider, error: providerError } = await ctx.db
    .from("providers")
    .select("id, status")
    .eq("id", providerId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (providerError) throw providerError;
  if (!provider || (provider as { status: string | null }).status === "terminated") {
    return { kind: "mismatch", reason: "Provider is not available in this organization." };
  }

  const { data: membership, error: membershipError } = await ctx.db
    .from("provider_group_assignments")
    .select("provider_id, start_date, end_date")
    .eq("org_id", ctx.orgId)
    .eq("group_id", owner.contract.groupId)
    .eq("provider_id", providerId)
    .maybeSingle();
  if (membershipError) throw membershipError;
  const today = new Date().toISOString().slice(0, 10);
  if (
    !membership ||
    !isCurrentDate(
      (membership as { start_date: string | null }).start_date,
      (membership as { end_date: string | null }).end_date,
      today,
    )
  ) {
    return { kind: "mismatch", reason: "Provider is not an active member of the Contract group." };
  }

  if (!facilityId) return { kind: "ok", providerId, facilityId: null };
  if (!UUID_RE.test(facilityId))
    return { kind: "mismatch", reason: "Facility selection is invalid." };
  const { data: link, error: linkError } = await ctx.db
    .from("provider_facility_assignments")
    .select("facility_id, start_date")
    .eq("org_id", ctx.orgId)
    .eq("provider_id", providerId)
    .eq("facility_id", facilityId)
    .maybeSingle();
  if (linkError) throw linkError;
  const linkStart = (link as { start_date: string | null } | null)?.start_date ?? null;
  if (!link || !isCurrentDate(linkStart, null, today)) {
    return { kind: "mismatch", reason: "Facility is not currently assigned to this provider." };
  }
  const { data: facility, error: facilityError } = await ctx.db
    .from("facilities")
    .select("id, group_id, state")
    .eq("id", facilityId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (facilityError) throw facilityError;
  if (
    !facility ||
    (facility as { group_id: string | null }).group_id !== owner.contract.groupId ||
    (facility as { state: string | null }).state !== owner.contract.state
  ) {
    return {
      kind: "mismatch",
      reason: "Facility group or state does not match the Contract context.",
    };
  }
  return { kind: "ok", providerId, facilityId };
}

export async function getContractFormContext(
  ctx: ContractFormContextServiceCtx,
  contractId: string,
  selection: { providerId?: string; facilityId?: string } = {},
  expected: ExpectedContractSopContext = {},
): Promise<ContractFormContextResult> {
  const ownerResult = await loadContractOwnerContext(ctx, contractId, expected);
  if (ownerResult.kind !== "ok") return ownerResult;
  const selected = await validateContractOwnerSelection(
    ctx,
    ownerResult.context,
    selection.providerId,
    selection.facilityId,
  );
  if (selected.kind !== "ok") return selected;

  // Resolve exact current maps through MINT-52. The response carries only the
  // launch tuple/readiness, never the map rows or selector values.
  const mapCache = new Map<string, ReturnType<typeof resolveEffectivePortalMaps>>();
  const steps = await Promise.all(
    ownerResult.context.steps.map(async (step) => {
      let resolutions = mapCache.get(step.portalKey);
      if (!resolutions) {
        resolutions = resolveEffectivePortalMaps(
          { db: ctx.db, orgId: ctx.orgId },
          { portalKey: step.portalKey!, mapType: "web" },
        );
        mapCache.set(step.portalKey, resolutions);
      }
      const configuration = await resolutions;
      return {
        stepIdentity: step.stepIdentity,
        taskIndex: step.taskIndex,
        stepIndex: step.stepIndex,
        taskTitle: step.taskTitle,
        stepLabel: step.stepLabel,
        portalKey: step.portalKey,
        launch: buildContractSopLaunchTuple({
          contractId: ownerResult.context.contract.id,
          orgId: ctx.orgId,
          payerId: ownerResult.context.contract.payerId,
          assignment: ownerResult.context.assignment,
          taskIndex: step.taskIndex,
          stepIndex: step.stepIndex,
          step: { stepType: "online_form", portalKey: step.portalKey },
          providerId: selected.providerId,
          facilityId: selected.facilityId,
          configuration: configuration ?? null,
        }),
      } satisfies ContractSopStepReference;
    }),
  );
  return {
    kind: "ok",
    context: {
      contract: ownerResult.context.contract,
      assignment: ownerResult.context.assignment,
      sop: ownerResult.context.sop,
      selectedProviderId: selected.providerId,
      selectedFacilityId: selected.facilityId,
      steps,
    },
  };
}
