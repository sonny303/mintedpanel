// Replaces @lovable.dev/vite-tanstack-config with the equivalent explicit setup.
// The wrapper's Lovable-editor-only plugins (componentTagger, hmr-gate, dev-server
// bridge, sandbox detection, editor error loggers) are intentionally dropped; the
// build-relevant behavior below is reproduced 1:1.
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ command, mode }) => {
  // Bake VITE_* vars (from .env files and the process env) into both client and
  // server bundles, matching the wrapper's envDefine behavior.
  const envDefine: Record<string, string> = {};
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), "VITE_"))) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  const isDevBuild = command === "build" && mode === "development";

  return {
    define: envDefine,
    // Client-scoped so React DevTools gets the dev react-dom; a global NODE_ENV
    // flip would emit jsxDEV, which the react-server SSR runtime can't resolve.
    ...(isDevBuild
      ? {
          environments: {
            client: { define: { "process.env.NODE_ENV": JSON.stringify("development") } },
          },
          esbuild: { keepNames: true },
        }
      : {}),
    // Match the build's CSS pipeline in dev. Vite uses PostCSS in dev and only
    // runs Lightning CSS at build, so build-time transforms (e.g. collapsing a
    // hand-written `-webkit-backdrop-filter` to the prefixed form Chrome ignores)
    // break the built/static output while the dev preview looks fine. Running
    // Lightning CSS in both keeps the preview honest.
    css: { transformer: "lightningcss" },
    resolve: {
      alias: {
        "@": `${process.cwd()}/src`,
      },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    // Pre-bundle the always-present client deps + tolerate stale requests. React
    // core only — including @tanstack/react-start would pull its node:async_hooks
    // server entry into the client bundle and crash hydration.
    optimizeDeps: {
      include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
      ignoreOutdatedRequests: true,
    },
    server: {
      // The wrapper pinned "::", which crashes on IPv4-only hosts; `true` binds
      // all available interfaces on either stack.
      host: true,
      port: 8080,
      watch: { awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 } },
    },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        importProtection: {
          behavior: "error",
          client: {
            files: ["**/server/**"],
            specifiers: ["server-only"],
          },
        },
        // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR
        // error wrapper). nitro/vite builds from this.
        server: { entry: "server" },
      }),
      // Build-only deploy plugin. defaultPreset only applies when no provider is
      // auto-detected (Vercel CI detects itself and emits Build Output API).
      ...(command === "build" ? [nitro({ defaultPreset: "cloudflare-module" })] : []),
      viteReact(),
    ],
  };
});
