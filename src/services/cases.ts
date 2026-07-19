// Credential cases: list, detail (with joined provider/payer/mso/tasks/touches/
// notes/status history), create, and credentialing-track status changes that
// also append status_history and audit_log.

import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { currentUserId, currentUserRole, requireActiveOrg, writeAudit } from "@/lib/audit";
import { normalizeStateCode } from "@/lib/stateCode";
import { translateDbError } from "@/lib/dbErrors";
import type { Database, Json } from "@/integrations/supabase/types";
import { isTerminalPipelineState, type PayerPipelineState } from "@/lib/payerPipeline";
import { isCaseStatus, isTerminalCaseStatus, mapLegacyCaseStatus } from "@/lib/caseStatus";
import type { CaseStatus } from "@/lib/caseStatus";
import type { SopResolutionTier } from "@/lib/pickTemplate";
import type {
  CaseDetail,
  Contract,
  CredentialCase,
  DenialReasonCode,
  StatusHistoryEntry,
  Task,
} from "@/types";

type CredentialCaseUpdate = Database["public"]["Tables"]["credential_cases"]["Update"];

export interface CaseFilters {
  providerId?: string;
  payerId?: string;
  state?: string;
  statusId?: string;
  assignedTo?: string;
}

export interface CaseInput {
  providerId: string;
  payerId: string;
  state: string;
  groupId?: string | null;
  facilityId?: string | null;
  specialty?: string | null;
  credentialingStatusId?: string | null;
  msoId?: string | null;
  assignedTo?: string | null;
  submittedDate?: string | null;
  expectedEffectiveDate?: string | null;
  /** E2.1: set only by the generation confirm loop (F2.1.2); manual and
   * legacy creation paths leave it unset — the "run-less" trail. */
  generationRunId?: string | null;
}

// E4.0: payer_reference_id (tracking ID — list column + search + duplicate
// warning) and payer_pipeline_state (the badge rendered on the list/queue,
// distinct from credentialing_status_id) join the list projection. The
// resolution provider-IDs are detail-only (getCase select *), not listed here.
// E6.0: case_status is THE status every list surface renders.
const CASE_LIST_COLUMNS =
  "id, provider_id, payer_id, state, group_id, facility_id, mso_id, credentialing_status_id, case_status, contract_executed_date, assigned_to, submitted_date, approved_date, confirmed_effective_date, expected_effective_date, termination_date, generation_run_id, payer_reference_id, payer_pipeline_state, created_at, updated_at";

export async function getCases(filters: CaseFilters = {}): Promise<CredentialCase[]> {
  const orgId = requireActiveOrg();
  let query = supabase
    .from("credential_cases")
    .select(CASE_LIST_COLUMNS)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (filters.providerId) query = query.eq("provider_id", filters.providerId);
  if (filters.payerId) query = query.eq("payer_id", filters.payerId);
  if (filters.state) query = query.eq("state", filters.state);
  if (filters.statusId) query = query.eq("credentialing_status_id", filters.statusId);
  if (filters.assignedTo) query = query.eq("assigned_to", filters.assignedTo);
  const { data, error } = await query;
  if (error) throw error;
  return camelizeRow<CredentialCase[]>(data ?? []).map(withCaseStatusDefault);
}

// E6.0 — keep CredentialCase.caseStatus honest at the boundary: the column is
// NOT NULL DEFAULT 'not_started' in the DB, but a narrow/mock row may omit it;
// derive from the pipeline mirror (the same deterministic migration rule) so
// no consumer ever sees undefined. Mirrors the payerPipelineState defaulting.
function withCaseStatusDefault<T extends CredentialCase>(c: T): T {
  if (isCaseStatus(c.caseStatus)) return c;
  return {
    ...c,
    caseStatus: mapLegacyCaseStatus(null, (c.payerPipelineState as string | null) ?? null),
  };
}

export async function getCase(id: string): Promise<CaseDetail | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("credential_cases")
    .select(
      `*,
       provider:providers(*),
       payer:payers(*),
       mso:msos(*),
       group:provider_groups(*),
       facility:facilities(*),
       credentialing_status:status_configs(*),
       tasks(*),
       touches(*),
       status_history(*),
       payer_pipeline_history(*),
       case_status_history(*)`,
    )
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const rawTouches =
    ((data as Record<string, unknown>).touches as Array<Record<string, unknown>> | null) ?? [];
  const rawHistory =
    ((data as Record<string, unknown>).status_history as Array<Record<string, unknown>> | null) ??
    [];
  const rawPipeline =
    ((data as Record<string, unknown>).payer_pipeline_history as Array<
      Record<string, unknown>
    > | null) ?? [];
  const rawCaseStatus =
    ((data as Record<string, unknown>).case_status_history as Array<
      Record<string, unknown>
    > | null) ?? [];

  // One profiles fetch covers status-history authors, touchlog note authors,
  // and the case's creation actor (E2.4 F2.4.2 provenance).
  const personIds = Array.from(
    new Set(
      [
        ...rawHistory.map((h) => h.changed_by as string | null),
        ...rawTouches.map((t) => t.coordinator_id as string | null),
        ...rawPipeline.map((p) => p.changed_by as string | null),
        ...rawCaseStatus.map((h) => h.changed_by as string | null),
        (data as Record<string, unknown>).created_by as string | null,
      ].filter((v): v is string => Boolean(v)),
    ),
  );
  const nameMap = new Map<string, string | null>();
  if (personIds.length > 0) {
    const { data: profs, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", personIds);
    if (profErr) throw profErr;
    for (const p of profs ?? []) {
      const name = (p.full_name as string | null) ?? (p.email as string | null) ?? null;
      nameMap.set(p.id as string, name);
    }
  }
  const enrichedHistory = rawHistory.map((h) => ({
    ...h,
    changed_by_name: h.changed_by ? (nameMap.get(h.changed_by as string) ?? null) : null,
  }));

  // Story 1: case internal notes now live in the touchlog as note entries
  // (entry_type = 'note', task_id NULL). Derive the case Notes list from there
  // rather than the dormant `notes` table (its case/task rows were migrated in).
  const notes = rawTouches
    .filter((t) => t.entry_type === "note" && !t.task_id)
    .sort(
      (a, b) =>
        new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime(),
    )
    .map((t) => ({
      id: t.id,
      org_id: t.org_id,
      entity_type: "case",
      entity_id: id,
      content: t.notes,
      author_id: t.coordinator_id,
      author_name: t.coordinator_id ? (nameMap.get(t.coordinator_id as string) ?? null) : null,
      created_at: t.created_at,
    }));

  // Story 8: resolve each batch-call child touchpoint to a "Part of {payer}
  // {channel} call, N cases" summary (payer name + total children in that event).
  const eventIds = Array.from(
    new Set(
      rawTouches
        .map((t) => t.communication_event_id as string | null)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const batchMap = new Map<
    string,
    { payer_name: string; channel_label: string; case_count: number }
  >();
  if (eventIds.length > 0) {
    const { data: events, error: evErr } = await supabase
      .from("communication_event")
      .select("id, channel, payer_id")
      .eq("org_id", orgId)
      .in("id", eventIds);
    if (evErr) throw evErr;
    const evRows = (events ?? []) as Array<{ id: string; channel: string; payer_id: string }>;
    const payerIds = Array.from(new Set(evRows.map((e) => e.payer_id)));
    const payerNames = new Map<string, string>();
    if (payerIds.length > 0) {
      const { data: payers, error: pErr } = await supabase
        .from("payers")
        .select("id, name")
        .in("id", payerIds);
      if (pErr) throw pErr;
      for (const p of payers ?? []) payerNames.set(p.id as string, (p.name as string) ?? "payer");
    }
    // Count children across ALL cases in each event (not just this case's row).
    const counts = new Map<string, number>();
    const { data: childRows, error: cErr } = await supabase
      .from("touches")
      .select("communication_event_id")
      .eq("org_id", orgId)
      .in("communication_event_id", eventIds);
    if (cErr) throw cErr;
    for (const row of (childRows ?? []) as Array<{ communication_event_id: string | null }>) {
      const eid = row.communication_event_id;
      if (eid) counts.set(eid, (counts.get(eid) ?? 0) + 1);
    }
    for (const e of evRows) {
      batchMap.set(e.id, {
        payer_name: payerNames.get(e.payer_id) ?? "payer",
        channel_label: channelWord(e.channel),
        case_count: counts.get(e.id) ?? 1,
      });
    }
  }
  const enrichedTouches = rawTouches.map((t) => ({
    ...t,
    batch_summary: t.communication_event_id
      ? (batchMap.get(t.communication_event_id as string) ?? null)
      : null,
  }));

  // E4.0 F4.0.1 / E6.0 — resolve each history row's reason-code label (global
  // + own-org catalog) so the visible timelines read without a second lookup.
  const reasonIds = Array.from(
    new Set(
      [...rawPipeline, ...rawCaseStatus]
        .map((p) => p.reason_code_id as string | null)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const reasonMap = new Map<string, string | null>();
  if (reasonIds.length > 0) {
    const { data: reasons, error: rErr } = await supabase
      .from("denial_reason_codes")
      .select("id, label")
      .in("id", reasonIds);
    if (rErr) throw rErr;
    for (const r of reasons ?? []) reasonMap.set(r.id as string, (r.label as string) ?? null);
  }
  const enrichedPipeline = rawPipeline.map((p) => ({
    ...p,
    changed_by_name: p.changed_by ? (nameMap.get(p.changed_by as string) ?? null) : null,
    reason_label: p.reason_code_id ? (reasonMap.get(p.reason_code_id as string) ?? null) : null,
  }));

  // E6.0 — the unified-status timeline: attributed (system/user), reason- and
  // author-resolved. The evidencing touch itself rides the same case's touch
  // embed; the panel resolves evidence_touch_id against it locally.
  const enrichedCaseStatus = rawCaseStatus.map((h) => ({
    ...h,
    changed_by_name: h.changed_by ? (nameMap.get(h.changed_by as string) ?? null) : null,
    reason_label: h.reason_code_id ? (reasonMap.get(h.reason_code_id as string) ?? null) : null,
  }));

  const createdBy = (data as Record<string, unknown>).created_by as string | null;
  const rawCaseStatusValue = (data as Record<string, unknown>).case_status as string | null;
  const rawPipelineValue =
    ((data as Record<string, unknown>).payer_pipeline_state as string | null) ?? "not_started";
  const merged = {
    ...(data as Record<string, unknown>),
    // E4.0: keep CredentialCase.payerPipelineState honest at the boundary — the
    // column is NOT NULL DEFAULT 'not_started' in prod, but a narrow/mock row
    // may omit it; default it so no consumer sees undefined (mirrors caseContext).
    payer_pipeline_state: rawPipelineValue,
    // E6.0: same boundary honesty for the canonical status.
    case_status: isCaseStatus(rawCaseStatusValue)
      ? rawCaseStatusValue
      : mapLegacyCaseStatus(null, rawPipelineValue),
    touches: enrichedTouches,
    status_history: enrichedHistory,
    payer_pipeline_history: enrichedPipeline,
    case_status_history: enrichedCaseStatus,
    notes,
    created_by_name: createdBy ? (nameMap.get(createdBy) ?? null) : null,
  };
  return camelizeRow<CaseDetail>(merged);
}

// The channel word used in "Part of {payer} {word} call" (touch_type -> word).
function channelWord(touchType: string): string {
  return touchType === "call" ? "phone" : touchType;
}

// Story 2 / E4.0 TE-3: latest-wins payer reference / submission ID (the case's
// tracking ID) on the case. History is kept in the touchlog (system_event) +
// audit_log, not here — this column just overwrites. The audit row carries BOTH
// the prior and new value (F4.0.2 "every change writes an audit_log row carrying
// the prior and new value").
export async function setPayerReference(caseId: string, value: string | null): Promise<void> {
  const orgId = requireActiveOrg();
  const trimmed = value && value.trim() ? value.trim() : null;

  // Read the prior value + pipeline state first: the audit row carries
  // before -> after, and the terminal admin-gate (F4.0.2/TE-3: "Post-terminal
  // edits are P1-only") reads the same row — no extra round trip.
  const { data: prior, error: readErr } = await supabase
    .from("credential_cases")
    .select("id, payer_reference_id, payer_pipeline_state")
    .eq("id", caseId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!prior) throw new Error("Case not found");
  const priorValue = (prior.payer_reference_id as string | null) ?? null;

  // Once the pipeline is closed (Approved/Denied/OON), only an admin may edit
  // the tracking ID — the same admin-only rule the correction/post-terminal RPC
  // enforces (TE-6). Non-terminal cases stay open to any writer.
  const pipelineState = (prior.payer_pipeline_state as PayerPipelineState | null) ?? "not_started";
  if (isTerminalPipelineState(pipelineState) && currentUserRole() !== "admin") {
    throw new Error("Only an admin can edit the tracking ID on a closed case.");
  }

  const { data, error } = await supabase
    .from("credential_cases")
    .update({ payer_reference_id: trimmed } as CredentialCaseUpdate)
    .eq("id", caseId)
    .eq("org_id", orgId)
    .select("id, payer_reference_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Case not found");
  await writeAudit({
    actionType: "UPDATE",
    entityType: "case",
    entityId: caseId,
    before: { payerReferenceId: priorValue },
    after: { payerReferenceId: trimmed },
    description: "Updated payer reference ID",
  });
}

// E4.0's advance_payer_pipeline RPC remains in the database (additive rule)
// but is DORMANT since E6.0: the payer pipeline is no longer a user-facing
// machine, and its state column is a transition-shim mirror written by
// set_case_status. The browser transition path is gone.

// E6.0 — a typed error the UI maps to an actionable message. `code` is the
// set_case_status RPC's named error; `conflictStatus` is the case's true
// current status on a concurrency conflict (refresh prompt).
export class CaseStatusError extends Error {
  readonly code: string;
  readonly conflictStatus: CaseStatus | null;
  constructor(code: string, message: string, conflictStatus: CaseStatus | null = null) {
    super(message);
    this.name = "CaseStatusError";
    this.code = code;
    this.conflictStatus = conflictStatus;
  }
}

const CASE_STATUS_ERROR_MESSAGES: Record<string, string> = {
  case_status_case_not_found: "Case not found.",
  case_status_not_authorized: "You don't have permission to change the case status.",
  case_status_admin_only: "Only an admin can make this correction.",
  case_status_invalid: "That is not a valid case status.",
  case_status_invalid_transition: "That move isn't allowed from the current status.",
  case_status_correction_needs_note: "A note is required for a correction.",
  case_status_reason_invalid: "That reason isn't available.",
  case_status_denied_needs_reason: "A denial reason is required.",
  case_status_other_needs_context: "Selecting “Other” requires a short context.",
  case_status_not_pursuing_needs_note: "A note is required to mark a case Not Pursuing.",
  case_status_approved_needs_effective_date: "An effective date is required to approve.",
  case_status_approved_needs_provider_id: "The payer-issued provider ID is required to approve.",
  case_status_evidence_invalid: "The evidencing touch doesn't belong to this case.",
};

function mapCaseStatusError(error: { message?: string }): Error {
  const raw = (error.message ?? "").trim();
  if (raw.startsWith("case_status_conflict")) {
    const actual = raw.split(":")[1]?.trim() || null;
    return new CaseStatusError(
      "case_status_conflict",
      "This case was updated by someone else — refresh to continue.",
      actual && isCaseStatus(actual) ? actual : null,
    );
  }
  // Longest match first: case_status_invalid is a prefix of
  // case_status_invalid_transition — a naive first-match picks the wrong code.
  const key = Object.keys(CASE_STATUS_ERROR_MESSAGES)
    .sort((a, b) => b.length - a.length)
    .find((k) => raw.startsWith(k));
  if (key) return new CaseStatusError(key, CASE_STATUS_ERROR_MESSAGES[key]);
  return raw ? new Error(raw) : new Error("Could not update the case status.");
}

export interface SetCaseStatusInput {
  caseId: string;
  toStatus: CaseStatus;
  /** The status the client believed the case was in — optimistic concurrency.
   * The Add-touch bump passes null (an auto trigger may have just advanced
   * the case); the header menu always passes the rendered status. */
  expectedStatus?: CaseStatus | null;
  reasonCodeId?: string | null;
  /** Correction note, the Not Pursuing note, or the Denied-"Other" context. */
  note?: string | null;
  isCorrection?: boolean;
  /** Required by the RPC when toStatus is 'approved'. */
  effectiveDate?: string | null;
  /** Required by the RPC when toStatus is 'approved' — the payer-issued ID,
   * labeled with the payer's own term client-side. */
  individualProviderId?: string | null;
  groupProviderId?: string | null;
  contractExecutedDate?: string | null;
  /** F6.0.3 — the touch evidencing this transition (must be on this case). */
  evidenceTouchId?: string | null;
}

// E6.0 — the single atomic transition entry point for the unified status:
// state change + legacy-mirror lockstep + append-only case_status_history +
// terminal-fact writes/clears + audit, all-or-nothing. Never a bare UPDATE —
// that would bypass the edge rules, evidence requirements, admin gate, and
// history.
export async function setCaseStatus(input: SetCaseStatusInput): Promise<CredentialCase> {
  requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
  const { data, error } = await rpc("set_case_status", {
    p_case_id: input.caseId,
    p_to_status: input.toStatus,
    p_expected_status: input.expectedStatus ?? null,
    p_reason_code_id: input.reasonCodeId ?? null,
    p_note: input.note ?? null,
    p_is_correction: input.isCorrection ?? false,
    p_effective_date: input.effectiveDate ?? null,
    p_individual_provider_id: input.individualProviderId ?? null,
    p_group_provider_id: input.groupProviderId ?? null,
    p_contract_executed_date: input.contractExecutedDate ?? null,
    p_evidence_touch_id: input.evidenceTouchId ?? null,
  });
  if (error) throw mapCaseStatusError(error);
  if (!data) throw new Error("set_case_status returned no data");
  return withCaseStatusDefault(camelizeRow<CredentialCase>(data));
}

// E4.0 TE-4 — the active denial/return reason vocabulary: global defaults +
// this org's added codes (the shared-catalog read pattern). Read-only here;
// E4.2 owns the management CRUD.
export async function listDenialReasonCodes(): Promise<DenialReasonCode[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("denial_reason_codes")
    .select("id, org_id, code, label, active, created_at")
    .or(`org_id.is.null,org_id.eq.${orgId}`)
    .eq("active", true)
    .order("label", { ascending: true });
  if (error) throw error;
  return camelizeRow<DenialReasonCode[]>(data ?? []);
}

// E6.2 F6.2.3 — the board drill-down's denial history: one org-scoped narrow
// read of the E6.0 unified ledger's DENIED entries (case id, reason, date),
// joined to reason labels client-side via the cached listDenialReasonCodes.
// Latest-first so "the prior denial beneath a reapply cycle" reads naturally.
export interface CaseDenialEntry {
  caseId: string;
  reasonCodeId: string | null;
  note: string | null;
  changedAt: string;
}

export async function listCaseDenialEntries(): Promise<CaseDenialEntry[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("case_status_history")
    .select("case_id, reason_code_id, note, changed_at")
    .eq("org_id", orgId)
    .eq("to_status", "denied")
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    caseId: (row as { case_id: string }).case_id,
    reasonCodeId: (row as { reason_code_id: string | null }).reason_code_id,
    note: (row as { note: string | null }).note,
    changedAt: (row as { changed_at: string }).changed_at,
  }));
}

export interface AppendStatusHistoryInput {
  track: "credentialing" | "contracting";
  caseId?: string | null;
  contractId?: string | null;
  fromStatusId: string | null;
  toStatusId: string;
  metadata?: Record<string, unknown>;
}

export async function appendStatusHistory(input: AppendStatusHistoryInput): Promise<void> {
  const orgId = requireActiveOrg();
  const { error } = await supabase.from("status_history").insert({
    org_id: orgId,
    case_id: input.caseId ?? null,
    contract_id: input.contractId ?? null,
    track: input.track,
    from_status_id: input.fromStatusId,
    to_status_id: input.toStatusId,
    metadata: (input.metadata ?? {}) as Json,
    changed_by: currentUserId(),
  });
  if (error) throw error;
}

export interface CaseTaskPayload {
  title: string;
  description: string | null;
  sopContent: unknown;
  sortOrder: number;
  dueDate: string | null;
  /** E2.2 stamp transport (threaded here per E2.1 TE-3; E2.2 populates them):
   * the SOP version the task's content was resolved from. Both or neither —
   * the tasks_sop_stamp_both_or_neither CHECK enforces the pairing. */
  sopTemplateId?: string | null;
  sopVersion?: number | null;
  /** E4.2 TE-12 — per-task execution type, stamped onto the generated task.
   * NULL/absent ⇒ manual. */
  executionType?: string | null;
  /** E4.2 SOP hardening — the deterministic resolution tier the SOP was
   * selected at (organization | global_payer | generic_fallback). Stamped so a
   * manual case (no generation run) stays tier-reportable without reconstructing
   * it from mutable template ownership. NULL/absent ⇒ legacy / non-SOP task. */
  sopResolutionTier?: SopResolutionTier | null;
}

export async function createCase(
  input: CaseInput,
  tasks: CaseTaskPayload[] = [],
): Promise<CredentialCase> {
  const orgId = requireActiveOrg();
  const p_input: Record<string, unknown> = {
    org_id: orgId,
    provider_id: input.providerId,
    payer_id: input.payerId,
    // E0.10: credential_cases.state is DB-checked to ^[A-Z]{2}$.
    state: normalizeStateCode(input.state),
    group_id: input.groupId ?? null,
    facility_id: input.facilityId ?? null,
    specialty: input.specialty ?? null,
    mso_id: input.msoId ?? null,
    assigned_to: input.assignedTo ?? null,
    submitted_date: input.submittedDate ?? null,
    expected_effective_date: input.expectedEffectiveDate ?? null,
    generation_run_id: input.generationRunId ?? null,
  };
  if (input.credentialingStatusId) {
    p_input.credentialing_status_id = input.credentialingStatusId;
  }
  const p_tasks = tasks.map((t) => ({
    title: t.title,
    description: t.description,
    sop_content: t.sopContent,
    sort_order: t.sortOrder,
    due_date: t.dueDate,
    sop_template_id: t.sopTemplateId ?? null,
    sop_version: t.sopVersion ?? null,
    execution_type: t.executionType ?? null,
    sop_resolution_tier: t.sopResolutionTier ?? null,
  }));

  // Bound reference: extracting the method bare loses `this` and throws
  // before the request is ever sent.
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
  const { data, error } = await rpc("create_case_with_tasks", {
    p_input,
    p_tasks,
  });
  if (error) {
    const translated = translateDbError(error);
    throw translated instanceof Error ? translated : new Error(error.message);
  }
  if (!data) throw new Error("create_case_with_tasks returned no data");
  return camelizeRow<CredentialCase>(data);
}

// E2.1 F2.1.3 (TE-5) — reapplication appends the restamped task set to the
// EXISTING case (never a second case at the key; the reopen itself is the
// updateCaseStatus path, which already writes status_history + audit). Task
// inserts follow the create_case_with_tasks RPC's shape; E2.2 owns
// resolution/stamping, so the optional stamp fields just thread through.
export async function appendCaseTasks(caseId: string, tasks: CaseTaskPayload[]): Promise<void> {
  if (tasks.length === 0) return;
  const orgId = requireActiveOrg();

  const { data: caseRow, error: readErr } = await supabase
    .from("credential_cases")
    .select("id, provider_id")
    .eq("id", caseId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!caseRow) throw new Error("Case not found");

  const { data: inserted, error } = await supabase
    .from("tasks")
    .insert(
      tasks.map((t) => ({
        org_id: orgId,
        case_id: caseId,
        provider_id: caseRow.provider_id,
        title: t.title,
        description: t.description,
        sop_content: t.sopContent as Json,
        status: "not_started",
        sort_order: t.sortOrder,
        due_date: t.dueDate,
        is_auto_generated: true,
        sop_template_id: t.sopTemplateId ?? null,
        sop_version: t.sopVersion ?? null,
        execution_type: t.executionType ?? null,
        sop_resolution_tier: t.sopResolutionTier ?? null,
      })),
    )
    .select("id");
  if (error) throw translateDbError(error);

  await writeAudit({
    actionType: "CREATE",
    entityType: "task",
    entityId: caseId,
    after: {
      caseId,
      count: tasks.length,
      taskIds: (inserted ?? []).map((r) => r.id),
    },
    description: `Regenerated ${tasks.length} SOP task${tasks.length === 1 ? "" : "s"} on reapplication`,
  });
}

// E6.0 — the legacy updateCaseStatus writer (bare credentialing_status_id
// UPDATE + status_history append) was DELETED with the internal machine's UI:
// every status change now goes through set_case_status, which keeps the
// legacy mirror in lockstep atomically. appendStatusHistory stays for the
// contracting-track writer in services/contracts.ts (a dormant machine whose
// UI affordances E6.0 also retired).

export async function getContractFor(
  groupId: string,
  payerId: string,
  state: string,
): Promise<Contract | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("org_id", orgId)
    .eq("group_id", groupId)
    .eq("payer_id", payerId)
    .eq("state", state)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Contract>(data) : null;
}
