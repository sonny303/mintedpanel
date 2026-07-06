// The calling user's org memberships, for GET /api/me/orgs: org id, org name,
// role — nothing else. USER-scoped, not org-scoped: the point of the endpoint
// is telling a (possibly multi-org) caller which orgs it can send as x-org-id,
// so the only filter is the JWT-verified user id. The userId must always come
// from the guard's UserContext, never from a request body or query string.
//
// Server-only surface (no browser-default ctx) — the app UI reads memberships
// itself under RLS; this projection exists for the extension/API consumers.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface OrgMembershipsServiceCtx {
  db: SupabaseClient<Database>;
}

export interface UserOrgMembership {
  orgId: string;
  orgName: string;
  // memberships.role is text in the schema; the guard narrows it to
  // admin|specialist|billing for authorization — here it is only reported.
  role: string;
}

interface MembershipRow {
  org_id: string;
  role: string;
  organizations: { name: string | null } | null;
}

const MEMBERSHIP_COLUMNS = "org_id, role, organizations(name)";

export async function listUserOrgMemberships(
  ctx: OrgMembershipsServiceCtx,
  userId: string,
): Promise<UserOrgMembership[]> {
  const { data, error } = await ctx.db
    .from("memberships")
    .select(MEMBERSHIP_COLUMNS)
    .eq("user_id", userId);
  if (error) throw error;

  const rows = (data ?? []) as unknown as MembershipRow[];
  return rows
    .map((row) => ({
      orgId: row.org_id,
      orgName: row.organizations?.name ?? "",
      role: row.role,
    }))
    .sort((a, b) => a.orgName.localeCompare(b.orgName) || a.orgId.localeCompare(b.orgId));
}
