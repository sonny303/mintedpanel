// Minimal /api router, dispatched from the nitro server entry (src/server.ts).
//
// This TanStack Start version ships no file-based server-route API
// (`createServerFileRoute` and friends are absent), so REST endpoints are served
// from the nitro fetch entry instead. Every data route goes through the shared
// `authenticate` guard; only /api/health is public.
import { ok, fail } from "./envelope";
import { authenticate, GuardError } from "./guard";

// The provider handlers pull in the provider service (and its browser-client
// import). They are loaded lazily so /api/health stays free of that graph and
// proves the server-route path even when Supabase env is absent.
const loadProviderRoutes = () => import("./providerRoutes");

// `/api/providers` and `/api/providers/:id`
const PROVIDERS_ROUTE = /^\/api\/providers(?:\/([^/]+))?\/?$/;

// Paths this router owns. Kept in sync with the check in src/server.ts.
export function isApiRequest(pathname: string): boolean {
  return pathname === "/api/health" || pathname.startsWith("/api/providers");
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
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  // Public health check — proves the server route path without touching Supabase.
  if (pathname === "/api/health") {
    if (method !== "GET") return fail(405, "Method not allowed");
    return ok("ok");
  }

  const match = pathname.match(PROVIDERS_ROUTE);
  if (!match) return fail(404, "Not found");
  const id = match[1];

  let ctx;
  try {
    const requestedOrgId = request.headers.get("x-org-id") ?? url.searchParams.get("orgId");
    ctx = await authenticate(request, requestedOrgId);
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    const routes = await loadProviderRoutes();
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
