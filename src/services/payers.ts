// Payer reads + the E6.7 manual-setup write seam.
//
// E4.2 payer governance (closed out 2026-07-18) made this service read-only;
// E6.7 (PM decisions 2026-07-26) reopens ONE sanctioned write path: manual
// payer setup through the create_payer / update_payer SECURITY DEFINER RPCs.
// The service still NEVER issues a direct payers INSERT/UPDATE — the
// 20260718120000 write lockdown stands (no policies, no grants); the RPCs are
// the only door, they validate (name/kind/states), run the duplicate guard,
// stamp provenance, upsert the caller org's org_payer_assignments row
// (create = it's in my network), and write their own audit rows — so this
// service must NOT also writeAudit. Rows are GLOBAL (org_id NULL): authored
// once, template inheritance intact.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg } from "@/lib/audit";
import type { Payer, PayerKind } from "@/types";

export async function listPayers(): Promise<Payer[]> {
  const orgId = requireActiveOrg();
  // Own-org rows plus global-catalog rows (org_id NULL). RLS gates which global
  // rows are returned to the org_payer_assignments-subscribed ones, so this
  // mirrors the portal_field_maps shared-catalog read. The own-org disjunct is
  // vestigial on live data (payers are global-catalog-only since the legacy
  // cutover close-out) but keeps local seed fixtures readable.
  const { data, error } = await supabase
    .from("payers")
    .select("*")
    .or(`org_id.eq.${orgId},org_id.is.null`)
    .order("name");
  if (error) throw error;
  return camelizeRow<Payer[]>(data ?? []);
}

export async function getPayer(id: string): Promise<Payer | null> {
  const orgId = requireActiveOrg();
  // Same visibility as listPayers: an own-org row OR an assigned global row
  // (RLS scopes the global disjunct), so detail surfaces (e.g. the scorecard)
  // can read an assigned catalog payer without any policy change.
  const { data, error } = await supabase
    .from("payers")
    .select("*")
    .eq("id", id)
    .or(`org_id.eq.${orgId},org_id.is.null`)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Payer>(data) : null;
}

/** The typed duplicate rejection (F6.7.3 acceptance): the RPC's in-body guard
 * raised `payer_duplicate` — the message names the colliding payer (and, for
 * a merged match, its successor), so the dialog can branch to the "use this
 * instead" picker. */
export class PayerDuplicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayerDuplicateError";
  }
}

const DUPLICATE_PREFIX = "payer_duplicate";

const PAYER_WRITE_ERRORS: Record<string, string> = {
  payer_name_required: "A payer name is required.",
  payer_kind_invalid: "That is not a valid payer type.",
  payer_states_required: "At least one operating state is required.",
  payer_state_invalid: "Operating states must be two-letter codes.",
  payer_not_editable: "This payer is retired or merged and can no longer be edited.",
};

function mapPayerWriteError(error: { message?: string }): Error {
  const raw = error.message ?? "";
  if (raw.includes(DUPLICATE_PREFIX)) {
    // Keep the RPC's human-readable tail ("a payer named X already exists…" /
    // "X was merged into Y — add that payer instead").
    const detail = raw.slice(raw.indexOf(DUPLICATE_PREFIX) + DUPLICATE_PREFIX.length + 1).trim();
    return new PayerDuplicateError(detail || "A payer with this name already exists.");
  }
  for (const [code, message] of Object.entries(PAYER_WRITE_ERRORS)) {
    if (raw.includes(code)) return new Error(message);
  }
  return error instanceof Error ? error : new Error(raw || "Payer write failed");
}

/** The editable payer facts (create + update share the shape). The legacy
 * resolution_id_* pair is deliberately absent — it deprecates in place
 * (stop-write); provenance/status/merge stay server- or platform-side. */
export interface PayerWriteInput {
  name: string;
  payerKind: PayerKind;
  /** Required, >= 1 — attach eligibility, generation candidates, and the
   * attach-CSV scan all intersect against states[]. */
  states: string[];
  aliases?: string[];
  groupIdLabel?: string | null;
  groupIdExpected?: boolean | null;
  providerIdLabel?: string | null;
  providerIdExpected?: boolean | null;
  delegationNote?: string | null;
}

/** F6.7.1 — create a GLOBAL payer and add it to the active org's network in
 * one transaction (the RPC also reactivates an archived subscription). */
export async function createPayer(input: PayerWriteInput): Promise<Payer> {
  const orgId = requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("create_payer", {
    p_org_id: orgId,
    p_name: input.name,
    p_payer_kind: input.payerKind,
    p_states: input.states,
    p_aliases: input.aliases ?? undefined,
    p_group_id_label: input.groupIdLabel ?? undefined,
    p_group_id_expected: input.groupIdExpected ?? undefined,
    p_provider_id_label: input.providerIdLabel ?? undefined,
    p_provider_id_expected: input.providerIdExpected ?? undefined,
    p_delegation_note: input.delegationNote ?? undefined,
  });
  if (error) throw mapPayerWriteError(error);
  return camelizeRow<Payer>(data as Record<string, unknown>);
}

/** F6.7.1b — edit an ACTIVE global payer's facts (same validation + duplicate
 * guard as create, excluding the row itself; states can never be emptied). */
export async function updatePayer(id: string, input: PayerWriteInput): Promise<Payer> {
  const orgId = requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("update_payer", {
    p_org_id: orgId,
    p_payer_id: id,
    p_name: input.name,
    p_payer_kind: input.payerKind,
    p_states: input.states,
    p_aliases: input.aliases ?? undefined,
    p_group_id_label: input.groupIdLabel ?? undefined,
    p_group_id_expected: input.groupIdExpected ?? undefined,
    p_provider_id_label: input.providerIdLabel ?? undefined,
    p_provider_id_expected: input.providerIdExpected ?? undefined,
    p_delegation_note: input.delegationNote ?? undefined,
  });
  if (error) throw mapPayerWriteError(error);
  return camelizeRow<Payer>(data as Record<string, unknown>);
}
