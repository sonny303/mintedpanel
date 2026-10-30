import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { logServerError, requestSite, withRequestId } from "./server/safeLog";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// A 500 HTML error page that carries the correlation id of its log line.
function errorPageResponse(requestId: string): Response {
  return withRequestId(
    new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
    requestId,
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
// The captured error can be any throw, a PostgREST error object included, so
// it is logged through ./server/safeLog.ts like every other server fault.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  request: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  const requestId = logServerError(
    "[server] h3 swallowed SSR error",
    consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`),
    requestSite(request),
  );
  return errorPageResponse(requestId);
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Serve /api/* from our own router before falling through to SSR. This
      // version of TanStack Start has no file-based server-route API, so the
      // nitro fetch entry is the server-route path (see src/server/api.ts).
      // The router owns the whole /api prefix — keep in sync with isApiRequest.
      const pathname = new URL(request.url).pathname;
      if (pathname === "/api" || pathname.startsWith("/api/")) {
        const { handleApiRequest } = await import("./server/api");
        return await handleApiRequest(request);
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response, request);
    } catch (error) {
      return errorPageResponse(
        logServerError("[server] unhandled error", error, requestSite(request)),
      );
    }
  },
};
