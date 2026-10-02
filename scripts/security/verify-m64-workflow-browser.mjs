// First M64 browser gate: run the exact built MV3 against a deny-by-default
// HTTPS bridge on the existing E6.12 internal Docker network. This is a
// transport/authentication rejection smoke, not owner-fill acceptance proof.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:https";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = "1.61.1";
const PANEL_HOST = "mintedpanel.vercel.app";
const SUPABASE_HOST = "fkvuhfsqcmujywzgczmc.supabase.co";
const PORTAL_HOST = "payer.m64.test";
const ORG_ID = "10000000-0000-4000-8000-000000000001";
const ADMIN_EMAIL = "admin@e612.test";
const ADMIN_PASSWORD = "E612-Local-Password-!234";
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
  tls_certificate: "M64_BROWSER_STAGE_TLS_CERTIFICATE_FAILED",
  proxy_listen: "M64_BROWSER_STAGE_PROXY_LISTEN_FAILED",
  chromium_launch: "M64_BROWSER_STAGE_CHROMIUM_LAUNCH_FAILED",
  mv3_worker: "M64_BROWSER_STAGE_MV3_WORKER_FAILED",
  sidepanel: "M64_BROWSER_STAGE_SIDEPANEL_FAILED",
  sign_in: "M64_BROWSER_STAGE_SIGN_IN_FAILED",
  org_select: "M64_BROWSER_STAGE_ORG_SELECT_FAILED",
  handoff_send: "M64_BROWSER_STAGE_HANDOFF_SEND_FAILED",
  postconditions: "M64_BROWSER_STAGE_POSTCONDITIONS_FAILED",
});

let currentStage = "preflight";
safeLog("M64_BROWSER_DRIVER_STARTED");

async function poll(read, accept, label, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      last = await read();
      if (accept(last)) return last;
    } catch (error) {
      last = error;
    }
    await delay(100);
  }
  throw new Error(`M64_BROWSER_TIMEOUT_${label}${last instanceof Error ? `_${last.message}` : ""}`);
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
let runtimeAssetsSha256;
let localAnonKey;
let expectedRuntimeAssetsSha256;
let certDir;
let certPath;
let keyPath;
let profileDir;
const certHosts = [PANEL_HOST, SUPABASE_HOST, PORTAL_HOST];
const metrics = new Map();
let unexpectedRoutes = 0;
let exactValidationNotFound = false;
let server;
let context;
let proxyClosed = false;

async function preflight() {
  localAnonKey = process.env.M64_LOCAL_ANON_KEY;
  expectedRuntimeAssetsSha256 = process.env.M64_EXPECTED_RUNTIME_ASSETS_SHA;
  assert(localAnonKey?.split(".").length === 3, "M64_BROWSER_LOCAL_ANON_KEY_MISSING");
  assert(
    /^[a-f0-9]{64}$/.test(expectedRuntimeAssetsSha256 ?? ""),
    "M64_BROWSER_EXPECTED_ASSET_HASH_MISSING",
  );
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
    backgroundSha256 === "903b0e80aef0575a2af03e0cbdad81c3edd410cf1d5bba9413526a5e53d76549",
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
}

function count(route, status) {
  const key = `${route}:${status}`;
  metrics.set(key, (metrics.get(key) ?? 0) + 1);
}

function unexpected(response, route = "proxy.unexpected") {
  unexpectedRoutes += 1;
  count(route, response.statusCode);
  response.statusCode = 404;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end("local verification route unavailable");
}

function routeFor(host, method, pathname) {
  if (host === PANEL_HOST) {
    if (method === "GET" && pathname === "/__m64__/handoff")
      return { kind: "static", name: "panel.handoff" };
    if (method === "GET" && pathname === "/api/me/orgs")
      return { kind: "app", name: "panel.me_orgs" };
    if (method === "POST" && pathname === "/api/work-context/validate")
      return { kind: "app", name: "panel.work_validate" };
    return null;
  }
  if (host === SUPABASE_HOST) {
    if (
      pathname.startsWith("/auth/v1/") ||
      pathname.startsWith("/rest/v1/") ||
      pathname.startsWith("/storage/v1/")
    ) {
      let service = "storage";
      if (pathname.startsWith("/auth/")) {
        service = pathname === "/auth/v1/token" ? "auth_token" : "auth";
      } else if (pathname.startsWith("/rest/")) {
        service = "rest";
      }
      return { kind: "gateway", name: `supabase.${service}` };
    }
    return null;
  }
  if (host === PORTAL_HOST && method === "GET" && pathname === "/__m64__/form") {
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
    "<!doctype html><title>M64 synthetic payer fixture</title><main><label>Fixture field <input id=fixture-field></label></main>",
  );
}

function proxyToLocal(request, response, route, requestUrl, method) {
  const isSupabase = route.kind === "gateway";
  const destination = isSupabase ? { host: "gateway", port: 8787 } : { host: "app", port: 3000 };
  const headers = { ...request.headers, host: `${destination.host}:${destination.port}` };
  if (isSupabase) {
    if (headers.apikey !== extensionAnonKey) {
      unexpected(response, "supabase.apikey_mismatch");
      return;
    }
    headers.apikey = localAnonKey;
    if (headers.authorization === `Bearer ${extensionAnonKey}`) {
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
        exactValidationNotFound =
          status === 404 && envelope?.data === null && envelope?.error === "Case not found.";
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

async function run() {
  currentStage = "preflight";
  await preflight();

  currentStage = "tls_certificate";
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

  currentStage = "proxy_listen";
  server = createServer(
    { cert: readFileSync(certPath), key: readFileSync(keyPath) },
    (request, response) => {
      try {
        const hostHeader = String(request.headers.host ?? "")
          .toLowerCase()
          .replace(/:\d+$/, "");
        const pathname = new URL(request.url ?? "/", `https://${hostHeader || PANEL_HOST}`)
          .pathname;
        const method = String(request.method ?? "GET").toUpperCase();
        const route = routeFor(hostHeader, method, pathname);
        if (!route) {
          unexpected(response);
          return;
        }
        if (route.kind === "static") {
          count(route.name, 200);
          serveStatic(response, route);
          return;
        }
        proxyToLocal(request, response, route, request.url ?? "/", method);
      } catch {
        if (!response.headersSent && !response.writableEnded) unexpected(response);
      }
    },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(443, "0.0.0.0", resolve);
  });

  currentStage = "chromium_launch";
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
  currentStage = "mv3_worker";
  const worker = await poll(
    () =>
      context.serviceWorkers().find((candidate) => candidate.url().endsWith("/background.js")) ??
      null,
    Boolean,
    "mv3_service_worker",
  );
  const extensionId = new URL(worker.url()).hostname;
  currentStage = "sidepanel";
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await poll(
    () => extensionPage.title(),
    (title) => title === "Minted Panel Workbench",
    "extension_sidepanel",
  );
  currentStage = "sign_in";
  const signIn = await extensionPage.evaluate(
    async ({ email, password }) => chrome.runtime.sendMessage({ type: "SIGN_IN", email, password }),
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  );
  assert(
    signIn?.ok === true &&
      signIn.data?.signedIn === true &&
      !JSON.stringify(signIn).includes("access_token"),
    "M64_BROWSER_EXTENSION_SIGN_IN_FAILED",
  );
  currentStage = "org_select";
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

  currentStage = "handoff_send";
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
  currentStage = "postconditions";
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
  assert(unexpectedRoutes === 0, "M64_BROWSER_PROXY_DENIED_UNEXPECTED_ROUTE");
  safeLog(
    `M64|BROWSER|PASS|playwright=${PLAYWRIGHT_VERSION}|chromium=${context.browser()?.version() ?? "unknown"}|runtime_assets_sha256=${runtimeAssetsSha256}`,
  );
  safeLog(
    "M64|BROWSER|PASS|goTrue_local=200|panel_orgs_local=200|work_validate_local=404|ack=CONTEXT_STALE|portal_tabs=0",
  );
}

try {
  await run();
} catch (error) {
  const code = error instanceof BrowserFailure ? error.message : STAGES[currentStage];
  process.stderr.write(`${code ?? STAGES.preflight}\n`);
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
  if (server && !proxyClosed) {
    proxyClosed = true;
    await new Promise((resolve) => server.close(resolve));
  }
  if (certDir) {
    try {
      rmSync(certDir, { recursive: true, force: true });
    } catch {
      /* Do not expose temporary paths in cleanup errors. */
    }
  }
}
