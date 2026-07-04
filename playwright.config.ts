import { defineConfig, devices } from "@playwright/test";

// Smoke skeleton (Gate 0). See docs/minted-panel-phase-gates.md.
// Serves the app via the Vite dev server with dummy Supabase env vars: the app
// only needs a valid-looking VITE_SUPABASE_URL/ANON_KEY to construct its client;
// the unauthenticated paths these specs exercise make no network call
// (getSession reads localStorage). Writes/authenticated flows are test.skip'd
// until a seeded test tenant exists — never run them against KFP prod data.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8080",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
