// Extension-facing route handlers (Chunk 4): provider profile, portal field
// maps, fill events. Same composition as providerRoutes.ts — inject the
// authenticated server context into the service layer, never duplicate query
// logic here.
import { listPortalFieldMaps } from "@/services/portalFieldMaps";
import { recordFillEvent, type FillEventInput } from "@/services/fillSessions";
import { getProviderProfile } from "@/services/providerProfile";
import { releaseSsnForFill } from "@/services/ssnRelease";
import { listOpenProviderCases, searchOrgCases } from "@/services/providerCases";
import { getCaseContext } from "@/services/caseContext";
import { listUserOrgMemberships } from "@/services/orgMemberships";
import { recordSubmissionTouch, type SubmissionTouchInput } from "@/services/submissionTouches";
import { getNextBestAction } from "@/services/nextBestAction";
import { getExtensionViewPrefs, putExtensionViewPrefs } from "@/services/extensionViewPrefs";
import { validateQuickCardFields } from "@/lib/quickCardCatalog";
import { ok, fail, type ApiMeta } from "./envelope";
import { isWriter, type AuthContext, type UserContext } from "./guard";
import { resolveUserTokens } from "./userTokens";

// Date-only ISO (YYYY-MM-DD) for the pure queue reducer — a server clock read
// at the route boundary, never inside the pure module.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

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

// GET /api/me/view-prefs — the caller's saved extension quick-card layout.
// USER-scoped like /api/me/orgs (runs on authenticateUser): the layout follows
// the user across orgs, so the org guard deliberately does not apply. Not a
// PHI read (a list of field KEYS, no provider values) — no audit. Returns
// { fields: string[] | null } (null = nothing saved); the envelope data itself
// is never null so the extension never treats "no saved layout" as an error.
export async function handleGetViewPrefs(user: UserContext): Promise<Response> {
  const prefs = await getExtensionViewPrefs({ db: user.db, userId: user.userId });
  return ok(prefs);
}

// PUT /api/me/view-prefs — save the caller's quick-card layout. Body:
// { fields: string[] }, validated to a bounded (<=32), deduplicated, ORDERED
// array of closed-catalog keys (TE-15/TE-16) — anything else is a 422, incl. a
// hand-crafted key for ssnLast4 or any vault/excluded field (they are absent
// from the catalog). user_id comes from the verified JWT, never the body.
export async function handlePutViewPrefs(body: unknown, user: UserContext): Promise<Response> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(422, "Request body must be a JSON object");
  }
  const validation = validateQuickCardFields((body as { fields?: unknown }).fields);
  if (!validation.ok) return fail(422, validation.message);
  const prefs = await putExtensionViewPrefs(
    { db: user.db, userId: user.userId },
    validation.fields,
  );
  return ok(prefs);
}

// GET /api/next-best-action — the extension's log-and-advance loop (F4.3.4 /
// TE-6): assemble the org-scoped queue inputs, rank via the SAME pure
// E2.3/E4.1 reducer under the org's F4.2.5 ranking config, and return the
// QUEUE TOP — exactly one item, or { item: null } for an honest "queue clear"
// state. Read-only, no persisted queue rows (the E2.3 queue is fully derived);
// the returned item is a case pointer + display label/reason + a webapp deep
// link, never a token value or PHI. No role gate: billing may read the queue
// (the /work surface is admin/billing-visible), and the reducer writes nothing.
export async function handleNextBestAction(ctx: AuthContext): Promise<Response> {
  const result = await getNextBestAction({ db: ctx.db, orgId: ctx.orgId }, todayIso());
  return ok(result);
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

// GET /api/providers/:id/ssn-release?caseId=<uuid> — E4.4 F4.4.2 fill-only SSN
// release. The extension requests the full SSN for a provider it is ACTIVELY
// filling; the value goes solely into the portal field (the extension UI shows
// only the mask). Fill-only boundary: writer roles only (billing 403), and the
// caseId is REQUIRED — a request outside an active fill context is rejected. The
// case must be this org's and this provider's (else 404, cross-org
// indistinguishable from missing). Cache-Control: no-store; the response body is
// never logged; and every successful release writes ONE READ audit row (actor,
// provider, case — never the value; a failed audit write fails the request).
export async function handleSsnRelease(id: string, url: URL, ctx: AuthContext): Promise<Response> {
  if (!isWriter(ctx)) return fail(403, "Your role cannot release an SSN for fill");
  if (!UUID_RE.test(id)) return fail(404, "Provider not found");
  const caseIdRaw = url.searchParams.get("caseId");
  if (!caseIdRaw) return fail(422, "caseId is required to release an SSN for fill");
  if (!UUID_RE.test(caseIdRaw)) return fail(404, "Case not found for this provider");

  const result = await releaseSsnForFill({ db: ctx.db, orgId: ctx.orgId }, id, caseIdRaw);
  if (result.kind === "rejected") return fail(result.status, result.message);

  // One READ audit row per successful release — actor, provider, case. Never the
  // value. A failed audit write throws -> 500, so no un-audited release leaves.
  await ctx.writeAudit({
    actionType: "READ",
    entityType: "provider_ssn_vault",
    entityId: id,
    after: { route: "/api/providers/:id/ssn-release", caseId: caseIdRaw },
    description: "Full SSN released for portal fill",
  });

  const response = ok({ ssn: result.ssn, ssnLast4: result.ssnLast4 });
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

// GET /api/cases — two additive modes over the same org-scoped route:
//   ?providerId=<uuid>  the popup's case dropdown: the provider's OPEN cases
//                       (open = credentialing status not in the 'complete'
//                       bucket). A cross-org providerId is a 404.
//   ?q=<text>           E4.3 TE-11 — the case half of the unified standalone
//                       search: org-scoped, matching payer name / provider
//                       name / tracking id, ids + display fields only.
// providerId takes precedence when both are present (the fill flow's primary
// path). Neither present is a 422 — the route never dumps the whole org.
export async function handleListProviderCases(url: URL, ctx: AuthContext): Promise<Response> {
  const providerId = url.searchParams.get("providerId");
  const q = url.searchParams.get("q");
  if (providerId) {
    if (!UUID_RE.test(providerId)) {
      return fail(422, "providerId must be a UUID query parameter");
    }
    const rows = await listOpenProviderCases({ db: ctx.db, orgId: ctx.orgId }, providerId);
    if (!rows) return fail(404, "Provider not found");
    return ok(rows, { total: rows.length });
  }
  if (q != null) {
    const rows = await searchOrgCases({ db: ctx.db, orgId: ctx.orgId }, q);
    return ok(rows, { total: rows.length });
  }
  return fail(422, "providerId or q query parameter is required");
}

// GET /api/cases/:id/context — the Workbench pulls this after case selection so
// the filler sees everything the panel needs (identity header, open tasks with
// execution types, pipeline state, tracking ID, selected facility, latest
// note/touch) without leaving the portal tab. The case must belong to the
// resolved org: a cross-org or nonexistent id is a 404 (the service returns
// null), mirroring the other case handlers. Read-only, no role gate.
// E4.3 TE-2: Cache-Control no-store, never log the body, and exactly ONE
// successful read writes one READ audit row (the profile-route posture — a
// failed audit write fails the request; 404s are not reads).
export async function handleCaseContext(caseId: string, ctx: AuthContext): Promise<Response> {
  // A non-UUID path segment can't be a case — 404 here rather than a Postgres
  // uuid-cast 500 (the profile/touches-route precedent).
  if (!UUID_RE.test(caseId)) return fail(404, "Case not found");
  const context = await getCaseContext({ db: ctx.db, orgId: ctx.orgId }, caseId);
  if (!context) return fail(404, "Case not found");
  await ctx.writeAudit({
    actionType: "READ",
    entityType: "case",
    entityId: caseId,
    after: { route: "/api/cases/:id/context" },
    description: "Case context read (extension workbench)",
  });
  const response = ok(context);
  response.headers.set("cache-control", "no-store");
  return response;
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
