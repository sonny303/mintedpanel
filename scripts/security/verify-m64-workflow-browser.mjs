// First M64 browser gate: run the exact built MV3 against a deny-by-default
// HTTPS bridge on the existing E6.12 internal Docker network. This is a
// transport/authentication rejection smoke followed by a bounded real
// UI/permission probe. It deliberately stops before any form fill.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:https";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = "1.61.1";
const PANEL_HOST = "mintedpanel.vercel.app";
const PANEL_ORIGIN = `https://${PANEL_HOST}`;
const SUPABASE_HOST = "fkvuhfsqcmujywzgczmc.supabase.co";
const PORTAL_HOST = "payer.m64.test";
const ORG_ID = "18000000-0000-4000-a000-000000000064";
const ORG_NAME_RE = /^E612 M64 [a-f0-9]{16} Organization$/;
const CONTRACT_ID = "29000000-0000-4000-a000-000000000064";
const PAYER_ID = "28000000-0000-4000-a000-000000000064";
const GROUP_ID = "49000000-0000-4000-a000-000000000064";
const PROVIDER_ID = "39000000-0000-4000-a000-000000000065";
const FACILITY_ID = "78000000-0000-4000-a000-000000000064";
const CONTRACT_PORTAL_ID = "38000000-0000-4000-a000-000000000064";
const ENROLLMENT_PORTAL_ID = "38000000-0000-4000-a000-000000000065";
const ENROLLMENT_CASE_ID = "49000000-0000-4000-a000-000000000064";
const ENROLLMENT_TASK_ID = "99000000-0000-4000-a000-000000000064";
const ENROLLMENT_STEP1_ID = "89000000-0000-4000-a000-000000000064";
const ENROLLMENT_STEP2_ID = "89000000-0000-4000-a000-000000000065";
const ENROLLMENT_SIBLING_TASK_ID = "99000000-0000-4000-a000-000000000065";
const ENROLLMENT_SIBLING_STEP_ID = "89000000-0000-4000-a000-000000000066";
const SUPABASE_ORIGIN = `https://${SUPABASE_HOST}`;
const PORTAL_URL = `https://${PORTAL_HOST}/application`;
const SPECIALIST_EMAIL = "specialist@e612.test";
const ADMIN_PASSWORD = "E612-Local-Password-!234";
const BUILD_ANON_KEY = "e612-build-synthetic-anon-key";
const AUTH_PREFLIGHT_TARGET = "/auth/v1/token?grant_type=password";
const AUTH_PREFLIGHT_HEADERS = new Set([
  "apikey",
  "authorization",
  "content-type",
  "x-client-info",
]);
const ACTIVE_WORK_KEY = "minted.activeWork.v2";
const EXPECTED_BACKGROUND_MARKERS = [
  "/api/work-context/validate",
  "minted.activeWork.v2",
  "SET_ACTIVE_WORK",
];

class BrowserFailure extends Error {}

function assert(condition, code) {
  if (!condition) throw new BrowserFailure(code);
}

function safeLog(value) {
  process.stdout.write(`${value}\n`);
}

const STAGES = Object.freeze({
  preflight: "M64_BROWSER_STAGE_PREFLIGHT_FAILED",
  panel_ready: "M64_BROWSER_STAGE_PANEL_READY_FAILED",
  tls_certificate: "M64_BROWSER_STAGE_TLS_CERTIFICATE_FAILED",
  proxy_listen: "M64_BROWSER_STAGE_PROXY_LISTEN_FAILED",
  chromium_launch: "M64_BROWSER_STAGE_CHROMIUM_LAUNCH_FAILED",
  mv3_worker: "M64_BROWSER_STAGE_MV3_WORKER_FAILED",
  sidepanel: "M64_BROWSER_STAGE_SIDEPANEL_FAILED",
  permission_probe: "M64_BROWSER_STAGE_PERMISSION_PROBE_FAILED",
  sign_in: "M64_BROWSER_STAGE_SIGN_IN_FAILED",
  org_select: "M64_BROWSER_STAGE_ORG_SELECT_FAILED",
  handoff_send: "M64_BROWSER_STAGE_HANDOFF_SEND_FAILED",
  postconditions: "M64_BROWSER_STAGE_POSTCONDITIONS_FAILED",
  panel_page_create: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  panel_login_navigation: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  panel_login_dom: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  panel_login_assets: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  panel_login_form: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  panel_login_credentials: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  panel_login_submit: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  panel_login_submit_no_request: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  panel_login_route_denied: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  panel_login_auth_response: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  panel_login_auth_non_200: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  panel_login_access_context: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  panel_login_access_context_missing: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  panel_login_access_context_non_200: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  panel_login_org_wait: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  panel_login_org_ready: "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  contract_ui: "M64_BROWSER_STAGE_CONTRACT_UI_FAILED",
  contract_fill: "M64_BROWSER_STAGE_CONTRACT_FILL_FAILED",
  enrollment_ui: "M64_BROWSER_STAGE_ENROLLMENT_UI_FAILED",
  enrollment_fill: "M64_BROWSER_STAGE_ENROLLMENT_FILL_FAILED",
  submission: "M64_BROWSER_STAGE_HUMAN_SUBMISSION_FAILED",
  second_enrollment_fill: "M64_BROWSER_STAGE_SECOND_ENROLLMENT_FILL_FAILED",
  reset: "M64_BROWSER_STAGE_MAPPING_RESET_FAILED",
  stale_fill: "M64_BROWSER_STAGE_STALE_FILL_FAILED",
});

let currentStage = "preflight";
safeLog("M64_BROWSER_DRIVER_STARTED");

function checkpoint(stage) {
  assert(Object.hasOwn(STAGES, stage), "M64_BROWSER_STAGE_INVALID");
  currentStage = stage;
  safeLog(`M64_BROWSER_CHECKPOINT_${stage.toUpperCase()}`);
}

async function poll(read, accept, label, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    let readTimer;
    try {
      const remaining = Math.max(1, end - Date.now());
      last = await Promise.race([
        Promise.resolve().then(read),
        new Promise((_, reject) => {
          readTimer = setTimeout(
            () => reject(new BrowserFailure("M64_BROWSER_POLL_READ_TIMEOUT")),
            remaining,
          );
        }),
      ]);
      if (accept(last)) return last;
    } catch (error) {
      if (error instanceof BrowserFailure && error.message === "M64_BROWSER_POLL_READ_TIMEOUT")
        throw error;
      last = error;
    } finally {
      if (readTimer) clearTimeout(readTimer);
    }
    await delay(100);
  }
  throw new Error(`M64_BROWSER_TIMEOUT_${label}${last instanceof Error ? `_${last.message}` : ""}`);
}

async function settleWithin(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(operation)
        .then(
          () => true,
          () => true,
        ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function bounded(operation, timeoutMs, failureCode) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new BrowserFailure(failureCode)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readPanelReady(expectedExtensionId) {
  const input = createInterface({ input: process.stdin });
  return new Promise((resolve, reject) => {
    let settled = false;
    const failOnce = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.close();
      reject(new BrowserFailure(code));
    };
    const timeout = setTimeout(() => {
      failOnce("M64_BROWSER_PANEL_READY_TIMEOUT");
    }, 1_200_000);
    input.once("line", (line) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.close();
      const match = /^M64_PANEL_READY\|([A-Za-z0-9_-]{1,65536})$/.exec(line);
      if (!match) {
        reject(new BrowserFailure("M64_BROWSER_PANEL_READY_MALFORMED"));
        return;
      }
      let value;
      try {
        value = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
      } catch {
        reject(new BrowserFailure("M64_BROWSER_PANEL_READY_MALFORMED"));
        return;
      }
      const assets = value?.clientAssets;
      const safeAssets =
        Array.isArray(assets) &&
        assets.length > 0 &&
        assets.length <= 1000 &&
        assets.every(
          (asset) =>
            typeof asset === "string" &&
            /^\/[A-Za-z0-9_./-]+$/.test(asset) &&
            !asset.split("/").includes(".."),
        ) &&
        new Set(assets).size === assets.length;
      if (
        value?.extensionId !== expectedExtensionId ||
        !/^[a-p]{32}$/.test(value?.extensionId ?? "") ||
        !/^[a-f0-9]{64}$/.test(value?.clientSha256 ?? "") ||
        !safeAssets ||
        !ORG_NAME_RE.test(value?.orgName ?? "")
      ) {
        reject(new BrowserFailure("M64_BROWSER_PANEL_READY_INVALID"));
        return;
      }
      panelClientAssets = new Set(assets);
      panelClientSha256 = value.clientSha256;
      panelOrgName = value.orgName;
      resolve(value);
    });
    input.once("close", () => failOnce("M64_BROWSER_PANEL_READY_EOF"));
  });
}

function extractAnonKey(bundle) {
  const candidates = bundle.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? [];
  const anonymous = candidates.filter((token) => {
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      return payload.role === "anon" && payload.iss === "supabase";
    } catch {
      return false;
    }
  });
  assert(anonymous.length === 1, "M64_BROWSER_BUILT_ANON_KEY_NOT_UNIQUE");
  return anonymous[0];
}

function listFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(absolute, relative) : [relative];
    })
    .sort();
}

function jsonEnvelope(responseBody) {
  try {
    const value = JSON.parse(responseBody.toString("utf8"));
    return value != null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

const extensionRoot = "/tmp/m64/extension";
const backgroundPath = join(extensionRoot, "background.js");
const manifestPath = join(extensionRoot, "manifest.json");
let chromium;
let extensionAnonKey;
let panelBuildAnonKey;
let runtimeAssetsSha256;
let localAnonKey;
let expectedRuntimeAssetsSha256;
let panelClientAssets = new Set();
let panelClientSha256;
let panelOrgName;
let certDir;
let certPath;
let keyPath;
let profileDir;
const certHosts = [PANEL_HOST, SUPABASE_HOST, PORTAL_HOST];
const metrics = new Map();
let unexpectedRoutes = 0;
let firstDeniedCategory = null;
let lastDeniedCategory = null;
let exactValidationNotFound = false;
const workValidationAttempts = [];
const workValidationSuccesses = [];
let extensionIdObserved;
let server;
let context;
let proxyClosed = false;
let driverFailed = false;

async function preflight() {
  localAnonKey = process.env.M64_LOCAL_ANON_KEY;
  panelBuildAnonKey = process.env.M64_PANEL_BUILD_ANON_KEY;
  expectedRuntimeAssetsSha256 = process.env.M64_EXPECTED_RUNTIME_ASSETS_SHA;
  assert(localAnonKey?.split(".").length === 3, "M64_BROWSER_LOCAL_ANON_KEY_MISSING");
  assert(
    /^[a-f0-9]{64}$/.test(expectedRuntimeAssetsSha256 ?? ""),
    "M64_BROWSER_EXPECTED_ASSET_HASH_MISSING",
  );
  assert(panelBuildAnonKey === BUILD_ANON_KEY, "M64_BROWSER_PANEL_BUILD_KEY_MISMATCH");
  const playwright = require("playwright");
  const playwrightPackage = require("playwright/package.json");
  chromium = playwright.chromium;
  assert(
    playwrightPackage.version === PLAYWRIGHT_VERSION,
    "M64_BROWSER_PLAYWRIGHT_VERSION_MISMATCH",
  );
  assert(
    existsSync(backgroundPath) && existsSync(manifestPath),
    "M64_BROWSER_EXTENSION_DIST_MISSING",
  );
  assert(existsSync(chromium.executablePath()), "M64_BROWSER_CHROMIUM_BINARY_MISSING");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const background = readFileSync(backgroundPath, "utf8");
  const backgroundSha256 = createHash("sha256").update(background).digest("hex");
  assert(
    backgroundSha256 === "83215a2c10425451e40068682fc88b76abc08cbb2f376770cedb3070adac7c84",
    "M64_BROWSER_BACKGROUND_HASH_MISMATCH",
  );
  const javascriptFiles = listFiles(extensionRoot).filter((file) => file.endsWith(".js"));
  const javascriptAssets = javascriptFiles.map((file) => [
    file,
    readFileSync(join(extensionRoot, file), "utf8"),
  ]);
  const allJavascript = javascriptAssets.map(([, source]) => source).join("\n");
  extensionAnonKey = extractAnonKey(allJavascript);
  runtimeAssetsSha256 = createHash("sha256")
    .update(
      javascriptAssets
        .map(([file, source]) => `${file}\0${createHash("sha256").update(source).digest("hex")}\n`)
        .join(""),
    )
    .digest("hex");
  assert(
    runtimeAssetsSha256 === expectedRuntimeAssetsSha256,
    "M64_BROWSER_RUNTIME_ASSET_HASH_MISMATCH",
  );
  assert(manifest.manifest_version === 3, "M64_BROWSER_NOT_MV3");
  assert(
    manifest.host_permissions?.includes(`https://${PANEL_HOST}/*`),
    "M64_BROWSER_PANEL_HOST_PERMISSION_MISSING",
  );
  assert(
    manifest.host_permissions?.includes(`https://${SUPABASE_HOST}/*`),
    "M64_BROWSER_SUPABASE_HOST_PERMISSION_MISSING",
  );
  assert(
    manifest.externally_connectable?.matches?.includes(`https://${PANEL_HOST}/*`),
    "M64_BROWSER_HANDOFF_ORIGIN_NOT_ALLOWLISTED",
  );
  for (const marker of EXPECTED_BACKGROUND_MARKERS) {
    assert(
      background.includes(marker),
      `M64_BROWSER_BUILT_MARKER_MISSING_${marker.replaceAll(/[^A-Za-z0-9]+/g, "_")}`,
    );
  }
  assert(allJavascript.includes(`https://${PANEL_HOST}`), "M64_BROWSER_PANEL_ORIGIN_DRIFT");
  assert(allJavascript.includes(`https://${SUPABASE_HOST}`), "M64_BROWSER_SUPABASE_ORIGIN_DRIFT");
  assertAuthPreflightPolicy();
}

function count(route, status) {
  const key = `${route}:${status}`;
  metrics.set(key, (metrics.get(key) ?? 0) + 1);
}

function routeCount(route, status) {
  return metrics.get(`${route}:${status}`) ?? 0;
}

function routeTotal(route) {
  let total = 0;
  for (const [key, value] of metrics) {
    if (key.startsWith(`${route}:`)) total += value;
  }
  return total;
}

function unexpected(response, category = "UNKNOWN_HOST") {
  response.statusCode = 404;
  unexpectedRoutes += 1;
  firstDeniedCategory ??= category;
  lastDeniedCategory = category;
  count(`denied.${category}`, response.statusCode);
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end("local verification route unavailable");
}

function classifyDenied(host, method, pathname) {
  if (host === PANEL_HOST) {
    if (method === "GET" && pathname === "/favicon.ico") return "PANEL_GET_FAVICON";
    if (method === "OPTIONS" && pathname === "/api/work-context/validate") {
      return "PANEL_OPTIONS_WORK_VALIDATE";
    }
    if (method === "GET" && pathname === "/api/portals") return "PANEL_GET_PORTALS";
    if (method === "GET" && pathname === "/api/providers") return "PANEL_GET_PROVIDERS";
    return "PANEL_OTHER";
  }
  if (host === SUPABASE_HOST) {
    if (method === "OPTIONS" && pathname.startsWith("/auth/v1/")) {
      return "SUPABASE_OPTIONS_AUTH";
    }
    return "SUPABASE_OTHER";
  }
  if (host === PORTAL_HOST) {
    if (method === "GET" && pathname === "/favicon.ico") return "PORTAL_GET_FAVICON";
    return "PORTAL_OTHER";
  }
  return "UNKNOWN_HOST";
}

function requestedAuthPreflightHeaders(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const requested = value.split(",").map((name) => name.trim().toLowerCase());
  if (
    requested.some((name) => !name || !AUTH_PREFLIGHT_HEADERS.has(name)) ||
    new Set(requested).size !== requested.length ||
    !["apikey", "authorization", "content-type"].every((name) => requested.includes(name))
  ) {
    return null;
  }
  return requested;
}

function isAllowedAuthPreflight(host, method, pathname, requestTarget, headers) {
  return (
    host === SUPABASE_HOST &&
    method === "OPTIONS" &&
    pathname === "/auth/v1/token" &&
    requestTarget === AUTH_PREFLIGHT_TARGET &&
    headers.origin === PANEL_ORIGIN &&
    headers["access-control-request-method"] === "POST" &&
    requestedAuthPreflightHeaders(headers["access-control-request-headers"]) !== null
  );
}

function assertAuthPreflightPolicy() {
  const headers = {
    origin: PANEL_ORIGIN,
    "access-control-request-method": "POST",
    "access-control-request-headers": "apikey, authorization, content-type, x-client-info",
  };
  const route = (candidateHeaders = headers, target = AUTH_PREFLIGHT_TARGET) =>
    routeFor(SUPABASE_HOST, "OPTIONS", "/auth/v1/token", target, candidateHeaders);
  assert(route()?.kind === "preflight", "M64_BROWSER_PREFLIGHT_POLICY_INVALID");
  assert(
    route({ ...headers, origin: "https://untrusted.invalid" }) === null,
    "M64_BROWSER_PREFLIGHT_POLICY_INVALID",
  );
  assert(
    route({ ...headers, "access-control-request-method": "PUT" }) === null,
    "M64_BROWSER_PREFLIGHT_POLICY_INVALID",
  );
  assert(
    route({ ...headers, "access-control-request-headers": "apikey, content-type, x-evil" }) ===
      null,
    "M64_BROWSER_PREFLIGHT_POLICY_INVALID",
  );
  assert(
    route(headers, "/auth/v1/token?grant_type=refresh_token") === null,
    "M64_BROWSER_PREFLIGHT_POLICY_INVALID",
  );
}

function routeFor(host, method, pathname, requestTarget, headers = {}) {
  if (host === PANEL_HOST) {
    if (method === "GET" && requestTarget === "/favicon.ico") {
      return { kind: "empty", name: "panel.favicon" };
    }
    if (method === "GET" && pathname === "/__m64__/handoff")
      return { kind: "static", name: "panel.handoff" };
    if (
      method === "GET" &&
      ["/", "/login", "/reporting/contracts-matrix", `/cases/${ENROLLMENT_CASE_ID}`].includes(
        pathname,
      )
    ) {
      return { kind: "app", name: "panel.page" };
    }
    if ((method === "GET" || method === "HEAD") && panelClientAssets.has(pathname)) {
      return { kind: "app", name: "panel.asset" };
    }
    if (["GET", "OPTIONS"].includes(method) && pathname === "/api/me/orgs")
      return { kind: "app", name: "panel.me_orgs" };
    if (["GET", "OPTIONS"].includes(method) && pathname === "/api/me/access-context")
      return { kind: "app", name: "panel.access_context" };
    if (["POST", "OPTIONS"].includes(method) && pathname === "/api/me/access-context/select")
      return { kind: "app", name: "panel.access_context_select" };
    if (
      ["GET", "OPTIONS"].includes(method) &&
      pathname === `/api/contracts/${CONTRACT_ID}/form-context`
    )
      return { kind: "app", name: "panel.contract_form_context" };
    if (["POST", "OPTIONS"].includes(method) && pathname === "/api/work-context/validate")
      return { kind: "app", name: "panel.work_validate" };
    if (["GET", "OPTIONS"].includes(method) && pathname === "/api/portals")
      return { kind: "app", name: "panel.portals" };
    if (["GET", "OPTIONS"].includes(method) && pathname === "/api/portal-field-maps")
      return { kind: "app", name: "panel.portal_field_maps" };
    if (["POST", "OPTIONS"].includes(method) && pathname === "/api/fill-events")
      return { kind: "app", name: "panel.fill_events" };
    if (
      ["POST", "OPTIONS"].includes(method) &&
      pathname === `/api/cases/${ENROLLMENT_CASE_ID}/touches`
    )
      return { kind: "app", name: "panel.case_touches" };
    if (["GET", "OPTIONS"].includes(method) && pathname === "/api/cases")
      return { kind: "app", name: "panel.cases" };
    if (
      ["GET", "OPTIONS"].includes(method) &&
      pathname === `/api/cases/${ENROLLMENT_CASE_ID}/context`
    )
      return { kind: "app", name: "panel.case_context" };
    if (
      (method === "OPTIONS" || method === "PATCH") &&
      pathname === `/api/tasks/${ENROLLMENT_TASK_ID}/steps`
    ) {
      return { kind: "app", name: "panel.task_steps" };
    }
    return null;
  }
  if (host === SUPABASE_HOST) {
    if (isAllowedAuthPreflight(host, method, pathname, requestTarget, headers)) {
      return { kind: "preflight", name: "supabase.auth_token_preflight" };
    }
    const authMethods = new Map([
      ["/auth/v1/token", new Set(["POST"])],
      ["/auth/v1/user", new Set(["GET", "OPTIONS"])],
      ["/auth/v1/logout", new Set(["POST", "OPTIONS"])],
    ]);
    const allowedAuth = authMethods.get(pathname);
    if (allowedAuth?.has(method)) {
      return {
        kind: "gateway",
        name: pathname.endsWith("/token") ? "supabase.auth_token" : "supabase.auth",
      };
    }
    const restReads = new Set([
      "profiles",
      "memberships",
      "organizations",
      "contracts",
      "status_configs",
      "provider_groups",
      "payers",
      "payer_network_targets",
      "facilities",
      "contract_sop_assignments",
      "sop_templates",
      "sop_template_versions",
      "portals",
      "portal_field_maps",
      "credential_cases",
      "tasks",
      "case_facilities",
      "touches",
      "provider_group_assignments",
      "provider_facility_assignments",
      "providers",
    ]);
    const tableMatch = /^\/rest\/v1\/([a-z][a-z0-9_]*)$/.exec(pathname);
    if (tableMatch && restReads.has(tableMatch[1]) && ["GET", "HEAD", "OPTIONS"].includes(method)) {
      return { kind: "gateway", name: `supabase.rest.${tableMatch[1]}` };
    }
    const rpcMatch = /^\/rest\/v1\/rpc\/(claim_invites|reset_portal_mapping)$/.exec(pathname);
    if (rpcMatch && (method === "POST" || method === "OPTIONS")) {
      return { kind: "gateway", name: `supabase.rpc.${rpcMatch[1]}` };
    }
    return null;
  }
  if (host === PORTAL_HOST && method === "GET" && requestTarget === "/application") {
    return { kind: "static", name: "portal.synthetic_form" };
  }
  return null;
}

function serveStatic(response, route) {
  response.statusCode = 200;
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "text/html; charset=utf-8");
  if (route.name === "panel.handoff") {
    response.end(
      "<!doctype html><title>M64 local handoff fixture</title><main id=handoff>Local-only test handoff</main>",
    );
    return;
  }
  response.end(
    `<!doctype html><html><head><title>M64 synthetic payer fixture</title></head><body><main aria-label="Synthetic payer application"><label for="contract-npi">Contract NPI</label><input id="contract-npi" name="contract-npi" type="text"><label for="enrollment-npi">Enrollment NPI</label><input id="enrollment-npi" name="enrollment-npi" type="text"></main></body></html>`,
  );
}

function serveAuthPreflight(response, route) {
  response.statusCode = 204;
  response.setHeader("access-control-allow-origin", PANEL_ORIGIN);
  response.setHeader("access-control-allow-methods", "POST");
  response.setHeader("access-control-allow-headers", [...AUTH_PREFLIGHT_HEADERS].join(", "));
  response.setHeader("access-control-max-age", "0");
  response.setHeader("cache-control", "no-store");
  response.setHeader("vary", "Origin");
  count(route.name, response.statusCode);
  response.end();
}

function proxyToLocal(request, response, route, requestUrl, method) {
  const isSupabase = route.kind === "gateway";
  const destination = isSupabase ? { host: "gateway", port: 8787 } : { host: "app", port: 3000 };
  const headers = { ...request.headers, host: `${destination.host}:${destination.port}` };
  if (isSupabase) {
    if (headers.apikey !== extensionAnonKey && headers.apikey !== panelBuildAnonKey) {
      unexpected(response, "SUPABASE_APIKEY_MISMATCH");
      return;
    }
    headers.apikey = localAnonKey;
    if (
      headers.authorization === `Bearer ${extensionAnonKey}` ||
      headers.authorization === `Bearer ${panelBuildAnonKey}`
    ) {
      headers.authorization = `Bearer ${localAnonKey}`;
    }
  }
  const upstream = require("node:http").request(
    {
      hostname: destination.host,
      port: destination.port,
      method,
      path: requestUrl,
      headers,
      timeout: 15_000,
    },
    (upstreamResponse) => {
      const status = upstreamResponse.statusCode ?? 502;
      count(route.name, status);
      response.writeHead(status, upstreamResponse.headers);
      if (route.name !== "panel.work_validate") {
        upstreamResponse.pipe(response);
        return;
      }
      const chunks = [];
      upstreamResponse.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      upstreamResponse.on("end", () => {
        const body = Buffer.concat(chunks);
        const envelope = jsonEnvelope(body);
        if (status === 404 && envelope?.data === null && envelope?.error === "Case not found.") {
          exactValidationNotFound = true;
        }
        const workData = envelope?.data;
        const workTuple = workData?.tuple;
        if (
          status === 200 &&
          workTuple &&
          typeof workTuple === "object" &&
          /^sha256:[a-f0-9]{64}$/.test(workData.effectiveMappingFingerprint ?? "")
        ) {
          workValidationSuccesses.push({
            tuple: {
              ownerKind: workTuple.ownerKind,
              ownerId: workTuple.ownerId,
              orgId: workTuple.orgId,
              contextVersion: workTuple.contextVersion,
              sopTemplateId: workTuple.sopTemplateId,
              sopVersion: workTuple.sopVersion,
              portalId: workTuple.portalId,
              portalKey: workTuple.portalKey,
              mappingGeneration: workTuple.mappingGeneration,
              stepIdentity: workTuple.stepIdentity,
              taskId: workTuple.taskId ?? null,
              stepId: workTuple.stepId ?? null,
              assignmentId: workTuple.assignmentId ?? null,
              taskIndex: workTuple.taskIndex ?? null,
              stepIndex: workTuple.stepIndex ?? null,
            },
            effectiveMappingFingerprint: workData.effectiveMappingFingerprint,
          });
        }
        response.end(body);
      });
    },
  );
  upstream.on("timeout", () => upstream.destroy(new Error("local upstream timeout")));
  upstream.on("error", () => {
    count(route.name, 502);
    if (!response.headersSent) response.statusCode = 502;
    response.end("local verification upstream unavailable");
  });
  request.pipe(upstream);
}

function activeChromeTabId(extensionPage) {
  return extensionPage.evaluate(
    () =>
      new Promise((resolve) =>
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
          resolve(Number.isInteger(tabs[0]?.id) ? tabs[0].id : null),
        ),
      ),
  );
}

async function panelContractPermissionProbe(extensionPage) {
  checkpoint("panel_page_create");
  const panelPage = await bounded(
    () => context.newPage(),
    10_000,
    "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  );
  checkpoint("panel_login_navigation");
  const panelPageCountBefore = routeCount("panel.page", 200);
  const panelAssetCountBefore = routeCount("panel.asset", 200);
  const loginResponse = await bounded(
    () =>
      panelPage.goto(`${PANEL_ORIGIN}/login`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      }),
    25_000,
    "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  );
  assert(
    loginResponse?.status() === 200 && panelPage.url() === `${PANEL_ORIGIN}/login`,
    "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  );

  checkpoint("panel_login_dom");
  await poll(
    () => routeCount("panel.page", 200),
    (count) => count > panelPageCountBefore,
    "panel_login_page_response",
    10_000,
  );
  checkpoint("panel_login_assets");
  await poll(
    () => routeCount("panel.asset", 200),
    (count) => count > panelAssetCountBefore,
    "panel_login_client_asset_response",
    15_000,
  );
  checkpoint("panel_login_form");
  const emailInput = panelPage.locator("#email");
  const passwordInput = panelPage.locator("#password");
  const signInButton = panelPage.getByRole("button", { name: /^Sign in$/, exact: true });
  await poll(
    async () => ({
      emailVisible: await emailInput.isVisible(),
      passwordVisible: await passwordInput.isVisible(),
      buttonVisible: await signInButton.isVisible(),
      buttonEnabled: await signInButton.isEnabled(),
    }),
    (state) =>
      state.emailVisible && state.passwordVisible && state.buttonVisible && state.buttonEnabled,
    "panel_login_form_ready",
    15_000,
  );
  checkpoint("panel_login_credentials");
  await bounded(
    () => emailInput.fill(SPECIALIST_EMAIL, { timeout: 10_000 }),
    12_000,
    "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  );
  assert(
    (await bounded(
      () => emailInput.inputValue({ timeout: 5_000 }),
      6_000,
      "M64_BROWSER_PANEL_SIGN_IN_FAILED",
    )) === SPECIALIST_EMAIL,
    "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  );
  await bounded(
    () => passwordInput.fill(ADMIN_PASSWORD, { timeout: 10_000 }),
    12_000,
    "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  );
  assert(
    (await bounded(
      () => passwordInput.inputValue({ timeout: 5_000 }),
      6_000,
      "M64_BROWSER_PANEL_SIGN_IN_FAILED",
    )) === ADMIN_PASSWORD,
    "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  );
  const authRequestsBefore = routeTotal("supabase.auth_token");
  const authSuccessesBefore = routeCount("supabase.auth_token", 200);
  const authPreflightsBefore = routeCount("supabase.auth_token_preflight", 204);
  const accessRequestsBefore = routeTotal("panel.access_context");
  const accessSuccessesBefore = routeCount("panel.access_context", 200);
  const deniedBefore = unexpectedRoutes;
  checkpoint("panel_login_submit");
  await bounded(
    () => signInButton.click({ timeout: 15_000 }),
    20_000,
    "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  );
  checkpoint("panel_login_auth_response");
  try {
    await poll(
      () => routeTotal("supabase.auth_token"),
      (count) => count > authRequestsBefore,
      "panel_login_auth_response",
      20_000,
    );
  } catch {
    checkpoint(
      unexpectedRoutes > deniedBefore
        ? "panel_login_route_denied"
        : "panel_login_submit_no_request",
    );
    throw new BrowserFailure("M64_BROWSER_PANEL_SIGN_IN_FAILED");
  }
  if (routeCount("supabase.auth_token", 200) === authSuccessesBefore) {
    checkpoint("panel_login_auth_non_200");
    throw new BrowserFailure("M64_BROWSER_PANEL_SIGN_IN_FAILED");
  }
  assert(
    routeCount("supabase.auth_token_preflight", 204) > authPreflightsBefore,
    "M64_BROWSER_AUTH_PREFLIGHT_NOT_OBSERVED",
  );
  checkpoint("panel_login_access_context");
  try {
    await poll(
      () => routeTotal("panel.access_context"),
      (count) => count > accessRequestsBefore,
      "panel_login_access_context_response",
      20_000,
    );
  } catch {
    checkpoint(
      unexpectedRoutes > deniedBefore
        ? "panel_login_route_denied"
        : "panel_login_access_context_missing",
    );
    throw new BrowserFailure("M64_BROWSER_PANEL_SIGN_IN_FAILED");
  }
  if (routeCount("panel.access_context", 200) === accessSuccessesBefore) {
    checkpoint("panel_login_access_context_non_200");
    throw new BrowserFailure("M64_BROWSER_PANEL_SIGN_IN_FAILED");
  }
  checkpoint("panel_login_org_wait");
  const activeOrgButton = panelPage.locator('button[aria-label^="Active organization:"]');
  await poll(
    () => activeOrgButton.count(),
    (count) => count === 1,
    "panel_authenticated_org",
    20_000,
  );
  checkpoint("panel_login_org_ready");

  checkpoint("contract_ui");
  const orgAttribute = await activeOrgButton.getAttribute("aria-label");
  if (!orgAttribute?.includes(panelOrgName)) {
    await activeOrgButton.click();
    await panelPage.getByRole("menuitem", { name: panelOrgName, exact: true }).click();
    await poll(
      () => activeOrgButton.getAttribute("aria-label"),
      (label) => label === `Active organization: ${panelOrgName}. Switch organization`,
      "panel_m64_org_selected",
    );
  }
  await panelPage.goto(
    `${PANEL_ORIGIN}/reporting/contracts-matrix?groupId=${GROUP_ID}&payerId=${PAYER_ID}&state=NY`,
    { waitUntil: "domcontentloaded" },
  );
  const targetCell = panelPage.locator('td[aria-current="location"]');
  await poll(
    () => targetCell.count(),
    (count) => count === 1,
    "contract_matrix_target",
  );
  await targetCell.click();
  await panelPage.getByRole("dialog").waitFor({ state: "visible" });

  const providerSelect = panelPage.getByRole("combobox", { name: "First provider for form work" });
  await providerSelect.click();
  await panelPage.getByRole("option", { name: /Synthetic M64 Provider/ }).click();
  const facilitySelect = panelPage.getByRole("combobox", { name: "Location for form work" });
  await facilitySelect.click();
  await panelPage.getByRole("option", { name: new RegExp(`${panelOrgName} Facility`) }).click();

  const tupleElement = panelPage.getByTestId("contract-launch-tuple");
  await poll(
    () => tupleElement.getAttribute("data-effective-mapping-fingerprint"),
    (fingerprint) => /^sha256:[a-f0-9]{64}$/.test(fingerprint ?? ""),
    "contract_live_map_fingerprint",
  );
  const uiTuple = await tupleElement.evaluate((element) => ({
    orgId: element.getAttribute("data-org-id"),
    portalId: element.getAttribute("data-portal-id"),
    mappingGeneration: element.getAttribute("data-mapping-generation"),
    effectiveMappingFingerprint: element.getAttribute("data-effective-mapping-fingerprint"),
    providerId: element.getAttribute("data-provider-id"),
    facilityId: element.getAttribute("data-facility-id"),
    readiness: element.getAttribute("data-readiness-outcome"),
    stepIdentity: element.getAttribute("data-step-identity"),
  }));
  assert(
    uiTuple.orgId === ORG_ID &&
      uiTuple.portalId === CONTRACT_PORTAL_ID &&
      uiTuple.mappingGeneration === "1" &&
      uiTuple.providerId === PROVIDER_ID &&
      uiTuple.facilityId === FACILITY_ID &&
      uiTuple.readiness === "ready",
    "M64_BROWSER_PANEL_CONTRACT_CONTEXT_FAILED",
  );
  const launch = panelPage.getByRole("button", { name: "Work in portal", exact: true });
  await poll(() => launch.isEnabled(), Boolean, "contract_work_launch_ready");
  await launch.click();
  await poll(
    () => workValidationSuccesses.find(({ tuple }) => tuple.ownerKind === "contract") ?? null,
    Boolean,
    "contract_real_work_validation",
  );
  const validation = workValidationSuccesses.find(({ tuple }) => tuple.ownerKind === "contract");
  assert(
    validation?.tuple.ownerId === CONTRACT_ID &&
      validation.tuple.orgId === ORG_ID &&
      validation.tuple.portalId === CONTRACT_PORTAL_ID &&
      validation.tuple.portalKey === "m64_contract" &&
      validation.tuple.mappingGeneration === 1 &&
      validation.tuple.providerId === PROVIDER_ID &&
      validation.tuple.facilityId === FACILITY_ID &&
      validation.tuple.stepIdentity === uiTuple.stepIdentity &&
      validation.effectiveMappingFingerprint === uiTuple.effectiveMappingFingerprint,
    "M64_BROWSER_PANEL_CONTRACT_LAUNCH_FAILED",
  );
  await panelPage
    .getByText("The extension validated this step and opened its exact work tab.", {
      exact: true,
    })
    .waitFor({ state: "visible" });
  const portalPages = await poll(
    () => context.pages().filter((page) => page.url().startsWith(`${PORTAL_URL}`)),
    (pages) => pages.length === 1,
    "synthetic_contract_tab",
  );
  const [portalPage] = portalPages;
  const boundWork = await extensionPage.evaluate(
    async (key) => (await chrome.storage.session.get(key))[key] ?? null,
    ACTIVE_WORK_KEY,
  );
  const boundTabId = boundWork?.boundTabId;
  assert(
    Number.isInteger(boundTabId) &&
      boundWork?.tuple?.ownerKind === "contract" &&
      boundWork.tuple.ownerId === CONTRACT_ID &&
      boundWork.tuple.portalId === CONTRACT_PORTAL_ID &&
      boundWork.formOrigin === new URL(PORTAL_URL).origin,
    "M64_BROWSER_WORK_BINDING_MISMATCH",
  );
  assert((await activeChromeTabId(extensionPage)) === boundTabId, "M64_BROWSER_ACTIVE_TAB_DRIFT");
  assert(new URL(portalPage.url()).href === PORTAL_URL, "M64_BROWSER_WORK_BINDING_MISMATCH");
  const formControls = await portalPage
    .locator("input")
    .evaluateAll((inputs) => inputs.map((input) => ({ id: input.id, type: input.type })));
  assert(
    formControls.length === 2 &&
      formControls.some((input) => input.id === "contract-npi" && input.type === "text") &&
      formControls.some((input) => input.id === "enrollment-npi" && input.type === "text") &&
      (await portalPage.locator("form, button, input[type=submit]").count()) === 0,
    "M64_BROWSER_SYNTHETIC_FORM_SHAPE_INVALID",
  );

  checkpoint("permission_probe");
  await extensionPage.evaluate((expectedTabId) => {
    const button = document.createElement("button");
    button.id = "m64-open-real-sidepanel";
    button.type = "button";
    button.textContent = "Open test side panel";
    button.addEventListener("click", async () => {
      try {
        await chrome.sidePanel.open({ tabId: expectedTabId });
        window.__m64SidePanelOpen = true;
      } catch {
        window.__m64SidePanelOpen = false;
      }
    });
    document.body.append(button);
  }, boundTabId);
  await extensionPage.locator("#m64-open-real-sidepanel").click();
  const sidePanelOpened = await poll(
    () => extensionPage.evaluate(() => window.__m64SidePanelOpen === true),
    Boolean,
    "actual_sidepanel_open",
  );
  assert(sidePanelOpened, "M64_BROWSER_ACTUAL_SIDEPANEL_OPEN_FAILED");
  assert((await activeChromeTabId(extensionPage)) === boundTabId, "M64_BROWSER_ACTIVE_TAB_DRIFT");
  await extensionPage
    .locator("#work-portal-access-grant")
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => assert(false, "M64_BROWSER_PERMISSION_CTA_UNAVAILABLE"));
  const originPattern = `${new URL(PORTAL_URL).origin}/*`;
  const permissionBefore = await extensionPage.evaluate(
    (origin) => chrome.permissions.contains({ origins: [origin] }),
    originPattern,
  );
  assert(permissionBefore === false, "M64_BROWSER_PERMISSION_PREGRANTED");
  assert((await activeChromeTabId(extensionPage)) === boundTabId, "M64_BROWSER_ACTIVE_TAB_DRIFT");
  await extensionPage
    .locator("#work-portal-access-grant")
    .click({ timeout: 10_000 })
    .catch(() => assert(false, "M64_BROWSER_PERMISSION_CONSENT_UNAVAILABLE"));
  await poll(
    () =>
      extensionPage.evaluate(
        (origin) => chrome.permissions.contains({ origins: [origin] }),
        originPattern,
      ),
    Boolean,
    "work_origin_permission_granted",
    15_000,
  ).catch(() => assert(false, "M64_BROWSER_PERMISSION_CONSENT_UNAVAILABLE"));
  const permissionAfter = await extensionPage.evaluate(
    (origin) => chrome.permissions.contains({ origins: [origin] }),
    originPattern,
  );
  assert(permissionAfter === true, "M64_BROWSER_PERMISSION_CONTAINS_FAILED");
  assert((await activeChromeTabId(extensionPage)) === boundTabId, "M64_BROWSER_ACTIVE_TAB_DRIFT");
  return {
    contractValidations: [
      {
        effectiveMappingFingerprint: validation.effectiveMappingFingerprint,
        tuple: {
          ownerKind: validation.tuple.ownerKind,
          ownerId: validation.tuple.ownerId,
          orgId: validation.tuple.orgId,
          portalId: validation.tuple.portalId,
          portalKey: validation.tuple.portalKey,
          mappingGeneration: validation.tuple.mappingGeneration,
          providerId: validation.tuple.providerId,
          facilityId: validation.tuple.facilityId,
          stepIdentity: validation.tuple.stepIdentity,
        },
      },
    ],
  };
}

async function run() {
  checkpoint("preflight");
  await preflight();

  checkpoint("tls_certificate");
  certDir = mkdtempSync(join(tmpdir(), "m64-browser-tls-"));
  certPath = join(certDir, "cert.pem");
  keyPath = join(certDir, "key.pem");
  profileDir = join(certDir, "chrome-profile");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-days",
      "1",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-subj",
      `/CN=${PANEL_HOST}`,
      "-addext",
      `subjectAltName=${certHosts.map((host) => `DNS:${host}`).join(",")}`,
    ],
    { stdio: "ignore" },
  );
  chmodSync(keyPath, 0o600);
  const sanText = execFileSync(
    "openssl",
    ["x509", "-in", certPath, "-noout", "-ext", "subjectAltName"],
    { encoding: "utf8" },
  );
  for (const host of certHosts) assert(sanText.includes(host), "M64_BROWSER_TLS_SAN_INCOMPLETE");

  checkpoint("proxy_listen");
  server = createServer(
    { cert: readFileSync(certPath), key: readFileSync(keyPath) },
    (request, response) => {
      try {
        const hostHeader = String(request.headers.host ?? "")
          .toLowerCase()
          .replace(/:\d+$/, "");
        const sni = String(request.socket.servername ?? "").toLowerCase();
        if (sni !== hostHeader || !certHosts.includes(sni)) {
          unexpected(response, "UNKNOWN_HOST");
          return;
        }
        const pathname = new URL(request.url ?? "/", `https://${hostHeader || PANEL_HOST}`)
          .pathname;
        const method = String(request.method ?? "GET").toUpperCase();
        const requestTarget = request.url ?? "/";
        const route = routeFor(hostHeader, method, pathname, requestTarget, request.headers);
        if (!route) {
          unexpected(response, classifyDenied(hostHeader, method, pathname));
          return;
        }
        if (route.kind === "static") {
          count(route.name, 200);
          serveStatic(response, route);
          return;
        }
        if (route.kind === "empty") {
          response.statusCode = 204;
          response.setHeader("cache-control", "no-store");
          count(route.name, response.statusCode);
          response.end();
          return;
        }
        if (route.kind === "preflight") {
          serveAuthPreflight(response, route);
          return;
        }
        proxyToLocal(request, response, route, requestTarget, method);
      } catch {
        if (!response.headersSent && !response.writableEnded) unexpected(response);
      }
    },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(443, "0.0.0.0", resolve);
  });

  checkpoint("chromium_launch");
  context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-extensions-except=/tmp/m64/extension",
      "--load-extension=/tmp/m64/extension",
      "--ignore-certificate-errors",
      `--host-resolver-rules=MAP ${PANEL_HOST} 127.0.0.1,MAP ${SUPABASE_HOST} 127.0.0.1,MAP ${PORTAL_HOST} 127.0.0.1,MAP * ~NOTFOUND,EXCLUDE localhost,EXCLUDE 127.0.0.1`,
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
  checkpoint("mv3_worker");
  const worker = await poll(
    () =>
      context.serviceWorkers().find((candidate) => candidate.url().endsWith("/background.js")) ??
      null,
    Boolean,
    "mv3_service_worker",
  );
  const extensionId = new URL(worker.url()).hostname;
  safeLog(`M64|BROWSER|EXTENSION_ID|${extensionId}`);
  checkpoint("panel_ready");
  await readPanelReady(extensionId);
  checkpoint("sidepanel");
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await poll(
    () => extensionPage.title(),
    (title) => title === "Minted Panel Workbench",
    "extension_sidepanel",
  );
  checkpoint("sign_in");
  const signIn = await extensionPage.evaluate(
    async ({ email, password }) => chrome.runtime.sendMessage({ type: "SIGN_IN", email, password }),
    { email: SPECIALIST_EMAIL, password: ADMIN_PASSWORD },
  );
  assert(
    signIn?.ok === true &&
      signIn.data?.signedIn === true &&
      !JSON.stringify(signIn).includes("access_token"),
    "M64_BROWSER_EXTENSION_SIGN_IN_FAILED",
  );
  checkpoint("org_select");
  const orgs = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: "LIST_MY_ORGS" }),
  );
  assert(
    orgs?.ok === true && orgs.data?.some((membership) => membership.orgId === ORG_ID),
    "M64_BROWSER_EXTENSION_ORG_LOOKUP_FAILED",
  );
  const orgSet = await extensionPage.evaluate(
    (orgId) => chrome.runtime.sendMessage({ type: "SET_ACTIVE_ORG", orgId }),
    ORG_ID,
  );
  assert(orgSet?.ok === true, "M64_BROWSER_EXTENSION_ORG_SELECTION_FAILED");

  checkpoint("handoff_send");
  const handoffPage = await context.newPage();
  await handoffPage.goto(`https://${PANEL_HOST}/__m64__/handoff`);
  assert(
    new URL(handoffPage.url()).origin === `https://${PANEL_HOST}`,
    "M64_BROWSER_HANDOFF_ORIGIN_MISMATCH",
  );
  const pageCountBefore = context.pages().length;
  const unknown = {
    protocolVersion: 2,
    launchReceiptId: randomUUID(),
    ownerKind: "case",
    ownerId: randomUUID(),
    contextVersion: 1,
    sopTemplateId: randomUUID(),
    sopVersion: 1,
    portalId: randomUUID(),
    portalKey: "m64-vertical-smoke",
    mappingGeneration: 1,
    effectiveMappingFingerprint: `sha256:${"0".repeat(64)}`,
    providerId: "70000000-0000-4000-8000-000000000001",
    orgId: ORG_ID,
    facilityId: null,
    taskId: randomUUID(),
    stepId: randomUUID(),
    stepIdentity: "m64-vertical-smoke:unknown-owner:step",
    type: "SET_ACTIVE_WORK",
    portalUrl: `https://${PORTAL_HOST}/__m64__/form`,
  };
  const acknowledgement = await handoffPage.evaluate(
    async ({ extensionId: id, message }) =>
      new Promise((resolve) => chrome.runtime.sendMessage(id, message, resolve)),
    { extensionId, message: unknown },
  );
  assert(
    acknowledgement?.ok === false && acknowledgement.code === "CONTEXT_STALE",
    "M64_BROWSER_HANDOFF_ACK_UNEXPECTED",
  );
  checkpoint("postconditions");
  await poll(
    () => metrics.get("panel.work_validate:404") ?? 0,
    (count) => count === 1,
    "real_api_validation_404",
  );
  assert(exactValidationNotFound, "M64_BROWSER_API_NOT_EXACT_CASE_NOT_FOUND");
  assert(
    (metrics.get("supabase.auth_token:200") ?? 0) >= 1,
    "M64_BROWSER_GOTRUE_SIGN_IN_NOT_OBSERVED",
  );
  assert(metrics.get("panel.me_orgs:200") >= 1, "M64_BROWSER_PANEL_AUTH_LOOKUP_NOT_OBSERVED");
  assert(context.pages().length === pageCountBefore, "M64_BROWSER_FAILED_HANDOFF_CREATED_TAB");
  const portalTabs = context
    .pages()
    .filter((page) => page.url().startsWith(`https://${PORTAL_HOST}/`));
  assert(portalTabs.length === 0, "M64_BROWSER_FAILED_HANDOFF_OPENED_PORTAL");
  const storedActiveWork = await extensionPage.evaluate(
    async (key) => (await chrome.storage.session.get(key))[key] ?? null,
    ACTIVE_WORK_KEY,
  );
  assert(storedActiveWork == null, "M64_BROWSER_FAILED_HANDOFF_PERSISTED_ACTIVE_WORK");
  assert(unexpectedRoutes === 0, `M64_BROWSER_DENIED_${firstDeniedCategory ?? "UNKNOWN_HOST"}`);
  safeLog(
    `M64|BROWSER|NEGATIVE|PASS|playwright=${PLAYWRIGHT_VERSION}|chromium=${context.browser()?.version() ?? "unknown"}|runtime_assets_sha256=${runtimeAssetsSha256}|work_validate=404|ack=CONTEXT_STALE|portal_tabs=0`,
  );

  const probe = await panelContractPermissionProbe(extensionPage);
  assert(unexpectedRoutes === 0, `M64_BROWSER_DENIED_${firstDeniedCategory ?? "UNKNOWN_HOST"}`);
  safeLog(
    "M64|BROWSER|PROBE|PASS|contract_ui=true|work_validation=true|sidepanel_open=true|active_payer_tab=true|permission_contains=true|fill_not_run=true",
  );
  safeLog(
    `M64_RESULT|${Buffer.from(
      JSON.stringify({
        extensionId,
        panelClientSha256,
        contractValidations: probe.contractValidations,
      }),
    ).toString("base64url")}`,
  );
}

try {
  await run();
} catch (error) {
  driverFailed = true;
  const code =
    currentStage === "panel_login_route_denied" && lastDeniedCategory
      ? `M64_BROWSER_DENIED_${lastDeniedCategory}`
      : error instanceof BrowserFailure
        ? error.message
        : STAGES[currentStage];
  await new Promise((resolve) => process.stderr.write(`${code ?? STAGES.preflight}\n`, resolve));
  process.exitCode = 1;
} finally {
  let cleanupTimedOut = false;
  safeLog("M64_BROWSER_CLEANUP_START");
  if (context) {
    if (!(await settleWithin(() => context.close(), 4_000))) {
      safeLog("M64_BROWSER_CLEANUP_TIMEOUT_CONTEXT");
      cleanupTimedOut = true;
    }
  }
  if (server && !proxyClosed) {
    proxyClosed = true;
    const proxyClosedInTime = await settleWithin(
      () =>
        new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections?.();
        }),
      4_000,
    );
    if (!proxyClosedInTime) {
      safeLog("M64_BROWSER_CLEANUP_TIMEOUT_PROXY");
      cleanupTimedOut = true;
    }
  }
  if (certDir) {
    try {
      rmSync(certDir, { recursive: true, force: true });
    } catch {
      /* Do not expose temporary paths in cleanup errors. */
    }
  }
  if (cleanupTimedOut) {
    safeLog("M64_BROWSER_CLEANUP_ABORT");
  }
  await new Promise((resolve) => process.stdout.write("M64_BROWSER_CLEANUP_DONE\n", resolve));
  if (driverFailed || cleanupTimedOut) {
    process.exit(1);
  }
}
