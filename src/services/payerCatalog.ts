// E1.6 — global payer catalog reads + diff review (cross-org, like
// portfolio.ts: no requireActiveOrg — these are platform-level surfaces).
//
// listGlobalPayers goes through the SECURITY DEFINER list_global_payers RPC:
// the P2 RLS disjunction only exposes ASSIGNED global rows to an org, and
// E1.6 must not touch that policy (TE-1), so the browse-everything directory
// gets its own authenticated read path. payer_catalog_changes is readable
// directly under its authenticated shared-queue SELECT policy (TE-3).
//
// reviewCatalogChange runs the review RPC; the diff row itself is the audit
// trail (reviewed_by/reviewed_at stamped server-side) — audit_log is
// org-scoped and catalog curation is platform-level, so no writeAudit here.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { translateDbError } from "@/lib/dbErrors";
import type { Payer, PayerCatalogChange } from "@/types";

export async function listGlobalPayers(): Promise<Payer[]> {
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("list_global_payers");
  if (error) throw error;
  return camelizeRow<Payer[]>(data ?? []);
}

export async function listCatalogChanges(): Promise<PayerCatalogChange[]> {
  const { data, error } = await supabase
    .from("payer_catalog_changes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return camelizeRow<PayerCatalogChange[]>(data ?? []);
}

export async function reviewCatalogChange(changeId: string, accept: boolean): Promise<void> {
  const rpc = supabase.rpc.bind(supabase);
  const { error } = await rpc("review_payer_catalog_change", {
    p_change_id: changeId,
    p_accept: accept,
  });
  if (error) throw translateDbError(error);
}
