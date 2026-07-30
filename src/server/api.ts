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
import { authenticate, authenticateUser, GuardError } from "./guard";
import { handlePreflight, withCors } from "./cors";

// Route handlers pull in their services (and the Supabase client graph). They
// are loaded lazily so /api/health stays free of that graph and proves the
// server-route path even when Supabase env is absent.
const loadProviderRoutes = () => import("./providerRoutes");
const loadExtensionRoutes = () => import("./extensionRoutes");
const loadDocumentRoutes = () => import("./documentRoutes");

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
// `/api/mock-fill-profile` — synthetic token values for an extension DRY RUN,
// served from the same curated module the app's in-editor dry run uses so the
// two can never disagree about what a pass means. No PHI, no provider read.
const MOCK_FILL_PROFILE_ROUTE = /^\/api\/mock-fill-profile\/?$/;
// `/api/me/orgs` — the caller's own memberships (user-scoped, no org context).
const ME_ORGS_ROUTE = /^\/api\/me\/orgs\/?$/;
// `/api/me/view-prefs` — the caller's saved extension quick-card layout
// (user-scoped, no org context — prefs follow the user across orgs).
const ME_VIEW_PREFS_ROUTE = /^\/api\/me\/view-prefs\/?$/;
// E4.5 document storage: signed upload intent, finalize, signed download.
const DOCUMENT_UPLOAD_INTENT_ROUTE = /^\/api\/documents\/upload-intent\/?$/;
const DOCUMENT_FINALIZE_ROUTE = /^\/api\/documents\/finalize\/?$/;
const DOCUMENT_DOWNLOAD_ROUTE = /^\/api\/documents\/([^/]+)\/download\/?$/;

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
  return withCors(await routeApiRequest(request), request);
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
  const isMockFillProfile = MOCK_FILL_PROFILE_ROUTE.test(pathname);
  const isMeOrgs = ME_ORGS_ROUTE.test(pathname);
  const isMeViewPrefs = ME_VIEW_PREFS_ROUTE.test(pathname);
  const isDocumentUploadIntent = DOCUMENT_UPLOAD_INTENT_ROUTE.test(pathname);
  const isDocumentFinalize = DOCUMENT_FINALIZE_ROUTE.test(pathname);
  const documentDownloadMatch =
    isDocumentUploadIntent || isDocumentFinalize ? null : pathname.match(DOCUMENT_DOWNLOAD_ROUTE);
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
    !isMockFillProfile &&
    !isMeOrgs &&
    !isMeViewPrefs &&
    !isDocumentUploadIntent &&
    !isDocumentFinalize &&
    !documentDownloadMatch
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
      const user = await authenticateUser(request);
      const routes = await loadExtensionRoutes();
      return await routes.handleListMyOrgs(user);
    } catch (error) {
      return toErrorResponse(error);
    }
  }
  if (isMeViewPrefs) {
    if (method !== "GET" && method !== "PUT") return fail(405, "Method not allowed");
    try {
      const user = await authenticateUser(request);
      const routes = await loadExtensionRoutes();
      return method === "GET"
        ? await routes.handleGetViewPrefs(user)
        : await routes.handlePutViewPrefs(await readJsonBody(request), user);
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
    if (isMockFillProfile) {
      if (method !== "GET") return fail(405, "Method not allowed");
      const routes = await loadExtensionRoutes();
      return await routes.handleMockFillProfile(ctx);
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
