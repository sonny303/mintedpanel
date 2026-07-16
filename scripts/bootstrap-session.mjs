#!/usr/bin/env node
// Idempotent session bootstrap (efficiency audit 2026-07-16, P2.1). Kills the
// fresh-session e2e boot trap: a clone with no .env makes `npx playwright test`
// silently burn the full 120s webServer timeout before failing. The two dummy
// vars below are all the mock-harness e2e suite needs — specs stub the
// Supabase HTTP layer, so the values never reach a real backend. NEVER put
// real credentials in this file or in the .env it writes.
//
// Safe to run repeatedly:
//   - writes .env only when absent (never overwrites an existing one)
//   - runs `npm ci` only when node_modules is missing or package-lock.json
//     is newer than the last install
//   - fetches origin/redesign (best-effort: offline is a warning, not a
//     failure)
//
// Usage: node scripts/bootstrap-session.mjs
import { existsSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const log = (message) => console.log(`[bootstrap] ${message}`);

// Dummy values only — the Playwright harness needs a valid-looking URL/key to
// construct the Supabase client; unauthenticated paths make no network call.
// The host ref MUST be `example`: externalClient.ts sets no storageKey, so
// supabase-js derives the GoTrue localStorage key from the URL ref as
// `sb-<ref>-auth-token`. Every authenticated e2e spec seeds the session under
// `sb-example-auth-token` (and CI boots with example.supabase.co), so any
// other host makes the app read a key the specs never set and log the user
// out — the whole authenticated suite would fail.
const DUMMY_ENV = `VITE_SUPABASE_URL=https://example.supabase.co
VITE_SUPABASE_ANON_KEY=dummy-anon-key
`;

// 1. .env — write the dummy Playwright vars only when the file is absent.
const envPath = join(root, ".env");
if (existsSync(envPath)) {
  log(".env already exists — left untouched");
} else {
  writeFileSync(envPath, DUMMY_ENV, { flag: "wx" });
  log("wrote .env with dummy Playwright vars (no real credentials)");
}

// 2. npm ci — only when node_modules is missing or the lockfile is newer.
const nodeModulesPath = join(root, "node_modules");
const lockfilePath = join(root, "package-lock.json");
const needsInstall =
  !existsSync(nodeModulesPath) ||
  statSync(lockfilePath).mtimeMs > statSync(nodeModulesPath).mtimeMs;
if (needsInstall) {
  log("node_modules missing or older than package-lock.json — running npm ci");
  const ci = spawnSync("npm", ["ci"], { cwd: root, stdio: "inherit" });
  if (ci.status !== 0) {
    log("npm ci failed — fix the install before continuing");
    process.exit(ci.status ?? 1);
  }
  log("npm ci complete");
} else {
  log("node_modules up to date — skipped npm ci");
}

// 3. Freshen the long-lived branch (best-effort; sandboxes may be offline).
const fetch = spawnSync("git", ["fetch", "origin", "redesign"], {
  cwd: root,
  stdio: "inherit",
});
if (fetch.status === 0) {
  log("fetched origin/redesign");
} else {
  log("warning: `git fetch origin redesign` failed — continuing without it");
}

log("bootstrap complete");
