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

/** The 4-part key set (TE-5/TE-6): group_id rides the projection since E2.1
 * widened the case key. A NULL-group row (legacy) still covers ALL candidate
 * rows at its (provider, payer, state); a group-stamped row covers only its
 * exact 4-part key — the two-branch match in buildGenerationPreview. */
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
    .select("id, provider_id, payer_id, state, group_id, credentialing_status_id")
    .eq("org_id", orgId);
  if (error) throw error;
  const rows = camelizeRow<GenerationCaseRow[]>(data ?? []);
  // Normalize a missing key to an explicit null — the two-branch match keys
  // on `groupId === null` and must never see undefined.
  return rows.map((r) => ({ ...r, groupId: r.groupId ?? null }));
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
