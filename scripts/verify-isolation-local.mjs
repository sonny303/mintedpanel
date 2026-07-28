#!/usr/bin/env node
// In-sandbox validation of the org-isolation gate (mock-and-run): boots the
// mock API server in-process and runs scripts/verify-org-isolation.mjs
// against it —
//   pass mode: a contract-correct server; the gate must exit 0
//   leak modes: one deliberately broken server per isolation property; the
//               gate must exit 1 (proving each assertion catches its leak)
//
// This needs no network egress and no secrets. It validates the GATE and the
// API CONTRACT shape; the real gate run against the production deploy is
// still the source of truth (deployment_status trigger / manual dispatch).
//
// Usage: node scripts/verify-isolation-local.mjs   (VERBOSE=1 to stream gate output)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createMockApiServer, FIXTURES, LEAK_MODES } from "./mock-api-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const GATE = join(here, "verify-org-isolation.mjs");
const VERBOSE = process.env.VERBOSE === "1";

function runGate(baseUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [GATE], {
      env: {
        ...process.env,
        SUPABASE_URL: baseUrl,
        SUPABASE_ANON_KEY: "mock-anon-key",
        API_BASE: baseUrl,
        KANSAS_EMAIL: FIXTURES.KANSAS_EMAIL,
        KANSAS_PASSWORD: "mock",
        SPVIEW_EMAIL: FIXTURES.SPVIEW_EMAIL,
        SPVIEW_PASSWORD: "mock",
        SOUTHPARK_ORG: FIXTURES.SOUTHPARK_ORG,
        SOUTHPARK_PROVIDER_ID: FIXTURES.SOUTHPARK_PROVIDER_ID,
        KANSAS_PROVIDER_ID: FIXTURES.KANSAS_PROVIDER_ID,
        SOUTHPARK_FIELDMAP_ID: FIXTURES.SOUTHPARK_FIELDMAP_ID,
        SOUTHPARK_CASE_ID: FIXTURES.SOUTHPARK_CASE_ID,
        SOUTHPARK_FACILITY_ID: FIXTURES.SOUTHPARK_FACILITY_ID,
        // Assertion 13 (task-ownership isolation) fixtures — always set here so
        // the mock run exercises it; optional in the real gate.
        KANSAS_CASE_ID: FIXTURES.KANSAS_CASE_ID,
        SOUTHPARK_TASK_ID: FIXTURES.SOUTHPARK_TASK_ID,
        // Assertions 17/17b (E4.5 signed document download) — always set here;
        // optional in the real gate until the operator seeds fixture documents.
        KANSAS_DOCUMENT_ID: FIXTURES.KANSAS_DOCUMENT_ID,
        SOUTHPARK_DOCUMENT_ID: FIXTURES.SOUTHPARK_DOCUMENT_ID,
        // Assertion 15/15b (E4.3 case search) — a query the Kansas fixtures
        // match (15 non-vacuous) and one that would surface the South Park
        // fixture case only under the casesearch leak (15b).
        SEARCH_QUERY: "kay",
        SEARCH_LEAK_QUERY: "South Park",
        VERCEL_BYPASS_SECRET: "",
        GITHUB_STEP_SUMMARY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => {
      output += d;
      if (VERBOSE) process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      output += d;
      if (VERBOSE) process.stderr.write(d);
    });
    child.on("close", (code) => resolve({ code, output }));
  });
}

// Exit code alone can't tell WHICH assertion tripped (co-failing siblings
// would mask a dead assertion), so each leak mode also pins the exact set of
// assertions expected to fail — any extra or missing failure is a harness bug.
const EXPECTED_FAILS = {
  // The "providers" leak also lets a cross-org PATCH land (assertion 12). The
  // list is sorted lexicographically to match failedAssertions()'s .sort().
  providers: ["1", "12", "1b", "2c", "3"],
  spoof: ["4"],
  fieldmaps: ["5b", "5c"],
  profile: ["6"],
  fillevents: ["7", "7b"],
  cases: ["8b", "8d"],
  // The case-search leak surfaces a cross-org case row in ?q= results (15b).
  casesearch: ["15b"],
  touches: ["9", "9b"],
  tasks: ["13"],
  casecontext: ["14b"],
  // The leaked extra membership row breaks both the exact-count shape check
  // (10) and the no-South-Park leak check (10b).
  meorgs: ["10", "10b"],
  facility: ["11"],
  // The SSN-release leak serves a cross-org provider's full SSN (assertion 16).
  ssnrelease: ["16"],
  // The document-download leak serves a cross-org signed URL (assertion 17b).
  documentdownload: ["17b"],
  portals: ["18b"],
};

function failedAssertions(output) {
  return [...output.matchAll(/^FAIL {2}(\d+[a-z]?)\./gm)].map((m) => m[1]).sort();
}

const runs = [
  { label: "pass (contract-correct server)", leak: null, expect: 0, expectFails: [] },
  ...LEAK_MODES.map((leak) => ({
    label: `leak: ${leak}`,
    leak,
    expect: 1,
    expectFails: EXPECTED_FAILS[leak],
  })),
];

let failed = false;
const results = [];
for (const run of runs) {
  const mock = await createMockApiServer({ leak: run.leak });
  const { code, output } = await runGate(mock.baseUrl);
  await mock.close();
  const fails = failedAssertions(output);
  const failsMatch =
    fails.length === run.expectFails.length && fails.every((f, i) => f === run.expectFails[i]);
  const ok = code === run.expect && failsMatch;
  if (!ok) failed = true;
  results.push({ ...run, code, ok });
  console.log(
    `${ok ? "OK  " : "BAD "} ${run.label}  — gate exit ${code} (expected ${run.expect}), ` +
      `failed assertions [${fails.join(", ")}] (expected [${run.expectFails.join(", ")}])`,
  );
  if (!ok && !VERBOSE) {
    console.log(output.replace(/^/gm, "    "));
  }
}

console.log("");
const okCount = results.filter((r) => r.ok).length;
console.log(
  failed
    ? `RESULT: FAIL — ${okCount}/${results.length} modes behaved as expected`
    : `RESULT: PASS — gate goes green on the correct server and red on all ${LEAK_MODES.length} leak modes`,
);
process.exit(failed ? 1 : 0);
