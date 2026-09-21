import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "fs";

const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium";
const LOCAL_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LINUX_CHROME = "/opt/google/chrome/chrome";
const CHROME_EXECUTABLE = existsSync(SANDBOX_CHROMIUM)
  ? SANDBOX_CHROMIUM
  : existsSync(LOCAL_CHROME)
    ? LOCAL_CHROME
    : existsSync(LINUX_CHROME)
      ? LINUX_CHROME
      : undefined;

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
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: CHROME_EXECUTABLE,
        },
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? "dummy-anon-key",
      // Mocked-browser layer only. Installed acceptance must use the actual
      // guarded staging ID and is tracked separately under H10.
      VITE_MINTED_EXTENSION_ID:
        process.env.VITE_MINTED_EXTENSION_ID ?? "abcdefghijklmnopabcdefghijklmnop",
    },
  },
});
