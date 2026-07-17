// E4.4 F4.4.2 — fill-only SSN release (server-only surface, service-role ctx).
// The extension's fill flow requests the full SSN for a provider it is actively
// filling; the value goes into the portal form field and is never rendered in
// the extension UI (masked display only). This service is the panel half of the
// contract: the extension consumes it later (no extension-repo code in this PR).
//
// Two walls, both mandatory:
//   1. Here (the /api layer resolves the caller's org from the JWT): the case
//      must exist, belong to that org, and be THIS provider's case — an active
//      fill context. A cross-org / mismatched / missing case is indistinguishable
//      from "not found" (null -> the route's 404), mirroring caseContext.ts.
//   2. The release_ssn_for_fill RPC re-validates the same fact and is the only
//      thing that can decrypt (service_role-only EXECUTE). Decryption never
//      happens outside the definer boundary.
// The READ audit row (actor, provider, case) is written by the /api handler with
// the JWT-verified actor — the service-role RPC has no auth.uid() (the
// profile/context-route posture).
//
// Server-only (no browser-default ctx), like caseContext.ts / portalFieldMaps.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface SsnReleaseServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
}

export type SsnReleaseResult =
  | { kind: "released"; ssn: string; ssnLast4: string }
  | { kind: "rejected"; status: number; message: string };

export async function releaseSsnForFill(
  ctx: SsnReleaseServiceCtx,
  providerId: string,
  caseId: string,
): Promise<SsnReleaseResult> {
  const { db, orgId } = ctx;

  // Wall 1 — active-fill context. The case must be this org's and this
  // provider's; a miss is a 404 (cross-org is indistinguishable from missing).
  const { data: caseRow, error: caseErr } = await db
    .from("credential_cases")
    .select("id")
    .eq("id", caseId)
    .eq("org_id", orgId)
    .eq("provider_id", providerId)
    .maybeSingle();
  if (caseErr) throw caseErr;
  if (!caseRow) {
    return { kind: "rejected", status: 404, message: "Case not found for this provider" };
  }

  // Wall 2 — the only decrypt path (service_role EXECUTE only). The RPC
  // re-checks the same case↔provider↔org fact before decrypting.
  const rpc = db.rpc.bind(db) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("release_ssn_for_fill", {
    p_provider_id: providerId,
    p_org_id: orgId,
    p_case_id: caseId,
  });
  if (error) {
    // The RPC raises for out-of-fill-context or no-SSN-on-file; surface a clean
    // 404 rather than a 500, and never echo the (empty) value.
    return { kind: "rejected", status: 404, message: "SSN is not available for this fill" };
  }
  const row = (data ?? {}) as Record<string, unknown>;
  const ssn = typeof row.ssn === "string" ? row.ssn : "";
  if (!ssn) {
    return { kind: "rejected", status: 404, message: "SSN is not available for this fill" };
  }
  return { kind: "released", ssn, ssnLast4: (row.ssn_last4 as string) ?? ssn.slice(-4) };
}
