// Credential cases: list, detail (with joined provider/payer/mso/tasks/touches/
// notes/status history), create, and credentialing-track status changes that
// also append status_history and audit_log.

import { supabase } from "@/integrations/supabase/externalClient";
import { getNotesFor } from "@/services/lookups";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { currentUserId, requireActiveOrg, writeAudit } from "@/lib/audit";
import type { Database, Json } from "@/integrations/supabase/types";
import type {
  CaseDetail,
  Contract,
  CredentialCase,
  Note,
  StatusHistoryEntry,
  Task,
  Touch,
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
  const notes = await getNotesFor("case", id);

  // Enrich status_history with author names for "changed by {name}".
  const rawHistory =
    ((data as Record<string, unknown>).status_history as Array<Record<string, unknown>> | null) ??
    [];
  const changedByIds = Array.from(
    new Set(
      rawHistory.map((h) => h.changed_by as string | null).filter((v): v is string => Boolean(v)),
    ),
  );
  const nameMap = new Map<string, string | null>();
  if (changedByIds.length > 0) {
    const { data: profs, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", changedByIds);
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

  const merged = {
    ...(data as Record<string, unknown>),
    status_history: enrichedHistory,
    notes,
  };
  return camelizeRow<CaseDetail>(merged);
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
    state: input.state,
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

  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("create_case_with_tasks", {
    p_input,
    p_tasks,
  });
  if (error) throw new Error(error.message);
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

  if (updErr) throw updErr;

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
