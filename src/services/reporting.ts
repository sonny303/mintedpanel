// Reporting Center data (redesign E0.6, TE-4). CROSS-org, like the Portfolio
// source (no requireActiveOrg; RLS scopes to the caller's orgs).
//
// Per-org geography for the state breakdown (F0.6.4). Organizations have no state
// column, so it is derived from the org's parties' split-address state (TD-5):
// prefer the customer-escalation contact (the practice's own address), then the
// owner. The sales rep is deliberately excluded — one shared rep (Zeb) sits on
// every org with the same address and would collapse the whole book into one
// state. Orgs with no derivable state resolve to null → the "Unknown" bucket.
import { supabase } from "@/integrations/supabase/externalClient";

interface AssignmentStateRow {
  org_id: string;
  role_key: string;
  parties: { state: string | null } | null;
}

export async function listPortfolioOrgStates(): Promise<Record<string, string | null>> {
  const { data, error } = await supabase
    .from("party_role_assignments")
    .select("org_id, role_key, parties(state)")
    .eq("scope_type", "org")
    .in("role_key", ["customer_escalation_contact", "owner"]);
  if (error) throw error;
  const customer: Record<string, string> = {};
  const owner: Record<string, string> = {};
  for (const row of (data ?? []) as AssignmentStateRow[]) {
    const st = row.parties?.state?.trim();
    if (!st) continue;
    if (row.role_key === "customer_escalation_contact") customer[row.org_id] = st;
    else if (row.role_key === "owner") owner[row.org_id] = st;
  }
  const out: Record<string, string | null> = {};
  for (const id of new Set([...Object.keys(customer), ...Object.keys(owner)])) {
    out[id] = customer[id] ?? owner[id] ?? null;
  }
  return out;
}
