#!/usr/bin/env node

import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true },
});

try {
  await server.ssrLoadModule("/scripts/benchmarks/matrix-derive-benchmark.ts");
} finally {
  await server.close();
}
