// Secure read-only portfolio share service (redesign E0.6, TE-5/TE-6).
//
// Operator (authenticated): create/list/revoke the caller's OWN shares (RLS is
// created_by-scoped — a full share spans all orgs, so it is not org-scoped).
// Recipient (unauthenticated, public /share/:token): validate only. The scope
// filter (full vs single-org) is enforced SERVER-SIDE inside the definer RPC;
// the client never filters and never trusts its own scope.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import type {
  IssuedReportShare,
  PortfolioOrg,
  ReportShare,
  ReportShareScope,
  ReportShareView,
} from "@/types";

function boundRpc() {
  return supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface CreateReportShareInput {
  reportKey: string;
  scope: ReportShareScope;
  scopeOrgId?: string | null;
  recipientEmail: string;
}

// Operator: issue a share; returns the raw token ONCE for URL assembly.
export async function createReportShare(input: CreateReportShareInput): Promise<IssuedReportShare> {
  const email = input.recipientEmail.trim();
  if (!email) throw new Error("A recipient email is required");
  const { data, error } = await boundRpc()("create_report_share", {
    p_report_key: input.reportKey,
    p_scope: input.scope,
    p_scope_org_id: input.scope === "single_org" ? (input.scopeOrgId ?? null) : null,
    p_recipient_email: email,
  });
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  return {
    token: row.token as string,
    shareId: row.share_id as string,
    recipientEmail: row.recipient_email as string,
    scope: row.scope as ReportShareScope,
    expiresAt: row.expires_at as string,
  };
}

// Operator: the caller's shares for a report, newest first (RLS: created_by).
export async function listReportShares(reportKey: string): Promise<ReportShare[]> {
  const { data, error } = await supabase
    .from("report_shares")
    .select("*")
    .eq("report_key", reportKey)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => camelizeRow<ReportShare>(row));
}

export async function revokeReportShare(id: string): Promise<void> {
  const { error } = await boundRpc()("revoke_report_share", { p_id: id });
  if (error) throw new Error(error.message);
}

// Recipient (anon): validate a share token and receive ONLY the in-scope orgs.
export async function validateReportShare(token: string): Promise<ReportShareView> {
  const { data, error } = await boundRpc()("validate_report_share", { p_token: token });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  const rawOrgs = Array.isArray(row.orgs)
    ? (row.orgs as Array<Record<string, unknown>>)
    : undefined;
  return {
    state: row.state as ReportShareView["state"],
    reportKey: (row.report_key as string) ?? undefined,
    scope: (row.scope as ReportShareScope) ?? undefined,
    orgs: rawOrgs
      ? rawOrgs.map((o) => ({
          id: o.id as string,
          name: o.name as string,
          lifecycleState: (o.lifecycle_state as PortfolioOrg["lifecycleState"]) ?? "active",
          createdAt: (o.created_at as string) ?? "",
        }))
      : undefined,
  };
}
