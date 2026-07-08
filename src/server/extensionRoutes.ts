// Extension-facing route handlers (Chunk 4): provider profile, portal field
// maps, fill events. Same composition as providerRoutes.ts — inject the
// authenticated server context into the service layer, never duplicate query
// logic here.
import { listPortalFieldMaps } from "@/services/portalFieldMaps";
import { recordFillEvent, type FillEventInput } from "@/services/fillSessions";
import { getProviderProfile } from "@/services/providerProfile";
import { listOpenProviderCases } from "@/services/providerCases";
import { getCaseContext } from "@/services/caseContext";
import { listUserOrgMemberships } from "@/services/orgMemberships";
import {
  getExtensionViewPrefs,
  parseExtensionViewPrefs,
  putExtensionViewPrefs,
} from "@/services/extensionViewPrefs";
import { recordSubmissionTouch, type SubmissionTouchInput } from "@/services/submissionTouches";
import { ok, fail, type ApiMeta } from "./envelope";
import { isWriter, type AuthContext, type UserContext } from "./guard";
import { resolveUserTokens } from "./userTokens";

const STATE_RE = /^[A-Za-z]{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/me/orgs — the caller's own org memberships (org id, name, role),
// derived from the JWT-verified user id and nothing else. This is the org
// discovery endpoint a multi-org caller needs BEFORE it can send x-org-id, so
// it runs on the user-only auth step (authenticateUser), not the org guard.
export async function handleListMyOrgs(user: UserContext): Promise<Response> {
  const rows = await listUserOrgMemberships({ db: user.db }, user.userId);
  return ok(rows, { total: rows.length });
}

// GET /api/me/view-prefs — the caller's saved extension detail-view field
// list. `fields: null` means nothing saved (the extension falls back to its
// default field set) — the envelope's `data` itself is never null, since
// clients treat a null data as an error. USER-scoped like /api/me/orgs:
// keyed by the JWT-verified user id only, so it runs on authenticateUser,
// not the org guard — view prefs follow the user across orgs.
export async function handleGetViewPrefs(user: UserContext): Promise<Response> {
  const prefs = await getExtensionViewPrefs({ db: user.db }, user.userId);
  return ok({ fields: prefs?.fields ?? null });
}

// PUT /api/me/view-prefs — save the caller's detail-view field list:
// { fields: ["license.licenseNumber", ...] }, bare token keys, deduped,
// capped. Not a PHI read/write — no audit row.
export async function handlePutViewPrefs(body: unknown, user: UserContext): Promise<Response> {
  const prefs = parseExtensionViewPrefs(body);
  if (!prefs) {
    return fail(422, "Body must be { fields: string[] } of bare token keys (max 64)");
  }
  await putExtensionViewPrefs({ db: user.db }, user.userId, prefs);
  return ok(prefs);
}

// GET /api/providers/:id/profile[?state=XX&facilityId=<uuid>] — everything the
// fill engine needs for one provider, resolved server-side. The most PHI-dense
// response in the system (SSN last-4, DOB, home address — unmasked by design
// for form fill): Cache-Control: no-store, and nothing here may ever log the
// response body.
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
  // Explicit facility selection for the facility.*/assignment.* tokens. A
  // non-UUID can't be a facility — same early 404 the set-membership check
  // below would produce, without a uuid-cast 500.
  const facilityIdRaw = url.searchParams.get("facilityId");
  let facilityId: string | undefined;
  if (facilityIdRaw != null && facilityIdRaw !== "") {
    if (!UUID_RE.test(facilityIdRaw)) return fail(404, "Facility not found for this provider");
    facilityId = facilityIdRaw;
  }

  const result = await getProviderProfile({ db: ctx.db, orgId: ctx.orgId }, id, {
    state,
    facilityId,
  });
  if (result.kind === "provider_not_found") return fail(404, "Provider not found");
  // A facilityId outside the caller's org or this provider's facility set —
  // the isolation gate's assertion 11. Not a read: no audit row, no data.
  if (result.kind === "facility_not_found") {
    return fail(404, "Facility not found for this provider");
  }
  const { profile, needsFacility } = result;

  // {{user.*}} tokens ride along with the catalog tokens (R2 locked decision
  // 5); resolution notes surface in meta, never as errors.
  const userTokens = resolveUserTokens(ctx);
  profile.tokens.push(...userTokens.tokens);

  // R2 locked decision 4: one audit row per successful profile read — the
  // actor, the provider, the route. NEVER the body or any token value. A
  // failed audit write fails the request (writeAudit throws -> 500): no
  // un-audited PHI read ever leaves this handler. 404s above are not reads.
  await ctx.writeAudit({
    actionType: "READ",
    entityType: "provider",
    entityId: id,
    after: {
      route: "/api/providers/:id/profile",
      state: state ?? null,
      facilityId: profile.selected_facility_id,
    },
    description: "Provider profile read (extension fill payload)",
  });

  const meta: ApiMeta = {};
  if (userTokens.notes.length) meta.notes = userTokens.notes;
  // Several facilities and no ?facilityId: facility tokens came back empty and
  // the client must ask the user to pick — the server never guesses.
  if (needsFacility) meta.needs_facility = true;
  const response = ok(profile, Object.keys(meta).length ? meta : null);
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

// GET /api/cases?providerId=<uuid> — the popup's case dropdown: the provider's
// OPEN cases (open = credentialing status not in the config's 'complete'
// action bucket — see providerCases.ts). The provider must belong to the
// caller's org: a cross-org providerId is a 404, same contract the isolation
// gate proves for the provider routes.
export async function handleListProviderCases(url: URL, ctx: AuthContext): Promise<Response> {
  const providerId = url.searchParams.get("providerId");
  if (!providerId || !UUID_RE.test(providerId)) {
    return fail(422, "providerId must be a UUID query parameter");
  }
  const rows = await listOpenProviderCases({ db: ctx.db, orgId: ctx.orgId }, providerId);
  if (!rows) return fail(404, "Provider not found");
  return ok(rows, { total: rows.length });
}

// GET /api/cases/:id/context — the Workbench pulls this after case selection so
// the filler sees the case's reference number(s) + latest note/touch without
// leaving the portal tab. The case must belong to the resolved org: a cross-org
// or nonexistent id is a 404 (the service returns null), mirroring the other
// case handlers. Read-only, PHI-minimal — no role gate, no audit.
export async function handleCaseContext(caseId: string, ctx: AuthContext): Promise<Response> {
  // A non-UUID path segment can't be a case — 404 here rather than a Postgres
  // uuid-cast 500 (the profile/touches-route precedent).
  if (!UUID_RE.test(caseId)) return fail(404, "Case not found");
  const context = await getCaseContext({ db: ctx.db, orgId: ctx.orgId }, caseId);
  if (!context) return fail(404, "Case not found");
  return ok(context);
}

// POST /api/cases/:id/touches — the human pressed "Mark submitted" after
// submitting the portal form themselves. Appends one submission touch
// (source 'extension'), idempotent on the client-generated idempotency_id.
// Never changes case status, never touches tasks. Writer roles only.
export async function handleCreateCaseTouch(
  caseId: string,
  body: unknown,
  ctx: AuthContext,
): Promise<Response> {
  if (!isWriter(ctx)) return fail(403, "Your role cannot log touches");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(422, "Request body must be a JSON object");
  }
  const result = await recordSubmissionTouch(
    { db: ctx.db, orgId: ctx.orgId, userId: ctx.userId, writeAudit: ctx.writeAudit },
    caseId,
    body as SubmissionTouchInput,
  );
  if (result.kind === "rejected") return fail(result.status, result.message);
  return ok(result.touch, null, result.kind === "created" ? 201 : 200);
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
