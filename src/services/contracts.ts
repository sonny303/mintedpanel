// Contracts: list/get/create plus contracting-track status updates that
// append status_history (track 'contracting') and audit_log.
//
// A contract record is keyed (group, payer, state, specialty_key) — migration
// 20261029120000, PM decision D11. `specialty_key` is `all` (one agreement for
// every specialty of the group in that state) or one specialty; it is set when
// the record is created and no update ever changes it. The free-text
// `specialty` column is deprecated in place: still read, never written.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { readCompletePages } from "@/lib/completePages";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import { normalizeStateCode } from "@/lib/stateCode";
import { isMissingContractSpecialtyKeyError, translateDbError } from "@/lib/dbErrors";

// Re-exported for callers that already import it from the contracts service.
export { isMissingContractSpecialtyKeyError };
import { appendStatusHistory } from "@/services/cases";
import type { Contract, ContractSpecialtyKey } from "@/types";

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
  /** The specialty the record covers. Omitted means `all`, both for the
   * upsert match and for a new record. Never changed by an update. */
  specialtyKey?: ContractSpecialtyKey;
  contractingStatusId?: string | null;
  effectiveDate?: string | null;
  tentativeEffectiveDate?: string | null;
  expirationDate?: string | null;
  /** @deprecated Ignored: `contracts.specialty` is no longer written
   * (`specialtyKey` is the grain). Kept so existing callers compile. */
  specialty?: string | null;
  notes?: string | null;
}

/** An update's fields. `specialtyKey` is not among them: a record's specialty
 * is fixed at create, so covering another specialty means another record. */
export type ContractPatch = Partial<Omit<ContractInput, "specialtyKey">>;

const CONTRACT_LIST_COLUMNS =
  "id, group_id, payer_id, state, specialty_key, contracting_status_id, effective_date, tentative_effective_date, expiration_date, specialty, notes, created_at, updated_at";
// The same list for a database that predates migration 20261029120000.
const PRE_SPECIALTY_KEY_LIST_COLUMNS =
  "id, group_id, payer_id, state, contracting_status_id, effective_date, tentative_effective_date, expiration_date, specialty, notes, created_at, updated_at";

const SPECIALTY_KEY_COLUMN = "specialty_key";

// Never sent from caller input: `specialty` is deprecated in place
// (stop-write), and `specialty_key` is set once, by createContract.
const CALLER_UNWRITABLE_COLUMNS = ["specialty", SPECIALTY_KEY_COLUMN] as const;

function writableColumns(input: object): Record<string, unknown> {
  const row = snakeizeRow<Record<string, unknown>>(input);
  for (const column of CALLER_UNWRITABLE_COLUMNS) delete row[column];
  return row;
}

export async function listContracts(filters: ContractFilters = {}): Promise<Contract[]> {
  const orgId = requireActiveOrg();
  const readAll = async (
    columns: typeof CONTRACT_LIST_COLUMNS | typeof PRE_SPECIALTY_KEY_LIST_COLUMNS,
  ) => {
    let query = supabase.from("contracts").select(columns, { count: "exact" }).eq("org_id", orgId);
    if (filters.groupId) query = query.eq("group_id", filters.groupId);
    if (filters.payerId) query = query.eq("payer_id", filters.payerId);
    if (filters.state) query = query.eq("state", filters.state);
    if (filters.statusId) query = query.eq("contracting_status_id", filters.statusId);
    const ordered = query
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });
    return await readCompletePages(async (from, to) => await ordered.range(from, to), {
      label: "Contract list",
    });
  };
  let rows: unknown[];
  try {
    rows = await readAll(CONTRACT_LIST_COLUMNS);
  } catch (error) {
    if (!isMissingContractSpecialtyKeyError(error)) throw error;
    // The app shipped before the operator applied the migration: read the
    // pre-migration columns; every row reads as `all`.
    rows = await readAll(PRE_SPECIALTY_KEY_LIST_COLUMNS);
  }
  return camelizeRow<Contract[]>(rows);
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
    ...writableColumns(input),
    state: normalizeStateCode(input.state),
    specialty_key: input.specialtyKey ?? "all",
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
    ...writableColumns(metadata),
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

export async function updateContract(contractId: string, patch: ContractPatch): Promise<Contract> {
  const orgId = requireActiveOrg();
  const before = await getContract(contractId);
  // writableColumns also drops a stray specialtyKey: an upsert hands its whole
  // input here, and the record's specialty never changes on update.
  const updatePayload: Record<string, unknown> = {
    ...writableColumns(patch),
    updated_at: new Date().toISOString(),
  };
  if (patch.state) {
    updatePayload.state = normalizeStateCode(patch.state);
  }
  const { data, error } = await supabase
    .from("contracts")
    .update(updatePayload as never)
    .eq("id", contractId)
    .eq("org_id", orgId)
    .select(CONTRACT_LIST_COLUMNS)
    .single();
  if (error) throw translateDbError(error);

  if (patch.contractingStatusId && patch.contractingStatusId !== before?.contractingStatusId) {
    await appendStatusHistory({
      track: "contracting",
      contractId,
      fromStatusId: before?.contractingStatusId ?? null,
      toStatusId: patch.contractingStatusId,
    });
  }

  const after = camelizeRow<Contract>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "contract",
    entityId: contractId,
    before,
    after,
    description: `Updated contract`,
  });
  return after;
}

/** Saves the record for (group, payer, state, specialty): updates the one at
 * that 4-part key, or creates it. A missing `specialtyKey` means `all`. Saving
 * a specialty's own record never touches the group's `all` record at the same
 * group/payer/state, and vice versa. */
export async function upsertContract(input: ContractInput): Promise<Contract> {
  const orgId = requireActiveOrg();
  const normalizedState = normalizeStateCode(input.state);
  const specialtyKey: ContractSpecialtyKey = input.specialtyKey ?? "all";
  const { data: existing, error } = await supabase
    .from("contracts")
    .select("id, contracting_status_id")
    .eq("org_id", orgId)
    .eq("group_id", input.groupId)
    .eq("payer_id", input.payerId)
    .eq("state", normalizedState)
    .eq("specialty_key", specialtyKey)
    .maybeSingle();

  if (error) throw translateDbError(error);

  if (existing) {
    return updateContract(existing.id, input);
  }
  return createContract({ ...input, specialtyKey });
}
