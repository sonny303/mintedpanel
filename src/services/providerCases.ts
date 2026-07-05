// Open cases for one provider — the extension popup's case dropdown
// (GET /api/cases?providerId=). "Open" is derived from the org's status
// configuration, never from hardcoded labels: a case is open unless its
// credentialing status has action_bucket 'complete', the config's terminal
// marker (the same bucket the M2 action engine treats as terminal — see
// src/lib/actionState.ts rule 6). A case with no status is unclassified,
// which the app routes to "needs a human" — it is open here too.
//
// Server-only surface (no browser-default ctx) — see portalFieldMaps.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface ProviderCasesServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
}

// One dropdown row: everything the popup renders ("<payer> - <state> -
// <status>") plus submitted_date. Explicit projection, nothing else.
export interface OpenProviderCase {
  id: string;
  payerName: string | null;
  state: string;
  status: string | null;
  submittedDate: string | null;
}

const CASE_COLUMNS = "id, state, submitted_date, credentialing_status_id, payers(name)";

interface CaseRow {
  id: string;
  state: string;
  submitted_date: string | null;
  credentialing_status_id: string | null;
  payers: { name: string | null } | null;
}

// Null = the provider is not in the caller's org (the route's 404) — a
// cross-org provider is indistinguishable from one that doesn't exist.
export async function listOpenProviderCases(
  ctx: ProviderCasesServiceCtx,
  providerId: string,
): Promise<OpenProviderCase[] | null> {
  const { db, orgId } = ctx;

  const { data: provider, error: providerErr } = await db
    .from("providers")
    .select("id")
    .eq("id", providerId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (providerErr) throw providerErr;
  if (!provider) return null;

  const { data: statuses, error: statusErr } = await db
    .from("status_configs")
    .select("id, label, action_bucket")
    .eq("org_id", orgId)
    .eq("track", "credentialing");
  if (statusErr) throw statusErr;
  const statusById = new Map(
    (statuses ?? []).map((s) => [s.id as string, s as { label: string; action_bucket: string }]),
  );

  const { data: cases, error: caseErr } = await db
    .from("credential_cases")
    .select(CASE_COLUMNS)
    .eq("org_id", orgId)
    .eq("provider_id", providerId);
  if (caseErr) throw caseErr;

  const open = ((cases ?? []) as unknown as CaseRow[]).filter((row) => {
    if (row.credentialing_status_id == null) return true;
    const status = statusById.get(row.credentialing_status_id);
    return status?.action_bucket !== "complete";
  });

  const rows = open.map<OpenProviderCase>((row) => ({
    id: row.id,
    payerName: row.payers?.name ?? null,
    state: row.state,
    status: row.credentialing_status_id
      ? (statusById.get(row.credentialing_status_id)?.label ?? null)
      : null,
    submittedDate: row.submitted_date,
  }));

  // Deterministic dropdown order: payer name, then state (nameless payers last).
  rows.sort((a, b) => {
    if (a.payerName !== b.payerName) {
      if (a.payerName == null) return 1;
      if (b.payerName == null) return -1;
      const byPayer = a.payerName.localeCompare(b.payerName);
      if (byPayer !== 0) return byPayer;
    }
    return a.state.localeCompare(b.state);
  });
  return rows;
}
