// Extension-facing route handlers (Chunk 4): provider profile, portal field
// maps, fill events. Same composition as providerRoutes.ts — inject the
// authenticated server context into the service layer, never duplicate query
// logic here.
import {
  listPortalFieldMaps,
  proposeFieldMap,
  type ProposeFieldMapInput,
} from "@/services/portalFieldMaps";
import { listPortalsForApi } from "@/services/portals";
import { recordFillEvent, type FillEventInput } from "@/services/fillSessions";
import { getProviderProfile } from "@/services/providerProfile";
import { releaseSsnForFill } from "@/services/ssnRelease";
import { listOpenProviderCases, searchOrgCases } from "@/services/providerCases";
import { getCaseContext } from "@/services/caseContext";
import { listUserOrgMemberships } from "@/services/orgMemberships";
import { recordSubmissionTouch, type SubmissionTouchInput } from "@/services/submissionTouches";
import { getNextBestAction } from "@/services/nextBestAction";
import { completeTaskStep } from "@/services/taskSteps";
import {
  getExtensionViewPrefs,
  getQuickCardCatalog,
  putExtensionViewPrefs,
} from "@/services/extensionViewPrefs";
import { validateQuickCardFields } from "@/lib/quickCardCatalog";
import { ok, fail, type ApiMeta } from "./envelope";
import { isWriter, type AuthContext, type UserContext } from "./guard";
import { resolveUserTokens } from "./userTokens";
import { resolveOrgContactProfileTokens } from "@/services/orgContacts";
import { proposeSharedFieldMap, type SharedProposeBody } from "@/services/sharedFieldMaps";

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

// GET /api/me/view-prefs — the caller's saved quick-card layout AND the
// catalog of fields they may choose from.
//
// USER-scoped like /api/me/orgs (runs on authenticateUser): the layout follows
// the user across orgs, so the org guard deliberately does not apply. Not a PHI
// read — the layout is a list of field KEYS and the catalog is schema metadata
// (which fields exist, with labels); no provider values pass through either.
// No audit row.
//
// Returns { fields: string[] | null, catalog: QuickCardField[] }. `fields` null
// = nothing saved (the client falls back to its default layout); the envelope's
// `data` is never null, so "no saved layout" is never read as an error. The
// catalog rides along because the picker needs both at the same moment — one
// round trip, and the offered set is guaranteed consistent with the set the PUT
// below validates against.
export async function handleGetViewPrefs(user: UserContext): Promise<Response> {
  const [prefs, catalog] = await Promise.all([
    getExtensionViewPrefs({ db: user.db, userId: user.userId }),
    getQuickCardCatalog({ db: user.db }),
  ]);
  return ok({ ...prefs, catalog });
}

// PUT /api/me/view-prefs — save the caller's quick-card layout. Body:
// { fields: string[] }, validated to a deduplicated, ORDERED array of keys
// drawn from the live schema-derived catalog — anything else is a 422.
//
// The allowed set is derived from get_sop_field_tokens() on every request, not
// from a hand-written list, so the validator and the picker are the same
// source. Excluded keys (case-scoped payer/mso/contract tokens, internal/audit
// columns) can never validate. A full-SSN key can never validate either: the
// vault lives in provider_ssn_vault, which the token catalog does not sweep, so
// no such token exists to name. user_id comes from the verified JWT, never the
// body.
export async function handlePutViewPrefs(body: unknown, user: UserContext): Promise<Response> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(422, "Request body must be a JSON object");
  }
  const catalog = await getQuickCardCatalog({ db: user.db });
  const allowed = new Set(catalog.map((f) => f.key));
  const validation = validateQuickCardFields((body as { fields?: unknown }).fields, allowed);
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
// ranked queue: `items` (bounded by ?limit=, default 20) plus `item` = the
// TOP, kept bit-for-bit for the pre-S3.3 single-item consumer.
// Read-only, no persisted queue rows (the E2.3 queue is fully derived);
// the returned item is a case pointer + display label/reason + a webapp deep
// link, never a token value or PHI. No role gate: billing may read the queue
// (the /work surface is admin/billing-visible), and the reducer writes nothing.
export async function handleNextBestAction(url: URL, ctx: AuthContext): Promise<Response> {
  // S3.3: ?limit= bounds the ranked list (1..100, default 20). Out-of-range or
  // non-numeric falls back to the default rather than erroring — the queue is
  // a read, and a bad param shouldn't cost the caller their queue.
  const raw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(raw) && raw >= 1 && raw <= 100 ? raw : 20;
  const result = await getNextBestAction({ db: ctx.db, orgId: ctx.orgId }, todayIso(), limit);
  return ok(result, { total: result.items.length });
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

  // Org contact families (billingContact.* / credentialingContact.* /
  // contractingSigner.*) — the same append-a-code-owned-family pattern as
  // {{user.*}}, resolved from the org's DEFAULT holder of each role (D9/D11).
  // They are NOT case-scoped, so unlike payer.*/mso.*/contract.* they carry
  // real values here. A role with no default holder yields null tokens plus an
  // unresolved reason naming the missing contact — never a guess.
  const contactTokens = await resolveOrgContactProfileTokens({ db: ctx.db, orgId: ctx.orgId });
  profile.tokens.push(...contactTokens.tokens);
  profile.unresolved.push(...contactTokens.unresolved);

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

// GET /api/portals[?portal_key=...] — the payer-portal registry the extension
// matches the current tab against, so portal identity is DB-driven rather than
// a hardcoded list baked into the extension bundle. Own-org rows plus global
// (org_id NULL) registry rows; another org's rows can never appear.
//
// Read-only and not PHI (portal names/URLs and their verification state), so
// no audit row and no role gate — billing may read, mirroring the field-maps
// route it pairs with.
export async function handleListPortals(url: URL, ctx: AuthContext): Promise<Response> {
  const portalKey = url.searchParams.get("portal_key") ?? undefined;
  const rows = await listPortalsForApi({ db: ctx.db, orgId: ctx.orgId }, { portalKey });
  return ok(rows, { total: rows.length });
}

// GET /api/portal-field-maps[?portal_key=...] — global catalog rows (org NULL)
// plus the caller's own org overrides.
export async function handleListPortalFieldMaps(url: URL, ctx: AuthContext): Promise<Response> {
  const portalKey = url.searchParams.get("portal_key") ?? undefined;
  const rows = await listPortalFieldMaps({ db: ctx.db, orgId: ctx.orgId }, { portalKey });
  return ok(rows, { total: rows.length });
}

// POST /api/portal-field-maps — the extension reports an unmapped field it saw
// on a portal page. PROPOSE-ONLY: the row is always written status 'proposed',
// source 'manual', token null, whatever the body says, and always under the
// caller's org (never as a global catalog row). Approving a mapping stays a
// human act in the SOP editor's trainer — see proposeFieldMap for why.
//
// Writer roles only. Idempotent on (portal_key, selector) across global + own
// org, so a field re-observed on every page load converges on one row: a
// repeat returns 200 with the existing row, a first sighting 201.
// POST /api/shared-field-maps — E6.9 F6.9.2/F6.9.8: propose a SHARED
// (`org_id IS NULL`) registry row from Train-forms capture.
//
// USER-scoped (runs on authenticateUser, like /api/me/*): training a payer
// form has no org at all (D10), and the org-resolving guard 400s a multi-org
// caller that sends no x-org-id — which is exactly what training mode sends.
//
// Ungated for any signed-in user (D11): there is no role model, and E6.7
// rejected platform-role gating, so there is deliberately no isWriter check
// here. JWT verification is the gate.
//
// Shape-only: the accepted keys are portal identity, page/section structure,
// label, selector and control type. No field-value key exists in this
// contract, so a value cannot ride in. No audit row (audit_log.org_id is NOT
// NULL and there is no org); the row's updated_at is the trail (D14).
export async function handleProposeSharedFieldMap(
  body: unknown,
  user: UserContext,
): Promise<Response> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(422, "Request body must be a JSON object");
  }
  const result = await proposeSharedFieldMap(user.db, body as SharedProposeBody);
  if (result.kind === "rejected") return fail(result.status, result.message);
  return ok({ map: result.map });
}

export async function handleProposeFieldMap(body: unknown, ctx: AuthContext): Promise<Response> {
  if (!isWriter(ctx)) return fail(403, "Your role cannot propose field mappings");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(422, "Request body must be a JSON object");
  }
  const result = await proposeFieldMap(
    { db: ctx.db, orgId: ctx.orgId, writeAudit: ctx.writeAudit },
    body as ProposeFieldMapInput,
  );
  if (result.kind === "rejected") return fail(result.status, result.message);
  // S5.3: the row PLUS what the org already learned about this label, so the
  // capture UI can offer a suggestion with its evidence instead of a blank
  // grid. The suggestion is advisory only — nothing is approved by proposing.
  return ok(
    { map: result.map, suggestion: result.suggestion },
    null,
    result.kind === "created" ? 201 : 200,
  );
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
// Writer roles only.
//
// Status: still never changed IMPLICITLY (the R2 rule stands). An optional
// `bump_status: true` on a portal_submission additionally moves the case to
// Submitted through set_case_status, evidenced by the touch just written — the
// one transition where "the human submitted the form" has an unambiguous
// meaning. The bump runs after the touch is durable and only on a first create,
// so a retry can never double-apply it; its outcome rides in meta.status_bump
// so the response `data` stays exactly the touch it has always been.
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
    {
      db: ctx.db,
      orgId: ctx.orgId,
      userId: ctx.userId,
      writeAudit: ctx.writeAudit,
    },
    caseId,
    body as SubmissionTouchInput,
  );
  if (result.kind === "rejected") return fail(result.status, result.message);
  // A rejected bump is reported, not raised: the touch landed, and failing the
  // request would tell the extension its submission record was lost when it
  // wasn't.
  const meta: ApiMeta | null =
    result.kind === "created" && result.bump
      ? {
          status_bump: result.bump.applied ? "applied" : "skipped",
          ...(result.bump.reason ? { status_bump_reason: result.bump.reason } : {}),
        }
      : null;
  return ok(result.touch, meta, result.kind === "created" ? 201 : 200);
}

// PATCH /api/tasks/:id/steps — tick one SOP step complete (S4.3, the
// extension's Progress tab). The ONE /api write that touches task state.
//
// Body: { stepId }. Writer roles only. The ordering rule ("finish the earlier
// step first") and the all-done -> task completed rollup come from the pure
// module shared with the webapp path, so the two surfaces can never disagree
// about which step may be ticked. A blocked step is a 409 naming the blocker,
// which the panel renders verbatim rather than inventing its own rule; a
// re-tick of an already-complete step is an idempotent success so a retry
// converges. Cross-org task id -> 404 before any write.
export async function handleCompleteTaskStep(
  taskId: string,
  body: unknown,
  ctx: AuthContext,
): Promise<Response> {
  if (!isWriter(ctx)) return fail(403, "Your role cannot complete task steps");
  if (!UUID_RE.test(taskId)) return fail(404, "Task not found");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(422, "Request body must be a JSON object");
  }
  const stepId = (body as { stepId?: unknown }).stepId;
  if (typeof stepId !== "string" || stepId.trim() === "") {
    return fail(422, "stepId is required");
  }
  const result = await completeTaskStep(
    { db: ctx.db, orgId: ctx.orgId, userId: ctx.userId, writeAudit: ctx.writeAudit },
    taskId,
    stepId,
    new Date().toISOString(),
  );
  if (result.kind === "rejected") return fail(result.status, result.message);
  return ok({ task: result.task, allDone: result.allDone });
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
