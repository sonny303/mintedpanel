// E1.6 — global payer catalog read (cross-org, like portfolio.ts: no
// requireActiveOrg — the directory is a platform-level browse surface).
//
// listGlobalPayers goes through the SECURITY DEFINER list_global_payers RPC:
// the P2 RLS disjunction only exposes ASSIGNED global rows to an org, and
// E1.6 must not touch that policy (TE-1), so the browse-everything directory
// gets its own authenticated read path.
//
// E4.2 payer governance: the catalog diff review (payer_catalog_changes reads +
// the review_payer_catalog_change RPC) is PLATFORM tooling only — authenticated
// SELECT/EXECUTE were revoked (migration 20260716191000) and the in-app review
// surface was removed. Minted reviews sync diffs via service-role/MCP tooling.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import type { Payer } from "@/types";

export async function listGlobalPayers(): Promise<Payer[]> {
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("list_global_payers");
  if (error) throw error;
  return camelizeRow<Payer[]>(data ?? []);
}
