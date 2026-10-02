// E6.12 real HTTP evidence.
//
// This verifier owns a fresh internal Docker topology: Supabase Postgres,
// GoTrue, PostgREST, Storage API, a small in-network gateway, and the built
// Nitro node server. Every credential and fixture is synthetic and scoped to
// this run. The gateway is only transport glue so the app can use one local
// Supabase URL while Auth, REST, and Storage remain separate containers.
import { execFileSync, spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { E612, baseFixtureSql, restrictedFixtureSql, sqlLiteral } from "./e612-fixtures.mjs";
import { M64, m64FixtureSql } from "./e612-m64-fixtures.mjs";
import { profileHttpFixtureSql } from "./e612-profile-http-fixtures.mjs";
import { e614HttpStreamFixtureSql } from "./e614-http-stream-fixtures.mjs";
import { buildManifest, writeManifest } from "./e612-build-manifest.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const context = process.env.E612_DOCKER_CONTEXT || "default";
const runId = randomUUID().replaceAll("-", "").slice(0, 16);
const label = `com.minted.e612=${runId}`;
const network = `minted-e612-http-${runId}`;
const names = Object.fromEntries(
  ["db", "auth", "rest", "storage", "gateway", "app", "browser"].map((kind) => [
    kind,
    `${network}-${kind}`,
  ]),
);
const M64_EXTENSION_SHA = "72843b665957249591975a1ce0f3b1bdce79e140";
const M64_PANEL_BUILD_ANON_KEY = "e612-build-synthetic-anon-key";
const M64_PANEL_HOST = "mintedpanel.vercel.app";
const M64_SUPABASE_HOST = "fkvuhfsqcmujywzgczmc.supabase.co";
const M64_BROWSER_COMPLETION_TIMEOUT_MS = 10 * 60 * 1000;
const M64_BROWSER_STOP_GRACE_MS = 5_000;
const M64_BROWSER_CLEANUP_TIMEOUT_MS = 10_000;
const images = {
  db:
    process.env.E612_HTTP_DB_IMAGE ||
    "supabase/postgres@sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca",
  auth:
    process.env.E612_HTTP_AUTH_IMAGE ||
    "supabase/gotrue@sha256:3439d5affb9e96395d1348521f4c675eea7096d8d76d18d4e31fcc08df802116",
  rest:
    process.env.E612_HTTP_REST_IMAGE ||
    "postgrest/postgrest@sha256:ba586907588f4c03fc1d7e5c57732cec80c396a164199ceeddfc8a89b24412f0",
  storage:
    process.env.E612_HTTP_STORAGE_IMAGE ||
    "supabase/storage-api@sha256:f1546fac6d1c7e345428ac904bfaa7be7cecd50a1f549fe1cf38c628a7b15c85",
  node:
    process.env.E612_HTTP_NODE_IMAGE ||
    "node@sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e",
  browser:
    process.env.E612_M64_BROWSER_IMAGE ||
    "mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48",
};
const authPassword = `e612-auth-${randomBytes(18).toString("hex")}`;
const restPassword = `e612-rest-${randomBytes(18).toString("hex")}`;
const storagePassword = `e612-storage-${randomBytes(18).toString("hex")}`;
const jwtSecret = `e612-jwt-${randomBytes(48).toString("base64url")}`;
const env = Object.fromEntries(
  ["PATH", "HOME", "DOCKER_CONFIG", "LANG"].flatMap((name) =>
    process.env[name] ? [[name, process.env[name]]] : [],
  ),
);
const options = {
  env,
  encoding: "utf8",
  timeout: 120_000,
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["pipe", "pipe", "pipe"],
};
const emit = (line) => process.stdout.write(`${line}\n`);
const m64BrowserPhases = new Set([
  "network_inspect",
  "container_create",
  "container_inspect",
  "workspace_create",
  "archive_driver",
  "extract_driver",
  "archive_extension",
  "extract_extension",
  "archive_playwright",
  "extract_playwright",
  "archive_playwright_core",
  "extract_playwright_core",
  "browser_preflight",
  "browser_node_version",
  "browser_driver",
  "browser_panel_build",
  "browser_driver_finish",
]);
const m64DriverFailureMarkers = new Set([
  "M64_BROWSER_API_NOT_EXACT_CASE_NOT_FOUND",
  "M64_BROWSER_BACKGROUND_HASH_MISMATCH",
  "M64_BROWSER_BUILT_ANON_KEY_NOT_UNIQUE",
  "M64_BROWSER_CHROMIUM_BINARY_MISSING",
  "M64_BROWSER_DRIVER_NOT_STARTED",
  "M64_BROWSER_EXPECTED_ASSET_HASH_MISSING",
  "M64_BROWSER_EXTENSION_DIST_MISSING",
  "M64_BROWSER_EXTENSION_ORG_LOOKUP_FAILED",
  "M64_BROWSER_EXTENSION_ORG_SELECTION_FAILED",
  "M64_BROWSER_EXTENSION_SIGN_IN_FAILED",
  "M64_BROWSER_FAILED_HANDOFF_CREATED_TAB",
  "M64_BROWSER_FAILED_HANDOFF_OPENED_PORTAL",
  "M64_BROWSER_FAILED_HANDOFF_PERSISTED_ACTIVE_WORK",
  "M64_BROWSER_GOTRUE_SIGN_IN_NOT_OBSERVED",
  "M64_BROWSER_HANDOFF_ACK_UNEXPECTED",
  "M64_BROWSER_HANDOFF_ORIGIN_MISMATCH",
  "M64_BROWSER_HANDOFF_ORIGIN_NOT_ALLOWLISTED",
  "M64_BROWSER_LOCAL_ANON_KEY_MISSING",
  "M64_BROWSER_NOT_MV3",
  "M64_BROWSER_PANEL_AUTH_LOOKUP_NOT_OBSERVED",
  "M64_BROWSER_PANEL_BUILD_KEY_MISMATCH",
  "M64_BROWSER_PANEL_READY_EOF",
  "M64_BROWSER_PANEL_READY_INVALID",
  "M64_BROWSER_PANEL_READY_MALFORMED",
  "M64_BROWSER_PANEL_READY_TIMEOUT",
  "M64_BROWSER_PANEL_SIGN_IN_FAILED",
  "M64_BROWSER_PANEL_ORG_SELECTION_FAILED",
  "M64_BROWSER_PANEL_MATRIX_FAILED",
  "M64_BROWSER_PANEL_CONTRACT_CONTEXT_FAILED",
  "M64_BROWSER_PANEL_CONTRACT_LAUNCH_FAILED",
  "M64_BROWSER_ACTIVE_TAB_DRIFT",
  "M64_BROWSER_EXTENSION_PAGE_RELOAD_FAILED",
  "M64_BROWSER_ACTUAL_SIDEPANEL_OPEN_FAILED",
  "M64_BROWSER_PERMISSION_CTA_CLICK_FAILED",
  "M64_BROWSER_PERMISSION_GRANT_TIMEOUT",
  "M64_BROWSER_PERMISSION_PREGRANTED",
  "M64_BROWSER_PERMISSION_CTA_UNAVAILABLE",
  "M64_BROWSER_PERMISSION_CONSENT_UNAVAILABLE",
  "M64_BROWSER_DB_ACK_EOF",
  "M64_BROWSER_DB_ACK_INVALID",
  "M64_BROWSER_DB_ACK_TIMEOUT",
  "M64_BROWSER_STATIC_FORM_URL_INVALID",
  "M64_BROWSER_STATIC_FORM_ROUTE_INVALID",
  "M64_BROWSER_STATIC_FORM_ROUTE_TOO_BROAD",
  "M64_BROWSER_STATIC_FORM_SHAPE_INVALID",
  "M64_BROWSER_PANEL_REQUIRED_PERMISSION_MISSING",
  "M64_BROWSER_SYNTHETIC_FORM_FILL_MISMATCH",
  "M64_BROWSER_CONTRACT_FILL_FAILED",
  "M64_BROWSER_ENROLLMENT_FILL_FAILED",
  "M64_BROWSER_STALE_FILL_FAILED",
  "M64_BROWSER_CONTRACT_FILL_CHANGED_ENROLLMENT_CONTROL",
  "M64_BROWSER_CONTRACT_SUBMISSION_CONTROL_VISIBLE",
  "M64_BROWSER_STALE_FILL_API_REQUESTED",
  "M64_BROWSER_STALE_FILL_MUTATED_FORM",
  "M64_BROWSER_ENROLLMENT_TASK_TITLE_INVALID",
  "M64_BROWSER_ENROLLMENT_STEP_NOT_SELECTED",
  "M64_BROWSER_ENROLLMENT_WORK_BINDING_MISMATCH",
  "M64_BROWSER_SYNTHETIC_FORM_HAS_SUBMIT_CONTROL",
  "M64_BROWSER_TYPED_KEY_FILL_ISOLATION_FAILED",
  "M64_BROWSER_ENROLLMENT_HUMAN_SUBMISSION_CONTROL_INVALID",
  "M64_BROWSER_PERMISSION_CONTAINS_FAILED",
  "M64_BROWSER_WORK_BINDING_MISMATCH",
  "M64_BROWSER_SYNTHETIC_FORM_SHAPE_INVALID",
  "M64_BROWSER_PROBE_PASS_MARKER_MISSING",
  "M64_BROWSER_RESULT_MARKER_MISSING",
  "M64_BROWSER_RESULT_MALFORMED",
  "M64_BROWSER_RESULT_INVALID",
  "M64_BROWSER_PANEL_HOST_PERMISSION_MISSING",
  "M64_BROWSER_PANEL_ORIGIN_DRIFT",
  "M64_BROWSER_PLAYWRIGHT_VERSION_MISMATCH",
  "M64_BROWSER_RUNTIME_ASSET_HASH_MISMATCH",
  "M64_BROWSER_SMOKE_FAILED",
  "M64_BROWSER_STAGE_CHROMIUM_LAUNCH_FAILED",
  "M64_BROWSER_STAGE_HANDOFF_SEND_FAILED",
  "M64_BROWSER_STAGE_MV3_WORKER_FAILED",
  "M64_BROWSER_STAGE_ORG_SELECT_FAILED",
  "M64_BROWSER_STAGE_POSTCONDITIONS_FAILED",
  "M64_BROWSER_STAGE_PANEL_READY_FAILED",
  "M64_BROWSER_STAGE_PANEL_SIGN_IN_FAILED",
  "M64_BROWSER_STAGE_CONTRACT_UI_FAILED",
  "M64_BROWSER_STAGE_CONTRACT_FILL_FAILED",
  "M64_BROWSER_STAGE_ENROLLMENT_UI_FAILED",
  "M64_BROWSER_STAGE_ENROLLMENT_FILL_FAILED",
  "M64_BROWSER_STAGE_HUMAN_SUBMISSION_FAILED",
  "M64_BROWSER_STAGE_SECOND_ENROLLMENT_FILL_FAILED",
  "M64_BROWSER_STAGE_MAPPING_RESET_FAILED",
  "M64_BROWSER_STAGE_STALE_FILL_FAILED",
  "M64_BROWSER_STAGE_PERMISSION_PROBE_FAILED",
  "M64_BROWSER_STAGE_PREFLIGHT_FAILED",
  "M64_BROWSER_STAGE_PROXY_LISTEN_FAILED",
  "M64_BROWSER_STAGE_SIDEPANEL_FAILED",
  "M64_BROWSER_STAGE_SIGN_IN_FAILED",
  "M64_BROWSER_STAGE_TLS_CERTIFICATE_FAILED",
  "M64_BROWSER_SUPABASE_HOST_PERMISSION_MISSING",
  "M64_BROWSER_SUPABASE_ORIGIN_DRIFT",
  "M64_BROWSER_TLS_SAN_INCOMPLETE",
  "M64_BROWSER_UNKNOWN_FAILURE",
  "M64_BROWSER_DENIED_PANEL_GET_FAVICON",
  "M64_BROWSER_DENIED_PANEL_OPTIONS_WORK_VALIDATE",
  "M64_BROWSER_DENIED_PANEL_GET_PORTALS",
  "M64_BROWSER_DENIED_PANEL_GET_PROVIDERS",
  "M64_BROWSER_DENIED_SUPABASE_OPTIONS_AUTH",
  "M64_BROWSER_DENIED_PORTAL_GET_FAVICON",
  "M64_BROWSER_DENIED_PANEL_OTHER",
  "M64_BROWSER_DENIED_SUPABASE_OTHER",
  "M64_BROWSER_DENIED_PORTAL_OTHER",
  "M64_BROWSER_DENIED_UNKNOWN_HOST",
  "M64_BROWSER_DENIED_SUPABASE_APIKEY_MISMATCH",
  "M64_BROWSER_DENIED_SUPABASE_OPTIONS_AUTH_REASON_AUTH_PATH_OTHER",
  "M64_BROWSER_DENIED_SUPABASE_OPTIONS_AUTH_REASON_TOKEN_TARGET_OTHER",
  "M64_BROWSER_DENIED_SUPABASE_OPTIONS_AUTH_REASON_ORIGIN_OTHER",
  "M64_BROWSER_DENIED_SUPABASE_OPTIONS_AUTH_REASON_REQUEST_METHOD_OTHER",
  "M64_BROWSER_DENIED_SUPABASE_OPTIONS_AUTH_REASON_HEADER_LIST_MISSING",
  "M64_BROWSER_DENIED_SUPABASE_OPTIONS_AUTH_REASON_HEADER_NAME_UNEXPECTED",
  "M64_BROWSER_DENIED_SUPABASE_OPTIONS_AUTH_REASON_HEADER_REQUIRED_MISSING",
  "M64_BROWSER_DENIED_SUPABASE_OPTIONS_AUTH_REASON_HEADER_DUPLICATE",
  "M64_BROWSER_PREFLIGHT_POLICY_INVALID",
  "M64_BROWSER_AUTH_PREFLIGHT_NOT_OBSERVED",
  "M64_BROWSER_BUILT_MARKER_MISSING__api_work_context_validate",
  "M64_BROWSER_BUILT_MARKER_MISSING_SET_ACTIVE_WORK",
  "M64_BROWSER_BUILT_MARKER_MISSING_minted_activeWork_v2",
  "M64_BROWSER_POLL_READ_TIMEOUT",
  "M64_BROWSER_CLEANUP_TIMEOUT_CONTEXT",
  "M64_BROWSER_CLEANUP_TIMEOUT_PROXY",
  "M64_BROWSER_CLEANUP_ABORT",
]);
const m64DriverCheckpoints = new Set([
  "preflight",
  "panel_ready",
  "tls_certificate",
  "proxy_listen",
  "chromium_launch",
  "mv3_worker",
  "sidepanel",
  "sign_in",
  "org_select",
  "handoff_send",
  "postconditions",
  "panel_page_create",
  "panel_login_navigation",
  "panel_login_dom",
  "panel_login_assets",
  "panel_login_form",
  "panel_login_credentials",
  "panel_login_submit",
  "panel_login_submit_no_request",
  "panel_login_route_denied",
  "panel_login_auth_response",
  "panel_login_auth_non_200",
  "panel_login_access_context",
  "panel_login_access_context_missing",
  "panel_login_access_context_non_200",
  "panel_login_org_wait",
  "panel_login_org_ready",
  "contract_ui",
  "contract_ui_org_state",
  "contract_ui_org_open",
  "contract_ui_org_select",
  "contract_ui_org_selected",
  "contract_ui_matrix_navigation",
  "contract_ui_matrix_target",
  "contract_ui_matrix_click",
  "contract_ui_dialog",
  "contract_ui_provider_open",
  "contract_ui_provider_select",
  "contract_ui_facility_open",
  "contract_ui_facility_select",
  "contract_ui_tuple_ready",
  "contract_ui_tuple_read",
  "contract_ui_launch_ready",
  "contract_ui_launch_click",
  "contract_ui_validation",
  "contract_ui_confirmation",
  "contract_ui_portal_tab",
  "contract_ui_work_binding",
  "contract_ui_active_tab_check",
  "contract_ui_form_shape",
  "contract_fill",
  "stale_fill",
  "enrollment_ui",
  "enrollment_fill",
  "submission",
  "permission_probe",
  "permission_cta_click",
  "permission_cta_clicked",
  "permission_grant_wait",
]);
const m64PermissionGrantFields = [
  "active_payer_tab",
  "work_identity",
  "cta_present",
  "cta_disabled",
  "main_error_visible",
  "access_container_hidden",
  "permission_present",
  "permission_added",
  "permission_removed",
];
const m64PermissionGrantValues = new Set(["false", "true", "unknown"]);
const m64OrgWaitDiagnosticFields = [
  "memberships_200",
  "memberships_401",
  "memberships_403",
  "memberships_404",
  "memberships_502",
  "memberships_other",
  "profiles_200",
  "profiles_401",
  "profiles_403",
  "profiles_404",
  "profiles_502",
  "profiles_other",
  "claim_invites_200",
  "claim_invites_401",
  "claim_invites_403",
  "claim_invites_404",
  "claim_invites_502",
  "claim_invites_other",
  "options_auth_token_404",
  "options_auth_other_404",
  "options_rest_memberships_404",
  "options_rest_profiles_404",
  "options_rpc_claim_invites_404",
  "options_other_404",
  "api_cases_200",
  "api_cases_403",
  "api_cases_404",
  "api_cases_other",
];
const m64OrgWaitRoutesDiagnosticFields = [
  "options_other_rest_organizations_404",
  "options_other_rest_contracts_404",
  "options_other_rest_status_configs_404",
  "options_other_rest_provider_groups_404",
  "options_other_rest_payers_404",
  "options_other_rest_payer_network_targets_404",
  "options_other_rest_facilities_404",
  "options_other_rest_contract_sop_assignments_404",
  "options_other_rest_sop_templates_404",
  "options_other_rest_sop_template_versions_404",
  "options_other_rest_portals_404",
  "options_other_rest_portal_field_maps_404",
  "options_other_rest_credential_cases_404",
  "options_other_rest_tasks_404",
  "options_other_rest_case_facilities_404",
  "options_other_rest_touches_404",
  "options_other_rest_provider_group_assignments_404",
  "options_other_rest_provider_facility_assignments_404",
  "options_other_rest_providers_404",
  "options_other_rpc_reset_portal_mapping_404",
  "options_other_rest_unknown_404",
  "options_other_rpc_unknown_404",
  "options_other_unknown_route_404",
];
const m64OrgWaitDiagnosticCounts = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9_PLUS"]);
const m64OrgWaitDiagnosticUiStates = new Set([
  "login",
  "no_org",
  "context_loading",
  "context_error",
  "context_choose",
  "context_client_ready",
  "sidebar",
  "other",
]);
const fail = (code) => {
  throw new Error(code);
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = (args, input) =>
  execFileSync("docker", ["--context", context, ...args], { ...options, input });
function safeM64DriverFailureMarker(error) {
  const stdout = Buffer.isBuffer(error?.stdout)
    ? error.stdout.toString("utf8")
    : typeof error?.stdout === "string"
      ? error.stdout
      : "";
  const stderr = Buffer.isBuffer(error?.stderr)
    ? error.stderr.toString("utf8")
    : typeof error?.stderr === "string"
      ? error.stderr
      : "";
  const boundedStderr = `${stderr.slice(0, 8192)}\n${stderr.slice(-8192)}`;
  for (const line of boundedStderr.split(/\r?\n/).reverse()) {
    const match = /^(?:Error: )?(M64_BROWSER_[A-Za-z0-9_]+)$/.exec(line.trimEnd());
    if (match && m64DriverFailureMarkers.has(match[1])) return match[1];
  }
  const boundedStdout = `${stdout.slice(0, 8192)}\n${stdout.slice(-8192)}`;
  for (const line of boundedStdout.split(/\r?\n/).reverse()) {
    const match = /^(?:Error: )?(M64_BROWSER_[A-Za-z0-9_]+)$/.exec(line.trimEnd());
    if (match && m64DriverFailureMarkers.has(match[1])) return match[1];
  }
  return stdout.slice(0, 8192).split(/\r?\n/).includes("M64_BROWSER_DRIVER_STARTED")
    ? "M64_BROWSER_SMOKE_FAILED"
    : "M64_BROWSER_DRIVER_NOT_STARTED";
}
function safeM64DriverCheckpoint(lines) {
  let checkpoint = null;
  for (const line of lines) {
    const match = /^M64_BROWSER_CHECKPOINT_([A-Z0-9_]+)$/.exec(line);
    const candidate = match?.[1]?.toLowerCase();
    if (candidate && m64DriverCheckpoints.has(candidate)) checkpoint = candidate;
  }
  return checkpoint;
}
function reportM64BrowserCheckpoint(driver) {
  const checkpoint = safeM64DriverCheckpoint(driver.lines);
  if (checkpoint) emit(`E612|M64|BROWSER|DRIVER_CHECKPOINT|last=${checkpoint}`);
  return checkpoint;
}
function safeM64OrgWaitDiagnostic(lines) {
  const markers = lines.filter((line) => line.startsWith("M64|BROWSER|ORG_WAIT|"));
  if (markers.length !== 1) return null;
  const parts = markers[0].split("|");
  if (
    parts.length !== m64OrgWaitDiagnosticFields.length + 4 ||
    parts[0] !== "M64" ||
    parts[1] !== "BROWSER" ||
    parts[2] !== "ORG_WAIT"
  ) {
    return null;
  }
  const fields = [];
  for (let index = 0; index < m64OrgWaitDiagnosticFields.length; index += 1) {
    const [name, value, ...rest] = parts[index + 3].split("=");
    if (
      name !== m64OrgWaitDiagnosticFields[index] ||
      rest.length !== 0 ||
      !m64OrgWaitDiagnosticCounts.has(value)
    ) {
      return null;
    }
    fields.push(`${name}=${value}`);
  }
  const [uiName, uiValue, ...uiRest] = parts.at(-1).split("=");
  if (uiName !== "ui" || uiRest.length !== 0 || !m64OrgWaitDiagnosticUiStates.has(uiValue)) {
    return null;
  }
  return [...fields, `ui=${uiValue}`].join("|");
}
function safeM64FixedRouteDiagnostic(lines, markerName) {
  if (markerName !== "ORG_WAIT_ROUTES" && markerName !== "CONTRACT_UI_ROUTES") return null;
  const markers = lines.filter((line) => line.startsWith(`M64|BROWSER|${markerName}|`));
  if (markers.length !== 1) return null;
  const parts = markers[0].split("|");
  if (
    parts.length !== m64OrgWaitRoutesDiagnosticFields.length + 3 ||
    parts[0] !== "M64" ||
    parts[1] !== "BROWSER" ||
    parts[2] !== markerName
  ) {
    return null;
  }
  const fields = [];
  for (let index = 0; index < m64OrgWaitRoutesDiagnosticFields.length; index += 1) {
    const [name, value, ...rest] = parts[index + 3].split("=");
    if (
      name !== m64OrgWaitRoutesDiagnosticFields[index] ||
      rest.length !== 0 ||
      !m64OrgWaitDiagnosticCounts.has(value)
    ) {
      return null;
    }
    fields.push(`${name}=${value}`);
  }
  return fields.join("|");
}
function safeM64OrgWaitRoutesDiagnostic(lines) {
  return safeM64FixedRouteDiagnostic(lines, "ORG_WAIT_ROUTES");
}
function safeM64ContractUiRoutesDiagnostic(lines) {
  return safeM64FixedRouteDiagnostic(lines, "CONTRACT_UI_ROUTES");
}
function reportM64BrowserOrgWaitDiagnostic(driver, checkpoint) {
  if (checkpoint !== "panel_login_org_wait") return;
  const diagnostic = safeM64OrgWaitDiagnostic(driver.lines);
  if (diagnostic) emit(`E612|M64|BROWSER|ORG_WAIT_DIAGNOSTIC|${diagnostic}`);
  const routesDiagnostic = safeM64OrgWaitRoutesDiagnostic(driver.lines);
  if (routesDiagnostic) emit(`E612|M64|BROWSER|ORG_WAIT_ROUTES_DIAGNOSTIC|${routesDiagnostic}`);
}
function reportM64BrowserContractUiRouteDiagnostic(driver, checkpoint) {
  if (
    typeof checkpoint !== "string" ||
    (checkpoint !== "contract_ui" && !checkpoint.startsWith("contract_ui_"))
  ) {
    return;
  }
  const routesDiagnostic = safeM64ContractUiRoutesDiagnostic(driver.lines);
  if (routesDiagnostic) emit(`E612|M64|BROWSER|CONTRACT_UI_ROUTES_DIAGNOSTIC|${routesDiagnostic}`);
}
function safeM64PermissionGrantDiagnostic(lines) {
  const markers = lines.filter((line) => line.startsWith("M64|BROWSER|PERMISSION_GRANT|"));
  if (markers.length !== 1) return null;
  const parts = markers[0].split("|");
  if (
    parts.length !== m64PermissionGrantFields.length + 3 ||
    parts[0] !== "M64" ||
    parts[1] !== "BROWSER" ||
    parts[2] !== "PERMISSION_GRANT"
  ) {
    return null;
  }
  const fields = [];
  for (let index = 0; index < m64PermissionGrantFields.length; index += 1) {
    const [name, value, ...rest] = parts[index + 3].split("=");
    if (
      name !== m64PermissionGrantFields[index] ||
      rest.length !== 0 ||
      !m64PermissionGrantValues.has(value)
    ) {
      return null;
    }
    fields.push(`${name}=${value}`);
  }
  return fields.join("|");
}
function reportM64BrowserPermissionGrantDiagnostic(driver, checkpoint) {
  if (checkpoint !== "permission_grant_wait") return;
  const diagnostic = safeM64PermissionGrantDiagnostic(driver.lines);
  if (diagnostic) emit(`E612|M64|BROWSER|PERMISSION_GRANT_DIAGNOSTIC|${diagnostic}`);
}
function waitForM64BrowserCompletion(driver, timeoutMs) {
  let timer;
  return Promise.race([
    driver.completion,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("E612_M64_BROWSER_DRIVER_COMPLETION_TIMEOUT")),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
function waitForM64BrowserExit(driver, timeoutMs) {
  let timer;
  return Promise.race([
    driver.closed.then(() => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}
function runM64BrowserPhase(phase, operation) {
  if (!m64BrowserPhases.has(phase)) fail("E612_M64_BROWSER_PHASE_NOT_ALLOWLISTED");
  emit(`E612|M64|BROWSER|PHASE_START|${phase}`);
  try {
    const result = operation();
    emit(`E612|M64|BROWSER|PHASE_PASS|${phase}`);
    return result;
  } catch (error) {
    const rawExit = error?.status ?? error?.exitCode;
    const exit = Number.isInteger(rawExit) && rawExit >= 0 && rawExit <= 255 ? rawExit : "unknown";
    const signal =
      typeof error?.signal === "string" && /^SIG[A-Z0-9]+$/.test(error.signal)
        ? error.signal
        : "none";
    if (phase === "browser_driver") {
      emit(`E612|M64|BROWSER|DRIVER_MARKER|${safeM64DriverFailureMarker(error)}`);
    }
    emit(`E612|M64|BROWSER|PHASE_FAILED|${phase}|exit=${exit}|signal=${signal}`);
    throw new Error(`E612_M64_BROWSER_PHASE_FAILED_${phase}`);
  }
}
function archiveM64BrowserInputs(phase, tarArgs) {
  return runM64BrowserPhase(`archive_${phase}`, () =>
    execFileSync("tar", tarArgs, { ...options, encoding: "buffer" }),
  );
}
function extractM64BrowserInput(phase, archive, destination) {
  return runM64BrowserPhase(`extract_${phase}`, () =>
    docker(
      [
        "exec",
        "-i",
        names.browser,
        "tar",
        "--no-same-owner",
        "--no-same-permissions",
        "-xf",
        "-",
        "-C",
        destination,
      ],
      archive,
    ),
  );
}
function dockerProcess(args) {
  const child = spawn("docker", ["--context", context, ...args], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = [];
  let output = "";
  let buffer = "";
  let capturedBytes = 0;
  const maxCapturedBytes = 1024 * 1024;
  const maxLineLength = 128 * 1024;
  let childFailure;
  let childClosed = false;
  let stopTimer;
  function stop() {
    if (childClosed) return;
    if (!child.killed) child.kill("SIGTERM");
    if (!stopTimer) {
      stopTimer = setTimeout(() => {
        if (!childClosed) child.kill("SIGKILL");
      }, M64_BROWSER_STOP_GRACE_MS);
      stopTimer.unref();
    }
  }
  const safeMarker =
    /^(?:E6(?:12|13|14)\|[A-Z0-9_|.-]+(?:\|[A-Za-z0-9_:=.,/-]+)*|M64\|BROWSER\|[A-Z0-9_|.-]+(?:\|[A-Za-z0-9_:=.,/-]+)*|M64_BROWSER_[A-Z0-9_]+|M64_RESULT\|[A-Za-z0-9_-]{1,120000})$/;
  const captureLine = (line) => {
    const normalized = line.replace(/\r$/, "");
    if (normalized.length > maxLineLength) {
      childFailure ??= new Error("E612_HTTP_CHILD_OUTPUT_LIMIT");
      stop();
      return;
    }
    if (!safeMarker.test(normalized)) return;
    lines.push(normalized);
    output += `${normalized}\n`;
  };
  const notify = (chunk) => {
    capturedBytes += Buffer.byteLength(chunk);
    if (capturedBytes > maxCapturedBytes) {
      childFailure ??= new Error("E612_HTTP_CHILD_OUTPUT_LIMIT");
      stop();
      return;
    }
    buffer = `${buffer}${chunk}`;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      captureLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
    if (buffer.length > maxLineLength) {
      childFailure ??= new Error("E612_HTTP_CHILD_OUTPUT_LIMIT");
      stop();
      buffer = "";
    }
  };
  child.stdout.on("data", (chunk) => notify(String(chunk)));
  child.stderr.on("data", (chunk) => notify(String(chunk)));
  const closed = new Promise((resolve) => {
    if (childClosed) resolve();
    else child.once("close", resolve);
  });
  const completion = new Promise((resolve, reject) => {
    child.once("error", (error) => {
      childFailure ??= error;
      reject(error);
    });
    child.once("close", (code, signal) => {
      childClosed = true;
      if (stopTimer) clearTimeout(stopTimer);
      if (buffer) captureLine(buffer);
      if (code === 0 && !childFailure) {
        resolve({ code, signal, output, lines });
        return;
      }
      const error = childFailure ?? new Error(`E612_HTTP_CHILD_EXIT_${code ?? "signal"}`);
      childFailure ??= error;
      reject(error);
    });
  });
  // Keep `completion` unchanged for callers that await it, while observing a
  // rejection immediately so a child that exits before its marker cannot cause
  // an unhandled-rejection crash before waitFor() or finally() handles it.
  void completion.catch(() => undefined);
  const waitFor = (pattern, timeoutMs = 20_000) => {
    const match = () => lines.find((line) => pattern.test(line));
    const existing = match();
    if (existing) return Promise.resolve(existing);
    if (childFailure) return Promise.reject(childFailure);
    if (childClosed) return Promise.reject(new Error("E612_HTTP_CHILD_MARKER_MISSING"));
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let timer;
      let settled = false;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        child.off("error", onError);
        child.off("close", onClose);
      };
      const finishResolve = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onError = (error) => finishReject(error);
      const onClose = (code, signal) => {
        const found = match();
        if (found) return finishResolve(found);
        finishReject(
          childFailure ??
            new Error(
              code === 0
                ? "E612_HTTP_CHILD_MARKER_MISSING"
                : `E612_HTTP_CHILD_EXIT_${code ?? signal ?? "signal"}`,
            ),
        );
      };
      child.once("error", onError);
      child.once("close", onClose);
      const poll = () => {
        const found = match();
        if (found) return finishResolve(found);
        if (childFailure) return finishReject(childFailure);
        if (childClosed) return finishReject(new Error("E612_HTTP_CHILD_MARKER_MISSING"));
        if (Date.now() - started >= timeoutMs)
          return finishReject(new Error("E612_HTTP_CHILD_MARKER_TIMEOUT"));
        timer = setTimeout(poll, 25);
      };
      poll();
    });
  };
  return { child, closed, completion, lines, waitFor, stop };
}
function validateDockerContext() {
  let inspected;
  try {
    inspected = JSON.parse(docker(["context", "inspect", context]));
  } catch {
    fail("E612_HTTP_DOCKER_CONTEXT_UNAVAILABLE");
  }
  const host = inspected?.[0]?.Endpoints?.docker?.Host;
  if (typeof host !== "string" || !host.startsWith("unix://"))
    fail("E612_HTTP_DOCKER_CONTEXT_NOT_LOCAL");
  const server = docker(["info", "--format", "{{.ServerVersion}}"]).trim();
  if (!server) fail("E612_HTTP_DOCKER_DAEMON_UNAVAILABLE");
  emit(`E612|HTTP|DOCKER|context=${context}|endpoint=unix|server=${server}`);
}
const imageId = (image) => {
  const id = docker(["image", "inspect", image, "--format", "{{.Id}}"]).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) fail("E612_HTTP_IMAGE_NOT_CACHED");
  return id;
};
const imagePlatform = (image) => {
  const platform = docker([
    "image",
    "inspect",
    image,
    "--format",
    "{{.Os}}/{{.Architecture}}",
  ]).trim();
  if (!/^linux\/(amd64|arm64)$/.test(platform)) fail("E612_HTTP_IMAGE_PLATFORM_UNKNOWN");
  return platform;
};
function listFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = `${directory}/${entry.name}`;
      return entry.isDirectory() ? listFiles(absolute, relative) : [relative];
    })
    .sort();
}
function buildM64Extension() {
  const extensionRoot = process.env.E612_M64_EXTENSION_ROOT;
  if (typeof extensionRoot !== "string" || !existsSync(`${extensionRoot}/package.json`))
    fail("E612_M64_EXTENSION_SOURCE_REQUIRED");
  const head = execFileSync("git", ["-C", extensionRoot, "rev-parse", "HEAD"], options).trim();
  const tree = execFileSync(
    "git",
    ["-C", extensionRoot, "rev-parse", "HEAD^{tree}"],
    options,
  ).trim();
  if (head !== M64_EXTENSION_SHA) fail("E612_M64_EXTENSION_COMMIT_MISMATCH");
  if (tree !== "320a147a1a8fc978c5a172f5347c9c63fb7cc705") fail("E612_M64_EXTENSION_TREE_MISMATCH");
  try {
    execFileSync("npm", ["run", "build"], { ...options, cwd: extensionRoot, env });
  } catch {
    fail("E612_M64_EXTENSION_BUILD_FAILED");
  }
  const backgroundPath = `${extensionRoot}/dist/background.js`;
  const manifestPath = `${extensionRoot}/dist/manifest.json`;
  if (!existsSync(backgroundPath) || !existsSync(manifestPath))
    fail("E612_M64_EXTENSION_DIST_MISSING");
  const background = readFileSync(backgroundPath, "utf8");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const javascript = listFiles(`${extensionRoot}/dist`)
    .filter((name) => name.endsWith(".js"))
    .map((name) => [name, readFileSync(`${extensionRoot}/dist/${name}`, "utf8")]);
  const allJavascript = javascript.map(([, source]) => source).join("\n");
  if (
    !allJavascript.includes("https://mintedpanel.vercel.app") ||
    !allJavascript.includes("https://fkvuhfsqcmujywzgczmc.supabase.co") ||
    !background.includes("/api/work-context/validate") ||
    manifest.manifest_version !== 3
  ) {
    fail("E612_M64_EXTENSION_ARTIFACT_ORIGIN_OR_WORK_MISMATCH");
  }
  const runtimeAssetsSha = createHash("sha256")
    .update(
      javascript
        .map(([name, source]) => `${name}\0${createHash("sha256").update(source).digest("hex")}\n`)
        .join(""),
    )
    .digest("hex");
  const backgroundSha = createHash("sha256").update(background).digest("hex");
  if (backgroundSha !== "83215a2c10425451e40068682fc88b76abc08cbb2f376770cedb3070adac7c84")
    fail("E612_M64_EXTENSION_BACKGROUND_HASH_MISMATCH");
  emit(
    `M64|ARTIFACT|PASS|candidate_source_commit=${M64_EXTENSION_SHA}|built_commit=${head}|tree=${tree}|runtime_assets_sha256=${runtimeAssetsSha}`,
  );
  return { root: extensionRoot, runtimeAssetsSha };
}

async function startM64BrowserDriver(extensionBuild) {
  const { root: extensionRoot, runtimeAssetsSha } = extensionBuild;
  const playwrightPath = `${root}node_modules/playwright`;
  const playwrightCorePath = `${root}node_modules/playwright-core`;
  if (
    !existsSync(`${playwrightPath}/package.json`) ||
    !existsSync(`${playwrightCorePath}/package.json`)
  )
    fail("E612_M64_PLAYWRIGHT_PACKAGE_MISSING");
  const playwrightVersion = JSON.parse(
    readFileSync(`${playwrightPath}/package.json`, "utf8"),
  ).version;
  const playwrightCoreVersion = JSON.parse(
    readFileSync(`${playwrightCorePath}/package.json`, "utf8"),
  ).version;
  if (playwrightVersion !== "1.61.1" || playwrightCoreVersion !== playwrightVersion)
    fail("E612_M64_PLAYWRIGHT_PACKAGE_VERSION_MISMATCH");
  const networkInfo = runM64BrowserPhase(
    "network_inspect",
    () => JSON.parse(docker(["network", "inspect", network]))[0],
  );
  if (networkInfo.Internal !== true || networkInfo.Labels?.[`com.minted.e612`] !== runId) {
    emit(
      `E612|M64|BROWSER|NETWORK|internal=${networkInfo.Internal === true}|label=${networkInfo.Labels?.[`com.minted.e612`] === runId}`,
    );
    fail("E612_M64_DOCKER_NETWORK_NOT_INTERNAL");
  }
  if (platforms.browser !== "linux/amd64") fail("E612_M64_BROWSER_IMAGE_NOT_LINUX_AMD64");
  runM64BrowserPhase("container_create", () =>
    docker([
      "run",
      "--detach",
      "--rm",
      "--name",
      names.browser,
      "--label",
      label,
      "--network",
      network,
      "--network-alias",
      "browser",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--cap-add",
      "NET_BIND_SERVICE",
      "--security-opt",
      "no-new-privileges",
      "--tmpfs",
      "/tmp:rw,mode=1777",
      "--tmpfs",
      "/dev/shm:rw,nosuid,nodev,size=1g",
      "--env",
      "HOME=/tmp/m64-home",
      ids.browser,
      "sleep",
      "infinity",
    ]),
  );
  created.add("browser");
  const observed = runM64BrowserPhase(
    "container_inspect",
    () => JSON.parse(docker(["inspect", names.browser]))[0],
  );
  const browserHostConfig = observed.HostConfig ?? {};
  const browserCapabilities = browserHostConfig.CapAdd ?? [];
  const normalizedCapabilities = browserCapabilities.map((capability) =>
    capability.replace(/^CAP_/, ""),
  );
  const browserSecurityOptions = browserHostConfig.SecurityOpt ?? [];
  const browserHardening = {
    label: observed.Config?.Labels?.[`com.minted.e612`] === runId,
    network: browserHostConfig.NetworkMode === network,
    readOnlyRoot: browserHostConfig.ReadonlyRootfs === true,
    dropAllCapabilities: browserHostConfig.CapDrop?.includes("ALL") === true,
    onlyBindServiceCapability:
      browserCapabilities.length === 1 && normalizedCapabilities[0] === "NET_BIND_SERVICE",
    noNewPrivileges: browserSecurityOptions.some(
      (option) => option === "no-new-privileges" || option === "no-new-privileges:true",
    ),
    noPublishedPorts: Object.keys(browserHostConfig.PortBindings ?? {}).length === 0,
    attachedToInternalNetwork: Boolean(observed.NetworkSettings?.Networks?.[network]),
  };
  if (Object.values(browserHardening).some((check) => !check)) {
    emit(
      `E612|M64|BROWSER|HARDENING|${Object.entries(browserHardening)
        .map(([name, passed]) => `${name}=${passed}`)
        .join(
          "|",
        )}|cap_add_count=${browserCapabilities.length}|security_opt_count=${browserSecurityOptions.length}`,
    );
    fail("E612_M64_BROWSER_CONTAINER_HARDENING_MISMATCH");
  }
  runM64BrowserPhase("workspace_create", () =>
    docker([
      "exec",
      names.browser,
      "mkdir",
      "-p",
      "/tmp/m64",
      "/tmp/m64/extension",
      "/tmp/m64/node_modules",
      "/tmp/m64-home",
    ]),
  );
  extractM64BrowserInput(
    "driver",
    archiveM64BrowserInputs("driver", [
      "-cf",
      "-",
      "-C",
      `${root}scripts/security`,
      "verify-m64-workflow-browser.mjs",
    ]),
    "/tmp/m64",
  );
  extractM64BrowserInput(
    "extension",
    archiveM64BrowserInputs("extension", ["-cf", "-", "-C", `${extensionRoot}/dist`, "."]),
    "/tmp/m64/extension",
  );
  extractM64BrowserInput(
    "playwright",
    archiveM64BrowserInputs("playwright", ["-cf", "-", "-C", `${root}node_modules`, "playwright"]),
    "/tmp/m64/node_modules",
  );
  extractM64BrowserInput(
    "playwright_core",
    archiveM64BrowserInputs("playwright_core", [
      "-cf",
      "-",
      "-C",
      `${root}node_modules`,
      "playwright-core",
    ]),
    "/tmp/m64/node_modules",
  );
  runM64BrowserPhase("browser_preflight", () =>
    docker([
      "exec",
      "-w",
      "/tmp/m64",
      names.browser,
      "/bin/sh",
      "-c",
      "command -v Xvfb >/dev/null && command -v xvfb-run >/dev/null && node -e \"if(Number(process.versions.node.split('.')[0])<18)process.exit(3);if(require('playwright/package.json').version!=='1.61.1')process.exit(1);if(!require('fs').existsSync(require('playwright').chromium.executablePath()))process.exit(2)\"",
    ]),
  );
  const browserNode = runM64BrowserPhase("browser_node_version", () =>
    docker(["exec", names.browser, "node", "--version"]).trim(),
  );
  emit(
    `M64|BROWSER|PREFLIGHT|image=${ids.browser}|platform=${platforms.browser}|playwright=${playwrightVersion}|node=${browserNode}|xvfb=available|network=internal`,
  );
  const browserDriver = runM64BrowserPhase("browser_driver", () =>
    dockerProcess([
      "exec",
      "-i",
      "-e",
      `M64_LOCAL_ANON_KEY=${anonKey}`,
      "-e",
      `M64_EXPECTED_RUNTIME_ASSETS_SHA=${runtimeAssetsSha}`,
      "-e",
      `M64_PANEL_BUILD_ANON_KEY=${M64_PANEL_BUILD_ANON_KEY}`,
      names.browser,
      "xvfb-run",
      "-a",
      "node",
      "/tmp/m64/verify-m64-workflow-browser.mjs",
    ]),
  );
  let marker;
  try {
    marker = await browserDriver.waitFor(/^M64\|BROWSER\|EXTENSION_ID\|[a-p]{32}$/);
  } catch {
    browserDriver.stop();
    reportM64BrowserCheckpoint(browserDriver);
    const knownFailure = safeM64DriverFailureMarker({ stdout: browserDriver.lines.join("\n") });
    fail(`E612_M64_BROWSER_DRIVER_START_FAILED_${knownFailure.replaceAll(/[^A-Z0-9_]/g, "_")}`);
  }
  const extensionId = marker.slice("M64|BROWSER|EXTENSION_ID|".length);
  if (!/^[a-p]{32}$/.test(extensionId)) fail("E612_M64_EXTENSION_ID_INVALID");
  emit("E612|M64|BROWSER|EXTENSION|ID_OBSERVED|valid=true");
  return { browserDriver, extensionId, runtimeAssetsSha };
}

function buildM64Panel(extensionId) {
  if (!/^[a-p]{32}$/.test(extensionId)) fail("E612_M64_EXTENSION_ID_INVALID");
  const buildEnvironment = {
    ...env,
    NITRO_PRESET: "node_server",
    VITE_SUPABASE_URL: `https://${M64_SUPABASE_HOST}`,
    VITE_SUPABASE_ANON_KEY: M64_PANEL_BUILD_ANON_KEY,
    VITE_MINTED_EXTENSION_ID: extensionId,
  };
  try {
    execFileSync("npm", ["run", "build"], {
      cwd: root,
      env: buildEnvironment,
      encoding: "utf8",
      timeout: 240_000,
      stdio: ["ignore", "ignore", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    fail("E612_M64_PANEL_BROWSER_BUILD_FAILED");
  }
  let manifest;
  try {
    manifest = writeManifest();
  } catch {
    fail("E612_M64_PANEL_BUILD_MANIFEST_FAILED");
  }
  const javascriptFiles = manifest.clientFiles.filter((file) => file.endsWith(".js"));
  const embedsRuntimeConfig = javascriptFiles.some((file) =>
    readFileSync(`${root}${file}`, "utf8").includes(extensionId),
  );
  const embedsCanonicalSupabase = javascriptFiles.some((file) =>
    readFileSync(`${root}${file}`, "utf8").includes(`https://${M64_SUPABASE_HOST}`),
  );
  if (!embedsRuntimeConfig) fail("E612_M64_PANEL_EXTENSION_ID_NOT_BUILT");
  if (!embedsCanonicalSupabase) fail("E612_M64_PANEL_SUPABASE_ORIGIN_NOT_BUILT");
  const clientAssets = manifest.clientFiles
    .map((file) => file.replace(/^\.output\/public\//, "/"))
    .filter((file) => file.startsWith("/") && !file.startsWith("/../"));
  if (!clientAssets.some((file) => file.endsWith(".js")) || clientAssets.length === 0) {
    fail("E612_M64_PANEL_ASSET_ALLOWLIST_EMPTY");
  }
  emit(
    `E612|M64|PANEL_BUILD|PASS|git=${manifest.gitHead}|source=${manifest.sourceSha256}|server=${manifest.bundleSha256}|client=${manifest.clientSha256}|assets=${clientAssets.length}|extension_id_bound=true`,
  );
  return { manifest, clientAssets, extensionId };
}

function assertM64ContractIsolationAndReset(idempotencyKey) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      idempotencyKey,
    )
  ) {
    fail("E612_M64_CONTRACT_RESET_KEY_INVALID");
  }
  const sql = `
BEGIN;
SET LOCAL client_min_messages = warning;
DO $m64$
BEGIN
  IF (SELECT count(*) FROM public.fill_sessions WHERE org_id = '${M64.org}') <> 1
     OR (SELECT count(*) FROM public.fill_sessions
          WHERE org_id = '${M64.org}' AND contract_id = '${M64.contract}'
            AND case_id IS NULL AND contract_sop_assignment_id = '${M64.contractAssignment}'
            AND portal_id = '${M64.contractPortal}' AND portal_key = 'm64_contract'
            AND provider_id = '${M64.provider}' AND facility_id = '${M64.facility}'
            AND sop_template_id = '${M64.contractTemplate}' AND sop_version = 1
            AND context_version = 1 AND task_index = 0 AND step_index = 0
            AND case_task_id IS NULL AND case_step_id IS NULL
            AND launch_receipt_id IS NOT NULL AND mapping_generation = 1
            AND effective_mapping_fingerprint ~ '^sha256:[0-9a-f]{64}$'
            AND step_identity IS NOT NULL AND btrim(step_identity) <> ''
            AND fill_mode = 'web' AND is_test = false AND event_schema_version = 2) <> 1
     OR EXISTS (SELECT 1 FROM public.fill_sessions
                 WHERE org_id = '${M64.org}' AND portal_id = '${M64.enrollmentPortal}') THEN
    RAISE EXCEPTION 'M64 Contract receipt or pre-reset isolation failed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.touches WHERE org_id = '${M64.org}')
     OR NOT EXISTS (
       SELECT 1 FROM public.credential_cases
        WHERE id = '${M64.enrollmentCase}' AND org_id = '${M64.org}'
          AND case_status = 'in_progress' AND context_version = 1
     ) THEN
    RAISE EXCEPTION 'M64 Contract fill changed the Enrollment case before submission';
  END IF;
  IF (SELECT count(*) FROM public.portals
       WHERE org_id = '${M64.org}' AND form_url = '${M64.formUrl}'
         AND requires_explicit_selection AND mapping_generation = 1) <> 2
     OR NOT EXISTS (
       SELECT 1 FROM public.portals
        WHERE id = '${M64.contractPortal}' AND portal_key = 'm64_contract'
          AND case_type = 'contract' AND is_verified
          AND last_verified_at IS NOT NULL AND proven_at IS NOT NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.portals
        WHERE id = '${M64.enrollmentPortal}' AND portal_key = 'm64_enrollment'
          AND case_type = 'enrollment' AND is_verified
          AND last_verified_at IS NOT NULL AND proven_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'M64 same-URL typed portal identities or proof state are not independent';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.portal_field_maps
        WHERE org_id = '${M64.org}' AND portal_key = 'm64_contract'
          AND map_type = 'web' AND selector = '#contract-npi'
          AND token = 'provider.npi' AND status = 'approved' AND mapping_generation = 1
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.portal_field_maps
        WHERE org_id = '${M64.org}' AND portal_key = 'm64_enrollment'
          AND map_type = 'web' AND selector = '#enrollment-npi'
          AND token = 'provider.npi' AND status = 'approved' AND mapping_generation = 1
     ) THEN
    RAISE EXCEPTION 'M64 same-URL effective maps are not independently keyed';
  END IF;
  IF (SELECT count(*)
      FROM public.tasks AS task
        CROSS JOIN LATERAL jsonb_array_elements(task.sop_content) AS item(step)
       WHERE task.id = '${M64.enrollmentTask}'
         AND item.step->>'id' IN ('${M64.enrollmentStep1}', '${M64.enrollmentStep2}')
         AND item.step->'isCompleted' = 'false'::jsonb) <> 2
     OR (SELECT count(*)
           FROM public.tasks AS task
           CROSS JOIN LATERAL jsonb_array_elements(task.sop_content) AS item(step)
          WHERE task.id = '${M64.enrollmentSiblingTask}'
            AND item.step->>'id' = '${M64.enrollmentSiblingStep}'
            AND item.step->'isCompleted' = 'false'::jsonb) <> 1 THEN
    RAISE EXCEPTION 'M64 Contract fill changed an Enrollment SOP step';
  END IF;
END
$m64$;
SET LOCAL request.jwt.claim.sub = '${E612.specialist}';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"${E612.specialist}","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $m64$
DECLARE
  first_receipt public.form_mapping_reset_events%ROWTYPE;
  replay_receipt public.form_mapping_reset_events%ROWTYPE;
BEGIN
  first_receipt := public.reset_portal_mapping(
    '${M64.contractPortal}', 1, '${idempotencyKey}'
  );
  replay_receipt := public.reset_portal_mapping(
    '${M64.contractPortal}', 1, '${idempotencyKey}'
  );
  IF first_receipt.id IS NULL
     OR first_receipt.id IS DISTINCT FROM replay_receipt.id
     OR first_receipt.actor_id IS DISTINCT FROM '${E612.specialist}'::uuid
     OR first_receipt.portal_id IS DISTINCT FROM '${M64.contractPortal}'::uuid
     OR first_receipt.org_id IS DISTINCT FROM '${M64.org}'::uuid
     OR first_receipt.owner_scope IS DISTINCT FROM 'organization'
     OR first_receipt.portal_key IS DISTINCT FROM 'm64_contract'
     OR first_receipt.old_mapping_generation IS DISTINCT FROM 1
     OR first_receipt.new_mapping_generation IS DISTINCT FROM 2
     OR first_receipt.affected_field_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'M64 exact-key reset or idempotent replay failed';
  END IF;
END
$m64$;
RESET ROLE;
DO $m64$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM public.portals
        WHERE id = '${M64.contractPortal}' AND org_id = '${M64.org}'
          AND portal_key = 'm64_contract' AND mapping_generation = 2
          AND NOT is_verified AND last_verified_at IS NULL AND proven_at IS NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.portals
        WHERE id = '${M64.enrollmentPortal}' AND org_id = '${M64.org}'
          AND portal_key = 'm64_enrollment' AND mapping_generation = 1
          AND is_verified AND last_verified_at IS NOT NULL AND proven_at IS NOT NULL
     )
     OR (SELECT count(*) FROM public.portal_field_maps
          WHERE org_id = '${M64.org}' AND portal_key = 'm64_contract'
            AND mapping_generation = 1) <> 1
     OR EXISTS (SELECT 1 FROM public.portal_field_maps
                 WHERE org_id = '${M64.org}' AND portal_key = 'm64_contract'
                   AND mapping_generation = 2)
     OR (SELECT count(*) FROM public.form_mapping_reset_events
          WHERE portal_id = '${M64.contractPortal}'
            AND idempotency_key = '${idempotencyKey}'
            AND owner_scope = 'organization' AND org_id = '${M64.org}'
            AND old_mapping_generation = 1 AND new_mapping_generation = 2
            AND affected_field_count = 1) <> 1 THEN
    RAISE EXCEPTION 'M64 selected-key reset changed a sibling or lost history';
  END IF;
END
$m64$;
COMMIT;
SELECT 'M64_CONTRACT_RESET_OK';
`;
  const result = dbExec(sql).trim();
  if (result !== "M64_CONTRACT_RESET_OK") fail("E612_M64_CONTRACT_RESET_ASSERTION_FAILED");
  emit(
    "E612|M64|BROWSER|CONTRACT_ISOLATION_RESET|receipt=true|enrollment_untouched=true|idempotent=true",
  );
}

function assertM64FinalDatabaseState() {
  const sql = `
DO $m64$
BEGIN
  IF (SELECT count(*) FROM public.fill_sessions WHERE org_id = '${M64.org}') <> 2
     OR (SELECT count(*) FROM public.fill_sessions
          WHERE org_id = '${M64.org}' AND contract_id = '${M64.contract}'
            AND case_id IS NULL AND portal_id = '${M64.contractPortal}'
            AND portal_key = 'm64_contract' AND mapping_generation = 1
            AND contract_sop_assignment_id = '${M64.contractAssignment}'
            AND launch_receipt_id IS NOT NULL
            AND effective_mapping_fingerprint ~ '^sha256:[0-9a-f]{64}$'
            AND is_test = false AND event_schema_version = 2) <> 1
     OR (SELECT count(*) FROM public.fill_sessions
          WHERE org_id = '${M64.org}' AND case_id = '${M64.enrollmentCase}'
            AND contract_id IS NULL AND portal_id = '${M64.enrollmentPortal}'
            AND portal_key = 'm64_enrollment' AND mapping_generation = 1
            AND case_task_id = '${M64.enrollmentTask}'
            AND case_step_id = '${M64.enrollmentStep1}'
            AND context_version = 1 AND launch_receipt_id IS NOT NULL
            AND effective_mapping_fingerprint ~ '^sha256:[0-9a-f]{64}$'
            AND is_test = false AND event_schema_version = 2) <> 1 THEN
    RAISE EXCEPTION 'M64 Contract/Enrollment fill receipts are not exact and distinct';
  END IF;
  IF (SELECT count(*) FROM public.touches
       WHERE org_id = '${M64.org}' AND case_id = '${M64.enrollmentCase}'
         AND task_id = '${M64.enrollmentTask}'
         AND fill_session_id IN (
           SELECT id FROM public.fill_sessions
            WHERE org_id = '${M64.org}' AND case_id = '${M64.enrollmentCase}'
              AND case_step_id = '${M64.enrollmentStep1}'
         )
         AND entry_type = 'touchpoint' AND touch_type = 'portal'
         AND outcome = 'submitted' AND source = 'extension'
         AND coordinator_id = '${E612.specialist}') <> 1
     OR EXISTS (SELECT 1 FROM public.touches
                 WHERE org_id = '${M64.org}' AND task_id = '${M64.enrollmentSiblingTask}')
     OR EXISTS (SELECT 1 FROM public.touches
                 WHERE org_id = '${M64.org}' AND fill_session_id IS NOT NULL
                   AND fill_session_id NOT IN (
                     SELECT id FROM public.fill_sessions
                      WHERE org_id = '${M64.org}' AND case_id = '${M64.enrollmentCase}'
                        AND case_step_id = '${M64.enrollmentStep1}'
                   )) THEN
    RAISE EXCEPTION 'M64 human submission touch escaped its exact Enrollment step';
  END IF;
  IF (SELECT count(*)
      FROM public.tasks AS task
        CROSS JOIN LATERAL jsonb_array_elements(task.sop_content) AS item(step)
       WHERE task.id = '${M64.enrollmentTask}'
         AND item.step->>'id' = '${M64.enrollmentStep1}'
         AND item.step->'isCompleted' = 'true'::jsonb) <> 1
     OR (SELECT count(*)
           FROM public.tasks AS task
           CROSS JOIN LATERAL jsonb_array_elements(task.sop_content) AS item(step)
          WHERE task.id = '${M64.enrollmentTask}'
            AND item.step->>'id' = '${M64.enrollmentStep2}'
            AND item.step->'isCompleted' = 'false'::jsonb) <> 1
     OR (SELECT count(*)
           FROM public.tasks AS task
           CROSS JOIN LATERAL jsonb_array_elements(task.sop_content) AS item(step)
          WHERE task.id = '${M64.enrollmentSiblingTask}'
            AND item.step->>'id' = '${M64.enrollmentSiblingStep}'
            AND item.step->'isCompleted' = 'false'::jsonb) <> 1 THEN
    RAISE EXCEPTION 'M64 selected-step or sibling-step completion state is incorrect';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.portals
        WHERE id = '${M64.contractPortal}' AND mapping_generation = 2
          AND NOT is_verified AND last_verified_at IS NULL AND proven_at IS NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.portals
        WHERE id = '${M64.enrollmentPortal}' AND mapping_generation = 1
          AND is_verified AND last_verified_at IS NOT NULL AND proven_at IS NOT NULL
     )
     OR (SELECT count(*) FROM public.form_mapping_reset_events
          WHERE portal_id = '${M64.contractPortal}' AND old_mapping_generation = 1
            AND new_mapping_generation = 2 AND owner_scope = 'organization'
            AND org_id = '${M64.org}') <> 1 THEN
    RAISE EXCEPTION 'M64 reset history or sibling generation was not preserved';
  END IF;
END
$m64$;
SELECT 'M64_FINAL_STATE_OK';
`;
  const result = dbExec(sql).trim();
  if (result !== "M64_FINAL_STATE_OK") fail("E612_M64_FINAL_DATABASE_ASSERTION_FAILED");
  emit(
    "E612|M64|BROWSER|FINAL_DB_ASSERTIONS|contract_history=true|enrollment_receipt=true|selected_step_only=true",
  );
}

async function finishM64BrowserSmoke(browserSession, panelBuild) {
  const ready = Buffer.from(
    JSON.stringify({
      extensionId: panelBuild.extensionId,
      clientSha256: panelBuild.manifest.clientSha256,
      clientAssets: panelBuild.clientAssets,
      orgName: `E612 M64 ${runId} Organization`,
    }),
  ).toString("base64url");
  browserSession.browserDriver.child.stdin.write(`M64_PANEL_READY|${ready}\n`);
  let result;
  try {
    const contractCheckpoint = await browserSession.browserDriver.waitFor(
      /^M64\|BROWSER\|DB_CHECKPOINT\|CONTRACT_FILL_COMPLETE$/,
      180_000,
    );
    if (
      contractCheckpoint !== "M64|BROWSER|DB_CHECKPOINT|CONTRACT_FILL_COMPLETE" ||
      browserSession.browserDriver.lines.filter(
        (line) => line === "M64|BROWSER|DB_CHECKPOINT|CONTRACT_FILL_COMPLETE",
      ).length !== 1
    ) {
      fail("E612_M64_CONTRACT_CHECKPOINT_INVALID");
    }
    assertM64ContractIsolationAndReset(randomUUID());
    browserSession.browserDriver.child.stdin.write("M64_DB_ACK|CONTRACT_RESET_COMPLETE\n");
    result = await waitForM64BrowserCompletion(
      browserSession.browserDriver,
      M64_BROWSER_COMPLETION_TIMEOUT_MS,
    );
  } catch (error) {
    browserSession.browserDriver.stop();
    const checkpoint = reportM64BrowserCheckpoint(browserSession.browserDriver);
    reportM64BrowserOrgWaitDiagnostic(browserSession.browserDriver, checkpoint);
    reportM64BrowserContractUiRouteDiagnostic(browserSession.browserDriver, checkpoint);
    reportM64BrowserPermissionGrantDiagnostic(browserSession.browserDriver, checkpoint);
    if (
      error instanceof Error &&
      /^E612_M64_(?:CONTRACT_CHECKPOINT_INVALID|CONTRACT_RESET_KEY_INVALID|CONTRACT_RESET_ASSERTION_FAILED)$/.test(
        error.message,
      )
    ) {
      fail(error.message);
    }
    if (error instanceof Error && error.message === "E612_M64_BROWSER_DRIVER_COMPLETION_TIMEOUT") {
      emit("E612|M64|BROWSER|DRIVER_TIMEOUT|minutes=10");
      fail("E612_M64_BROWSER_DRIVER_COMPLETION_TIMEOUT");
    }
    const knownFailure = safeM64DriverFailureMarker({
      stdout: browserSession.browserDriver.lines.join("\n"),
    });
    fail(`E612_M64_BROWSER_DRIVER_FAILED_${knownFailure.replaceAll(/[^A-Z0-9_]/g, "_")}`);
  }
  const expectedVertical =
    "M64|BROWSER|VERTICAL|PASS|static_host=true|optional_host_consent=unverified|contract_fill_receipt=true|enrollment_fill_receipt=true|selected_step_submission=true|selected_key_reset=true|stale_fill_rejected=true";
  const expectedConsentHold =
    "M64|BROWSER|OPTIONAL_HOST_CONSENT|HOLD|reason=manual_only_not_tested";
  if (
    result.lines.filter((line) => line === expectedVertical).length !== 1 ||
    result.lines.filter((line) => line === expectedConsentHold).length !== 1
  ) {
    fail("E612_M64_VERTICAL_MARKER_OR_CONSENT_HOLD_MISSING");
  }
  const resultLine = result.lines.find((line) => line.startsWith("M64_RESULT|"));
  if (!resultLine) fail("E612_M64_BROWSER_RESULT_MARKER_MISSING");
  let browserResult;
  try {
    browserResult = JSON.parse(
      Buffer.from(resultLine.slice("M64_RESULT|".length), "base64url").toString("utf8"),
    );
  } catch {
    fail("E612_M64_BROWSER_RESULT_MALFORMED");
  }
  if (
    browserResult?.extensionId !== panelBuild.extensionId ||
    browserResult?.panelClientSha256 !== panelBuild.manifest.clientSha256 ||
    !Array.isArray(browserResult?.contractValidations) ||
    browserResult.contractValidations.length !== 1 ||
    !Array.isArray(browserResult?.enrollmentValidations) ||
    browserResult.enrollmentValidations.length !== 1
  ) {
    fail("E612_M64_BROWSER_RESULT_INVALID");
  }
  const contractValidation = browserResult.contractValidations[0];
  const contractTuple = contractValidation?.tuple;
  if (
    contractValidation?.protocolVersion !== 2 ||
    contractTuple?.ownerKind !== "contract" ||
    contractTuple.ownerId !== M64.contract ||
    contractTuple.orgId !== M64.org ||
    contractTuple.portalId !== M64.contractPortal ||
    contractTuple.portalKey !== "m64_contract" ||
    contractTuple.assignmentId !== M64.contractAssignment ||
    contractTuple.mappingGeneration !== 1 ||
    contractTuple.contextVersion !== 1 ||
    contractTuple.providerId !== M64.provider ||
    contractTuple.facilityId !== M64.facility ||
    contractTuple.taskId !== null ||
    contractTuple.stepId !== null ||
    contractTuple.taskIndex !== 0 ||
    contractTuple.stepIndex !== 0 ||
    typeof contractTuple.launchReceiptId !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(contractValidation?.effectiveMappingFingerprint ?? "") ||
    typeof contractTuple.stepIdentity !== "string" ||
    contractTuple.stepIdentity.length === 0
  ) {
    fail("E612_M64_BROWSER_RESULT_INVALID");
  }
  const enrollmentValidation = browserResult.enrollmentValidations[0];
  const enrollmentTuple = enrollmentValidation?.tuple;
  if (
    enrollmentValidation?.protocolVersion !== 2 ||
    enrollmentTuple?.ownerKind !== "case" ||
    enrollmentTuple.ownerId !== M64.enrollmentCase ||
    enrollmentTuple.orgId !== M64.org ||
    enrollmentTuple.portalId !== M64.enrollmentPortal ||
    enrollmentTuple.portalKey !== "m64_enrollment" ||
    enrollmentTuple.mappingGeneration !== 1 ||
    enrollmentTuple.contextVersion !== 1 ||
    enrollmentTuple.providerId !== M64.provider ||
    enrollmentTuple.facilityId !== M64.facility ||
    enrollmentTuple.taskId !== M64.enrollmentTask ||
    enrollmentTuple.stepId !== M64.enrollmentStep1 ||
    typeof enrollmentTuple.launchReceiptId !== "string" ||
    typeof enrollmentTuple.stepIdentity !== "string" ||
    enrollmentTuple.stepIdentity.length === 0 ||
    !/^sha256:[a-f0-9]{64}$/.test(enrollmentValidation?.effectiveMappingFingerprint ?? "") ||
    enrollmentValidation.effectiveMappingFingerprint ===
      contractValidation.effectiveMappingFingerprint
  ) {
    fail("E612_M64_BROWSER_RESULT_INVALID");
  }
  assertM64FinalDatabaseState();
  emit(
    `E612|M64|BROWSER|VERTICAL|PASS|panel=${panelBuild.manifest.gitHead}|client=${panelBuild.manifest.clientSha256}|extension=${browserSession.extensionId}|static_host=true|optional_host_consent=unverified|contract_and_enrollment_receipts=true|exact_step_submission=true|selected_key_reset=true|stale_fill_rejected=true`,
  );
}

function startM64App(extensionId) {
  const appEnv = [
    "--env",
    "NITRO_HOST=0.0.0.0",
    "--env",
    "NITRO_PORT=3000",
    "--env",
    "SUPABASE_URL=http://gateway:8787",
    "--env",
    `VITE_SUPABASE_URL=https://${M64_SUPABASE_HOST}`,
    "--env",
    `SUPABASE_ANON_KEY=${anonKey}`,
    "--env",
    `VITE_SUPABASE_ANON_KEY=${M64_PANEL_BUILD_ANON_KEY}`,
    "--env",
    `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
    "--env",
    `API_CORS_ORIGINS=https://${M64_PANEL_HOST},chrome-extension://${extensionId}`,
  ];
  const output = `${root}.output/server`;
  const publicOutput = `${root}.output/public`;
  if (
    !existsSync(`${output}/index.mjs`) ||
    !existsSync(publicOutput) ||
    !buildManifest().clientFiles.some((file) => file.endsWith(".js"))
  ) {
    fail("E612_HTTP_APP_BUILD_REQUIRED");
  }
  docker([
    "create",
    "--name",
    names.app,
    "--label",
    label,
    "--network",
    network,
    "--network-alias",
    "app",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    ...appEnv,
    ids.node,
    "node",
    "/tmp/server/index.mjs",
  ]);
  created.add("app");
  docker(["cp", output, `${names.app}:/tmp/server`]);
  docker(["cp", publicOutput, `${names.app}:/tmp/public`]);
  docker(["start", names.app]);
}
let ids;
let platforms;

function dbExec(input) {
  return docker(
    [
      "exec",
      "-i",
      names.db,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=sqlstate",
    ],
    input,
  );
}

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = encode({ alg: "HS256", typ: "JWT" });
  const body = encode({
    iss: "minted-e612-http",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload,
  });
  const data = `${head}.${body}`;
  return `${data}.${createHmac("sha256", jwtSecret).update(data).digest("base64url")}`;
}
const adminToken = jwt({ role: "service_role", aud: "authenticated" });
const anonKey = jwt({ role: "anon", aud: "authenticated" });
const serviceKey = adminToken;
function start(kind, args, image, command = [], hardened = true) {
  const hardening =
    hardened && !["gateway"].includes(kind)
      ? [
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--tmpfs",
          "/tmp:rw,mode=1777",
        ]
      : hardened
        ? ["--cap-drop", "ALL", "--security-opt", "no-new-privileges"]
        : [];
  docker([
    "run",
    "--detach",
    "--rm",
    "--name",
    names[kind],
    "--label",
    label,
    "--network",
    network,
    "--network-alias",
    kind,
    ...hardening,
    ...args,
    image,
    ...command,
  ]);
}

async function internalReady(base, path, expectedStatus = 200) {
  const code = `fetch(${JSON.stringify(`${base}${path}`)}, {signal:AbortSignal.timeout(10000)}).then((r)=>process.exitCode=r.status===${expectedStatus}?0:1).catch(()=>process.exitCode=1)`;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      docker(["exec", names.gateway, "node", "-e", code]);
      return;
    } catch {
      if (attempt === 119) {
        if (base === "http://app:3000") {
          emit(
            `E612|HTTP|APP_STATE|${docker(["inspect", names.app, "--format", "{{.State.Status}}:{{.State.ExitCode}}"]).trim()}`,
          );
          const startupLog = docker(["logs", "--tail", "30", names.app]);
          for (const line of startupLog
            .split("\n")
            .filter((item) => /error|cannot|failed/i.test(item))) {
            emit(`E612|HTTP|APP_STARTUP|${line.replace(/[^A-Za-z0-9 .:_/-]/g, "_").slice(0, 240)}`);
          }
        }
        fail(`E612_HTTP_INTERNAL_SERVICE_NOT_READY_${base.replaceAll(/[^A-Za-z0-9]+/g, "_")}`);
      }
    }
    await pause(250);
  }
}

function runInternalDriver() {
  docker([
    "cp",
    `${root}scripts/security/e612-http-driver.mjs`,
    `${names.gateway}:/tmp/e612-http-driver.mjs`,
  ]);
  docker([
    "cp",
    `${root}scripts/security/e613-http-probes.mjs`,
    `${names.gateway}:/tmp/e613-http-probes.mjs`,
  ]);
  docker([
    "cp",
    `${root}scripts/security/e614-http-stream-fixtures.mjs`,
    `${names.gateway}:/tmp/e614-http-stream-fixtures.mjs`,
  ]);
  docker([
    "cp",
    `${root}scripts/security/e614-http-stream-probes.mjs`,
    `${names.gateway}:/tmp/e614-http-stream-probes.mjs`,
  ]);
  docker([
    "cp",
    `${root}scripts/security/e612-profile-http-fixtures.mjs`,
    `${names.gateway}:/tmp/e612-profile-http-fixtures.mjs`,
  ]);
  docker([
    "cp",
    `${root}scripts/security/e612-profile-http-probes.mjs`,
    `${names.gateway}:/tmp/e612-profile-http-probes.mjs`,
  ]);
  try {
    const expiredToken = jwt({
      sub: E612.clientActive,
      email: "active@e612.test",
      role: "authenticated",
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const output = docker([
      "exec",
      "-i",
      "-e",
      `E612_ADMIN_TOKEN=${adminToken}`,
      "-e",
      `E612_ANON_KEY=${anonKey}`,
      "-e",
      "E612_BUCKET_ID=payer-forms",
      "-e",
      `E612_EXPIRED_TOKEN=${expiredToken}`,
      names.gateway,
      "node",
      "/tmp/e612-http-driver.mjs",
    ]);
    process.stdout.write(output);
    if (!output.includes("E612|HTTP|PASS")) fail("E612_HTTP_DRIVER_PASS_MARKER_MISSING");
    if (!output.includes("E613|HTTP|PASS")) fail("E613_HTTP_PROBE_PASS_MARKER_MISSING");
    if (!output.includes("E614|HTTP|PASS")) fail("E614_HTTP_PROBE_PASS_MARKER_MISSING");
    if (!output.includes("E612|PROFILE|PASS")) fail("E612_PROFILE_PROBE_PASS_MARKER_MISSING");
  } catch (error) {
    if (error.stdout) process.stdout.write(String(error.stdout));
    fail("E612_HTTP_DRIVER_FAILED");
  }
}

async function runInternalAuthorityReadRace() {
  const driverEnv = [
    "-e",
    `E612_ADMIN_TOKEN=${adminToken}`,
    "-e",
    `E612_ANON_KEY=${anonKey}`,
    "-e",
    "E612_BUCKET_ID=payer-forms",
  ];
  const lockSql = `
\\set ON_ERROR_STOP on
BEGIN;
LOCK TABLE public.portals IN ACCESS EXCLUSIVE MODE;
SELECT 'E612|RACE|LOCK_READY|pid=' || pg_backend_pid();
`;
  let lock;
  let read;
  let released = false;
  try {
    read = dockerProcess([
      "exec",
      "-i",
      ...driverEnv,
      names.gateway,
      "node",
      "/tmp/e612-http-driver.mjs",
      "--race-read",
    ]);
    await read.waitFor(/^E612\|RACE\|POSITIVE_COMPLETE$/);

    lock = dockerProcess([
      "exec",
      "-i",
      names.db,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ]);
    lock.child.stdin.write(lockSql);
    const readyLine = await lock.waitFor(/^E612\|RACE\|LOCK_READY\|pid=\d+$/);
    const holder = Number(readyLine.split("pid=")[1]);
    if (!Number.isInteger(holder) || holder <= 0) fail("E612_HTTP_RACE_HOLDER_INVALID");

    read.child.stdin.write("START\n");
    await read.waitFor(/^E612\|RACE\|GET_STARTED$/);

    let barrier = "";
    for (let attempt = 0; attempt < 120; attempt++) {
      barrier = dbExec(
        `SELECT pid || '|' || pg_blocking_pids(pid)::text
           FROM pg_stat_activity
          WHERE wait_event_type = 'Lock'
            AND ${holder} = ANY(pg_blocking_pids(pid))
            AND query ILIKE '%portals%';`,
      ).trim();
      if (barrier) break;
      if (attempt === 119) fail("E612_HTTP_RACE_READ_NOT_BLOCKED");
      await pause(100);
    }
    const [waiter, blockers] = barrier.split("|", 2);
    emit(`E612|HTTP|RACE|BARRIER|holder=${holder}|waiter=${waiter}|blockers=${blockers}`);

    const changed = docker([
      "exec",
      "-i",
      ...driverEnv,
      names.gateway,
      "node",
      "/tmp/e612-http-driver.mjs",
      "--race-mutate",
    ]);
    process.stdout.write(changed);
    if (!changed.includes("E612|RACE|AUTHORITY_CHANGED"))
      fail("E612_HTTP_RACE_AUTHORITY_MUTATION_MARKER_MISSING");

    lock.child.stdin.write("COMMIT;\n");
    lock.child.stdin.end();
    released = true;
    emit("E612|HTTP|RACE|RELEASED");
    await lock.completion;
    const readResult = await read.completion;
    process.stdout.write(readResult.output);
  } finally {
    if (!released) {
      try {
        if (lock?.child.stdin.writable) {
          lock.child.stdin.write("ROLLBACK;\n");
          lock.child.stdin.end();
        }
      } catch {
        /* container cleanup below still owns the session */
      }
    }
    if (read) {
      try {
        if (!released) read.stop();
        await read.completion;
      } catch {
        read.stop();
      }
    }
    if (lock) {
      try {
        if (!released && lock.child.stdin.writable) {
          lock.child.stdin.write("ROLLBACK;\n");
          lock.child.stdin.end();
        }
        await lock.completion;
      } catch {
        lock.stop();
      }
    }
  }
}

function runAuthBootstrap() {
  docker([
    "cp",
    `${root}scripts/security/e612-http-driver.mjs`,
    `${names.gateway}:/tmp/e612-http-driver.mjs`,
  ]);
  try {
    const output = docker([
      "exec",
      "-i",
      "-e",
      `E612_ADMIN_TOKEN=${adminToken}`,
      "-e",
      `E612_ANON_KEY=${anonKey}`,
      names.gateway,
      "node",
      "/tmp/e612-http-driver.mjs",
      "--bootstrap",
    ]);
    process.stdout.write(output);
    if (!output.includes("E612|HTTP|PASS|auth.admin_create_all"))
      fail("E612_HTTP_AUTH_BOOTSTRAP_MARKER_MISSING");
  } catch (error) {
    if (error.stdout) process.stdout.write(String(error.stdout));
    fail("E612_HTTP_AUTH_BOOTSTRAP_FAILED");
  }
}

function sqlBootstrap() {
  const statements = [
    `
ALTER ROLE supabase_auth_admin PASSWORD ${sqlLiteral(authPassword)};
ALTER ROLE authenticator PASSWORD ${sqlLiteral(restPassword)};
ALTER ROLE supabase_storage_admin PASSWORD ${sqlLiteral(storagePassword)};
GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;
`,
    `
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;
`,
  ];
  for (const [index, statement] of statements.entries()) {
    emit(`E612|HTTP|BOOTSTRAP|${index + 1}`);
    try {
      dbExec(statement);
    } catch (error) {
      const diagnostic = String(error?.stderr ?? error?.message ?? "");
      const sqlState =
        diagnostic.match(/(?:SQL state: |\[)([0-9A-Z]{5})(?:\]|\b)/)?.[1] ?? "unknown";
      emit(`E612|HTTP|BOOTSTRAP_FAILED|step=${index + 1}|sqlstate=${sqlState}`);
      throw new Error(`E612_HTTP_SQL_BOOTSTRAP_FAILED_${index + 1}`);
    }
  }
}

function applyMigrations() {
  const files = readdirSync(`${root}supabase/migrations`)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (!files.some((name) => name === "20260925035408_e612_client_access_context.sql"))
    fail("E612_HTTP_MIGRATION_MISSING");
  for (const name of files) {
    try {
      dbExec(readFileSync(`${root}supabase/migrations/${name}`, "utf8"));
    } catch {
      fail(`E612_HTTP_MIGRATION_FAILED_${name}`);
    }
  }
  emit(`E612|HTTP|MIGRATIONS|${files.length}`);
}

function seedFixtures() {
  try {
    dbExec(baseFixtureSql());
  } catch {
    fail("E612_HTTP_SEED_FAILED_base");
  }
  try {
    dbExec(restrictedFixtureSql());
  } catch {
    fail("E612_HTTP_SEED_FAILED_restricted");
  }
  try {
    dbExec(`
INSERT INTO public.payers (id, org_id, payer_slug, name)
VALUES ('60000000-0000-4000-8000-000000000001', NULL, 'e612-global-payer', 'E612 Global Payer'),
       ('60000000-0000-4000-8000-000000000002', '${E612.orgA}', 'e612-private-payer', 'E612 Private Payer')
ON CONFLICT DO NOTHING;
INSERT INTO public.payer_catalog_changes
  (id, payer_id, field, old_value, new_value, source, review_state)
VALUES
  ('90000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000001',
   'name', 'E612 Global Payer (old)', 'E612 Global Payer', 'manual', 'unreviewed')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.portals
  (id, org_id, portal_key, name, payer_id, form_url)
VALUES
  ('${E612.orgPortal}', '${E612.orgA}', 'e612-org-portal', 'E612 Org Portal',
   '60000000-0000-4000-8000-000000000001', 'https://org.e612.test/form')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.facilities
  (id, org_id, group_id, name, city, state, zip, is_active)
VALUES
  ('70000000-0000-4000-8000-000000000002', '${E612.orgA}', '${E612.groupA1}',
   'E613 Synthetic Facility', 'Topeka', 'KS', '66603', TRUE)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.provider_group_assignments
  (org_id, provider_id, group_id, is_primary, start_date)
VALUES ('${E612.orgA}', '${E612.provider}', '${E612.groupA1}', TRUE, DATE '2026-01-01')
ON CONFLICT (provider_id, group_id) DO NOTHING;
INSERT INTO public.provider_facility_assignments
  (org_id, provider_id, facility_id, is_primary, start_date)
VALUES ('${E612.orgA}', '${E612.provider}', '70000000-0000-4000-8000-000000000002', FALSE, DATE '2026-01-01')
ON CONFLICT (provider_id, facility_id) DO NOTHING;
INSERT INTO public.inbound_leads
  (id, org_name, contact_name, contact_email, contact_phone, city, state, postal_code, country, status)
VALUES
  ('61000000-0000-4000-8000-000000000001', 'E612 Lead Org', 'E612 Contact', 'e612-lead@e612.test', '303-555-0161', 'Denver', 'CO', '80202', 'US', 'new')
ON CONFLICT (id) DO NOTHING;
`);
  } catch {
    fail("E612_HTTP_SEED_FAILED_post");
  }
  try {
    dbExec(profileHttpFixtureSql({ E612 }));
  } catch {
    fail("E612_HTTP_SEED_FAILED_profile");
  }
  try {
    dbExec(e614HttpStreamFixtureSql());
  } catch (error) {
    const state = String(error?.stderr ?? "").match(/(?:ERROR|SQLSTATE)[: ]+([A-Z0-9]{5})/i)?.[1];
    emit(`E614|HTTP|FIXTURE_SQLSTATE|${state ?? "unknown"}`);
    fail("E614_HTTP_STREAM_SEED_FAILED");
  }
  try {
    dbExec(m64FixtureSql(runId));
    emit("E612|M64|FIXTURE|PASS|persistent=true|receipts_preseeded=false|touches_preseeded=false");
  } catch {
    fail("E612_M64_FIXTURE_SEED_FAILED");
  }
}

const created = new Set();
let networkCreated = false;
let browserSession;
let stage = "docker_context";
try {
  validateDockerContext();
  stage = "pinned_images";
  ids = Object.fromEntries(Object.entries(images).map(([kind, image]) => [kind, imageId(image)]));
  platforms = Object.fromEntries(
    Object.entries(images).map(([kind, image]) => [kind, imagePlatform(image)]),
  );
  emit(
    `E612|HTTP|IMAGES|db=${ids.db}|auth=${ids.auth}|rest=${ids.rest}|storage=${ids.storage}|node=${ids.node}|browser=${ids.browser}`,
  );
  emit(
    `E612|HTTP|PLATFORM|db=${platforms.db}|auth=${platforms.auth}|rest=${platforms.rest}|storage=${platforms.storage}|node=${platforms.node}|browser=${platforms.browser}`,
  );
  stage = "build_manifest";
  const manifestPath = `${root}.output/server/.e612-build-manifest.json`;
  if (!existsSync(manifestPath)) fail("E612_HTTP_BUILD_MANIFEST_MISSING");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const currentManifest = buildManifest();
  if (
    manifest.sourceSha256 !== currentManifest.sourceSha256 ||
    manifest.bundleSha256 !== currentManifest.bundleSha256 ||
    manifest.clientSha256 !== currentManifest.clientSha256 ||
    !Array.isArray(manifest.sourceFiles) ||
    !Array.isArray(manifest.bundleFiles) ||
    !Array.isArray(manifest.clientFiles) ||
    manifest.format !== 3
  )
    fail("E612_HTTP_BUILD_MANIFEST_MISMATCH");
  emit(
    `E612|HTTP|BUILD|git=${manifest.gitHead}|source=${manifest.sourceSha256}|server=${manifest.bundleSha256}|client=${manifest.clientSha256}`,
  );
  stage = "m64_extension_build";
  const m64ExtensionBuild = buildM64Extension();
  docker(["network", "create", "--internal", "--label", label, network]);
  networkCreated = true;
  stage = "m64_browser_extension_id";
  browserSession = await startM64BrowserDriver(m64ExtensionBuild);
  stage = "isolated_database";
  start(
    "db",
    [
      "--env",
      "POSTGRES_PASSWORD=postgres",
      "--env",
      "POSTGRES_USER=supabase_admin",
      "--env",
      "POSTGRES_DB=postgres",
      "--health-cmd",
      "pg_isready -U supabase_admin -d postgres",
    ],
    ids.db,
    [],
    false,
  );
  created.add("db");
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      docker(["exec", names.db, "pg_isready", "-q", "-U", "supabase_admin", "-d", "postgres"]);
      break;
    } catch {
      if (attempt === 79) fail("E612_HTTP_DB_NOT_READY");
      await pause(250);
    }
  }
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const roles = dbExec(
        "SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_auth_admin','supabase_storage_admin','authenticator','anon','authenticated','service_role');",
      );
      if (roles.trim() === "6") break;
    } catch {
      /* Supabase's post-bootstrap role migration is still running. */
    }
    if (attempt === 119) fail("E612_HTTP_DB_ROLES_NOT_READY");
    await pause(500);
  }
  let stablePostmaster = "";
  let stableReads = 0;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const current = dbExec("SELECT pg_postmaster_start_time()::text;").trim();
      stableReads = current === stablePostmaster ? stableReads + 1 : 1;
      stablePostmaster = current;
      if (stableReads >= 4) break;
    } catch {
      stablePostmaster = "";
      stableReads = 0;
    }
    if (attempt === 119) fail("E612_HTTP_DB_RESTART_NOT_STABLE");
    await pause(500);
  }
  stage = "sql_bootstrap";
  sqlBootstrap();

  stage = "supabase_http_services";
  start("gateway", [], ids.node, [
    "node",
    "-e",
    "const http=require('http');const routes=[['/auth/v1/','http://auth:9999'],['/rest/v1/','http://rest:3000'],['/storage/v1/','http://storage:5000']];http.createServer(async(req,res)=>{const r=routes.find(([p])=>req.url.startsWith(p));if(!r){res.statusCode=404;return res.end('not found')}const u=r[1]+req.url.slice(r[0].length-1);const body=['GET','HEAD'].includes(req.method)?undefined:await new Promise(x=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>x(b))});const out=await fetch(u,{method:req.method,headers:Object.fromEntries(Object.entries(req.headers).filter(([k])=>k!=='host')),body});res.statusCode=out.status;out.headers.forEach((v,k)=>res.setHeader(k,v));res.end(Buffer.from(await out.arrayBuffer()))}).listen(8787,'0.0.0.0')",
  ]);
  created.add("gateway");
  start(
    "storage",
    [
      "--env",
      `DATABASE_URL=postgres://supabase_storage_admin:${storagePassword}@db:5432/postgres`,
      "--env",
      `ANON_KEY=${anonKey}`,
      "--env",
      `SERVICE_KEY=${serviceKey}`,
      "--env",
      `PGRST_JWT_SECRET=${jwtSecret}`,
      "--env",
      "STORAGE_BACKEND=file",
      "--env",
      "FILE_STORAGE_BACKEND_PATH=/var/lib/storage",
      "--env",
      "SERVER_PORT=5000",
      "--env",
      "TENANT_ID=e612",
      "--env",
      "REGION=local",
      "--env",
      "GLOBAL_S3_BUCKET=e612-local",
      "--tmpfs",
      "/var/lib/storage:rw,mode=1777",
    ],
    ids.storage,
  );
  created.add("storage");
  await internalReady("http://storage:5000", "/status");

  start(
    "auth",
    [
      "--env",
      "GOTRUE_DB_DRIVER=postgres",
      "--env",
      `GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${authPassword}@db:5432/postgres`,
      "--env",
      "GOTRUE_DB_AUTOMIGRATE=true",
      "--env",
      "GOTRUE_LOG_LEVEL=info",
      "--env",
      "GOTRUE_API_HOST=0.0.0.0",
      "--env",
      "GOTRUE_API_PORT=9999",
      "--env",
      "API_EXTERNAL_URL=http://auth:9999",
      "--env",
      "GOTRUE_SITE_URL=http://fixture.invalid",
      "--env",
      `GOTRUE_JWT_SECRET=${jwtSecret}`,
      "--env",
      "GOTRUE_JWT_ADMIN_ROLES=service_role",
      "--env",
      "GOTRUE_JWT_EXP=3600",
      "--env",
      "GOTRUE_JWT_AUD=authenticated",
      "--env",
      "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
      "--env",
      "GOTRUE_DISABLE_SIGNUP=true",
      "--env",
      "GOTRUE_DB_NAMESPACE=auth",
    ],
    ids.auth,
  );
  created.add("auth");
  await internalReady("http://auth:9999", "/health");
  runAuthBootstrap();
  applyMigrations();
  seedFixtures();

  start(
    "rest",
    [
      "--env",
      `PGRST_DB_URI=postgres://authenticator:${restPassword}@db:5432/postgres`,
      "--env",
      `PGRST_JWT_SECRET=${jwtSecret}`,
      "--env",
      "PGRST_SERVER_PORT=3000",
      "--env",
      "PGRST_DB_SCHEMAS=public",
      "--env",
      "PGRST_DB_ANON_ROLE=anon",
      "--env",
      "PGRST_DB_EXTRA_SEARCH_PATH=public,extensions",
      "--env",
      "PGRST_DB_CONFIG=false",
    ],
    ids.rest,
    ["postgrest"],
  );
  created.add("rest");
  await internalReady("http://rest:3000", "/");
  stage = "m64_panel_browser_build";
  const panelBuild = buildM64Panel(browserSession.extensionId);
  startM64App(browserSession.extensionId);
  await internalReady("http://app:3000", "/api/health");
  stage = "e612_e613_http_driver";
  runInternalDriver();
  stage = "authority_read_race";
  await runInternalAuthorityReadRace();
  stage = "m64_browser_positive_flow";
  await finishM64BrowserSmoke(browserSession, panelBuild);
} catch (error) {
  const code =
    error instanceof Error && /^E61[24]_[A-Za-z0-9_-]+$/.test(error.message)
      ? error.message
      : "E612_HTTP_VERIFICATION_FAILED";
  process.stderr.write(`${code}\n`);
  if (code === "E612_HTTP_VERIFICATION_FAILED") {
    process.stderr.write(`E612|HTTP|STAGE_FAILED|${stage}\n`);
  }
  process.exitCode = 1;
} finally {
  let cleanupFailed = false;
  if (browserSession?.browserDriver) {
    browserSession.browserDriver.stop();
    const browserExited = await waitForM64BrowserExit(
      browserSession.browserDriver,
      M64_BROWSER_CLEANUP_TIMEOUT_MS,
    );
    if (!browserExited) {
      emit("E612|HTTP|CLEANUP|BROWSER_DRIVER_TIMEOUT");
      cleanupFailed = true;
    }
  }
  for (const kind of ["browser", "app", "gateway", "storage", "rest", "auth", "db"]) {
    if (!created.has(kind)) continue;
    try {
      const observed = JSON.parse(docker(["container", "inspect", names[kind]]))[0];
      if (observed.Config?.Labels?.[`com.minted.e612`] !== runId)
        fail("E612_HTTP_CLEANUP_LABEL_MISMATCH");
      docker(["rm", "--force", names[kind]]);
    } catch {
      cleanupFailed = true;
      process.exitCode = 1;
    }
  }
  if (networkCreated) {
    try {
      const observed = JSON.parse(docker(["network", "inspect", network]))[0];
      if (observed.Labels?.[`com.minted.e612`] !== runId) fail("E612_HTTP_NETWORK_LABEL_MISMATCH");
      docker(["network", "rm", network]);
    } catch {
      cleanupFailed = true;
      process.exitCode = 1;
    }
  }
  if (cleanupFailed) emit("E612|HTTP|CLEANUP|FAIL");
  else emit("E612|HTTP|CLEANUP|PASS");
}
