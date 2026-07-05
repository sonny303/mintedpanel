// The single org/role guard every /api data route runs through.
//
// The service-role client bypasses RLS, so tenant isolation is enforced here in
// code: verify the caller's JWT, resolve their membership (org_id + role), and
// hand routes a context already scoped to that org. There is no code path that
// reaches a provider handler without a resolved AuthContext.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AuditInput } from "@/lib/audit";
import { getAuthClient, getServiceClient } from "./serviceClient";

export type AppRole = "admin" | "specialist" | "billing";

export interface AuthContext {
  userId: string;
  orgId: string;
  role: AppRole;
  userName: string | null;
  // JWT email claim and raw user_metadata — the {{user.*}} token sources
  // (see ./userTokens.ts). Metadata is caller-controlled display data: fine
  // for form-fill values, never for authorization decisions.
  email: string | null;
  userMetadata: Record<string, unknown> | null;
  db: SupabaseClient<Database>; // service-role; already org-scoped by callers
  writeAudit: (input: AuditInput) => Promise<void>;
}

export class GuardError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GuardError";
  }
}

export function getBearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    throw new GuardError(401, "Missing or malformed Authorization header");
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) throw new GuardError(401, "Empty bearer token");
  return token;
}

// Authenticate the request and resolve the caller's org membership.
// `requestedOrgId` (from an `x-org-id` header or `?orgId=`) disambiguates users
// who belong to more than one org; the caller must actually be a member of it.
// Multi-org callers MUST send it — omitting it is a 400, never a guessed org.
export async function authenticate(
  request: Request,
  requestedOrgId?: string | null,
): Promise<AuthContext> {
  const token = getBearerToken(request);

  const { data: claimData, error: claimError } = await getAuthClient(token).auth.getClaims(token);
  if (claimError || !claimData?.claims?.sub) {
    throw new GuardError(401, "Invalid or expired token");
  }
  const userId = claimData.claims.sub as string;
  const email = (claimData.claims.email as string | undefined) ?? null;
  const rawMetadata = (claimData.claims as Record<string, unknown>).user_metadata;
  const userMetadata =
    rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)
      ? (rawMetadata as Record<string, unknown>)
      : null;

  const db = getServiceClient();

  let membershipQuery = db.from("memberships").select("org_id, role").eq("user_id", userId);
  if (requestedOrgId) membershipQuery = membershipQuery.eq("org_id", requestedOrgId);
  const { data: memberships, error: membershipError } = await membershipQuery;
  if (membershipError) throw new GuardError(500, "Failed to resolve membership");

  const membershipRows = (memberships ?? []) as Array<{ org_id: string; role: AppRole }>;
  if (membershipRows.length === 0) {
    throw new GuardError(403, requestedOrgId ? "Not a member of that org" : "No org membership");
  }
  // A multi-org caller with no x-org-id must fail LOUDLY, never fall through
  // to an arbitrary first row: the service key bypasses RLS, so a guessed org
  // silently serves the wrong tenant's view (which reads as "no value in
  // Minted Panel" in the extension instead of an actionable error).
  if (!requestedOrgId && membershipRows.length > 1) {
    throw new GuardError(
      400,
      "You belong to multiple orgs; send an x-org-id header (or ?orgId=) to choose one",
    );
  }
  const membership = membershipRows[0];
  const orgId = membership.org_id;
  const role = membership.role;

  const { data: profile } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  const userName = (profile?.full_name as string | undefined) ?? email;

  const writeAudit = async (input: AuditInput): Promise<void> => {
    const { error } = await db.from("audit_log").insert({
      org_id: orgId,
      user_id: userId,
      user_name: userName,
      action_type: input.actionType,
      entity_type: input.entityType,
      entity_id: input.entityId,
      before: (input.before ?? null) as never,
      after: (input.after ?? null) as never,
      description: input.description ?? null,
    });
    if (error) throw error;
  };

  return { userId, orgId, role, userName, email, userMetadata, db, writeAudit };
}

// Writers = specialist or admin, mirroring the RLS write policies. billing is
// read-only. Handlers turn a false here into a 403 envelope.
export function isWriter(ctx: AuthContext): boolean {
  return ctx.role === "admin" || ctx.role === "specialist";
}
