#!/usr/bin/env node
// End-to-end org-isolation check for the provider API, run against a real
// deploy from a host with open network egress (a GitHub runner, or your
// laptop). The Claude sandbox cannot run this — its egress policy denies both
// *.supabase.co and the *.vercel.app deploy host.
//
// It never uses the service-role key. It signs in as real users with the anon
// key + passwords (the service-role key stays server-side on Vercel), then
// calls the deploy with each user's Bearer JWT. Read-only.
//
// Required env (the GitHub workflow wires these from secrets + constants):
//   SUPABASE_URL           e.g. https://fkvuhfsqcmujywzgczmc.supabase.co
//   SUPABASE_ANON_KEY      publishable/anon key
//   API_BASE               PRODUCTION deploy base (preview SSO blocks Bearer auth)
//   KANSAS_EMAIL/PASSWORD  a Kansas-ONLY user (testkansas@minted.com, admin)
//   SPVIEW_EMAIL/PASSWORD  a South-Park-ONLY user (testsouthpark@minted.com, billing)
//   SOUTHPARK_ORG, SOUTHPARK_PROVIDER_ID, KANSAS_PROVIDER_ID
// Optional:
//   VERCEL_BYPASS_SECRET   Vercel "Protection Bypass for Automation" secret. If the
//                          deploy has Deployment Protection on, set this so requests
//                          carry x-vercel-protection-bypass and reach the app.
//
// Both users are single-org, so views 1-3 send no x-org-id (the guard resolves
// each caller's sole org). Only the assertion-4 spoof sends an x-org-id.
//
// Exit code: 0 = all pass, 1 = any assertion failed, 2 = missing env,
// 3 = setup/network error. A cross-org row anywhere is a STOP-SHIP failure.

const env = process.env;
const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "API_BASE",
  "KANSAS_EMAIL",
  "KANSAS_PASSWORD",
  "SPVIEW_EMAIL",
  "SPVIEW_PASSWORD",
  "SOUTHPARK_ORG",
  "SOUTHPARK_PROVIDER_ID",
  "KANSAS_PROVIDER_ID",
];
const missing = REQUIRED.filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(2);
}

const API_BASE = env.API_BASE.replace(/\/+$/, "");
const BYPASS = env.VERCEL_BYPASS_SECRET || "";

async function signIn(email, password) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`sign-in failed for ${email}: HTTP ${res.status} ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

// One GET against the deploy. Adds the Bearer + x-org-id when given, and the
// Vercel protection-bypass header when a secret is configured. Returns the
// parsed JSON body when possible plus the raw text (so a non-JSON SSO gate is
// visible in the logs).
async function apiGet(path, { token, orgId } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (orgId) headers["x-org-id"] = orgId;
  if (BYPASS) {
    headers["x-vercel-protection-bypass"] = BYPASS;
    headers["x-vercel-set-bypass-cookie"] = "true";
  }
  const res = await fetch(`${API_BASE}${path}`, { headers });
  const raw = await res.text();
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    /* non-JSON (e.g. an SSO HTML gate) → body stays null; raw holds the page */
  }
  return { status: res.status, body, raw };
}

const rows = [];
let stopShip = false;
function check(name, pass, detail, { leak = false } = {}) {
  rows.push({ name, pass, detail });
  if (leak && !pass) stopShip = true;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  —  ${detail}`);
}

function idsOf(body) {
  return new Set((body?.data ?? []).map((r) => r.id));
}

function looksLikeVercelGate(r) {
  // Vercel Authentication returns an HTML interstitial, not our JSON envelope.
  const s = (r.raw || "").toLowerCase();
  return (
    r.body === null && (s.includes("authenticat") || s.includes("vercel") || s.includes("<html"))
  );
}

(async () => {
  console.log(`API_BASE host reachable check — bypass secret ${BYPASS ? "SET" : "not set"}`);

  // Preflight: prove the deploy is reachable and that OUR guard (JSON envelope),
  // not a Vercel SSO gate (HTML), is answering. /api/health is public in-app.
  const health = await apiGet("/api/health");
  console.log(
    `preflight GET /api/health          -> status=${health.status} body=${(health.raw || "").slice(0, 120)}`,
  );
  const noAuth = await apiGet("/api/providers");
  console.log(
    `preflight GET /api/providers noauth -> status=${noAuth.status} body=${(noAuth.raw || "").slice(0, 160)}`,
  );
  if (looksLikeVercelGate(health) || looksLikeVercelGate(noAuth)) {
    console.error(
      "\nDIAGNOSIS: the deploy is behind Vercel Deployment Protection (SSO) — an HTML\n" +
        "gate is answering instead of the app's JSON. Bearer auth can't get past it.\n" +
        "Fix: point API_BASE at a public production deploy, or set VERCEL_BYPASS_SECRET\n" +
        "(a Vercel 'Protection Bypass for Automation' secret) so requests carry the\n" +
        "x-vercel-protection-bypass header.\n",
    );
  }

  const kansasTok = await signIn(env.KANSAS_EMAIL, env.KANSAS_PASSWORD);
  const spTok = await signIn(env.SPVIEW_EMAIL, env.SPVIEW_PASSWORD);

  // 1. Kansas view (single-org user, no x-org-id) = exactly 6, zero South Park.
  const k = await apiGet("/api/providers?pageSize=100", { token: kansasTok });
  const kIds = idsOf(k.body);
  check(
    "1. Kansas view returns exactly 6",
    k.status === 200 && kIds.size === 6 && k.body?.meta?.total === 6,
    `status=${k.status} count=${kIds.size} meta.total=${k.body?.meta?.total}` +
      (k.status !== 200 ? ` body=${(k.raw || "").slice(0, 100)}` : ""),
  );
  check(
    "1b. Kansas view contains no South Park provider id",
    !kIds.has(env.SOUTHPARK_PROVIDER_ID),
    `southParkIdPresent=${kIds.has(env.SOUTHPARK_PROVIDER_ID)}`,
    { leak: true },
  );

  // 2. South Park view (single-org user, no x-org-id) = exactly 4, zero Kansas.
  const s = await apiGet("/api/providers?pageSize=100", { token: spTok });
  const sIds = idsOf(s.body);
  check(
    "2. South Park view returns exactly 4",
    s.status === 200 && sIds.size === 4 && s.body?.meta?.total === 4,
    `status=${s.status} count=${sIds.size} meta.total=${s.body?.meta?.total}` +
      (s.status !== 200 ? ` body=${(s.raw || "").slice(0, 100)}` : ""),
  );
  check(
    "2b. South Park view contains no known Kansas provider id",
    !sIds.has(env.KANSAS_PROVIDER_ID),
    `kansasIdPresent=${sIds.has(env.KANSAS_PROVIDER_ID)}`,
    { leak: true },
  );
  const overlap = [...kIds].filter((id) => sIds.has(id));
  check(
    "2c. Kansas and South Park id sets are disjoint",
    overlap.length === 0,
    `overlap=${overlap.length}${overlap.length ? " " + overlap.slice(0, 3).join(",") : ""}`,
    { leak: true },
  );

  // 3. Kansas view: GET a South Park provider by id -> 404, no row leaked.
  const x = await apiGet(`/api/providers/${env.SOUTHPARK_PROVIDER_ID}`, { token: kansasTok });
  const leakedRow = x.status === 200 && x.body?.data?.id === env.SOUTHPARK_PROVIDER_ID;
  check(
    "3. Kansas view GET-by-id on a South Park provider -> 404",
    x.status === 404 && !leakedRow,
    `status=${x.status} leakedRow=${leakedRow}`,
    { leak: true },
  );

  // 4. HEADER-SPOOF (the real one): a Kansas-only user sends x-org-id for South
  //    Park, an org they are NOT a member of. Must be DENIED and must never
  //    return South Park's data.
  const spoof = await apiGet("/api/providers?pageSize=100", {
    token: kansasTok,
    orgId: env.SOUTHPARK_ORG,
  });
  const spoofIds = idsOf(spoof.body);
  const spoofLeakedSP =
    spoofIds.has(env.SOUTHPARK_PROVIDER_ID) ||
    (spoof.status === 200 && spoof.body?.meta?.total === 4);
  check(
    "4. Header-spoof (Kansas-only user, x-org-id=SouthPark) is denied",
    spoof.status === 403 && !spoofLeakedSP,
    `status=${spoof.status} (expect 403) returnedRows=${spoofIds.size} spLeaked=${spoofLeakedSP}`,
    { leak: true },
  );

  // ---- Pass/fail table ----
  const w = Math.max(...rows.map((r) => r.name.length));
  const line = "+" + "-".repeat(w + 2) + "+--------+";
  const out = [];
  out.push(line);
  out.push(`| ${"Assertion".padEnd(w)} | Result |`);
  out.push(line);
  for (const r of rows) out.push(`| ${r.name.padEnd(w)} | ${r.pass ? " PASS " : " FAIL "} |`);
  out.push(line);
  const table = out.join("\n");
  console.log("\n" + table);

  const anyFail = rows.some((r) => !r.pass);
  const verdict = anyFail
    ? stopShip
      ? "RESULT: FAIL — STOP-SHIP (cross-org isolation breach)"
      : "RESULT: FAIL"
    : "RESULT: PASS — org isolation holds";
  console.log("\n" + verdict);

  // GitHub job summary (markdown), when running in Actions.
  if (env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    const md = [
      "## Provider API — org isolation",
      "",
      "| Assertion | Result |",
      "| --- | --- |",
      ...rows.map((r) => `| ${r.name} | ${r.pass ? "✅ PASS" : "❌ FAIL"} |`),
      "",
      `**${verdict}**`,
      "",
    ].join("\n");
    appendFileSync(env.GITHUB_STEP_SUMMARY, md + "\n");
  }

  process.exit(anyFail ? 1 : 0);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(3);
});
