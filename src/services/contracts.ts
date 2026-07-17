// Contracts: list/get/create plus contracting-track status updates that
// append status_history (track 'contracting') and audit_log.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import { normalizeStateCode } from "@/lib/stateCode";
import { translateDbError } from "@/lib/dbErrors";
import { appendStatusHistory } from "@/services/cases";
import type { Contract } from "@/types";

export interface ContractFilters {
  groupId?: string;
  payerId?: string;
  state?: string;
  statusId?: string;
}

export interface ContractInput {
  groupId: string;
  payerId: string;
  state: string;
  contractingStatusId?: string | null;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  notes?: string | null;
}

const CONTRACT_LIST_COLUMNS =
  "id, group_id, payer_id, state, contracting_status_id, effective_date, expiration_date, notes, created_at, updated_at";

export async function listContracts(filters: ContractFilters = {}): Promise<Contract[]> {
  const orgId = requireActiveOrg();
  let query = supabase.from("contracts").select(CONTRACT_LIST_COLUMNS).eq("org_id", orgId);
  if (filters.groupId) query = query.eq("group_id", filters.groupId);
  if (filters.payerId) query = query.eq("payer_id", filters.payerId);
  if (filters.state) query = query.eq("state", filters.state);
  if (filters.statusId) query = query.eq("contracting_status_id", filters.statusId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return camelizeRow<Contract[]>(data ?? []);
}

export async function getContract(id: string): Promise<Contract | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Contract>(data) : null;
}

export async function createContract(input: ContractInput): Promise<Contract> {
  const orgId = requireActiveOrg();
  // E0.10: the DB enforces ^[A-Z]{2}$ on contracts.state — normalize casing at
  // the boundary; constraint violations surface as domain messages.
  const payload = {
    ...snakeizeRow<Record<string, unknown>>(input),
    state: normalizeStateCode(input.state),
    org_id: orgId,
  };
  const { data, error } = await supabase
    .from("contracts")
    .insert(payload as never)
    .select("*")
    .single();
  if (error) throw translateDbError(error);
  const created = camelizeRow<Contract>(data);
  if (created.contractingStatusId) {
    await appendStatusHistory({
      track: "contracting",
      contractId: created.id,
      fromStatusId: null,
      toStatusId: created.contractingStatusId,
    });
  }
  await writeAudit({
    actionType: "CREATE",
    entityType: "contract",
    entityId: created.id,
    after: created,
    description: `Created contract`,
  });
  return created;
}

export async function updateContractStatus(
  contractId: string,
  statusId: string,
  metadata: Record<string, unknown> = {},
): Promise<Contract> {
  const orgId = requireActiveOrg();
  const before = await getContract(contractId);
  const fromStatusId = before?.contractingStatusId ?? null;

  const patch: Record<string, unknown> = {
    contracting_status_id: statusId,
    ...snakeizeRow<Record<string, unknown>>(metadata),
  };
  const { data, error } = await supabase
    .from("contracts")
    .update(patch as never)
    .eq("id", contractId)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw translateDbError(error);

  await appendStatusHistory({
    track: "contracting",
    contractId,
    fromStatusId,
    toStatusId: statusId,
    metadata,
  });

  await writeAudit({
    actionType: "STATUS_CHANGE",
    entityType: "contract",
    entityId: contractId,
    before: { contractingStatusId: fromStatusId },
    after: { contractingStatusId: statusId, ...metadata },
    description: `Contract status changed`,
  });

  return camelizeRow<Contract>(data);
}
