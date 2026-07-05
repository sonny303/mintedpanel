// Extension-facing route handlers (Chunk 4): provider profile, portal field
// maps, fill events. Same composition as providerRoutes.ts — inject the
// authenticated server context into the service layer, never duplicate query
// logic here.
import { listPortalFieldMaps } from "@/services/portalFieldMaps";
import { recordFillEvent, type FillEventInput } from "@/services/fillSessions";
import { getProviderProfile } from "@/services/providerProfile";
import { ok, fail } from "./envelope";
import { isWriter, type AuthContext } from "./guard";

const STATE_RE = /^[A-Za-z]{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/providers/:id/profile[?state=XX] — everything the fill engine needs
// for one provider, resolved server-side. The most PHI-dense response in the
// system (SSN last-4, DOB, home address — unmasked by design for form fill):
// Cache-Control: no-store, and nothing here may ever log the response body.
export async function handleProviderProfile(
  id: string,
  url: URL,
  ctx: AuthContext,
): Promise<Response> {
  // A non-UUID path segment can't be a provider; answer 404 here rather than
  // letting Postgres throw a uuid-cast error into a 500.
  if (!UUID_RE.test(id)) return fail(404, "Provider not found");
  const stateRaw = url.searchParams.get("state");
  let state: string | undefined;
  if (stateRaw != null && stateRaw !== "") {
    if (!STATE_RE.test(stateRaw)) return fail(422, "state must be a two-letter code");
    state = stateRaw.toUpperCase();
  }
  const profile = await getProviderProfile({ db: ctx.db, orgId: ctx.orgId }, id, { state });
  if (!profile) return fail(404, "Provider not found");
  const response = ok(profile);
  response.headers.set("cache-control", "no-store");
  return response;
}

// GET /api/portal-field-maps[?portal_key=...] — global catalog rows (org NULL)
// plus the caller's own org overrides.
export async function handleListPortalFieldMaps(url: URL, ctx: AuthContext): Promise<Response> {
  const portalKey = url.searchParams.get("portal_key") ?? undefined;
  const rows = await listPortalFieldMaps({ db: ctx.db, orgId: ctx.orgId }, { portalKey });
  return ok(rows, { total: rows.length });
}

// POST /api/fill-events — log one fill session, idempotent on the
// client-generated id. org_id/performed_by come from the resolved membership;
// case/provider/task ownership is validated before any write.
export async function handleCreateFillEvent(body: unknown, ctx: AuthContext): Promise<Response> {
  if (!isWriter(ctx)) return fail(403, "Your role cannot record fill events");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(422, "Request body must be a JSON object");
  }
  const result = await recordFillEvent(
    { db: ctx.db, orgId: ctx.orgId, userId: ctx.userId, writeAudit: ctx.writeAudit },
    body as FillEventInput,
  );
  if (result.kind === "rejected") return fail(result.status, result.message);
  return ok(result.session, null, result.kind === "created" ? 201 : 200);
}
