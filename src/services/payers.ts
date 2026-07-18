// Payer reads — organizations never write payers rows.
//
// E4.2 payer governance (closed out 2026-07-18): organizations SELECT
// canonical payer identities from the Minted-managed catalog (payer-directory
// → org_payer_assignments) — they never create, rename, or update them, so
// this service is read-only: no createPayer, no updatePayer. The DB enforces
// the same posture (migration `20260718120000_payers_org_write_lockdown.sql`
// revoked the org INSERT/UPDATE grants and dropped the write policies), and
// the legacy org-scoped rows the old write path served were removed by the
// 2026-07-17 pre-prod-cut wipe. Org-varying payer configuration lives in
// org_payer_settings (orgPayerSettings.ts), not on the payers row.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg } from "@/lib/audit";
import type { Payer } from "@/types";

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
