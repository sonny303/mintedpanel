// Credential cases: list, detail (with joined provider/payer/mso/tasks/touches/
// notes/status history), create, and credentialing-track status changes that
// also append status_history and audit_log.

import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { currentUserId, requireActiveOrg, writeAudit } from "@/lib/audit";
import { normalizeStateCode } from "@/lib/stateCode";
import { translateDbError } from "@/lib/dbErrors";
import type { Database, Json } from "@/integrations/supabase/types";
import type { CaseDetail, Contract, CredentialCase, StatusHistoryEntry, Task } from "@/types";

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
}

const CASE_LIST_COLUMNS =
  "id, provider_id, payer_id, state, group_id, facility_id, mso_id, credentialing_status_id, assigned_to, submitted_date, approved_date, confirmed_effective_date, expected_effective_date, termination_date, created_at, updated_at";

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
  return camelizeRow<CredentialCase[]>(data ?? []);
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
       status_history(*)`,
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

  // One profiles fetch covers status-history authors and touchlog note authors.
  const personIds = Array.from(
    new Set(
      [
        ...rawHistory.map((h) => h.changed_by as string | null),
        ...rawTouches.map((t) => t.coordinator_id as string | null),
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

  const merged = {
    ...(data as Record<string, unknown>),
    touches: enrichedTouches,
    status_history: enrichedHistory,
    notes,
  };
  return camelizeRow<CaseDetail>(merged);
}

// The channel word used in "Part of {payer} {word} call" (touch_type -> word).
function channelWord(touchType: string): string {
  return touchType === "call" ? "phone" : touchType;
}

// Story 2: latest-wins payer reference / submission ID on the case. History is
// kept in the touchlog (system_event), not here — this column just overwrites.
export async function setPayerReference(caseId: string, value: string | null): Promise<void> {
  const orgId = requireActiveOrg();
  const trimmed = value && value.trim() ? value.trim() : null;
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
    after: { payerReferenceId: trimmed },
    description: "Updated payer reference ID",
  });
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

export async function updateCaseStatus(
  caseId: string,
  statusId: string,
  metadata: Record<string, unknown> = {},
): Promise<CredentialCase> {
  const orgId = requireActiveOrg();

  const { data: existing, error: readErr } = await supabase
    .from("credential_cases")
    .select("*")
    .eq("id", caseId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!existing) throw new Error("Case not found");
  const fromStatusId = (existing.credentialing_status_id as string | null) ?? null;

  const patch: Record<string, unknown> = {
    credentialing_status_id: statusId,
    ...snakeizeRow<Record<string, unknown>>(metadata),
  };

  const { data: updated, error: updErr } = await supabase
    .from("credential_cases")
    .update(patch as unknown as CredentialCaseUpdate)
    .eq("id", caseId)
    .eq("org_id", orgId)
    .select("*")
    .single();

  if (updErr) throw translateDbError(updErr);

  await appendStatusHistory({
    track: "credentialing",
    caseId,
    fromStatusId,
    toStatusId: statusId,
    metadata,
  });

  await writeAudit({
    actionType: "STATUS_CHANGE",
    entityType: "credential_case",
    entityId: caseId,
    before: { credentialingStatusId: fromStatusId },
    after: { credentialingStatusId: statusId, ...metadata },
    description: `Credentialing status changed`,
  });

  return camelizeRow<CredentialCase>(updated);
}

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
