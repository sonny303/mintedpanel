import { fail, ok } from "./envelope";
import { GuardError, type UserContext } from "./guard";
import {
  claimClientInvite,
  createClientInvite,
  resolveEnrollmentContext,
  revokeClientAccess,
  setClientGroupGrants,
} from "@/services/clientAccess";
import type { EnrollmentAudience } from "@/services/clientAccess";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function objectBody(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function hasActorField(body: Record<string, unknown> | null): boolean {
  if (!body) return false;
  return ["actorUserId", "actorId", "userId", "actor_user_id", "p_actor_user_id"].some((key) =>
    Object.prototype.hasOwnProperty.call(body, key),
  );
}

function stringValue(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function groupIdsValue(body: Record<string, unknown>): string[] | null {
  const value = body.groupIds;
  if (!Array.isArray(value) || value.length === 0 || !value.every((id) => typeof id === "string")) {
    return null;
  }
  const groupIds = [...new Set(value.map((id) => (id as string).trim()))];
  return groupIds.length > 0 && groupIds.every((id) => UUID_RE.test(id)) ? groupIds : null;
}

function rpcFailure(error: unknown): Response {
  const raw = error instanceof Error ? error.message : "";
  const message = raw.toLowerCase();
  if (message.includes("not authenticated") || message.includes("verified actor")) {
    return fail(401, "Verified session required");
  }
  if (
    message.includes("requires current") ||
    message.includes("restricted client") ||
    message.includes("not authorized") ||
    message.includes("unavailable") ||
    message.includes("does not match")
  ) {
    return fail(403, "This access context is not authorized");
  }
  if (
    message.includes("already claimed") ||
    message.includes("expired") ||
    message.includes("invalid") ||
    message.includes("replay")
  ) {
    return fail(409, "The access request is no longer valid");
  }
  if (
    message.includes("required") ||
    message.includes("must belong") ||
    message.includes("not valid") ||
    message.includes("unsupported")
  ) {
    return fail(422, "The access request is invalid");
  }
  console.error("[client-access] RPC failure:", error);
  return fail(500, "Access request failed");
}

function withRevision(response: Response, revision: string): Response {
  response.headers.set("X-Minted-Context-Revision", revision);
  return response;
}

async function mutationResponse(data: unknown, user: UserContext, status = 200): Promise<Response> {
  try {
    const context = await resolveEnrollmentContext({ db: user.db, actorUserId: user.userId });
    return withRevision(ok(data, null, status), context.contextRevision);
  } catch {
    // The mutation already committed. Preserve that success and leave the
    // revision explicitly unknown so the browser invalidates and refreshes;
    // never label a committed result with the pre-mutation revision.
    return withRevision(ok(data, null, status), "unknown");
  }
}

export async function handleGetAccessContext(user: UserContext): Promise<Response> {
  try {
    const context = await resolveEnrollmentContext({ db: user.db, actorUserId: user.userId });
    return withRevision(ok(context), context.contextRevision);
  } catch (error) {
    return rpcFailure(error);
  }
}

export async function handleSelectAccessContext(
  body: unknown,
  user: UserContext,
): Promise<Response> {
  const input = objectBody(body);
  if (hasActorField(input)) return fail(400, "Actor identity is derived from the verified session");
  const audience = stringValue(input ?? {}, "audience") as EnrollmentAudience;
  const orgId = stringValue(input ?? {}, "orgId");
  const expectedRevision = stringValue(input ?? {}, "contextRevision");
  if (
    (audience !== "staff" && audience !== "client") ||
    !orgId ||
    !UUID_RE.test(orgId) ||
    !expectedRevision
  ) {
    return fail(422, "audience, orgId, and contextRevision are required");
  }
  try {
    const current = await resolveEnrollmentContext({ db: user.db, actorUserId: user.userId });
    if (current.contextRevision !== expectedRevision) {
      return fail(409, "Access context changed; refresh before selecting a new context");
    }
    const context = await resolveEnrollmentContext(
      { db: user.db, actorUserId: user.userId },
      { audience, orgId },
    );
    if (context.contextRevision !== expectedRevision) {
      return fail(409, "Access context changed; refresh before selecting a new context");
    }
    return withRevision(ok(context), context.contextRevision);
  } catch (error) {
    return rpcFailure(error);
  }
}

export async function handleClaimClientInvite(body: unknown, user: UserContext): Promise<Response> {
  const input = objectBody(body);
  if (hasActorField(input)) return fail(400, "Actor identity is derived from the verified session");
  const token = stringValue(input ?? {}, "token");
  if (!token) return fail(422, "token is required");
  try {
    const result = await claimClientInvite({ db: user.db, actorUserId: user.userId }, token);
    return await mutationResponse(result, user);
  } catch (error) {
    return rpcFailure(error);
  }
}

export async function handleCreateClientInvite(
  body: unknown,
  user: UserContext,
  requestUrl?: string,
): Promise<Response> {
  const input = objectBody(body);
  if (hasActorField(input)) return fail(400, "Actor identity is derived from the verified session");
  const orgId = stringValue(input ?? {}, "orgId");
  const recipientEmail = stringValue(input ?? {}, "recipientEmail");
  const groupIds = groupIdsValue(input ?? {});
  if (!orgId || !UUID_RE.test(orgId) || !recipientEmail || !groupIds) {
    return fail(422, "orgId, recipientEmail, and groupIds are required");
  }
  try {
    const result = await createClientInvite(
      { db: user.db, actorUserId: user.userId },
      { orgId, recipientEmail, groupIds },
    );
    const inviteUrl = requestUrl
      ? new URL(`/client-invites/claim/${encodeURIComponent(result.token)}`, requestUrl).toString()
      : undefined;
    return await mutationResponse({ ...result, ...(inviteUrl ? { inviteUrl } : {}) }, user, 201);
  } catch (error) {
    return rpcFailure(error);
  }
}

export async function handleSetClientGroupGrants(
  accessId: string,
  body: unknown,
  user: UserContext,
): Promise<Response> {
  const input = objectBody(body);
  if (hasActorField(input)) return fail(400, "Actor identity is derived from the verified session");
  const groupIds = groupIdsValue(input ?? {});
  if (!UUID_RE.test(accessId) || !groupIds) return fail(422, "accessId and groupIds are required");
  try {
    const result = await setClientGroupGrants(
      { db: user.db, actorUserId: user.userId },
      { accessId, groupIds },
    );
    return await mutationResponse(result, user);
  } catch (error) {
    return rpcFailure(error);
  }
}

export async function handleRevokeClientAccess(
  accessId: string,
  body: unknown,
  user: UserContext,
): Promise<Response> {
  if (hasActorField(objectBody(body))) {
    return fail(400, "Actor identity is derived from the verified session");
  }
  if (!UUID_RE.test(accessId)) throw new GuardError(422, "accessId is invalid");
  try {
    const result = await revokeClientAccess({ db: user.db, actorUserId: user.userId }, accessId);
    return await mutationResponse(result, user);
  } catch (error) {
    return rpcFailure(error);
  }
}
