// E6.12 access-context contracts and the server-side service-role RPC seam.
// This module contains no browser client or service credentials. Browser calls
// live in src/lib/clientAccessApi.ts; server routes pass the verified actor id
// into these functions and the database re-authorizes that actor independently.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type EnrollmentAudience = "staff" | "client" | null;

export interface EnrollmentStaffOrg {
  orgId: string;
  orgName: string;
  role: string;
  reportStaff: boolean;
  clientManage: boolean;
}

export interface EnrollmentClientGroup {
  groupId: string;
  groupName: string;
}

export interface EnrollmentClientOrg {
  orgId: string;
  orgName: string;
  groups: EnrollmentClientGroup[];
}

export interface EnrollmentContext {
  actorUserId: string;
  email: string | null;
  audience: EnrollmentAudience;
  selectedOrgId: string | null;
  staffOrgs: EnrollmentStaffOrg[];
  clientOrgs: EnrollmentClientOrg[];
  globalTraining: boolean;
  restrictedExternal: boolean;
  contextRevision: string;
}

export interface AccessRpcContext {
  db: SupabaseClient<Database>;
  actorUserId: string;
}

interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}

function rpcClient(db: SupabaseClient<Database>): RpcClient {
  return db as unknown as RpcClient;
}

function rpcError(message: string, code?: string): Error & { code?: string } {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid response`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is missing`);
  return value;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseStaffOrgs(value: unknown): EnrollmentStaffOrg[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const item = row as Record<string, unknown>;
    if (typeof item.orgId !== "string" || typeof item.orgName !== "string") return [];
    return [
      {
        orgId: item.orgId,
        orgName: item.orgName,
        role: typeof item.role === "string" ? item.role : "",
        reportStaff: asBoolean(item.reportStaff),
        clientManage: asBoolean(item.clientManage),
      },
    ];
  });
}

function parseClientOrgs(value: unknown): EnrollmentClientOrg[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const item = row as Record<string, unknown>;
    if (typeof item.orgId !== "string" || typeof item.orgName !== "string") return [];
    const groups = Array.isArray(item.groups)
      ? item.groups.flatMap((group) => {
          if (!group || typeof group !== "object" || Array.isArray(group)) return [];
          const g = group as Record<string, unknown>;
          return typeof g.groupId === "string" && typeof g.groupName === "string"
            ? [{ groupId: g.groupId, groupName: g.groupName }]
            : [];
        })
      : [];
    return [{ orgId: item.orgId, orgName: item.orgName, groups }];
  });
}

export function parseEnrollmentContext(value: unknown): EnrollmentContext {
  const item = asObject(value, "resolve_enrollment_context");
  const audience = item.audience === "staff" || item.audience === "client" ? item.audience : null;
  return {
    actorUserId: asString(item.actorUserId, "actorUserId"),
    email: asNullableString(item.email),
    audience,
    selectedOrgId: asNullableString(item.selectedOrgId),
    staffOrgs: parseStaffOrgs(item.staffOrgs),
    clientOrgs: parseClientOrgs(item.clientOrgs),
    globalTraining: asBoolean(item.globalTraining),
    restrictedExternal: asBoolean(item.restrictedExternal),
    contextRevision: asString(item.contextRevision, "contextRevision"),
  };
}

export async function resolveEnrollmentContext(
  ctx: AccessRpcContext,
  options: { audience?: EnrollmentAudience; orgId?: string | null } = {},
): Promise<EnrollmentContext> {
  const { data, error } = await rpcClient(ctx.db).rpc("resolve_enrollment_context", {
    p_actor_user_id: ctx.actorUserId,
    p_audience: options.audience ?? null,
    p_org_id: options.orgId ?? null,
  });
  if (error) throw rpcError(error.message, error.code);
  return parseEnrollmentContext(data);
}

export interface ClientInviteResult {
  inviteId: string;
  organizationId: string;
  recipientUserId: string;
  recipientEmail: string;
  token: string;
  expiresAt: string;
  inviteUrl?: string;
}

export async function createClientInvite(
  ctx: AccessRpcContext,
  input: { orgId: string; recipientEmail: string; groupIds: string[] },
): Promise<ClientInviteResult> {
  const { data, error } = await rpcClient(ctx.db).rpc("create_client_invite", {
    p_actor_user_id: ctx.actorUserId,
    p_org_id: input.orgId,
    p_recipient_email: input.recipientEmail,
    p_group_ids: input.groupIds,
  });
  if (error) throw rpcError(error.message, error.code);
  const item = asObject(data, "create_client_invite");
  return {
    inviteId: asString(item.inviteId, "inviteId"),
    organizationId: asString(item.organizationId, "organizationId"),
    recipientUserId: asString(item.recipientUserId, "recipientUserId"),
    recipientEmail: asString(item.recipientEmail, "recipientEmail"),
    token: asString(item.token, "token"),
    expiresAt: asString(item.expiresAt, "expiresAt"),
  };
}

export async function claimClientInvite(
  ctx: AccessRpcContext,
  token: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await rpcClient(ctx.db).rpc("claim_client_invite", {
    p_actor_user_id: ctx.actorUserId,
    p_token: token,
  });
  if (error) throw rpcError(error.message, error.code);
  return asObject(data, "claim_client_invite");
}

export async function setClientGroupGrants(
  ctx: AccessRpcContext,
  input: { accessId: string; groupIds: string[] },
): Promise<Record<string, unknown>> {
  const { data, error } = await rpcClient(ctx.db).rpc("set_client_group_grants", {
    p_actor_user_id: ctx.actorUserId,
    p_access_id: input.accessId,
    p_group_ids: input.groupIds,
  });
  if (error) throw rpcError(error.message, error.code);
  return asObject(data, "set_client_group_grants");
}

export async function revokeClientAccess(
  ctx: AccessRpcContext,
  accessId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await rpcClient(ctx.db).rpc("revoke_client_access", {
    p_actor_user_id: ctx.actorUserId,
    p_access_id: accessId,
  });
  if (error) throw rpcError(error.message, error.code);
  return asObject(data, "revoke_client_access");
}
