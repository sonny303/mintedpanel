// Payer reads + the narrow org-side update path, with audit on writes.
//
// E4.2 payer governance: organizations SELECT canonical payer identities from
// the Minted-managed catalog (payer-directory → org_payer_assignments) — they
// never create or rename them, so there is NO createPayer here anymore. Global
// rows (org_id NULL) are readable through RLS (assigned rows only) but any
// org-side update is rejected with a typed domain error BEFORE a write is
// attempted; legacy org-scoped rows render read-only pending the catalog
// cutover (docs/data-model/legacy-payer-cutover.md). Org-varying payer
// configuration lives in org_payer_settings (orgPayerSettings.ts), not on the
// payers row.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import type { Payer } from "@/types";

// The only org-writable payers column. Identity (name), Minted-curated facts
// (avg_decision_days, catalog identity fields), and the resolution-ID config
// (org_payer_settings) are all deliberately absent.
export interface PayerInput {
  isActive?: boolean;
}

/** An org user attempted to update a Minted-managed global catalog row. The
 * payers_update RLS would have silently matched zero rows; this surfaces the
 * governance rule as a clear domain error before any write is attempted. */
export class GlobalPayerUpdateError extends Error {
  constructor() {
    super(
      "This payer is managed by Minted — its identity and catalog facts can't be edited here. " +
        "Organization-specific configuration lives in the payer's organization settings.",
    );
    this.name = "GlobalPayerUpdateError";
  }
}

export async function listPayers(): Promise<Payer[]> {
  const orgId = requireActiveOrg();
  // Own-org rows plus global-catalog rows (org_id NULL). RLS gates which global
  // rows are returned to the org_payer_assignments-subscribed ones, so this
  // mirrors the portal_field_maps shared-catalog read.
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

export async function updatePayer(id: string, patch: Partial<PayerInput>): Promise<Payer> {
  const orgId = requireActiveOrg();
  const before = await getPayer(id);
  if (!before) throw new Error("Payer not found");
  // Fail loudly BEFORE the write: a global row is Minted-managed and the
  // own-org-only RLS would otherwise turn this into a confusing zero-row miss.
  if (before.orgId === null) throw new GlobalPayerUpdateError();
  const payload = snakeizeRow<Record<string, unknown>>(patch);
  const { data, error } = await supabase
    .from("payers")
    .update(payload as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw error;
  const after = camelizeRow<Payer>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "payer",
    entityId: id,
    before,
    after,
    description: `Updated payer ${after.name}`,
  });
  return after;
}
