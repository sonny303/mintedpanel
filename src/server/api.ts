// Minimal /api router, dispatched from the nitro server entry (src/server.ts).
//
// This TanStack Start version ships no file-based server-route API
// (`createServerFileRoute` and friends are absent), so REST endpoints are served
// from the nitro fetch entry instead. The router owns the whole /api/* prefix
// (kept in sync with the check in src/server.ts): every data route goes through
// the shared `authenticate` guard, only /api/health is public, unknown /api
// paths get a JSON 404, and OPTIONS preflights are answered for the
// API_CORS_ORIGINS allowlist (see ./cors.ts).
import { ok, fail } from "./envelope";
import {
  authenticate,
  authenticateUser,
  GuardError,
  rememberVerifiedUser,
  type UserContext,
} from "./guard";
import { handlePreflight, withCors } from "./cors";
import {
  handleClaimClientInvite,
  handleCreateClientInvite,
  handleGetAccessContext,
  handleRevokeClientAccess,
  handleSelectAccessContext,
  handleSetClientGroupGrants,
} from "./clientAccessRoutes";
import { resolveEnrollmentContext } from "@/services/clientAccess";
import type { EnrollmentExplorerAudience } from "@/types";

// Route handlers pull in their services (and the Supabase client graph). They
// are loaded lazily so /api/health stays free of that graph and proves the
// server-route path even when Supabase env is absent.
const loadProviderRoutes = () => import("./providerRoutes");
const loadExtensionRoutes = () => import("./extensionRoutes");
const loadDocumentRoutes = () => import("./documentRoutes");
const loadPayerFormRoutes = () => import("./payerFormRoutes");

// `/api/providers/:id/profile` — must be matched before the generic :id route.
const PROVIDER_PROFILE_ROUTE = /^\/api\/providers\/([^/]+)\/profile\/?$/;
// `/api/providers/:id/ssn-release?caseId=` — E4.4 fill-only SSN release. Must be
// matched before the generic :id route.
const SSN_RELEASE_ROUTE = /^\/api\/providers\/([^/]+)\/ssn-release\/?$/;
// `/api/providers/:id/caqh-attestation` — record a CAQH re-attestation. Must
// be matched before the generic :id route.
const CAQH_ATTESTATION_ROUTE = /^\/api\/providers\/([^/]+)\/caqh-attestation\/?$/;
// `/api/providers` and `/api/providers/:id`
const PROVIDERS_ROUTE = /^\/api\/providers(?:\/([^/]+))?\/?$/;
// GET lists the shared catalog; POST proposes an unmapped field (propose-only).
// `/api/tasks/:id/steps` — the S4.3 step tick (the one /api task-state write).
const TASK_STEPS_ROUTE = /^\/api\/tasks\/([^/]+)\/steps\/?$/;
const PORTAL_FIELD_MAPS_ROUTE = /^\/api\/portal-field-maps\/?$/;
// E6.9 F6.9.8: the ORG-FREE shared propose path. A separate route rather than
// a mode flag on the org one, because the two run on different guards.
const SHARED_FIELD_MAPS_ROUTE = /^\/api\/shared-field-maps\/?$/;
// `/api/shared-portals` — the GLOBAL registry read that pairs with it, so a
// trainer can recognize the open page without ever naming an org.
const SHARED_PORTALS_ROUTE = /^\/api\/shared-portals\/?$/;
// Manual proven_at stamp for a GLOBAL portal (Train "Mark proven"). Separate
// from the dry-run fill log — a pass never auto-proves.
const SHARED_PORTALS_PROVE_ROUTE = /^\/api\/shared-portals\/prove\/?$/;
// Train mock dry-run machine log (is_test fill_sessions, case/provider null).
const SHARED_TEST_FILLS_ROUTE = /^\/api\/shared-test-fills\/?$/;
// `/api/portals` — the DB-driven payer-portal registry the extension matches
// the current tab against.
const PORTALS_ROUTE = /^\/api\/portals\/?$/;
const FILL_EVENTS_ROUTE = /^\/api\/fill-events\/?$/;
// `/api/cases?providerId=` — the extension popup's case dropdown.
const CASES_ROUTE = /^\/api\/cases\/?$/;
// `/api/cases/:id/touches` — the extension's "Mark submitted" business log.
const CASE_TOUCHES_ROUTE = /^\/api\/cases\/([^/]+)\/touches\/?$/;
// `/api/cases/:id/context` — the Workbench's post-selection case context read.
const CASE_CONTEXT_ROUTE = /^\/api\/cases\/([^/]+)\/context\/?$/;
// `/api/next-best-action` — the extension's queue-top read (log-and-advance).
const NEXT_BEST_ACTION_ROUTE = /^\/api\/next-best-action\/?$/;
// `/api/me/orgs` — the caller's own memberships (user-scoped, no org context).
const ME_ORGS_ROUTE = /^\/api\/me\/orgs\/?$/;
// `/api/me/view-prefs` — the caller's saved extension quick-card layout
// (user-scoped, no org context — prefs follow the user across orgs).
const ME_VIEW_PREFS_ROUTE = /^\/api\/me\/view-prefs\/?$/;
const ME_ACCESS_CONTEXT_ROUTE = /^\/api\/me\/access-context\/?$/;
const ME_ACCESS_CONTEXT_SELECT_ROUTE = /^\/api\/me\/access-context\/select\/?$/;
const ME_CLIENT_INVITE_CLAIM_ROUTE = /^\/api\/me\/client-invites\/claim\/?$/;
const INTERNAL_CLIENT_INVITES_ROUTE = /^\/api\/internal\/client-invites\/?$/;
const INTERNAL_CLIENT_GROUPS_ROUTE = /^\/api\/internal\/client-access\/([^/]+)\/groups\/?$/;
const INTERNAL_CLIENT_REVOKE_ROUTE = /^\/api\/internal\/client-access\/([^/]+)\/revoke\/?$/;
// E4.5 document storage: signed upload intent, finalize, signed download.
const DOCUMENT_UPLOAD_INTENT_ROUTE = /^\/api\/documents\/upload-intent\/?$/;
const DOCUMENT_FINALIZE_ROUTE = /^\/api\/documents\/finalize\/?$/;
const DOCUMENT_DOWNLOAD_ROUTE = /^\/api\/documents\/([^/]+)\/download\/?$/;
// Payer PDF storage: the same three signing endpoints for GLOBAL payer forms.
const PAYER_FORM_UPLOAD_INTENT_ROUTE = /^\/api\/payer-forms\/upload-intent\/?$/;
const PAYER_FORM_FINALIZE_ROUTE = /^\/api\/payer-forms\/finalize\/?$/;
const PAYER_FORM_DOWNLOAD_ROUTE = /^\/api\/payer-forms\/([^/]+)\/download\/?$/;

// Keep verified user context request-scoped. Legacy routes retain one auth
// call while the additive context-revision header reuses that actor after
// dispatch.
const requestUserCache = new WeakMap<Request, UserContext>();

async function authenticateUserForRequest(request: Request): Promise<UserContext> {
  const cached = requestUserCache.get(request);
  if (cached) return cached;
  const user = await authenticateUser(request);
  rememberVerifiedUser(request, user);
  requestUserCache.set(request, user);
  return user;
}

// Paths this router owns. Kept in sync with the check in src/server.ts.
export function isApiRequest(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// Map a thrown error to a response. A GuardError carries its own status and a
// safe, caller-facing message, so pass it through. Anything else is an internal
// fault — e.g. a missing SUPABASE_SERVICE_ROLE_KEY making getServiceClient()
// throw — so log the real error server-side (nitro/Vercel captures console.error)
// and return a generic 500. This keeps a server misconfiguration from being
// masked as a 401 and never leaks internal details in the response body.
function toErrorResponse(error: unknown): Response {
  if (error instanceof GuardError) return fail(error.status, error.message);
  console.error(
    "[api] internal error:",
    error instanceof Error ? `${error.message}\n${error.stack}` : error,
  );
  return fail(500, "Internal server error");
}

export async function handleApiRequest(request: Request): Promise<Response> {
  // Authorization/x-org-id always trigger a browser preflight; answer it
  // before auth (a preflight carries no credentials by definition).
  if (request.method.toUpperCase() === "OPTIONS") return handlePreflight(request);
  const requestPath = new URL(request.url).pathname;
  if (
    requestPath === "/api/enrollment-explorer" ||
    requestPath.startsWith("/api/enrollment-explorer/")
  ) {
    return withCors(await handleEnrollmentExplorerApiRequest(request), request);
  }
  const operation = await resolveOperationContext(request);
  if (operation && "error" in operation) {
    return withCors(toErrorResponse(operation.error), request);
  }
  if (operation?.restrictedExternal && !allowsRestrictedClientRoute(request)) {
    return withCors(fail(403, "Restricted client cannot use this route"), request);
  }
  const response = await routeApiRequest(request);
  if (operation?.user && response.status < 400 && !isAuthoritativeContextRoute(request)) {
    let current: { contextRevision: string };
    try {
      current = await resolveEnrollmentContext({
        db: operation.user.db,
        actorUserId: operation.user.userId,
      });
    } catch (error) {
      if (isRevisionBoundRead(request)) {
        return withCors(toErrorResponse(error), request);
      }
      // The mutation may already have committed. Keep its response body and
      // make the browser refresh instead of attaching a stale fingerprint.
      response.headers.set("X-Minted-Context-Revision", "unknown");
      return withCors(response, request);
    }
    if (isRevisionBoundRead(request) && current.contextRevision !== operation.revision) {
      return withCors(fail(409, "Access context changed; retry the request"), request);
    }
    response.headers.set("X-Minted-Context-Revision", current.contextRevision);
  } else if (
    operation?.revision &&
    response.status < 400 &&
    !response.headers.has("X-Minted-Context-Revision")
  ) {
    response.headers.set("X-Minted-Context-Revision", operation.revision);
  }
  return withCors(response, request);
}

/** E6.13 makes audience selection explicit because one identity may have both
 * staff and client grants. Never reuse the default context or infer staff. */
async function handleEnrollmentExplorerApiRequest(request: Request): Promise<Response> {
  const noStoreFailure = (status: number, message: string, revision?: string) => {
    const response = fail(status, message);
    response.headers.set("cache-control", "no-store, max-age=0");
    response.headers.set("pragma", "no-cache");
    if (revision) response.headers.set("x-minted-context-revision", revision);
    return response;
  };
  const contextFailure = (error: unknown, statusForUnavailable: number): Response => {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "P0001") {
      const message = (error as Error).message;
      if (message === "Verified actor is unavailable") {
        return noStoreFailure(401, "Your session is no longer active; sign in again");
      }
      if (message === "Unsupported audience") {
        return noStoreFailure(400, "Choose a supported enrollment audience");
      }
      return noStoreFailure(
        statusForUnavailable,
        "Selected enrollment access is no longer available",
      );
    }
    return noStoreFailure(500, "Unable to resolve enrollment access");
  };
  try {
    if (hasForgedActorTransport(request)) {
      return noStoreFailure(400, "Actor identity is derived from the verified session");
    }
    const user = await authenticateUserForRequest(request);
    const orgId = request.headers.get("x-org-id") ?? "";
    const audience = request.headers.get("x-enrollment-audience");
    const requestedRevision = request.headers.get("x-minted-context-revision");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
      return noStoreFailure(400, "A valid x-org-id header is required");
    }
    if (audience !== "staff" && audience !== "client") {
      return noStoreFailure(400, "Choose an explicit enrollment audience");
    }
    if (!requestedRevision) {
      return noStoreFailure(409, "Access context is missing; refresh before retrying", "unknown");
    }
    const selectedAudience = audience as EnrollmentExplorerAudience;
    let current;
    try {
      current = await resolveEnrollmentContext(
        { db: user.db, actorUserId: user.userId },
        { audience: selectedAudience, orgId },
      );
    } catch (error) {
      return contextFailure(error, 403);
    }
    if (current.audience !== selectedAudience || current.selectedOrgId !== orgId) {
      return noStoreFailure(403, "Selected enrollment audience is not available");
    }
    if (current.contextRevision !== requestedRevision) {
      return noStoreFailure(
        409,
        "Access context changed; retry the request",
        current.contextRevision,
      );
    }
    const routes = await import("./enrollmentExplorerRoutes");
    const response = await routes.handleEnrollmentExplorerRequest(request, user, {
      orgId,
      audience: selectedAudience,
    });
    response.headers.set("x-minted-context-revision", current.contextRevision);
    if (response.status >= 400) return response;
    try {
      const after = await resolveEnrollmentContext(
        { db: user.db, actorUserId: user.userId },
        { audience: selectedAudience, orgId },
      );
      if (after.contextRevision !== current.contextRevision) {
        if (request.method.toUpperCase() === "GET") {
          return noStoreFailure(
            409,
            "Access context changed; retry the request",
            after.contextRevision,
          );
        }
        response.headers.set("x-minted-context-revision", "unknown");
      } else {
        response.headers.set("x-minted-context-revision", after.contextRevision);
      }
    } catch (error) {
      if (request.method.toUpperCase() === "GET") {
        const stale = contextFailure(error, 409);
        stale.headers.set("x-minted-context-revision", "unknown");
        return stale;
      }
      response.headers.set("x-minted-context-revision", "unknown");
    }
    return response;
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set("cache-control", "no-store, max-age=0");
    response.headers.set("pragma", "no-cache");
    return response;
  }
}

// Existing response envelopes remain unchanged. Capture the fingerprint before
// dispatch so the additive header describes the authority used for the read or
// mutation, rather than a fresh post-response lookup.
async function resolveOperationContext(
  request: Request,
): Promise<
  { revision: string; restrictedExternal: boolean; user: UserContext } | { error: unknown } | null
> {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/health" || hasForgedActorTransport(request)) return null;
  let user: UserContext;
  try {
    user = await authenticateUserForRequest(request);
  } catch {
    // Route dispatch owns the caller-facing auth/error response.
    return null;
  }
  // Test doubles and partial adapters may omit the service client. Production
  // authenticateUser always returns one; leave those callers to route dispatch
  // so the legacy routing tests can keep exercising their own auth seam.
  if (!user?.db) return null;
  try {
    const context = await resolveEnrollmentContext({ db: user.db, actorUserId: user.userId });
    return {
      revision: context.contextRevision,
      restrictedExternal: context.restrictedExternal,
      user,
    };
  } catch (error) {
    // Once the bearer token is verified, an unavailable capability snapshot is
    // a server fault. Continuing into a legacy service-role route would lose
    // the restricted-client deny boundary.
    return { error };
  }
}

function isAuthoritativeContextRoute(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  return ME_ACCESS_CONTEXT_ROUTE.test(pathname) || ME_ACCESS_CONTEXT_SELECT_ROUTE.test(pathname);
}

function isRevisionBoundRead(request: Request): boolean {
  const url = new URL(request.url);
  if (request.method.toUpperCase() !== "GET") return false;
  return url.pathname !== "/api/health" && !isAuthoritativeContextRoute(request);
}

function allowsRestrictedClientRoute(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  return (
    ME_ACCESS_CONTEXT_ROUTE.test(pathname) ||
    ME_ACCESS_CONTEXT_SELECT_ROUTE.test(pathname) ||
    ME_CLIENT_INVITE_CLAIM_ROUTE.test(pathname)
  );
}

async function authenticateGlobalTrainer(request: Request) {
  const user = await authenticateUserForRequest(request);
  const context = await resolveEnrollmentContext({ db: user.db, actorUserId: user.userId });
  if (!context.globalTraining) {
    throw new GuardError(403, "Restricted client cannot use global training");
  }
  return user;
}

function hasForgedActorTransport(request: Request): boolean {
  const url = new URL(request.url);
  for (const key of ["actorUserId", "actorId", "userId", "actor_user_id", "p_actor_user_id"]) {
    if (url.searchParams.has(key)) return true;
  }
  return ["x-actor-user-id", "x-actor-id", "x-user-id", "x-auth-user-id"].some((name) =>
    request.headers.has(name),
  );
}

async function routeApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  // Public health check — proves the server route path without touching Supabase.
  if (pathname === "/api/health") {
    if (method !== "GET") return fail(405, "Method not allowed");
    return ok("ok");
  }

  const profileMatch = pathname.match(PROVIDER_PROFILE_ROUTE);
  const ssnReleaseMatch = pathname.match(SSN_RELEASE_ROUTE);
  const caqhMatch = pathname.match(CAQH_ATTESTATION_ROUTE);
  const providersMatch =
    profileMatch || ssnReleaseMatch || caqhMatch ? null : pathname.match(PROVIDERS_ROUTE);
  const isFieldMaps = PORTAL_FIELD_MAPS_ROUTE.test(pathname);
  const isPortals = PORTALS_ROUTE.test(pathname);
  const taskStepsMatch = pathname.match(TASK_STEPS_ROUTE);
  const isFillEvents = FILL_EVENTS_ROUTE.test(pathname);
  const isCases = CASES_ROUTE.test(pathname);
  const caseTouchesMatch = pathname.match(CASE_TOUCHES_ROUTE);
  const caseContextMatch = pathname.match(CASE_CONTEXT_ROUTE);
  const isNextBestAction = NEXT_BEST_ACTION_ROUTE.test(pathname);
  const isMeOrgs = ME_ORGS_ROUTE.test(pathname);
  const isMeViewPrefs = ME_VIEW_PREFS_ROUTE.test(pathname);
  const isAccessContext = ME_ACCESS_CONTEXT_ROUTE.test(pathname);
  const isAccessContextSelect = ME_ACCESS_CONTEXT_SELECT_ROUTE.test(pathname);
  const isClientInviteClaim = ME_CLIENT_INVITE_CLAIM_ROUTE.test(pathname);
  const isInternalClientInvites = INTERNAL_CLIENT_INVITES_ROUTE.test(pathname);
  const clientGroupsMatch = INTERNAL_CLIENT_GROUPS_ROUTE.exec(pathname);
  const clientRevokeMatch = INTERNAL_CLIENT_REVOKE_ROUTE.exec(pathname);
  const isSharedFieldMaps = SHARED_FIELD_MAPS_ROUTE.test(pathname);
  const isSharedPortals = SHARED_PORTALS_ROUTE.test(pathname);
  const isSharedPortalsProve = SHARED_PORTALS_PROVE_ROUTE.test(pathname);
  const isSharedTestFills = SHARED_TEST_FILLS_ROUTE.test(pathname);
  const isDocumentUploadIntent = DOCUMENT_UPLOAD_INTENT_ROUTE.test(pathname);
  const isDocumentFinalize = DOCUMENT_FINALIZE_ROUTE.test(pathname);
  const documentDownloadMatch =
    isDocumentUploadIntent || isDocumentFinalize ? null : pathname.match(DOCUMENT_DOWNLOAD_ROUTE);
  const isPayerFormUploadIntent = PAYER_FORM_UPLOAD_INTENT_ROUTE.test(pathname);
  const isPayerFormFinalize = PAYER_FORM_FINALIZE_ROUTE.test(pathname);
  const payerFormDownloadMatch =
    isPayerFormUploadIntent || isPayerFormFinalize
      ? null
      : pathname.match(PAYER_FORM_DOWNLOAD_ROUTE);
  if (
    !profileMatch &&
    !ssnReleaseMatch &&
    !caqhMatch &&
    !providersMatch &&
    !isFieldMaps &&
    !isPortals &&
    !taskStepsMatch &&
    !isFillEvents &&
    !isCases &&
    !caseTouchesMatch &&
    !caseContextMatch &&
    !isNextBestAction &&
    !isMeOrgs &&
    !isMeViewPrefs &&
    !isAccessContext &&
    !isAccessContextSelect &&
    !isClientInviteClaim &&
    !isInternalClientInvites &&
    !clientGroupsMatch &&
    !clientRevokeMatch &&
    !isSharedFieldMaps &&
    !isSharedPortals &&
    !isSharedPortalsProve &&
    !isSharedTestFills &&
    !isDocumentUploadIntent &&
    !isDocumentFinalize &&
    !documentDownloadMatch &&
    !isPayerFormUploadIntent &&
    !isPayerFormFinalize &&
    !payerFormDownloadMatch
  ) {
    return fail(404, "Not found");
  }

  // /api/me/* runs on the user-only auth step — no org resolution. These are
  // user-scoped: org discovery (/orgs) must work for a multi-org caller BEFORE
  // they can send x-org-id, and layout prefs (/view-prefs) follow the user
  // across orgs. The guard's multi-org 400 must not apply here; the services
  // filter by the JWT-verified user id alone.
  if (isMeOrgs) {
    if (method !== "GET") return fail(405, "Method not allowed");
    try {
      const user = await authenticateUserForRequest(request);
      const routes = await loadExtensionRoutes();
      return await routes.handleListMyOrgs(user);
    } catch (error) {
      return toErrorResponse(error);
    }
  }
  if (isMeViewPrefs) {
    if (method !== "GET" && method !== "PUT") return fail(405, "Method not allowed");
    try {
      const user = await authenticateUserForRequest(request);
      const routes = await loadExtensionRoutes();
      return method === "GET"
        ? await routes.handleGetViewPrefs(user)
        : await routes.handlePutViewPrefs(await readJsonBody(request), user);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  // E6.12 access-context and client-invite routes run on the user-only guard.
  // The server derives the actor from the verified bearer token; every service
  // RPC independently rechecks that actor, org, manifest, and grant scope.
  if (
    isAccessContext ||
    isAccessContextSelect ||
    isClientInviteClaim ||
    isInternalClientInvites ||
    clientGroupsMatch ||
    clientRevokeMatch
  ) {
    try {
      if (hasForgedActorTransport(request)) {
        return fail(400, "Actor identity is derived from the verified session");
      }
      const user = await authenticateUserForRequest(request);
      if (isAccessContext) {
        if (method !== "GET") return fail(405, "Method not allowed");
        const routes = await import("./clientAccessRoutes");
        return await routes.handleGetAccessContext(user);
      }
      if (isAccessContextSelect) {
        if (method !== "POST") return fail(405, "Method not allowed");
        return await handleSelectAccessContext(await readJsonBody(request), user);
      }
      if (isClientInviteClaim) {
        if (method !== "POST") return fail(405, "Method not allowed");
        return await handleClaimClientInvite(await readJsonBody(request), user);
      }
      if (isInternalClientInvites) {
        if (method !== "POST") return fail(405, "Method not allowed");
        return await handleCreateClientInvite(await readJsonBody(request), user, request.url);
      }
      if (clientGroupsMatch) {
        if (method !== "PUT") return fail(405, "Method not allowed");
        return await handleSetClientGroupGrants(
          clientGroupsMatch[1],
          await readJsonBody(request),
          user,
        );
      }
      if (clientRevokeMatch) {
        if (method !== "POST") return fail(405, "Method not allowed");
        return await handleRevokeClientAccess(
          clientRevokeMatch[1],
          await readJsonBody(request),
          user,
        );
      }
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  // E6.9 F6.9.2/F6.9.8 — training the shared form library has NO org (D10), so
  // this runs on the user-only auth step like /api/me/*. The org-resolving
  // guard cannot serve it: it 400s a multi-org caller that sends no x-org-id,
  // which is exactly what training mode sends. Verified global-training
  // capability is resolved before the handler and service-role reads run.
  if (isSharedFieldMaps) {
    if (method !== "POST" && method !== "GET") return fail(405, "Method not allowed");
    try {
      const user = await authenticateGlobalTrainer(request);
      const routes = await loadExtensionRoutes();
      return method === "GET"
        ? await routes.handleListSharedFieldMaps(url, user)
        : await routes.handleProposeSharedFieldMap(await readJsonBody(request), user);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  // The read half of the same tier, on the same user-scoped guard. Global rows
  // only — with no org in scope there is nothing to widen it to, which is what
  // keeps another org's private registry rows unreachable here.
  if (isSharedPortals) {
    if (method !== "GET") return fail(405, "Method not allowed");
    try {
      const user = await authenticateGlobalTrainer(request);
      const routes = await loadExtensionRoutes();
      return await routes.handleListSharedPortals(user);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  // Manual prove for a GLOBAL portal — never auto-called from a dry-run pass.
  if (isSharedPortalsProve) {
    if (method !== "POST") return fail(405, "Method not allowed");
    try {
      const user = await authenticateGlobalTrainer(request);
      const routes = await loadExtensionRoutes();
      return await routes.handleProveSharedPortal(await readJsonBody(request), user);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  // Train mock dry-run fill log (is_test). Telemetry org from body.orgId /
  // sole membership — not an implicit multi-org guess.
  if (isSharedTestFills) {
    if (method !== "POST") return fail(405, "Method not allowed");
    try {
      const user = await authenticateGlobalTrainer(request);
      const routes = await loadExtensionRoutes();
      return await routes.handleRecordSharedTestFill(await readJsonBody(request), user);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  let ctx;
  try {
    const requestedOrgId = request.headers.get("x-org-id") ?? url.searchParams.get("orgId");
    ctx = await authenticate(request, requestedOrgId);
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    if (profileMatch) {
      if (method !== "GET") return fail(405, "Method not allowed");
      const routes = await loadExtensionRoutes();
      return await routes.handleProviderProfile(profileMatch[1], url, ctx);
    }
    if (ssnReleaseMatch) {
      if (method !== "GET") return fail(405, "Method not allowed");
      const routes = await loadExtensionRoutes();
      return await routes.handleSsnRelease(ssnReleaseMatch[1], url, ctx);
    }
    if (caqhMatch) {
      if (method !== "POST") return fail(405, "Method not allowed");
      const routes = await loadProviderRoutes();
      return await routes.handleRecordCaqhAttestation(
        caqhMatch[1],
        await readJsonBody(request),
        ctx,
        new Date().toISOString().slice(0, 10),
      );
    }
    if (isFieldMaps) {
      if (method !== "GET" && method !== "POST") return fail(405, "Method not allowed");
      const routes = await loadExtensionRoutes();
      return method === "GET"
        ? await routes.handleListPortalFieldMaps(url, ctx)
        : await routes.handleProposeFieldMap(await readJsonBody(request), ctx);
    }
    if (isPortals) {
      if (method !== "GET") return fail(405, "Method not allowed");
      const routes = await loadExtensionRoutes();
      return await routes.handleListPortals(url, ctx);
    }
    if (taskStepsMatch) {
      if (method !== "PATCH") return fail(405, "Method not allowed");
      const routes = await loadExtensionRoutes();
      return await routes.handleCompleteTaskStep(
        taskStepsMatch[1],
        await readJsonBody(request),
        ctx,
      );
    }
    if (isFillEvents) {
      if (method !== "POST") return fail(405, "Method not allowed");
      const routes = await loadExtensionRoutes();
      return await routes.handleCreateFillEvent(await readJsonBody(request), ctx);
    }
    if (isCases) {
      if (method !== "GET") return fail(405, "Method not allowed");
      const routes = await loadExtensionRoutes();
      return await routes.handleListProviderCases(url, ctx);
    }
    if (caseTouchesMatch) {
      if (method !== "POST") return fail(405, "Method not allowed");
      const routes = await loadExtensionRoutes();
      return await routes.handleCreateCaseTouch(
        caseTouchesMatch[1],
        await readJsonBody(request),
        ctx,
      );
    }
    if (caseContextMatch) {
      if (method !== "GET") return fail(405, "Method not allowed");
      const routes = await loadExtensionRoutes();
      return await routes.handleCaseContext(caseContextMatch[1], ctx);
    }
    if (isNextBestAction) {
      if (method !== "GET") return fail(405, "Method not allowed");
      const routes = await loadExtensionRoutes();
      return await routes.handleNextBestAction(url, ctx);
    }
    if (isDocumentUploadIntent) {
      if (method !== "POST") return fail(405, "Method not allowed");
      const routes = await loadDocumentRoutes();
      return await routes.handleCreateUploadIntent(await readJsonBody(request), ctx);
    }
    if (isDocumentFinalize) {
      if (method !== "POST") return fail(405, "Method not allowed");
      const routes = await loadDocumentRoutes();
      return await routes.handleFinalizeDocument(await readJsonBody(request), ctx);
    }
    if (documentDownloadMatch) {
      if (method !== "GET") return fail(405, "Method not allowed");
      const routes = await loadDocumentRoutes();
      return await routes.handleDocumentDownload(documentDownloadMatch[1], ctx);
    }
    if (isPayerFormUploadIntent) {
      if (method !== "POST") return fail(405, "Method not allowed");
      const routes = await loadPayerFormRoutes();
      return await routes.handleCreatePayerFormUploadIntent(await readJsonBody(request), ctx);
    }
    if (isPayerFormFinalize) {
      if (method !== "POST") return fail(405, "Method not allowed");
      const routes = await loadPayerFormRoutes();
      return await routes.handleFinalizePayerForm(await readJsonBody(request), ctx);
    }
    if (payerFormDownloadMatch) {
      if (method !== "GET") return fail(405, "Method not allowed");
      const routes = await loadPayerFormRoutes();
      return await routes.handlePayerFormDownload(payerFormDownloadMatch[1], ctx);
    }

    const routes = await loadProviderRoutes();
    const id = providersMatch?.[1];
    if (!id) {
      if (method === "GET") return await routes.handleListProviders(url, ctx);
      if (method === "POST")
        return await routes.handleCreateProvider(await readJsonBody(request), ctx);
      return fail(405, "Method not allowed");
    }
    if (method === "GET") return await routes.handleGetProvider(id, ctx);
    if (method === "PATCH")
      return await routes.handleUpdateProvider(id, await readJsonBody(request), ctx);
    return fail(405, "Method not allowed");
  } catch (error) {
    return toErrorResponse(error);
  }
}
