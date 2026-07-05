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
import { authenticate, GuardError } from "./guard";
import { handlePreflight, withCors } from "./cors";

// Route handlers pull in their services (and the Supabase client graph). They
// are loaded lazily so /api/health stays free of that graph and proves the
// server-route path even when Supabase env is absent.
const loadProviderRoutes = () => import("./providerRoutes");
const loadExtensionRoutes = () => import("./extensionRoutes");

// `/api/providers/:id/profile` — must be matched before the generic :id route.
const PROVIDER_PROFILE_ROUTE = /^\/api\/providers\/([^/]+)\/profile\/?$/;
// `/api/providers` and `/api/providers/:id`
const PROVIDERS_ROUTE = /^\/api\/providers(?:\/([^/]+))?\/?$/;
const PORTAL_FIELD_MAPS_ROUTE = /^\/api\/portal-field-maps\/?$/;
const FILL_EVENTS_ROUTE = /^\/api\/fill-events\/?$/;
// `/api/cases?providerId=` — the extension popup's case dropdown.
const CASES_ROUTE = /^\/api\/cases\/?$/;

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
  const providersMatch = profileMatch ? null : pathname.match(PROVIDERS_ROUTE);
  const isFieldMaps = PORTAL_FIELD_MAPS_ROUTE.test(pathname);
  const isFillEvents = FILL_EVENTS_ROUTE.test(pathname);
  const isCases = CASES_ROUTE.test(pathname);
  if (!profileMatch && !providersMatch && !isFieldMaps && !isFillEvents && !isCases) {
    return fail(404, "Not found");
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
    if (isFieldMaps) {
      if (method !== "GET") return fail(405, "Method not allowed");
      const routes = await loadExtensionRoutes();
      return await routes.handleListPortalFieldMaps(url, ctx);
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
