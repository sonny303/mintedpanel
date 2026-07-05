import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
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
