import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { logServerError, requestSite, withRequestId } from "./server/safeLog";

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    // A raw error can carry row data (SEC-03), so log identifiers only.
    const requestId = logServerError("[start] unhandled error", error, requestSite(request));
    return withRequestId(
      new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
      requestId,
    );
  }
});

// No functionMiddleware: the generated attachSupabaseAuth middleware (and the
// dead generated client.ts it imported) was removed Jul 2026 — there are zero
// createServerFn call sites, and the client it depended on read an env var the
// app never sets, so the first serverFn would have thrown. If serverFns are
// ever introduced, attach auth against externalClient.ts instead.
export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
}));
