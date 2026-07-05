// CORS for the /api surface, driven by the API_CORS_ORIGINS env allowlist
// (comma-separated exact origins, e.g. "chrome-extension://<id>"). Default —
// unset or empty — means NO CORS headers are ever emitted, which is correct
// for same-origin app traffic and non-browser callers (the gate, curl). The
// extension's background service worker uses host_permissions rather than
// CORS, so this allowlist mostly protects against random web pages; it must
// still answer OPTIONS preflights because an Authorization header always
// triggers one.
const ALLOWED_METHODS = "GET, POST, PATCH, OPTIONS";
const ALLOWED_HEADERS = "authorization, content-type, x-org-id";

function allowedOrigins(): Set<string> {
  const raw = process.env.API_CORS_ORIGINS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// The request's Origin when (and only when) it is on the allowlist.
function allowedOriginFor(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return allowedOrigins().has(origin) ? origin : null;
}

// Answer an OPTIONS preflight. 204 always; the access-control-* headers are
// only attached for allowlisted origins.
export function handlePreflight(request: Request): Response {
  const headers = new Headers({ vary: "Origin" });
  const origin = allowedOriginFor(request);
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", ALLOWED_METHODS);
    headers.set("access-control-allow-headers", ALLOWED_HEADERS);
    headers.set("access-control-max-age", "86400");
  }
  return new Response(null, { status: 204, headers });
}

// Attach the allow-origin header to a real (non-preflight) response when the
// caller's Origin is allowlisted. No-op otherwise.
export function withCors(response: Response, request: Request): Response {
  const origin = allowedOriginFor(request);
  if (!origin) return response;
  response.headers.set("access-control-allow-origin", origin);
  response.headers.append("vary", "Origin");
  return response;
}
