// E2.0 TE-10/TE-12 — the two narrow preview-input projections the generation
// preview adds on top of the E1.8 readiness reads (batched style: one query
// per source table, joined in memory by the pure module — never per-row
// round-trips).
//
// PHI posture (TE-12): both reads are explicit narrow column sets — never
// select('*') — and carry keys + status ids only, no demographics.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg } from "@/lib/audit";

/** The pre-E2.1 3-part reality (TE-6): credential_cases has no group_id
 * column yet, so every row comes back with groupId null — a NULL-group case
 * covers ALL candidate rows at its (provider, payer, state). E2.1 widens this
 * projection when it adds the column. */
export interface GenerationCaseRow {
  id: string;
  providerId: string;
  payerId: string;
  state: string;
  groupId: string | null;
  credentialingStatusId: string | null;
}

export async function listGenerationCaseRows(): Promise<GenerationCaseRow[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("credential_cases")
    .select("id, provider_id, payer_id, state, credentialing_status_id")
    .eq("org_id", orgId);
  if (error) throw error;
  const rows = camelizeRow<Array<Omit<GenerationCaseRow, "groupId">>>(data ?? []);
  return rows.map((r) => ({ ...r, groupId: null }));
}

/** Group-contract readiness input (TE-8): the contract keys plus the status
 * id, resolved to a label against the contracting status_configs cache in
 * the composition hook. */
export interface GenerationContractRow {
  groupId: string | null;
  payerId: string | null;
  state: string;
  contractingStatusId: string | null;
}

export async function listGenerationContractRows(): Promise<GenerationContractRow[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("contracts")
    .select("group_id, payer_id, state, contracting_status_id")
    .eq("org_id", orgId);
  if (error) throw error;
  return camelizeRow<GenerationContractRow[]>(data ?? []);
}
