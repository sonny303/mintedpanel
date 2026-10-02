// First M64 browser gate: run the exact built MV3 against a deny-by-default
// HTTPS bridge on the existing E6.12 internal Docker network. This is a
// transport/authentication rejection smoke followed by the real Contract and
// Enrollment Work, fill-receipt, human-submission and mapping-reset path.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:https";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { E612 } from "./e612-fixtures.mjs";
import { M64 } from "./e612-m64-fixtures.mjs";

const require = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = "1.61.1";
const PANEL_HOST = "mintedpanel.vercel.app";
const PANEL_ORIGIN = `https://${PANEL_HOST}`;
const SUPABASE_HOST = "fkvuhfsqcmujywzgczmc.supabase.co";
const PORTAL_HOST = "payer.m64.test";
const ORG_ID = "18000000-0000-4000-a000-000000000064";
const ORG_NAME_RE = /^E612 M64 [a-f0-9]{16} Organization$/;
const CONTRACT_ID = "29000000-0000-4000-a000-000000000064";
const CONTRACT_TEMPLATE_ID = "69000000-0000-4000-a000-000000000064";
const CONTRACT_ASSIGNMENT_ID = "79000000-0000-4000-a000-000000000064";
const CONTRACT_PROFILE_STEP_IDENTITY = `${CONTRACT_ID}:${ORG_ID}:${CONTRACT_ASSIGNMENT_ID}:1:${CONTRACT_TEMPLATE_ID}:1:0:0`;
const PROVIDER_ROSTER_TARGET = "/api/providers?page=1&pageSize=100&sort=last_name&order=asc";
const PAYER_ID = "28000000-0000-4000-a000-000000000064";
const GROUP_ID = "49000000-0000-4000-a000-000000000064";
const PROVIDER_ID = "39000000-0000-4000-a000-000000000065";
const FACILITY_ID = "78000000-0000-4000-a000-000000000064";
const CONTRACT_PROFILE_TARGET = (() => {
  const query = new URLSearchParams();
  query.set("facilityId", FACILITY_ID);
  query.set("contractId", CONTRACT_ID);
  query.set("assignmentId", CONTRACT_ASSIGNMENT_ID);
  query.set("contextVersion", "1");
  query.set("sopTemplateId", CONTRACT_TEMPLATE_ID);
  query.set("sopVersion", "1");
  query.set("stepIdentity", CONTRACT_PROFILE_STEP_IDENTITY);
  return `/api/providers/${PROVIDER_ID}/profile?${query.toString()}`;
})();
const CONTRACT_PORTAL_ID = "38000000-0000-4000-a000-000000000064";
const ENROLLMENT_PORTAL_ID = "38000000-0000-4000-a000-000000000065";
const ENROLLMENT_PORTAL_KEY = "m64_enrollment";
const ENROLLMENT_CASE_ID = "49000000-0000-4000-a000-000000000064";
const ENROLLMENT_PROFILE_TARGET = (() => {
  const query = new URLSearchParams();
  query.set("state", "NY");
  query.set("facilityId", FACILITY_ID);
  query.set("caseId", ENROLLMENT_CASE_ID);
  return `/api/providers/${PROVIDER_ID}/profile?${query.toString()}`;
})();
const ENROLLMENT_FILL_PROFILE_TARGET = (() => {
  const query = new URLSearchParams();
  query.set("facilityId", FACILITY_ID);
  query.set("caseId", ENROLLMENT_CASE_ID);
  return `/api/providers/${PROVIDER_ID}/profile?${query.toString()}`;
})();
const ENROLLMENT_TASK_ID = "99000000-0000-4000-a000-000000000064";
const ENROLLMENT_STEP1_ID = "89000000-0000-4000-a000-000000000064";
const ENROLLMENT_STEP2_ID = "89000000-0000-4000-a000-000000000065";
const ENROLLMENT_SIBLING_TASK_ID = "99000000-0000-4000-a000-000000000065";
const ENROLLMENT_SIBLING_STEP_ID = "89000000-0000-4000-a000-000000000066";
const SUPABASE_ORIGIN = `https://${SUPABASE_HOST}`;
const PORTAL_URL = M64.formUrl;
const PORTAL_PATH = new URL(PORTAL_URL).pathname;
const SYNTHETIC_FORM_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>M64 synthetic application</title></head><body><main aria-label="Synthetic application"><label for="contract-npi">Contract NPI</label><input id="contract-npi" name="contract-npi" type="text"><label for="enrollment-npi">Enrollment NPI</label><input id="enrollment-npi" name="enrollment-npi" type="text"></main></body></html>';
const SPECIALIST_EMAIL = "specialist@e612.test";
const ADMIN_PASSWORD = "E612-Local-Password-!234";
const BUILD_ANON_KEY = "e612-build-synthetic-anon-key";
const ENROLLMENT_FILL_RECEIPT_DIAGNOSTIC_FIELDS = Object.freeze([
  "main_error_visible",
  "fill_results_visible",
  "fill_summary_visible",
  "fill_note_visible",
  "work_exact",
  "tab_exact",
  "enrollment_npi_nonempty",
  "enrollment_npi_exact",
  "fill_events_post_seen",
  "fill_events_post_admitted",
  "fill_events_post_denied",
  "fill_events_201",
  "fill_events_200",
  "fill_events_400",
  "fill_events_401",
  "fill_events_403",
  "fill_events_409",
  "fill_events_422",
  "fill_events_5xx",
  "fill_events_other",
  "fill_events_options_seen",
  "fill_events_options_admitted",
  "fill_events_options_denied",
  "work_validate_200",
  "work_validate_409",
  "work_validate_5xx",
  "work_validate_other",
]);
const ENROLLMENT_FILL_RECEIPT_BOOLEAN_FIELDS = new Set(
  ENROLLMENT_FILL_RECEIPT_DIAGNOSTIC_FIELDS.slice(0, 8),
);
const ENROLLMENT_FILL_RECEIPT_BOOLEAN_VALUES = new Set(["false", "true", "unknown"]);
const ENROLLMENT_FILL_RECEIPT_COUNT_VALUES = new Set([
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9_PLUS",
]);
const AUTH_PREFLIGHT_TARGET = "/auth/v1/token?grant_type=password";
const AUTH_PREFLIGHT_HEADERS = new Set([
  "apikey",
  "authorization",
  "content-type",
  "x-client-info",
  "x-supabase-api-version",
]);
const TABLE_PREFLIGHT_HEADERS = new Set([
  "accept-profile",
  "apikey",
  "authorization",
  "x-client-info",
]);
const FILL_SESSION_COUNT_PREFLIGHT_HEADERS = new Set([...TABLE_PREFLIGHT_HEADERS, "prefer"]);
const RPC_PREFLIGHT_HEADERS = new Set([
  "content-profile",
  "content-type",
  "apikey",
  "authorization",
  "x-client-info",
]);
const SYNTHETIC_USER_FILTER = /^eq\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SYNTHETIC_CASE_CREATOR_FILTER = `in.(${E612.specialist})`;
// postgrest-js 2.117.2 strips unquoted selector whitespace before
// URLSearchParams serialization; these exact values mirror transmitted queries.
const DATA_PREFLIGHT_TABLE_QUERIES = Object.freeze({
  profiles: Object.freeze([
    Object.freeze({ select: "full_name", id: SYNTHETIC_USER_FILTER }),
    Object.freeze({ select: "id,full_name,email", id: SYNTHETIC_CASE_CREATOR_FILTER }),
  ]),
  memberships: Object.freeze({
    select: "org_id,role,organizations(name,lifecycle_state,created_at)",
    user_id: SYNTHETIC_USER_FILTER,
  }),
  contracts: Object.freeze({
    select:
      "id,group_id,payer_id,state,contracting_status_id,effective_date,tentative_effective_date,expiration_date,specialty,notes,created_at,updated_at",
    org_id: `eq.${ORG_ID}`,
    order: "created_at.desc",
  }),
  provider_groups: Object.freeze({ select: "*", org_id: `eq.${ORG_ID}`, order: "name.asc" }),
  payers: Object.freeze({
    select: "*",
    or: `(org_id.eq.${ORG_ID},org_id.is.null)`,
    order: "name.asc",
  }),
  status_configs: Object.freeze({
    select: "*",
    org_id: `eq.${ORG_ID}`,
    order: "sort_order.asc",
    track: "eq.contracting",
  }),
  facilities: Object.freeze([
    Object.freeze({ select: "*", org_id: `eq.${ORG_ID}`, order: "name.asc" }),
    Object.freeze({
      select: "*",
      org_id: `eq.${ORG_ID}`,
      order: "name.asc",
      group_id: `eq.${GROUP_ID}`,
    }),
  ]),
  // The TaskDrawer lookup is enabled only after Open step reaches this task.
  credential_cases: Object.freeze({
    select:
      "*,provider:providers(*),payer:payers(*),mso:msos(*),group:provider_groups(*),facility:facilities(*),credentialing_status:status_configs(*),tasks(*),touches(*),status_history(*),payer_pipeline_history(*),case_status_history(*)",
    id: `eq.${ENROLLMENT_CASE_ID}`,
    org_id: `eq.${ORG_ID}`,
  }),
  case_facilities: Object.freeze({
    select:
      "id,org_id,case_id,facility_id,is_primary,created_at,created_by,facility:facilities(id,name,street,suite,city,state,zip,is_active)",
    case_id: `eq.${ENROLLMENT_CASE_ID}`,
    org_id: `eq.${ORG_ID}`,
  }),
  tasks: Object.freeze({
    select: "*",
    id: `eq.${ENROLLMENT_TASK_ID}`,
    org_id: `eq.${ORG_ID}`,
  }),
  payer_network_targets: Object.freeze({
    select: "*",
    org_id: `eq.${ORG_ID}`,
    order: "created_at.asc",
  }),
  // Keep the Matrix snapshot and add only the Enrollment Work key lookup.
  portals: Object.freeze([
    Object.freeze({
      select:
        "id,org_id,portal_key,name,payer_id,form_url,case_type,requires_explicit_selection,mapping_generation,is_verified,proven_at",
      order: "portal_key.asc,id.asc",
      or: `(org_id.is.null,org_id.eq.${ORG_ID})`,
    }),
    Object.freeze({
      select:
        "id,org_id,portal_key,name,payer_id,form_url,case_type,requires_explicit_selection,mapping_generation,is_verified,proven_at",
      order: "portal_key.asc,id.asc",
      or: `(org_id.is.null,org_id.eq.${ORG_ID})`,
      portal_key: `eq.${ENROLLMENT_PORTAL_KEY}`,
    }),
  ]),
  portal_field_maps: Object.freeze([
    Object.freeze({
      select:
        "id,org_id,portal_key,url_pattern,page_step,map_type,selector,selector_fallbacks,source,token,hardcoded_value,transform,field_type,notes,status,control_options,mapping_generation,shared_base_generation,created_at,updated_at,learned_via",
      order: "portal_key.asc,selector.asc",
      or: `(org_id.is.null,org_id.eq.${ORG_ID})`,
    }),
    Object.freeze({
      select:
        "id,org_id,portal_key,url_pattern,page_step,map_type,selector,selector_fallbacks,source,token,hardcoded_value,transform,field_type,notes,status,control_options,mapping_generation,shared_base_generation,created_at,updated_at,learned_via",
      order: "portal_key.asc,selector.asc",
      or: `(org_id.is.null,org_id.eq.${ORG_ID})`,
      portal_key: `eq.${ENROLLMENT_PORTAL_KEY}`,
    }),
  ]),
  contract_sop_assignments: Object.freeze({
    select: "*",
    org_id: `eq.${ORG_ID}`,
    contract_id: `eq.${CONTRACT_ID}`,
  }),
  sop_template_versions: Object.freeze({
    select: "template_id,version,name,case_type,task_definitions,required_profile_attributes",
    template_id: `eq.${CONTRACT_TEMPLATE_ID}`,
    version: "eq.1",
  }),
  provider_group_assignments: Object.freeze({
    select: "provider_id,start_date,end_date",
    org_id: `eq.${ORG_ID}`,
    group_id: `eq.${GROUP_ID}`,
  }),
  providers: Object.freeze([
    Object.freeze({
      select:
        "id,first_name,last_name,credentials,npi,home_state,caqh_id,caqh_last_attested_date,taxonomy_code,status,group_id,specialty,email,reference_only,verification_state,is_test_provider,updated_at",
      org_id: `eq.${ORG_ID}`,
      order: "last_name.asc",
    }),
    Object.freeze({
      select: "id,status",
      id: `in.(${PROVIDER_ID})`,
      org_id: `eq.${ORG_ID}`,
    }),
  ]),
});
const FILL_SESSION_COUNT_QUERY = Object.freeze({
  select: "id",
  org_id: `eq.${ORG_ID}`,
  contract_sop_assignment_id: `eq.${CONTRACT_ASSIGNMENT_ID}`,
  is_test: "eq.false",
});
const SUPABASE_REST_READ_TABLES = new Set([
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
const AUTH_PREFLIGHT_DENIAL_REASONS = new Set([
  "AUTH_PATH_OTHER",
  "TOKEN_TARGET_OTHER",
  "ORIGIN_OTHER",
  "REQUEST_METHOD_OTHER",
  "HEADER_LIST_MISSING",
  "HEADER_NAME_UNEXPECTED",
  "HEADER_REQUIRED_MISSING",
  "HEADER_DUPLICATE",
]);
const ORG_WAIT_ROUTE_STATUS_CODES = [200, 401, 403, 404, 502];
const ORG_WAIT_OPTIONS_BUCKETS = [
  "auth_token",
  "auth_other",
  "rest_memberships",
  "rest_profiles",
  "rpc_claim_invites",
  "other",
];
const ORG_WAIT_OPTION_DETAIL_BUCKETS = [
  "rest_organizations",
  "rest_contracts",
  "rest_status_configs",
  "rest_provider_groups",
  "rest_payers",
  "rest_payer_network_targets",
  "rest_facilities",
  "rest_contract_sop_assignments",
  "rest_sop_templates",
  "rest_sop_template_versions",
  "rest_portals",
  "rest_portal_field_maps",
  "rest_credential_cases",
  "rest_tasks",
  "rest_case_facilities",
  "rest_touches",
  "rest_provider_group_assignments",
  "rest_provider_facility_assignments",
  "rest_providers",
  "rpc_reset_portal_mapping",
  "rest_unknown",
  "rpc_unknown",
  "other",
];
const ACTIVE_WORK_KEY = "minted.activeWork.v2";
const EXPECTED_BACKGROUND_MARKERS = [
  "/api/work-context/validate",
  "minted.activeWork.v2",
  "SET_ACTIVE_WORK",
];
const CONTRACT_UI_CHECKPOINTS = [
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
];
const ENROLLMENT_UI_CHECKPOINTS = [
  "enrollment_ui_case_document",
  "enrollment_ui_task_row",
  "enrollment_ui_open_step",
  "enrollment_ui_task_dialog",
  "enrollment_ui_launch_ready",
  "enrollment_ui_launch_click",
  "enrollment_ui_work_validation",
  "enrollment_ui_portal_tab",
  "enrollment_ui_work_binding",
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
  permission_cta_click: "M64_BROWSER_STAGE_PERMISSION_PROBE_FAILED",
  permission_cta_clicked: "M64_BROWSER_STAGE_PERMISSION_PROBE_FAILED",
  permission_grant_wait: "M64_BROWSER_STAGE_PERMISSION_PROBE_FAILED",
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
  ...Object.fromEntries(
    CONTRACT_UI_CHECKPOINTS.map((stage) => [stage, "M64_BROWSER_STAGE_CONTRACT_UI_FAILED"]),
  ),
  ...Object.fromEntries(
    ENROLLMENT_UI_CHECKPOINTS.map((stage) => [stage, "M64_BROWSER_STAGE_ENROLLMENT_UI_FAILED"]),
  ),
  contract_fill: "M64_BROWSER_STAGE_CONTRACT_FILL_FAILED",
  contract_fill_active_tab: "M64_BROWSER_STAGE_CONTRACT_FILL_FAILED",
  contract_fill_readiness: "M64_BROWSER_STAGE_CONTRACT_FILL_FAILED",
  contract_fill_click: "M64_BROWSER_STAGE_CONTRACT_FILL_FAILED",
  contract_fill_receipt_wait: "M64_BROWSER_STAGE_CONTRACT_FILL_FAILED",
  contract_fill_summary_wait: "M64_BROWSER_STAGE_CONTRACT_FILL_FAILED",
  enrollment_ui: "M64_BROWSER_STAGE_ENROLLMENT_UI_FAILED",
  enrollment_fill: "M64_BROWSER_STAGE_ENROLLMENT_FILL_FAILED",
  enrollment_fill_active_tab: "M64_BROWSER_STAGE_ENROLLMENT_FILL_FAILED",
  enrollment_fill_readiness: "M64_BROWSER_STAGE_ENROLLMENT_FILL_FAILED",
  enrollment_fill_click: "M64_BROWSER_STAGE_ENROLLMENT_FILL_FAILED",
  enrollment_fill_receipt_wait: "M64_BROWSER_STAGE_ENROLLMENT_FILL_FAILED",
  enrollment_fill_summary_wait: "M64_BROWSER_STAGE_ENROLLMENT_FILL_FAILED",
  submission: "M64_BROWSER_STAGE_HUMAN_SUBMISSION_FAILED",
  second_enrollment_fill: "M64_BROWSER_STAGE_SECOND_ENROLLMENT_FILL_FAILED",
  reset: "M64_BROWSER_STAGE_MAPPING_RESET_FAILED",
  stale_fill: "M64_BROWSER_STAGE_STALE_FILL_FAILED",
  stale_fill_readiness: "M64_BROWSER_STAGE_STALE_FILL_FAILED",
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

async function waitForDbAck(token) {
  assert(token === "CONTRACT_RESET_COMPLETE", "M64_BROWSER_DB_ACK_INVALID");
  const expected = `M64_DB_ACK|${token}`;
  const input = createInterface({ input: process.stdin });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.close();
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(
      () => finish(new BrowserFailure("M64_BROWSER_DB_ACK_TIMEOUT")),
      120_000,
    );
    input.once("line", (line) => {
      if (line !== expected) {
        finish(new BrowserFailure("M64_BROWSER_DB_ACK_INVALID"));
        return;
      }
      finish();
    });
    input.once("close", () => finish(new BrowserFailure("M64_BROWSER_DB_ACK_EOF")));
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
let lastDeniedReason = null;
let exactValidationNotFound = false;
const workValidationAttempts = [];
const workValidationSuccesses = [];
let extensionIdObserved;
let providerRosterDenialReported = false;
let panelPage;
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
    backgroundSha256 === "da81573daaa459df04ab11222ebc5bd8e383933caff866da8633ef8dd8ebe4e7",
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
  assertStaticPanelFormPolicy();
  assertAuthPreflightPolicy();
  assertDataPreflightPolicy();
  assertM64ProviderReadPolicy();
  assertM64EnrollmentFillReceiptDiagnosticPolicy();
}

function assertStaticPanelFormPolicy() {
  assert(
    new URL(PORTAL_URL).origin === PANEL_ORIGIN && PORTAL_PATH === "/__m64__/form",
    "M64_BROWSER_STATIC_FORM_URL_INVALID",
  );
  assert(
    routeFor(PANEL_HOST, "GET", PORTAL_PATH, PORTAL_PATH)?.name === "panel.synthetic_form",
    "M64_BROWSER_STATIC_FORM_ROUTE_INVALID",
  );
  for (const [method, target] of [
    ["GET", `${PORTAL_PATH}?probe=1`],
    ["HEAD", PORTAL_PATH],
    ["POST", PORTAL_PATH],
    ["OPTIONS", PORTAL_PATH],
    ["GET", "/__m64__/unknown"],
  ]) {
    assert(
      routeFor(PANEL_HOST, method, new URL(target, PANEL_ORIGIN).pathname, target) === null,
      "M64_BROWSER_STATIC_FORM_ROUTE_TOO_BROAD",
    );
  }
  assert(
    !/<\/?(?:script|form|button)\b|<input[^>]+type=["']?submit/i.test(SYNTHETIC_FORM_HTML) &&
      SYNTHETIC_FORM_HTML.includes('id="contract-npi"') &&
      SYNTHETIC_FORM_HTML.includes('id="enrollment-npi"'),
    "M64_BROWSER_STATIC_FORM_SHAPE_INVALID",
  );
}

function assertM64ProviderReadPolicy() {
  const previousExtensionId = extensionIdObserved;
  extensionIdObserved = "abcdefghijklmnopabcdefghijklmnop";
  const extensionOrigin = extensionOriginForM64();
  const getHeaders = {
    origin: extensionOrigin,
    authorization: "Bearer synthetic-policy-token",
    accept: "application/json",
    "x-org-id": ORG_ID,
  };
  const preflightHeaders = {
    origin: extensionOrigin,
    "access-control-request-method": "GET",
    "access-control-request-headers": "authorization, x-org-id",
  };
  const originlessGetHeaders = { ...getHeaders };
  delete originlessGetHeaders.origin;
  const route = (method, target, headers = {}) =>
    routeFor(PANEL_HOST, method, new URL(target, PANEL_ORIGIN).pathname, target, headers);
  try {
    assert(
      ENROLLMENT_PROFILE_TARGET ===
        `/api/providers/${PROVIDER_ID}/profile?state=NY&facilityId=${FACILITY_ID}&caseId=${ENROLLMENT_CASE_ID}`,
      "M64_BROWSER_ENROLLMENT_PROFILE_TARGET_SERIALIZATION_INVALID",
    );
    assert(
      ENROLLMENT_FILL_PROFILE_TARGET ===
        `/api/providers/${PROVIDER_ID}/profile?facilityId=${FACILITY_ID}&caseId=${ENROLLMENT_CASE_ID}`,
      "M64_BROWSER_ENROLLMENT_FILL_PROFILE_TARGET_SERIALIZATION_INVALID",
    );
    for (const [target, getName, preflightName] of [
      [PROVIDER_ROSTER_TARGET, "panel.providers", "panel.providers_preflight"],
      [CONTRACT_PROFILE_TARGET, "panel.provider_profile", "panel.provider_profile_preflight"],
      [ENROLLMENT_PROFILE_TARGET, "panel.provider_profile", "panel.provider_profile_preflight"],
      [
        ENROLLMENT_FILL_PROFILE_TARGET,
        "panel.provider_profile",
        "panel.provider_profile_preflight",
      ],
    ]) {
      assert(
        route("GET", target, getHeaders)?.name === getName,
        "M64_BROWSER_PROVIDER_READ_POLICY_INVALID",
      );
      assert(
        route("GET", target, originlessGetHeaders)?.name === getName,
        "M64_BROWSER_PROVIDER_ORIGINLESS_GET_POLICY_INVALID",
      );
      assert(
        route("OPTIONS", target, preflightHeaders)?.name === preflightName,
        "M64_BROWSER_PROVIDER_READ_POLICY_INVALID",
      );
      assert(
        route("HEAD", target, getHeaders) === null && route("POST", target, getHeaders) === null,
        "M64_BROWSER_PROVIDER_READ_POLICY_TOO_BROAD",
      );
      assert(
        route("GET", `${target}&extra=1`, getHeaders) === null,
        "M64_BROWSER_PROVIDER_READ_POLICY_TOO_BROAD",
      );
      assert(
        route("OPTIONS", target, { ...preflightHeaders, origin: "https://attacker.invalid" }) ===
          null,
        "M64_BROWSER_PROVIDER_PREFLIGHT_POLICY_TOO_BROAD",
      );
      assert(
        route("OPTIONS", target, {
          ...preflightHeaders,
          "access-control-request-method": "POST",
        }) === null,
        "M64_BROWSER_PROVIDER_PREFLIGHT_POLICY_TOO_BROAD",
      );
      assert(
        route("OPTIONS", target, {
          ...preflightHeaders,
          "access-control-request-headers": "authorization, x-org-id, content-type",
        }) === null,
        "M64_BROWSER_PROVIDER_PREFLIGHT_POLICY_TOO_BROAD",
      );
      assert(
        route("OPTIONS", target, {
          ...preflightHeaders,
          "access-control-request-headers": "authorization, authorization, x-org-id",
        }) === null,
        "M64_BROWSER_PROVIDER_PREFLIGHT_POLICY_TOO_BROAD",
      );
      assert(
        route("OPTIONS", target, {
          ...preflightHeaders,
          "access-control-request-private-network": "true",
        }) === null,
        "M64_BROWSER_PROVIDER_PREFLIGHT_POLICY_TOO_BROAD",
      );
      const originlessOptionsHeaders = { ...preflightHeaders };
      delete originlessOptionsHeaders.origin;
      assert(
        route("OPTIONS", target, originlessOptionsHeaders) === null &&
          route("GET", target, { ...getHeaders, origin: "https://attacker.invalid" }) === null &&
          route("GET", target, { ...getHeaders, origin: "null" }) === null &&
          route("GET", target, { ...getHeaders, origin: null }) === null &&
          route("GET", target, { ...getHeaders, origin: "" }) === null &&
          route("GET", target, {
            ...getHeaders,
            "x-org-id": "18000000-0000-4000-a000-000000000001",
          }) === null &&
          route("GET", target, { ...getHeaders, authorization: "" }) === null &&
          route("GET", target, { ...getHeaders, authorization: undefined }) === null &&
          route("GET", target, { ...getHeaders, authorization: "Basic synthetic" }) === null &&
          route("GET", target, { ...getHeaders, authorization: "Bearer " }) === null &&
          route("GET", target, { ...getHeaders, accept: "text/plain" }) === null &&
          route("GET", target, { ...getHeaders, "content-type": "application/json" }) === null,
        "M64_BROWSER_PROVIDER_GET_POLICY_TOO_BROAD",
      );
    }
    assert(
      route(
        "GET",
        CONTRACT_PROFILE_TARGET.replace(PROVIDER_ID, "39000000-0000-4000-a000-000000000066"),
        getHeaders,
      ) === null &&
        route(
          "GET",
          CONTRACT_PROFILE_TARGET.replace("stepIdentity=", "stepIdentity=wrong"),
          getHeaders,
        ) === null,
      "M64_BROWSER_PROVIDER_PROFILE_POLICY_TOO_BROAD",
    );
    const wrongEnrollmentTargets = [
      ENROLLMENT_PROFILE_TARGET.replace(PROVIDER_ID, "39000000-0000-4000-a000-000000000066"),
      ENROLLMENT_PROFILE_TARGET.replace(ENROLLMENT_CASE_ID, "49000000-0000-4000-a000-000000000099"),
      ENROLLMENT_PROFILE_TARGET.replace(FACILITY_ID, "78000000-0000-4000-a000-000000000099"),
      ENROLLMENT_PROFILE_TARGET.replace("state=NY", "state=CA"),
      `${ENROLLMENT_PROFILE_TARGET}&extra=1`,
      `${ENROLLMENT_PROFILE_TARGET}&state=NY`,
      ENROLLMENT_PROFILE_TARGET.replace(
        `state=NY&facilityId=${FACILITY_ID}&caseId=${ENROLLMENT_CASE_ID}`,
        `caseId=${ENROLLMENT_CASE_ID}&facilityId=${FACILITY_ID}&state=NY`,
      ),
      ENROLLMENT_FILL_PROFILE_TARGET.replace(
        `facilityId=${FACILITY_ID}&caseId=${ENROLLMENT_CASE_ID}`,
        `caseId=${ENROLLMENT_CASE_ID}&facilityId=${FACILITY_ID}`,
      ),
      ENROLLMENT_FILL_PROFILE_TARGET.replace(
        `caseId=${ENROLLMENT_CASE_ID}`,
        `caseId=${ENROLLMENT_CASE_ID}&caseId=${ENROLLMENT_CASE_ID}`,
      ),
      `${ENROLLMENT_FILL_PROFILE_TARGET}&state=NY`,
    ];
    assert(
      wrongEnrollmentTargets.every(
        (target) =>
          route("GET", target, getHeaders) === null &&
          route("OPTIONS", target, preflightHeaders) === null,
      ),
      "M64_BROWSER_ENROLLMENT_PROFILE_POLICY_TOO_BROAD",
    );
  } finally {
    extensionIdObserved = previousExtensionId;
  }
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

function routeStatusClassCount(route, predicate) {
  const prefix = `${route}:`;
  let total = 0;
  for (const [key, value] of metrics) {
    if (!key.startsWith(prefix)) continue;
    const status = Number(key.slice(prefix.length));
    if (predicate(status)) total += value;
  }
  return total;
}

function supabaseOptionsBucket(host, method, pathname, routeName = "") {
  if (host !== SUPABASE_HOST || method !== "OPTIONS") return null;
  const knownRouteBuckets = new Map([
    ["supabase.rest.memberships", "rest_memberships"],
    ["supabase.rest.profiles", "rest_profiles"],
    ["supabase.rpc.claim_invites", "rpc_claim_invites"],
  ]);
  if (knownRouteBuckets.has(routeName)) return knownRouteBuckets.get(routeName);
  const cleanPath = pathname.split("?", 1)[0];
  if (cleanPath.startsWith("/auth/v1/")) {
    return cleanPath === "/auth/v1/token" ? "auth_token" : "auth_other";
  }
  if (cleanPath === "/rest/v1/memberships") return "rest_memberships";
  if (cleanPath === "/rest/v1/profiles") return "rest_profiles";
  if (cleanPath === "/rest/v1/rpc/claim_invites") return "rpc_claim_invites";
  return "other";
}

function supabaseOptionsDetailBucket(host, method, pathname, routeName = "") {
  if (supabaseOptionsBucket(host, method, pathname, routeName) !== "other") return null;
  const cleanPath = pathname.split("?", 1)[0];
  const tableMatch = /^\/rest\/v1\/([a-z][a-z0-9_]*)$/.exec(cleanPath);
  if (tableMatch) {
    return SUPABASE_REST_READ_TABLES.has(tableMatch[1]) ? `rest_${tableMatch[1]}` : "rest_unknown";
  }
  const rpcMatch = /^\/rest\/v1\/rpc\/([a-z][a-z0-9_]*)$/.exec(cleanPath);
  if (rpcMatch) {
    return rpcMatch[1] === "reset_portal_mapping" ? "rpc_reset_portal_mapping" : "rpc_unknown";
  }
  return "other";
}

function countDeniedSupabaseOptions(host, method, pathname, routeName = "") {
  const bucket = supabaseOptionsBucket(host, method, pathname, routeName);
  if (bucket) count(`supabase.options_denied.${bucket}`, 404);
  const detail = supabaseOptionsDetailBucket(host, method, pathname, routeName);
  if (detail) count(`supabase.options_denied_detail.${detail}`, 404);
}

function boundedDiagnosticCount(value) {
  return value > 8 ? "9_PLUS" : String(value);
}

function safeM64EnrollmentFillReceiptDiagnostic(lines) {
  const markers = lines.filter((line) => line.startsWith("M64|BROWSER|ENROLLMENT_FILL_RECEIPT|"));
  if (markers.length !== 1) return null;
  const parts = markers[0].split("|");
  if (
    parts.length !== ENROLLMENT_FILL_RECEIPT_DIAGNOSTIC_FIELDS.length + 3 ||
    parts[0] !== "M64" ||
    parts[1] !== "BROWSER" ||
    parts[2] !== "ENROLLMENT_FILL_RECEIPT"
  ) {
    return null;
  }
  const fields = [];
  for (let index = 0; index < ENROLLMENT_FILL_RECEIPT_DIAGNOSTIC_FIELDS.length; index += 1) {
    const [name, value, ...rest] = parts[index + 3].split("=");
    const isBoolean = ENROLLMENT_FILL_RECEIPT_BOOLEAN_FIELDS.has(name);
    if (
      name !== ENROLLMENT_FILL_RECEIPT_DIAGNOSTIC_FIELDS[index] ||
      rest.length !== 0 ||
      (isBoolean
        ? !ENROLLMENT_FILL_RECEIPT_BOOLEAN_VALUES.has(value)
        : !ENROLLMENT_FILL_RECEIPT_COUNT_VALUES.has(value))
    ) {
      return null;
    }
    fields.push(`${name}=${value}`);
  }
  return fields.join("|");
}

function assertM64EnrollmentFillReceiptDiagnosticPolicy() {
  const values = Object.fromEntries(
    ENROLLMENT_FILL_RECEIPT_DIAGNOSTIC_FIELDS.map((name) => [name, "0"]),
  );
  for (const name of ENROLLMENT_FILL_RECEIPT_BOOLEAN_FIELDS) values[name] = "true";
  values.fill_events_201 = "1";
  values.work_validate_409 = "2";
  const marker = `M64|BROWSER|ENROLLMENT_FILL_RECEIPT|${ENROLLMENT_FILL_RECEIPT_DIAGNOSTIC_FIELDS.map(
    (name) => `${name}=${values[name]}`,
  ).join("|")}`;
  const expected = ENROLLMENT_FILL_RECEIPT_DIAGNOSTIC_FIELDS.map(
    (name) => `${name}=${values[name]}`,
  ).join("|");
  const invalidMarkers = [
    marker.replace("main_error_visible=true", "main_error_visible=raw"),
    marker.replace("fill_events_201=1", "fill_events_201=10"),
    `${marker}|raw=value`,
    marker.replace(
      "main_error_visible=true|fill_results_visible=true",
      "fill_results_visible=true|main_error_visible=true",
    ),
  ];
  assert(
    safeM64EnrollmentFillReceiptDiagnostic([marker]) === expected &&
      invalidMarkers.every(
        (invalid) => safeM64EnrollmentFillReceiptDiagnostic([invalid]) === null,
      ) &&
      safeM64EnrollmentFillReceiptDiagnostic([marker, marker]) === null,
    "M64_BROWSER_ENROLLMENT_FILL_RECEIPT_DIAGNOSTIC_POLICY_INVALID",
  );
}

function routeStatusDiagnostic(route, label, statuses = ORG_WAIT_ROUTE_STATUS_CODES) {
  const fields = statuses.map(
    (status) => `${label}_${status}=${boundedDiagnosticCount(routeCount(route, status))}`,
  );
  const known = statuses.reduce((total, status) => total + routeCount(route, status), 0);
  fields.push(`${label}_other=${boundedDiagnosticCount(Math.max(0, routeTotal(route) - known))}`);
  return fields;
}

async function orgWaitUiState(page) {
  try {
    const state = await bounded(
      () =>
        page.evaluate(() => {
          const headings = [...document.querySelectorAll("h1")].map((heading) =>
            heading.textContent?.trim(),
          );
          const bodyText = document.body?.textContent ?? "";
          return {
            login: Boolean(document.querySelector("#email, #password")),
            noOrg:
              headings.includes("Welcome to your Portfolio") &&
              bodyText.includes("You don't have any organizations yet."),
            contextLoading: bodyText.includes("Resolving your access context…"),
            contextError: headings.some((heading) =>
              [
                "Access context unavailable",
                "Client organization is unavailable",
                "Client access context required",
              ].includes(heading),
            ),
            contextChoose: headings.includes("Choose an access context"),
            contextClientReady: headings.includes("Client access context ready"),
            sidebar: Boolean(document.querySelector("aside")),
            activeOrg: Boolean(
              document.querySelector('button[aria-label^="Active organization:"]'),
            ),
          };
        }),
      1_500,
      "M64_BROWSER_ORG_WAIT_DIAGNOSTIC_TIMEOUT",
    );
    if (state.login) return "login";
    if (state.noOrg) return "no_org";
    if (state.contextLoading) return "context_loading";
    if (state.contextError) return "context_error";
    if (state.contextChoose) return "context_choose";
    if (state.contextClientReady) return "context_client_ready";
    if (state.sidebar) return state.activeOrg ? "sidebar" : "other";
    return "other";
  } catch {
    return "other";
  }
}

async function reportOrgWaitDiagnostic(page) {
  const fields = [
    ...routeStatusDiagnostic("supabase.rest.memberships", "memberships"),
    ...routeStatusDiagnostic("supabase.rest.profiles", "profiles"),
    ...routeStatusDiagnostic("supabase.rpc.claim_invites", "claim_invites"),
  ];
  for (const bucket of ORG_WAIT_OPTIONS_BUCKETS) {
    fields.push(
      `options_${bucket}_404=${boundedDiagnosticCount(
        routeCount(`supabase.options_denied.${bucket}`, 404),
      )}`,
    );
  }
  fields.push(...routeStatusDiagnostic("panel.cases", "api_cases", [200, 403, 404]));
  fields.push(`ui=${await orgWaitUiState(page)}`);
  safeLog(`M64|BROWSER|ORG_WAIT|${fields.join("|")}`);
  reportOptionsRouteClassDiagnostic("ORG_WAIT_ROUTES");
}

function reportOptionsRouteClassDiagnostic(marker) {
  const detailFields = ORG_WAIT_OPTION_DETAIL_BUCKETS.map((bucket) => {
    const field =
      bucket === "other" ? "options_other_unknown_route_404" : `options_other_${bucket}_404`;
    return `${field}=${boundedDiagnosticCount(
      routeCount(`supabase.options_denied_detail.${bucket}`, 404),
    )}`;
  });
  safeLog(`M64|BROWSER|${marker}|${detailFields.join("|")}`);
}

function reportContractUiRouteDiagnostic() {
  reportOptionsRouteClassDiagnostic("CONTRACT_UI_ROUTES");
}

async function enrollmentUiState(page, caseId, taskTitle) {
  try {
    return await bounded(
      () =>
        page.evaluate(
          ({ casePath, title }) => {
            const visible = (element) => {
              if (!element || element.hidden) return false;
              const style = getComputedStyle(element);
              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                element.getClientRects().length > 0
              );
            };
            const exactVisibleText = (selector, text) =>
              [...document.querySelectorAll(selector)].some(
                (element) => visible(element) && element.textContent?.trim() === text,
              );
            if (location.pathname !== casePath) return "other";
            if (exactVisibleText("button", "Work in portal")) return "launch";
            if ([...document.querySelectorAll('[role="dialog"]')].some(visible)) return "dialog";
            if (exactVisibleText("button", "Open step")) return "open_step";
            if (exactVisibleText("body *", title)) return "task_row";
            return visible(document.querySelector("main")) ? "case_document" : "case_loading";
          },
          { casePath: `/cases/${caseId}`, title: taskTitle },
        ),
      2_000,
      "M64_BROWSER_ENROLLMENT_UI_DIAGNOSTIC_TIMEOUT",
    );
  } catch {
    return "unknown";
  }
}

async function reportEnrollmentUiDiagnostic(page, caseId, taskTitle) {
  const fields = [
    ...routeStatusDiagnostic("supabase.rest.credential_cases", "credential_cases"),
    ...routeStatusDiagnostic("supabase.rest.case_facilities", "case_facilities"),
    ...routeStatusDiagnostic("supabase.rest.tasks", "tasks"),
    `credential_cases_options_404=${boundedDiagnosticCount(
      routeCount("supabase.options_denied_detail.rest_credential_cases", 404),
    )}`,
    `case_facilities_options_404=${boundedDiagnosticCount(
      routeCount("supabase.options_denied_detail.rest_case_facilities", 404),
    )}`,
    `tasks_options_404=${boundedDiagnosticCount(
      routeCount("supabase.options_denied_detail.rest_tasks", 404),
    )}`,
    `ui=${await enrollmentUiState(page, caseId, taskTitle)}`,
  ];
  safeLog(`M64|BROWSER|ENROLLMENT_UI|${fields.join("|")}`);
}

function unexpected(response, category = "UNKNOWN_HOST", reason = null) {
  response.statusCode = 404;
  unexpectedRoutes += 1;
  firstDeniedCategory ??= category;
  lastDeniedCategory = category;
  lastDeniedReason = AUTH_PREFLIGHT_DENIAL_REASONS.has(reason) ? reason : null;
  count(`denied.${category}`, response.statusCode);
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end("local verification route unavailable");
}

function reportDeniedProviderRoster(host, method, pathname, requestTarget, headers) {
  if (
    providerRosterDenialReported ||
    host !== PANEL_HOST ||
    method !== "GET" ||
    pathname !== "/api/providers"
  ) {
    return;
  }
  const extensionOrigin = extensionOriginForM64();
  const originState =
    headers.origin === undefined
      ? "missing"
      : extensionOrigin !== null && headers.origin === extensionOrigin
        ? "matching"
        : "other";
  const fields = [
    `target_exact=${requestTarget === PROVIDER_ROSTER_TARGET}`,
    `origin=${originState}`,
    `bearer_present=${typeof headers.authorization === "string" && /^Bearer \S+$/.test(headers.authorization)}`,
    `accept_exact=${headers.accept === "application/json"}`,
    `org_exact=${headers["x-org-id"] === ORG_ID}`,
    `cookie_present=${headers.cookie !== undefined}`,
    `content_type_present=${headers["content-type"] !== undefined}`,
  ];
  providerRosterDenialReported = true;
  safeLog(`M64|BROWSER|PROVIDER_ROSTER_DENIED|${fields.join("|")}`);
}

function countDeniedEnrollmentProfileTarget(host, method, pathname, requestTarget) {
  if (
    host !== PANEL_HOST ||
    pathname !== `/api/providers/${PROVIDER_ID}/profile` ||
    requestTarget !== ENROLLMENT_PROFILE_TARGET
  ) {
    return;
  }
  if (method === "GET") count("panel.enrollment_profile_denied_get", 404);
  if (method === "OPTIONS") count("panel.enrollment_profile_denied_options", 404);
}

function countAllowedEnrollmentProfileTarget(route, method, requestTarget, status) {
  if (requestTarget !== ENROLLMENT_PROFILE_TARGET) return;
  if (method === "GET" && route.name === "panel.provider_profile") {
    count("panel.enrollment_profile_get", status);
  }
  if (method === "OPTIONS" && route.name === "panel.provider_profile_preflight") {
    count("panel.enrollment_profile_options", status);
  }
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

function extensionOriginForM64() {
  return /^[a-p]{32}$/.test(extensionIdObserved ?? "")
    ? `chrome-extension://${extensionIdObserved}`
    : null;
}

function panelProviderReadKind(pathname, requestTarget) {
  if (pathname === "/api/providers" && requestTarget === PROVIDER_ROSTER_TARGET) return "providers";
  if (
    pathname === `/api/providers/${PROVIDER_ID}/profile` &&
    requestTarget === ENROLLMENT_PROFILE_TARGET
  ) {
    return "provider_profile";
  }
  if (
    pathname === `/api/providers/${PROVIDER_ID}/profile` &&
    requestTarget === ENROLLMENT_FILL_PROFILE_TARGET
  ) {
    return "provider_profile";
  }
  if (
    pathname === `/api/providers/${PROVIDER_ID}/profile` &&
    requestTarget === CONTRACT_PROFILE_TARGET
  ) {
    return "provider_profile";
  }
  return null;
}

function hasExactPanelProviderPreflightHeaders(headers) {
  const extensionOrigin = extensionOriginForM64();
  const raw = headers["access-control-request-headers"];
  if (
    extensionOrigin == null ||
    headers.origin !== extensionOrigin ||
    headers["access-control-request-method"] !== "GET" ||
    headers["access-control-request-private-network"] !== undefined ||
    typeof raw !== "string" ||
    raw.trim() === ""
  ) {
    return false;
  }
  const requested = raw.split(",").map((name) => name.trim().toLowerCase());
  return (
    requested.length === 2 &&
    new Set(requested).size === 2 &&
    requested.includes("authorization") &&
    requested.includes("x-org-id")
  );
}

function hasExactPanelProviderGetHeaders(headers) {
  const extensionOrigin = extensionOriginForM64();
  const originIsAllowed =
    headers.origin === undefined ||
    (extensionOrigin !== null && headers.origin === extensionOrigin);
  return (
    extensionOrigin != null &&
    originIsAllowed &&
    typeof headers.authorization === "string" &&
    /^Bearer \S+$/.test(headers.authorization) &&
    headers.accept === "application/json" &&
    headers["x-org-id"] === ORG_ID &&
    headers["content-type"] === undefined &&
    headers.cookie === undefined
  );
}

function panelProviderReadRoute(host, method, pathname, requestTarget, headers) {
  if (host !== PANEL_HOST) return null;
  const readKind = panelProviderReadKind(pathname, requestTarget);
  if (readKind == null) return null;
  if (method === "OPTIONS" && hasExactPanelProviderPreflightHeaders(headers)) {
    return { kind: "app", name: `panel.${readKind}_preflight` };
  }
  if (method === "GET" && hasExactPanelProviderGetHeaders(headers)) {
    return { kind: "app", name: `panel.${readKind}` };
  }
  return null;
}

function inspectRequestedAuthPreflightHeaders(value) {
  if (typeof value !== "string" || value.trim().length === 0) return "HEADER_LIST_MISSING";
  const requested = value.split(",").map((name) => name.trim().toLowerCase());
  if (requested.some((name) => !name || !AUTH_PREFLIGHT_HEADERS.has(name))) {
    return "HEADER_NAME_UNEXPECTED";
  }
  if (!["apikey", "authorization", "content-type"].every((name) => requested.includes(name))) {
    return "HEADER_REQUIRED_MISSING";
  }
  if (new Set(requested).size !== requested.length) return "HEADER_DUPLICATE";
  return null;
}

function requestedAuthPreflightHeaders(value) {
  if (inspectRequestedAuthPreflightHeaders(value) !== null) return null;
  return value.split(",").map((name) => name.trim().toLowerCase());
}

function inspectRequestedDataPreflightHeaders(value, method) {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const allowed =
    method === "GET"
      ? TABLE_PREFLIGHT_HEADERS
      : method === "HEAD"
        ? FILL_SESSION_COUNT_PREFLIGHT_HEADERS
        : RPC_PREFLIGHT_HEADERS;
  const required =
    method === "GET"
      ? ["accept-profile", "apikey", "authorization", "x-client-info"]
      : method === "HEAD"
        ? ["accept-profile", "apikey", "authorization", "prefer", "x-client-info"]
        : ["apikey", "authorization", "content-profile", "content-type", "x-client-info"];
  const requested = value.split(",").map((name) => name.trim().toLowerCase());
  return (
    requested.every((name) => name && allowed.has(name)) &&
    new Set(requested).size === requested.length &&
    required.every((name) => requested.includes(name))
  );
}

function hasExactSyntheticQuery(requestTarget, pathname, expectedQuery) {
  let parsed;
  try {
    parsed = new URL(requestTarget, SUPABASE_ORIGIN);
  } catch {
    return false;
  }
  if (
    !requestTarget.startsWith("/") ||
    requestTarget.startsWith("//") ||
    parsed.origin !== SUPABASE_ORIGIN ||
    parsed.pathname !== pathname ||
    parsed.hash
  ) {
    return false;
  }
  const entries = [...parsed.searchParams.entries()];
  if (
    entries.length !== Object.keys(expectedQuery).length ||
    new Set(entries.map(([key]) => key)).size !== entries.length ||
    entries.some(([key]) => !Object.hasOwn(expectedQuery, key))
  ) {
    return false;
  }
  return Object.entries(expectedQuery).every(([key, expected]) => {
    const actual = parsed.searchParams.get(key) ?? "";
    return expected instanceof RegExp ? expected.test(actual) : actual === expected;
  });
}

function hasExactSyntheticTableQuery(requestTarget, pathname, table) {
  const configured = DATA_PREFLIGHT_TABLE_QUERIES[table];
  if (!configured) return false;
  const expectedQueries = Array.isArray(configured) ? configured : [configured];
  return expectedQueries.some((expectedQuery) =>
    hasExactSyntheticQuery(requestTarget, pathname, expectedQuery),
  );
}

function isAllowedDataPreflight(host, method, pathname, requestTarget, headers) {
  if (
    host !== SUPABASE_HOST ||
    method !== "OPTIONS" ||
    headers.origin !== PANEL_ORIGIN ||
    headers["access-control-request-private-network"] !== undefined
  ) {
    return null;
  }
  const requestedMethod = headers["access-control-request-method"];
  const tableMatch = /^\/rest\/v1\/([a-z][a-z0-9_]*)$/.exec(pathname);
  const table = tableMatch?.[1];
  if (table && DATA_PREFLIGHT_TABLE_QUERIES[table] && requestedMethod === "GET") {
    if (
      hasExactSyntheticTableQuery(requestTarget, pathname, table) &&
      inspectRequestedDataPreflightHeaders(headers["access-control-request-headers"], "GET")
    ) {
      return {
        kind: "preflight",
        name: `supabase.rest.${table}_preflight`,
        allowedMethod: "GET",
        allowedHeaders: TABLE_PREFLIGHT_HEADERS,
      };
    }
  }
  if (
    pathname === "/rest/v1/fill_sessions" &&
    requestedMethod === "HEAD" &&
    hasExactSyntheticQuery(requestTarget, pathname, FILL_SESSION_COUNT_QUERY) &&
    inspectRequestedDataPreflightHeaders(headers["access-control-request-headers"], "HEAD")
  ) {
    return {
      kind: "preflight",
      name: "supabase.rest.fill_sessions_count_preflight",
      allowedMethod: "HEAD",
      allowedHeaders: FILL_SESSION_COUNT_PREFLIGHT_HEADERS,
    };
  }
  if (
    pathname === "/rest/v1/rpc/claim_invites" &&
    requestTarget === pathname &&
    requestedMethod === "POST" &&
    inspectRequestedDataPreflightHeaders(headers["access-control-request-headers"], "POST")
  ) {
    return {
      kind: "preflight",
      name: "supabase.rpc.claim_invites_preflight",
      allowedMethod: "POST",
      allowedHeaders: RPC_PREFLIGHT_HEADERS,
    };
  }
  return null;
}

function assertDataPreflightPolicy() {
  const getHeaders = {
    origin: PANEL_ORIGIN,
    "access-control-request-method": "GET",
    "access-control-request-headers": "apikey, authorization, x-client-info, accept-profile",
  };
  const postHeaders = {
    origin: PANEL_ORIGIN,
    "access-control-request-method": "POST",
    "access-control-request-headers":
      "apikey, authorization, x-client-info, content-profile, content-type",
  };
  const profileTarget =
    "/rest/v1/profiles?select=full_name&id=eq.39000000-0000-4000-a000-000000000065";
  const membershipsTarget =
    "/rest/v1/memberships?select=org_id%2Crole%2Corganizations%28name%2Clifecycle_state%2Ccreated_at%29&user_id=eq.30000000-0000-4000-8000-000000000002";
  const queryTarget = (path, query) => `${path}?${new URLSearchParams(query).toString()}`;
  const caseCreatorProfileTarget = queryTarget("/rest/v1/profiles", {
    select: "id,full_name,email",
    id: SYNTHETIC_CASE_CREATOR_FILTER,
  });
  const contractProviderTargets = [
    [
      "contract_sop_assignments",
      queryTarget("/rest/v1/contract_sop_assignments", {
        select: "*",
        org_id: `eq.${ORG_ID}`,
        contract_id: `eq.${CONTRACT_ID}`,
      }),
    ],
    [
      "sop_template_versions",
      queryTarget("/rest/v1/sop_template_versions", {
        select: "template_id,version,name,case_type,task_definitions,required_profile_attributes",
        template_id: `eq.${CONTRACT_TEMPLATE_ID}`,
        version: "eq.1",
      }),
    ],
    [
      "provider_group_assignments",
      queryTarget("/rest/v1/provider_group_assignments", {
        select: "provider_id,start_date,end_date",
        org_id: `eq.${ORG_ID}`,
        group_id: `eq.${GROUP_ID}`,
      }),
    ],
    [
      "providers",
      queryTarget("/rest/v1/providers", {
        select:
          "id,first_name,last_name,credentials,npi,home_state,caqh_id,caqh_last_attested_date,taxonomy_code,status,group_id,specialty,email,reference_only,verification_state,is_test_provider,updated_at",
        org_id: `eq.${ORG_ID}`,
        order: "last_name.asc",
      }),
    ],
    [
      "providers",
      queryTarget("/rest/v1/providers", {
        select: "id,status",
        id: `in.(${PROVIDER_ID})`,
        org_id: `eq.${ORG_ID}`,
      }),
    ],
  ];
  const portalResolverTargets = [
    [
      "portals",
      queryTarget("/rest/v1/portals", {
        select:
          "id,org_id,portal_key,name,payer_id,form_url,case_type,requires_explicit_selection,mapping_generation,is_verified,proven_at",
        order: "portal_key.asc,id.asc",
        or: `(org_id.is.null,org_id.eq.${ORG_ID})`,
      }),
    ],
    [
      "portal_field_maps",
      queryTarget("/rest/v1/portal_field_maps", {
        select:
          "id,org_id,portal_key,url_pattern,page_step,map_type,selector,selector_fallbacks,source,token,hardcoded_value,transform,field_type,notes,status,control_options,mapping_generation,shared_base_generation,created_at,updated_at,learned_via",
        order: "portal_key.asc,selector.asc",
        or: `(org_id.is.null,org_id.eq.${ORG_ID})`,
      }),
    ],
  ];
  const enrollmentPortalResolverQueries = {
    portals: {
      select:
        "id,org_id,portal_key,name,payer_id,form_url,case_type,requires_explicit_selection,mapping_generation,is_verified,proven_at",
      order: "portal_key.asc,id.asc",
      or: `(org_id.is.null,org_id.eq.${ORG_ID})`,
      portal_key: `eq.${ENROLLMENT_PORTAL_KEY}`,
    },
    portal_field_maps: {
      select:
        "id,org_id,portal_key,url_pattern,page_step,map_type,selector,selector_fallbacks,source,token,hardcoded_value,transform,field_type,notes,status,control_options,mapping_generation,shared_base_generation,created_at,updated_at,learned_via",
      order: "portal_key.asc,selector.asc",
      or: `(org_id.is.null,org_id.eq.${ORG_ID})`,
      portal_key: `eq.${ENROLLMENT_PORTAL_KEY}`,
    },
  };
  const enrollmentPortalResolverTargets = Object.entries(enrollmentPortalResolverQueries).map(
    ([table, query]) => [table, queryTarget(`/rest/v1/${table}`, query)],
  );
  const fillSessionCountTarget = queryTarget("/rest/v1/fill_sessions", FILL_SESSION_COUNT_QUERY);
  const headHeaders = {
    origin: PANEL_ORIGIN,
    "access-control-request-method": "HEAD",
    "access-control-request-headers":
      "accept-profile, apikey, authorization, prefer, x-client-info",
  };
  const fillSessionHeadRoute = (
    target,
    headers = { origin: PANEL_ORIGIN, prefer: "count=exact" },
  ) => routeFor(SUPABASE_HOST, "HEAD", "/rest/v1/fill_sessions", target, headers);
  const matrixTargets = [
    [
      "contracts",
      queryTarget("/rest/v1/contracts", {
        select:
          "id,group_id,payer_id,state,contracting_status_id,effective_date,tentative_effective_date,expiration_date,specialty,notes,created_at,updated_at",
        org_id: `eq.${ORG_ID}`,
        order: "created_at.desc",
      }),
    ],
    [
      "provider_groups",
      queryTarget("/rest/v1/provider_groups", {
        select: "*",
        org_id: `eq.${ORG_ID}`,
        order: "name.asc",
      }),
    ],
    [
      "payers",
      queryTarget("/rest/v1/payers", {
        select: "*",
        or: `(org_id.eq.${ORG_ID},org_id.is.null)`,
        order: "name.asc",
      }),
    ],
    [
      "status_configs",
      queryTarget("/rest/v1/status_configs", {
        select: "*",
        org_id: `eq.${ORG_ID}`,
        order: "sort_order.asc",
        track: "eq.contracting",
      }),
    ],
    [
      "facilities",
      queryTarget("/rest/v1/facilities", {
        select: "*",
        org_id: `eq.${ORG_ID}`,
        order: "name.asc",
      }),
    ],
    [
      "payer_network_targets",
      queryTarget("/rest/v1/payer_network_targets", {
        select: "*",
        org_id: `eq.${ORG_ID}`,
        order: "created_at.asc",
      }),
    ],
  ];
  const groupedFacilityTarget = queryTarget("/rest/v1/facilities", {
    select: "*",
    org_id: `eq.${ORG_ID}`,
    order: "name.asc",
    group_id: `eq.${GROUP_ID}`,
  });
  const enrollmentCaseQuery = {
    select:
      "*,provider:providers(*),payer:payers(*),mso:msos(*),group:provider_groups(*),facility:facilities(*),credentialing_status:status_configs(*),tasks(*),touches(*),status_history(*),payer_pipeline_history(*),case_status_history(*)",
    id: `eq.${ENROLLMENT_CASE_ID}`,
    org_id: `eq.${ORG_ID}`,
  };
  const enrollmentCaseTarget = queryTarget("/rest/v1/credential_cases", enrollmentCaseQuery);
  const caseFacilitiesQuery = {
    select:
      "id,org_id,case_id,facility_id,is_primary,created_at,created_by,facility:facilities(id,name,street,suite,city,state,zip,is_active)",
    case_id: `eq.${ENROLLMENT_CASE_ID}`,
    org_id: `eq.${ORG_ID}`,
  };
  const caseFacilitiesTarget = queryTarget("/rest/v1/case_facilities", caseFacilitiesQuery);
  const enrollmentTaskQuery = {
    select: "*",
    id: `eq.${ENROLLMENT_TASK_ID}`,
    org_id: `eq.${ORG_ID}`,
  };
  const tasksTarget = queryTarget("/rest/v1/tasks", enrollmentTaskQuery);
  const route = (path, target, headers) =>
    routeFor(SUPABASE_HOST, "OPTIONS", path, target, headers);
  assert(
    route("/rest/v1/profiles", profileTarget, getHeaders)?.name ===
      "supabase.rest.profiles_preflight" &&
      route("/rest/v1/profiles", caseCreatorProfileTarget, getHeaders)?.name ===
        "supabase.rest.profiles_preflight" &&
      route("/rest/v1/memberships", membershipsTarget, getHeaders)?.name ===
        "supabase.rest.memberships_preflight" &&
      contractProviderTargets.every(
        ([table, target]) =>
          route(`/rest/v1/${table}`, target, getHeaders)?.name ===
          `supabase.rest.${table}_preflight`,
      ) &&
      portalResolverTargets.every(
        ([table, target]) =>
          route(`/rest/v1/${table}`, target, getHeaders)?.name ===
          `supabase.rest.${table}_preflight`,
      ) &&
      enrollmentPortalResolverTargets.every(
        ([table, target]) =>
          route(`/rest/v1/${table}`, target, getHeaders)?.name ===
          `supabase.rest.${table}_preflight`,
      ) &&
      matrixTargets.every(
        ([table, target]) =>
          route(`/rest/v1/${table}`, target, getHeaders)?.name ===
          `supabase.rest.${table}_preflight`,
      ) &&
      route("/rest/v1/credential_cases", enrollmentCaseTarget, getHeaders)?.name ===
        "supabase.rest.credential_cases_preflight" &&
      route("/rest/v1/case_facilities", caseFacilitiesTarget, getHeaders)?.name ===
        "supabase.rest.case_facilities_preflight" &&
      route("/rest/v1/tasks", tasksTarget, getHeaders)?.name === "supabase.rest.tasks_preflight" &&
      route("/rest/v1/facilities", groupedFacilityTarget, getHeaders)?.name ===
        "supabase.rest.facilities_preflight" &&
      route("/rest/v1/rpc/claim_invites", "/rest/v1/rpc/claim_invites", postHeaders)?.name ===
        "supabase.rpc.claim_invites_preflight" &&
      route("/rest/v1/fill_sessions", fillSessionCountTarget, headHeaders)?.name ===
        "supabase.rest.fill_sessions_count_preflight" &&
      fillSessionHeadRoute(fillSessionCountTarget)?.name === "supabase.rest.fill_sessions_count",
    "M64_BROWSER_DATA_PREFLIGHT_POLICY_INVALID",
  );
  const deniedGetHeaderVariants = [
    { origin: "https://untrusted.invalid" },
    { "access-control-request-method": "POST" },
    { "access-control-request-private-network": "true" },
    { "access-control-request-headers": undefined },
    {
      "access-control-request-headers": `${getHeaders["access-control-request-headers"]}, x-unknown`,
    },
    {
      "access-control-request-headers":
        "apikey, authorization, x-client-info, apikey, accept-profile",
    },
  ];
  const strictGetPreflightDenials = (targets) =>
    targets.every(([table, target]) =>
      deniedGetHeaderVariants.every(
        (overrides) => route(`/rest/v1/${table}`, target, { ...getHeaders, ...overrides }) === null,
      ),
    );
  const wrongTaskTargets = [
    tasksTarget.replace(ENROLLMENT_TASK_ID, "99000000-0000-4000-a000-000000000099"),
    tasksTarget.replace(ORG_ID, "18000000-0000-4000-a000-000000000099"),
    `${tasksTarget}&unexpected=eq.x`,
    `${tasksTarget}&id=eq.${ENROLLMENT_TASK_ID}`,
    queryTarget("/rest/v1/tasks", { ...enrollmentTaskQuery, select: "id" }),
  ];
  const wrongKeyResolverTargets = enrollmentPortalResolverTargets.flatMap(([table, target]) => {
    const query = enrollmentPortalResolverQueries[table];
    const path = `/rest/v1/${table}`;
    const changedOrder =
      table === "portals" ? "id.asc,portal_key.asc" : "selector.asc,portal_key.asc";
    return [
      [table, queryTarget(path, { ...query, portal_key: "eq.m64_contract" })],
      [
        table,
        queryTarget(path, {
          ...query,
          or: "(org_id.is.null,org_id.eq.18000000-0000-4000-a000-000000000099)",
        }),
      ],
      [table, `${target}&unexpected=eq.x`],
      [table, `${target}&portal_key=eq.${ENROLLMENT_PORTAL_KEY}`],
      [table, queryTarget(path, { ...query, select: "id,portal_key" })],
      [table, queryTarget(path, { ...query, order: changedOrder })],
    ];
  });
  const strictTargetRoutes = [["tasks", tasksTarget], ...enrollmentPortalResolverTargets];
  assert(
    wrongTaskTargets.every((target) => route("/rest/v1/tasks", target, getHeaders) === null) &&
      wrongKeyResolverTargets.every(
        ([table, target]) => route(`/rest/v1/${table}`, target, getHeaders) === null,
      ) &&
      strictTargetRoutes.every(
        ([table, target]) => route(`/rest/v1/${table}/unexpected`, target, getHeaders) === null,
      ) &&
      strictGetPreflightDenials(strictTargetRoutes) &&
      strictTargetRoutes.every(
        ([table, target]) =>
          routeFor(SUPABASE_HOST, "POST", `/rest/v1/${table}`, target, getHeaders) === null,
      ) &&
      strictTargetRoutes.every(
        ([table, target]) =>
          routeFor("unexpected.supabase.co", "OPTIONS", `/rest/v1/${table}`, target, getHeaders) ===
          null,
      ),
    "M64_BROWSER_TASK_AND_KEYED_PORTAL_PREFLIGHT_POLICY_INVALID",
  );
  assert(
    route("/rest/v1/profiles", profileTarget, { ...getHeaders, origin: "https://other.test" }) ===
      null &&
      route("/rest/v1/profiles", profileTarget, {
        ...getHeaders,
        "access-control-request-method": "POST",
      }) === null &&
      route("/rest/v1/profiles", profileTarget, {
        ...getHeaders,
        "access-control-request-private-network": "true",
      }) === null &&
      route("/rest/v1/profiles", profileTarget, {
        ...getHeaders,
        "access-control-request-headers": undefined,
      }) === null &&
      route("/rest/v1/profiles", `${profileTarget}&id=eq.invalid`, getHeaders) === null &&
      route(
        "/rest/v1/profiles",
        caseCreatorProfileTarget.replace(E612.specialist, E612.admin),
        getHeaders,
      ) === null &&
      route(
        "/rest/v1/profiles",
        `${caseCreatorProfileTarget}&id=${encodeURIComponent(SYNTHETIC_CASE_CREATOR_FILTER)}`,
        getHeaders,
      ) === null &&
      route("/rest/v1/profiles", `${caseCreatorProfileTarget}&unexpected=eq.x`, getHeaders) ===
        null &&
      route(
        "/rest/v1/profiles",
        queryTarget("/rest/v1/profiles", {
          select: "full_name",
          id: SYNTHETIC_CASE_CREATOR_FILTER,
        }),
        getHeaders,
      ) === null &&
      route("/rest/v1/profiles", caseCreatorProfileTarget, {
        ...getHeaders,
        origin: "https://other.test",
      }) === null &&
      route("/rest/v1/profiles", caseCreatorProfileTarget, {
        ...getHeaders,
        "access-control-request-method": "POST",
      }) === null &&
      route("/rest/v1/profiles", caseCreatorProfileTarget, {
        ...getHeaders,
        "access-control-request-private-network": "true",
      }) === null &&
      route("/rest/v1/profiles", caseCreatorProfileTarget, {
        ...getHeaders,
        "access-control-request-headers": undefined,
      }) === null &&
      route("/rest/v1/profiles", caseCreatorProfileTarget, {
        ...getHeaders,
        "access-control-request-headers": `${getHeaders["access-control-request-headers"]}, x-unknown`,
      }) === null &&
      route("/rest/v1/profiles", caseCreatorProfileTarget, {
        ...getHeaders,
        "access-control-request-headers":
          "apikey, authorization, x-client-info, apikey, accept-profile",
      }) === null &&
      routeFor(SUPABASE_HOST, "POST", "/rest/v1/profiles", caseCreatorProfileTarget, getHeaders) ===
        null &&
      route("/rest/v1/profiles", profileTarget, {
        ...getHeaders,
        "access-control-request-headers": `${getHeaders["access-control-request-headers"]}, x-unknown`,
      }) === null &&
      route("/rest/v1/profiles", profileTarget, {
        ...getHeaders,
        "access-control-request-headers":
          "apikey, authorization, x-client-info, apikey, accept-profile",
      }) === null &&
      route("/rest/v1/credential_cases", enrollmentCaseTarget, {
        ...getHeaders,
        origin: "https://untrusted.invalid",
      }) === null &&
      route("/rest/v1/credential_cases", enrollmentCaseTarget, {
        ...getHeaders,
        "access-control-request-method": "POST",
      }) === null &&
      routeFor(
        SUPABASE_HOST,
        "POST",
        "/rest/v1/credential_cases",
        enrollmentCaseTarget,
        getHeaders,
      ) === null &&
      route("/rest/v1/credential_cases", enrollmentCaseTarget, {
        ...getHeaders,
        "access-control-request-private-network": "true",
      }) === null &&
      route("/rest/v1/credential_cases", enrollmentCaseTarget, {
        ...getHeaders,
        "access-control-request-headers": undefined,
      }) === null &&
      route("/rest/v1/credential_cases", enrollmentCaseTarget, {
        ...getHeaders,
        "access-control-request-headers": `${getHeaders["access-control-request-headers"]}, x-unknown`,
      }) === null &&
      route("/rest/v1/credential_cases", enrollmentCaseTarget, {
        ...getHeaders,
        "access-control-request-headers":
          "apikey, authorization, x-client-info, apikey, accept-profile",
      }) === null &&
      route(
        "/rest/v1/credential_cases",
        enrollmentCaseTarget.replace(ENROLLMENT_CASE_ID, "49000000-0000-4000-a000-000000000099"),
        getHeaders,
      ) === null &&
      route(
        "/rest/v1/credential_cases",
        enrollmentCaseTarget.replace(ORG_ID, "18000000-0000-4000-a000-000000000099"),
        getHeaders,
      ) === null &&
      route("/rest/v1/credential_cases", `${enrollmentCaseTarget}&unexpected=eq.x`, getHeaders) ===
        null &&
      route(
        "/rest/v1/credential_cases",
        `${enrollmentCaseTarget}&id=eq.${ENROLLMENT_CASE_ID}`,
        getHeaders,
      ) === null &&
      route(
        "/rest/v1/credential_cases",
        queryTarget("/rest/v1/credential_cases", {
          ...enrollmentCaseQuery,
          select: "*,provider:providers(*)",
        }),
        getHeaders,
      ) === null &&
      route("/rest/v1/case_facilities", caseFacilitiesTarget, {
        ...getHeaders,
        origin: "https://untrusted.invalid",
      }) === null &&
      route("/rest/v1/case_facilities", caseFacilitiesTarget, {
        ...getHeaders,
        "access-control-request-method": "POST",
      }) === null &&
      routeFor(
        SUPABASE_HOST,
        "POST",
        "/rest/v1/case_facilities",
        caseFacilitiesTarget,
        getHeaders,
      ) === null &&
      route("/rest/v1/case_facilities", caseFacilitiesTarget, {
        ...getHeaders,
        "access-control-request-private-network": "true",
      }) === null &&
      route("/rest/v1/case_facilities", caseFacilitiesTarget, {
        ...getHeaders,
        "access-control-request-headers": undefined,
      }) === null &&
      route("/rest/v1/case_facilities", caseFacilitiesTarget, {
        ...getHeaders,
        "access-control-request-headers": `${getHeaders["access-control-request-headers"]}, x-unknown`,
      }) === null &&
      route("/rest/v1/case_facilities", caseFacilitiesTarget, {
        ...getHeaders,
        "access-control-request-headers":
          "apikey, authorization, x-client-info, apikey, accept-profile",
      }) === null &&
      route(
        "/rest/v1/case_facilities",
        caseFacilitiesTarget.replace(ENROLLMENT_CASE_ID, "49000000-0000-4000-a000-000000000099"),
        getHeaders,
      ) === null &&
      route(
        "/rest/v1/case_facilities",
        caseFacilitiesTarget.replace(ORG_ID, "18000000-0000-4000-a000-000000000099"),
        getHeaders,
      ) === null &&
      route("/rest/v1/case_facilities", `${caseFacilitiesTarget}&unexpected=eq.x`, getHeaders) ===
        null &&
      route(
        "/rest/v1/case_facilities",
        `${caseFacilitiesTarget}&case_id=eq.${ENROLLMENT_CASE_ID}`,
        getHeaders,
      ) === null &&
      route(
        "/rest/v1/case_facilities",
        queryTarget("/rest/v1/case_facilities", {
          ...caseFacilitiesQuery,
          select: "id,case_id,facility_id",
        }),
        getHeaders,
      ) === null &&
      route(
        "/rest/v1/memberships",
        membershipsTarget.replace("org_id%2Crole", "org_id%2Cunknown"),
        getHeaders,
      ) === null &&
      route("/rest/v1/rpc/claim_invites", "/rest/v1/rpc/claim_invites?x=1", postHeaders) === null &&
      route("/rest/v1/contracts", "/rest/v1/contracts?select=id", getHeaders) === null &&
      route("/rest/v1/contracts", `${matrixTargets[0][1]}&unexpected=eq.x`, getHeaders) === null &&
      route("/rest/v1/provider_groups", matrixTargets[1][1], {
        ...getHeaders,
        origin: "https://other.test",
      }) === null &&
      route("/rest/v1/payers", matrixTargets[2][1], {
        ...getHeaders,
        "access-control-request-method": "POST",
      }) === null &&
      route("/rest/v1/status_configs", matrixTargets[3][1], {
        ...getHeaders,
        "access-control-request-headers": `${getHeaders["access-control-request-headers"]}, x-unknown`,
      }) === null &&
      route("/rest/v1/facilities", matrixTargets[4][1], {
        ...getHeaders,
        "access-control-request-headers":
          "apikey, authorization, x-client-info, accept-profile, apikey",
      }) === null &&
      route(
        "/rest/v1/facilities",
        groupedFacilityTarget.replace(GROUP_ID, "49000000-0000-4000-a000-000000000099"),
        getHeaders,
      ) === null &&
      route("/rest/v1/facilities", `${groupedFacilityTarget}&unexpected=eq.x`, getHeaders) ===
        null &&
      route("/rest/v1/facilities", groupedFacilityTarget, {
        ...getHeaders,
        origin: "https://untrusted.invalid",
      }) === null &&
      route("/rest/v1/facilities", groupedFacilityTarget, {
        ...getHeaders,
        "access-control-request-method": "POST",
      }) === null &&
      route("/rest/v1/facilities", groupedFacilityTarget, {
        ...getHeaders,
        "access-control-request-private-network": "true",
      }) === null &&
      route(
        "/rest/v1/portals",
        portalResolverTargets[0][1].replace(ORG_ID, "18000000-0000-4000-a000-000000000099"),
        getHeaders,
      ) === null &&
      route("/rest/v1/portals", `${portalResolverTargets[0][1]}&unexpected=eq.x`, getHeaders) ===
        null &&
      route(
        "/rest/v1/portals",
        queryTarget("/rest/v1/portals", {
          select: "id,portal_key",
          order: "portal_key.asc,id.asc",
          or: `(org_id.is.null,org_id.eq.${ORG_ID})`,
        }),
        getHeaders,
      ) === null &&
      route(
        "/rest/v1/portal_field_maps",
        queryTarget("/rest/v1/portal_field_maps", {
          select:
            "id,org_id,portal_key,url_pattern,page_step,map_type,selector,selector_fallbacks,source,token,hardcoded_value,transform,field_type,notes,status,control_options,mapping_generation,shared_base_generation,created_at,updated_at,learned_via",
          order: "selector.asc,portal_key.asc",
          or: `(org_id.is.null,org_id.eq.${ORG_ID})`,
        }),
        getHeaders,
      ) === null &&
      route("/rest/v1/portal_field_maps/extra", portalResolverTargets[1][1], getHeaders) === null &&
      route("/rest/v1/portals", portalResolverTargets[0][1], {
        ...getHeaders,
        origin: "https://untrusted.invalid",
      }) === null &&
      route("/rest/v1/portal_field_maps", portalResolverTargets[1][1], {
        ...getHeaders,
        "access-control-request-method": "POST",
      }) === null &&
      route("/rest/v1/portal_field_maps", portalResolverTargets[1][1], {
        ...getHeaders,
        "access-control-request-headers": `${getHeaders["access-control-request-headers"]}, x-unknown`,
      }) === null &&
      route("/rest/v1/portals", portalResolverTargets[0][1], {
        ...getHeaders,
        "access-control-request-private-network": "true",
      }) === null &&
      route("/rest/v1/payer_network_targets", matrixTargets[5][1], {
        ...getHeaders,
        "access-control-request-headers": undefined,
      }) === null &&
      route(
        "/rest/v1/contract_sop_assignments",
        contractProviderTargets[0][1].replace(CONTRACT_ID, "29000000-0000-4000-a000-000000000099"),
        getHeaders,
      ) === null &&
      route(
        "/rest/v1/sop_template_versions",
        contractProviderTargets[1][1].replace(
          CONTRACT_TEMPLATE_ID,
          "69000000-0000-4000-a000-000000000099",
        ),
        getHeaders,
      ) === null &&
      route(
        "/rest/v1/provider_group_assignments",
        contractProviderTargets[2][1].replace(GROUP_ID, "49000000-0000-4000-a000-000000000099"),
        getHeaders,
      ) === null &&
      route(
        "/rest/v1/providers",
        contractProviderTargets[3][1].replace(ORG_ID, "18000000-0000-4000-a000-000000000099"),
        getHeaders,
      ) === null &&
      route(
        "/rest/v1/providers",
        contractProviderTargets[4][1].replace(PROVIDER_ID, "39000000-0000-4000-a000-000000000099"),
        getHeaders,
      ) === null &&
      route(
        "/rest/v1/providers",
        queryTarget("/rest/v1/providers", {
          select: "id,status",
          id: `in.(${PROVIDER_ID},39000000-0000-4000-a000-000000000099)`,
          org_id: `eq.${ORG_ID}`,
        }),
        getHeaders,
      ) === null &&
      route("/rest/v1/contract_sop_assignments", contractProviderTargets[0][1], {
        ...getHeaders,
        origin: "https://untrusted.invalid",
      }) === null &&
      route("/rest/v1/sop_template_versions", contractProviderTargets[1][1], {
        ...getHeaders,
        "access-control-request-method": "POST",
      }) === null &&
      route("/rest/v1/provider_group_assignments", contractProviderTargets[2][1], {
        ...getHeaders,
        "access-control-request-private-network": "true",
      }) === null &&
      route("/rest/v1/providers", `${contractProviderTargets[3][1]}&extra=eq.x`, getHeaders) ===
        null &&
      route(
        "/rest/v1/providers/39000000-0000-4000-a000-000000000065",
        contractProviderTargets[4][1],
        getHeaders,
      ) === null &&
      route("/rest/v1/fill_sessions", fillSessionCountTarget, {
        ...headHeaders,
        origin: "https://untrusted.invalid",
      }) === null &&
      route("/rest/v1/fill_sessions", fillSessionCountTarget, {
        ...headHeaders,
        "access-control-request-method": "GET",
      }) === null &&
      route("/rest/v1/fill_sessions", fillSessionCountTarget, {
        ...headHeaders,
        "access-control-request-private-network": "true",
      }) === null &&
      route("/rest/v1/fill_sessions", fillSessionCountTarget, {
        ...headHeaders,
        "access-control-request-headers": "accept-profile, apikey, authorization, x-client-info",
      }) === null &&
      route("/rest/v1/fill_sessions", fillSessionCountTarget, {
        ...headHeaders,
        "access-control-request-headers": `${headHeaders["access-control-request-headers"]}, x-unknown`,
      }) === null &&
      route("/rest/v1/fill_sessions", fillSessionCountTarget, {
        ...headHeaders,
        "access-control-request-headers": `${headHeaders["access-control-request-headers"]}, prefer`,
      }) === null &&
      route(
        "/rest/v1/fill_sessions",
        fillSessionCountTarget.replace(
          CONTRACT_ASSIGNMENT_ID,
          "79000000-0000-4000-a000-000000000099",
        ),
        headHeaders,
      ) === null &&
      route(
        "/rest/v1/fill_sessions",
        fillSessionCountTarget.replace(ORG_ID, "18000000-0000-4000-a000-000000000099"),
        headHeaders,
      ) === null &&
      route("/rest/v1/fill_sessions", `${fillSessionCountTarget}&unexpected=eq.x`, headHeaders) ===
        null &&
      route("/rest/v1/fill_sessions", fillSessionCountTarget, {
        ...headHeaders,
        "access-control-request-method": "GET",
      }) === null &&
      fillSessionHeadRoute(fillSessionCountTarget, {}) === null &&
      fillSessionHeadRoute(fillSessionCountTarget, {
        origin: PANEL_ORIGIN,
        prefer: "count=exact,return=representation",
      }) === null &&
      fillSessionHeadRoute(fillSessionCountTarget, {
        origin: "https://untrusted.invalid",
        prefer: "count=exact",
      }) === null &&
      routeFor(SUPABASE_HOST, "GET", "/rest/v1/fill_sessions", fillSessionCountTarget, {}) === null,
    "M64_BROWSER_DATA_PREFLIGHT_POLICY_INVALID",
  );
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
    "access-control-request-headers":
      "apikey, authorization, content-type, x-client-info, x-supabase-api-version",
  };
  const route = (
    candidateHeaders = headers,
    target = AUTH_PREFLIGHT_TARGET,
    pathname = "/auth/v1/token",
  ) => routeFor(SUPABASE_HOST, "OPTIONS", pathname, target, candidateHeaders);
  const deniedReason = (
    candidateHeaders = headers,
    target = AUTH_PREFLIGHT_TARGET,
    pathname = "/auth/v1/token",
  ) =>
    classifyAuthPreflightDenialReason(SUPABASE_HOST, "OPTIONS", pathname, target, candidateHeaders);
  assert(route()?.kind === "preflight", "M64_BROWSER_PREFLIGHT_POLICY_INVALID");
  assert(
    route({ ...headers, origin: "https://untrusted.invalid" }) === null &&
      deniedReason({ ...headers, origin: "https://untrusted.invalid" }) === "ORIGIN_OTHER",
    "M64_BROWSER_PREFLIGHT_POLICY_INVALID",
  );
  assert(
    route({ ...headers, "access-control-request-method": "PUT" }) === null &&
      deniedReason({ ...headers, "access-control-request-method": "PUT" }) ===
        "REQUEST_METHOD_OTHER",
    "M64_BROWSER_PREFLIGHT_POLICY_INVALID",
  );
  assert(
    route({ ...headers, "access-control-request-headers": undefined }) === null &&
      deniedReason({ ...headers, "access-control-request-headers": undefined }) ===
        "HEADER_LIST_MISSING",
    "M64_BROWSER_PREFLIGHT_POLICY_INVALID",
  );
  assert(
    route({ ...headers, "access-control-request-headers": "apikey, content-type" }) === null &&
      deniedReason({ ...headers, "access-control-request-headers": "apikey, content-type" }) ===
        "HEADER_REQUIRED_MISSING",
    "M64_BROWSER_PREFLIGHT_POLICY_INVALID",
  );
  assert(
    route({
      ...headers,
      "access-control-request-headers": "apikey, authorization, content-type, x-evil",
    }) === null &&
      deniedReason({
        ...headers,
        "access-control-request-headers": "apikey, authorization, content-type, x-evil",
      }) === "HEADER_NAME_UNEXPECTED",
    "M64_BROWSER_PREFLIGHT_POLICY_INVALID",
  );
  assert(
    route({
      ...headers,
      "access-control-request-headers": "apikey, authorization, content-type, apikey",
    }) === null &&
      deniedReason({
        ...headers,
        "access-control-request-headers": "apikey, authorization, content-type, apikey",
      }) === "HEADER_DUPLICATE",
    "M64_BROWSER_PREFLIGHT_POLICY_INVALID",
  );
  assert(
    route(headers, "/auth/v1/token?grant_type=refresh_token") === null,
    "M64_BROWSER_PREFLIGHT_POLICY_INVALID",
  );
  assert(
    deniedReason(headers, "/auth/v1/token?grant_type=refresh_token") === "TOKEN_TARGET_OTHER",
    "M64_BROWSER_PREFLIGHT_POLICY_INVALID",
  );
  assert(
    route(headers, "/auth/v1/user", "/auth/v1/user") === null &&
      deniedReason(headers, "/auth/v1/user", "/auth/v1/user") === "AUTH_PATH_OTHER",
    "M64_BROWSER_PREFLIGHT_POLICY_INVALID",
  );
}

function classifyAuthPreflightDenialReason(host, method, pathname, requestTarget, headers) {
  if (host !== SUPABASE_HOST || method !== "OPTIONS" || !pathname.startsWith("/auth/v1/")) {
    return null;
  }
  if (pathname !== "/auth/v1/token") return "AUTH_PATH_OTHER";
  if (requestTarget !== AUTH_PREFLIGHT_TARGET) return "TOKEN_TARGET_OTHER";
  if (headers.origin !== PANEL_ORIGIN) return "ORIGIN_OTHER";
  if (headers["access-control-request-method"] !== "POST") return "REQUEST_METHOD_OTHER";
  return inspectRequestedAuthPreflightHeaders(headers["access-control-request-headers"]);
}

function routeFor(host, method, pathname, requestTarget, headers = {}) {
  if (host === PANEL_HOST) {
    const providerRead = panelProviderReadRoute(host, method, pathname, requestTarget, headers);
    if (providerRead) return providerRead;
    if (method === "GET" && requestTarget === PORTAL_PATH) {
      return { kind: "static", name: "panel.synthetic_form" };
    }
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
    const dataPreflight = isAllowedDataPreflight(host, method, pathname, requestTarget, headers);
    if (dataPreflight) return dataPreflight;
    if (
      method === "HEAD" &&
      pathname === "/rest/v1/fill_sessions" &&
      hasExactSyntheticQuery(requestTarget, pathname, FILL_SESSION_COUNT_QUERY) &&
      headers.origin === PANEL_ORIGIN &&
      headers.prefer === "count=exact"
    ) {
      return { kind: "gateway", name: "supabase.rest.fill_sessions_count" };
    }
    const authMethods = new Map([
      ["/auth/v1/token", new Set(["POST"])],
      ["/auth/v1/user", new Set(["GET"])],
      ["/auth/v1/logout", new Set(["POST"])],
    ]);
    const allowedAuth = authMethods.get(pathname);
    if (allowedAuth?.has(method)) {
      return {
        kind: "gateway",
        name: pathname.endsWith("/token") ? "supabase.auth_token" : "supabase.auth",
      };
    }
    const tableMatch = /^\/rest\/v1\/([a-z][a-z0-9_]*)$/.exec(pathname);
    if (
      tableMatch &&
      SUPABASE_REST_READ_TABLES.has(tableMatch[1]) &&
      ["GET", "HEAD"].includes(method)
    ) {
      return { kind: "gateway", name: `supabase.rest.${tableMatch[1]}` };
    }
    const rpcMatch = /^\/rest\/v1\/rpc\/(claim_invites|reset_portal_mapping)$/.exec(pathname);
    if (rpcMatch && method === "POST") {
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
  if (route.name === "panel.synthetic_form" || route.name === "portal.synthetic_form") {
    response.end(SYNTHETIC_FORM_HTML);
    return;
  }
  if (route.name === "panel.handoff") {
    response.end(
      "<!doctype html><title>M64 local handoff fixture</title><main id=handoff>Local-only test handoff</main>",
    );
    return;
  }
  response.end(SYNTHETIC_FORM_HTML);
}

function serveSupabasePreflight(response, route) {
  response.statusCode = 204;
  response.setHeader("access-control-allow-origin", PANEL_ORIGIN);
  response.setHeader("access-control-allow-methods", route.allowedMethod ?? "POST");
  response.setHeader(
    "access-control-allow-headers",
    [...(route.allowedHeaders ?? AUTH_PREFLIGHT_HEADERS)].join(", "),
  );
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
      countDeniedSupabaseOptions(SUPABASE_HOST, method, requestUrl, route.name);
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
      countAllowedEnrollmentProfileTarget(route, method, requestUrl, status);
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
              launchReceiptId: workTuple.launchReceiptId,
              ownerKind: workTuple.ownerKind,
              ownerId: workTuple.ownerId,
              orgId: workTuple.orgId,
              contextVersion: workTuple.contextVersion,
              sopTemplateId: workTuple.sopTemplateId,
              sopVersion: workTuple.sopVersion,
              portalId: workTuple.portalId,
              portalKey: workTuple.portalKey,
              mappingGeneration: workTuple.mappingGeneration,
              effectiveMappingFingerprint: workTuple.effectiveMappingFingerprint,
              providerId: workTuple.providerId ?? null,
              facilityId: workTuple.facilityId ?? null,
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
    countAllowedEnrollmentProfileTarget(route, method, requestUrl, 502);
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

async function panelContractPermissionProbe(extensionPage, extensionId) {
  checkpoint("panel_page_create");
  panelPage = await bounded(() => context.newPage(), 10_000, "M64_BROWSER_PANEL_SIGN_IN_FAILED");
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
  const activeOrgButton = panelPage.locator('button[aria-label^="Active organization:"]:visible');
  try {
    await poll(
      () => activeOrgButton.count(),
      (count) => count === 1,
      "panel_authenticated_org",
      20_000,
    );
  } catch {
    await reportOrgWaitDiagnostic(panelPage);
    throw new BrowserFailure("M64_BROWSER_PANEL_SIGN_IN_FAILED");
  }
  checkpoint("panel_login_org_ready");

  checkpoint("contract_ui");
  checkpoint("contract_ui_org_state");
  const orgAttribute = await activeOrgButton.getAttribute("aria-label");
  if (orgAttribute !== `Active organization: ${panelOrgName}. Switch organization`) {
    checkpoint("contract_ui_org_open");
    await activeOrgButton.click();
    checkpoint("contract_ui_org_select");
    await panelPage.getByRole("menuitem", { name: panelOrgName, exact: true }).click();
    checkpoint("contract_ui_org_selected");
    await poll(
      () => activeOrgButton.getAttribute("aria-label"),
      (label) => label === `Active organization: ${panelOrgName}. Switch organization`,
      "panel_m64_org_selected",
    );
  }
  checkpoint("contract_ui_matrix_navigation");
  await panelPage.goto(
    `${PANEL_ORIGIN}/reporting/contracts-matrix?groupId=${GROUP_ID}&payerId=${PAYER_ID}&state=NY`,
    { waitUntil: "domcontentloaded" },
  );
  const targetCell = panelPage.locator('td[aria-current="location"]');
  checkpoint("contract_ui_matrix_target");
  await poll(
    () => targetCell.count(),
    (count) => count === 1,
    "contract_matrix_target",
  );
  checkpoint("contract_ui_matrix_click");
  await targetCell.click();
  checkpoint("contract_ui_dialog");
  await panelPage.getByRole("dialog").waitFor({ state: "visible" });

  const providerSelect = panelPage.getByRole("combobox", { name: "First provider for form work" });
  checkpoint("contract_ui_provider_open");
  await providerSelect.click();
  checkpoint("contract_ui_provider_select");
  await panelPage.getByRole("option", { name: /Synthetic M64 Provider/ }).click();
  const facilitySelect = panelPage.getByRole("combobox", { name: "Location for form work" });
  checkpoint("contract_ui_facility_open");
  await facilitySelect.click();
  checkpoint("contract_ui_facility_select");
  const panelFacilityName = panelOrgName.replace(/ Organization$/, " Facility");
  assert(
    /^E612 M64 [a-f0-9]{16} Facility$/.test(panelFacilityName),
    "M64_BROWSER_PANEL_FACILITY_NAME_INVALID",
  );
  await panelPage.getByRole("option", { name: `${panelFacilityName} · NY`, exact: true }).click();

  const tupleElement = panelPage.getByTestId("contract-launch-tuple");
  checkpoint("contract_ui_tuple_ready");
  await poll(
    () => tupleElement.getAttribute("data-effective-mapping-fingerprint"),
    (fingerprint) => /^sha256:[a-f0-9]{64}$/.test(fingerprint ?? ""),
    "contract_live_map_fingerprint",
  );
  checkpoint("contract_ui_tuple_read");
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
  checkpoint("contract_ui_launch_ready");
  await poll(() => launch.isEnabled(), Boolean, "contract_work_launch_ready");
  checkpoint("contract_ui_launch_click");
  await launch.click();
  checkpoint("contract_ui_validation");
  await poll(
    () => workValidationSuccesses.find(({ tuple }) => tuple.ownerKind === "contract") ?? null,
    Boolean,
    "contract_real_work_validation",
  );
  const validation = workValidationSuccesses.find(({ tuple }) => tuple.ownerKind === "contract");
  assert(
    validation != null &&
      Object.hasOwn(validation.tuple, "providerId") &&
      Object.hasOwn(validation.tuple, "facilityId"),
    "M64_BROWSER_VALIDATION_CAPTURE_SCHEMA_INVALID",
  );
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
  checkpoint("contract_ui_confirmation");
  await panelPage
    .getByText("The extension validated this step and opened its exact work tab.", {
      exact: true,
    })
    .waitFor({ state: "visible" });
  checkpoint("contract_ui_portal_tab");
  const portalPages = await poll(
    () => context.pages().filter((page) => page.url().startsWith(`${PORTAL_URL}`)),
    (pages) => pages.length === 1,
    "synthetic_contract_tab",
  );
  const [portalPage] = portalPages;
  checkpoint("contract_ui_work_binding");
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
  checkpoint("contract_ui_active_tab_check");
  assert((await activeChromeTabId(extensionPage)) === boundTabId, "M64_BROWSER_ACTIVE_TAB_DRIFT");
  assert(new URL(portalPage.url()).href === PORTAL_URL, "M64_BROWSER_WORK_BINDING_MISMATCH");
  checkpoint("contract_ui_form_shape");
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
  const nativeSidePanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  assert(extensionPage.url() === nativeSidePanelUrl, "M64_BROWSER_ACTUAL_SIDEPANEL_OPEN_FAILED");
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
  assert((await activeChromeTabId(extensionPage)) === boundTabId, "M64_BROWSER_ACTIVE_TAB_DRIFT");
  await extensionPage.locator("#m64-open-real-sidepanel").click();
  assert(
    await poll(
      () => extensionPage.evaluate(() => window.__m64SidePanelOpen === true),
      Boolean,
      "actual_sidepanel_open",
    ),
    "M64_BROWSER_ACTUAL_SIDEPANEL_OPEN_FAILED",
  );
  assert((await activeChromeTabId(extensionPage)) === boundTabId, "M64_BROWSER_ACTIVE_TAB_DRIFT");

  const workTupleFields = [
    "ownerKind",
    "launchReceiptId",
    "ownerId",
    "orgId",
    "contextVersion",
    "sopTemplateId",
    "sopVersion",
    "portalId",
    "portalKey",
    "mappingGeneration",
    "effectiveMappingFingerprint",
    "providerId",
    "facilityId",
    "stepIdentity",
    "taskId",
    "stepId",
    "assignmentId",
    "taskIndex",
    "stepIndex",
  ];
  const activeWorkIdentity = (record) => {
    if (
      !record ||
      typeof record !== "object" ||
      !record.tuple ||
      typeof record.tuple !== "object"
    ) {
      return null;
    }
    const tuple = Object.fromEntries(
      workTupleFields.map((field) => [field, record.tuple[field] ?? null]),
    );
    return JSON.stringify({
      tuple,
      protocolVersion: record.tuple.protocolVersion,
      boundTabId: record.boundTabId,
      formOrigin: record.formOrigin,
      formPath: record.formPath,
      caseType: record.caseType,
      createdAt: record.createdAt,
    });
  };
  const readActiveWork = () =>
    extensionPage.evaluate(
      async (key) => (await chrome.storage.session.get(key))[key] ?? null,
      ACTIVE_WORK_KEY,
    );
  const assertPayerTabActive = async (expectedTabId) => {
    assert(
      (await activeChromeTabId(extensionPage)) === expectedTabId,
      "M64_BROWSER_ACTIVE_TAB_DRIFT",
    );
  };
  const assertPanelPermission = async () => {
    const requiredPattern = `${PANEL_ORIGIN}/*`;
    assert(
      (await extensionPage.evaluate(
        (origin) => chrome.permissions.contains({ origins: [origin] }),
        requiredPattern,
      )) === true,
      "M64_BROWSER_PANEL_REQUIRED_PERMISSION_MISSING",
    );
  };
  const assertWorkRecord = async (expected, validationEvidence, caseType) => {
    const current = await readActiveWork();
    assert(
      activeWorkIdentity(current) !== null &&
        workTupleFields.every(
          (field) => (current.tuple[field] ?? null) === (validationEvidence.tuple[field] ?? null),
        ) &&
        current.tuple.protocolVersion === 2 &&
        current.tuple.launchReceiptId === validationEvidence.tuple.launchReceiptId &&
        current.tuple.effectiveMappingFingerprint ===
          validationEvidence.effectiveMappingFingerprint &&
        current.formPath === PORTAL_PATH &&
        current.formOrigin === PANEL_ORIGIN &&
        current.caseType === caseType &&
        current.boundTabId === expected.boundTabId,
      "M64_BROWSER_WORK_BINDING_MISMATCH",
    );
    return current;
  };
  const evidenceFor = (workValidation) => ({
    effectiveMappingFingerprint: workValidation.effectiveMappingFingerprint,
    tuple: Object.fromEntries(
      workTupleFields.map((field) => [field, workValidation.tuple[field] ?? null]),
    ),
  });

  const contractEvidence = {
    ...evidenceFor(validation),
    protocolVersion: boundWork.tuple.protocolVersion,
  };
  assert(
    boundWork.tuple.protocolVersion === 2 &&
      validation.tuple.ownerKind === "contract" &&
      validation.tuple.ownerId === CONTRACT_ID &&
      validation.tuple.portalId === CONTRACT_PORTAL_ID &&
      validation.tuple.portalKey === "m64_contract" &&
      validation.tuple.assignmentId === CONTRACT_ASSIGNMENT_ID &&
      validation.tuple.mappingGeneration === 1 &&
      validation.tuple.launchReceiptId === boundWork.tuple.launchReceiptId &&
      validation.effectiveMappingFingerprint === uiTuple.effectiveMappingFingerprint &&
      boundWork.formPath === PORTAL_PATH &&
      boundWork.formOrigin === PANEL_ORIGIN &&
      boundWork.caseType === "contract",
    "M64_BROWSER_WORK_BINDING_MISMATCH",
  );
  await assertPanelPermission();
  safeLog("M64|BROWSER|OPTIONAL_HOST_CONSENT|HOLD|reason=manual_only_not_tested");

  // The Panel origin is already an Extension host permission. This is the
  // isolated built sidepanel document used for real user clicks; native panel
  // placement was observed separately above.
  await bounded(
    () => extensionPage.reload({ waitUntil: "domcontentloaded", timeout: 20_000 }),
    25_000,
    "M64_BROWSER_EXTENSION_PAGE_RELOAD_FAILED",
  );
  assert(extensionPage.url() === nativeSidePanelUrl, "M64_BROWSER_ACTUAL_SIDEPANEL_OPEN_FAILED");
  await assertPanelPermission();
  await assertPayerTabActive(boundWork.boundTabId);
  await assertWorkRecord(boundWork, contractEvidence, "contract");

  const fillButton = extensionPage.locator("#fill-btn");
  const mainError = extensionPage.locator("#main-error");
  const emitContractFillReadinessDiagnostic = async (expectedWork, expectedTabId, targetPage) => {
    const inspectWithinLimit = (operation) =>
      bounded(operation, 5_000, "M64_BROWSER_FILL_READINESS_DIAGNOSTIC_TIMEOUT").then(
        (value) => ({ ok: true, value }),
        () => ({ ok: false, value: null }),
      );
    const unknownState = {
      button_present: null,
      button_visible: null,
      button_enabled: null,
      portal_detected: null,
      org_loaded: null,
      org_selected: null,
      provider_loaded: null,
      provider_selected: null,
      facility_loaded: null,
      facility_selected: null,
      case_work_hidden: null,
      provider_card_hidden: null,
      fill_section_hidden: null,
      case_mode_active: null,
      provider_name_matches: null,
      selected_provider_exact: null,
      provider_list_contains_work_id: null,
      provider_list_state: "unknown",
      selected_facility_exact: null,
      main_error_hidden: null,
    };
    const [uiResult, workResult, tabResult] = await Promise.all([
      inspectWithinLimit(() =>
        extensionPage.evaluate(
          async ({ orgId, providerId, facilityId }) => {
            const button = document.querySelector("#fill-btn");
            const orgSelect = document.querySelector("#org-select");
            const providerCard = document.querySelector("#provider-card");
            const providerName = document.querySelector("#provider-name");
            const facilitySelect = document.querySelector("#facility-select");
            const portalStatus = document.querySelector("#portal-status");
            const caseWork = document.querySelector("#case-work");
            const fillSection = document.querySelector("#fill-section");
            const modeCase = document.querySelector("#mode-case");
            const mainError = document.querySelector("#main-error");
            const visible = (element) => {
              if (!element || element.hidden) return false;
              const style = getComputedStyle(element);
              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                element.getClientRects().length > 0
              );
            };
            const orgOptions = orgSelect ? [...orgSelect.options] : [];
            const facilityOptions = facilitySelect ? [...facilitySelect.options] : [];
            const readBackground = (request) =>
              new Promise((resolve) => {
                const timer = setTimeout(() => resolve(null), 2_000);
                try {
                  Promise.resolve(chrome.runtime.sendMessage(request)).then(
                    (response) => {
                      clearTimeout(timer);
                      resolve(response);
                    },
                    () => {
                      clearTimeout(timer);
                      resolve(null);
                    },
                  );
                } catch {
                  clearTimeout(timer);
                  resolve(null);
                }
              });
            const [selectedProvider, providerRoster, selectedFacility] = await Promise.all([
              readBackground({ type: "GET_SELECTED_PROVIDER" }),
              readBackground({ type: "LIST_PROVIDERS" }),
              readBackground({ type: "GET_SELECTED_FACILITY", providerId }),
            ]);
            return {
              button_present: button !== null,
              button_visible: visible(button),
              button_enabled: button instanceof HTMLButtonElement ? !button.disabled : false,
              portal_detected: portalStatus?.classList.contains("detected") === true,
              org_loaded: orgOptions.some((option) => option.value === orgId),
              org_selected: orgSelect?.value === orgId,
              provider_loaded: visible(providerCard) && Boolean(providerName?.textContent?.trim()),
              provider_selected:
                visible(providerCard) &&
                providerName?.textContent?.trim() === "Synthetic M64 Provider" &&
                providerId === "39000000-0000-4000-a000-000000000065",
              facility_loaded: facilityOptions.some((option) => option.value === facilityId),
              facility_selected: facilitySelect?.value === facilityId,
              case_work_hidden: caseWork?.hidden,
              provider_card_hidden: providerCard?.hidden,
              fill_section_hidden: fillSection?.hidden,
              case_mode_active:
                modeCase == null ? null : modeCase.getAttribute("aria-pressed") === "true",
              provider_name_matches:
                providerName == null
                  ? null
                  : providerName.textContent?.trim() === "Synthetic M64 Provider",
              selected_provider_exact:
                selectedProvider == null
                  ? null
                  : selectedProvider.ok === true && selectedProvider.data === providerId,
              provider_list_contains_work_id:
                providerRoster == null
                  ? null
                  : providerRoster.ok === true &&
                    Array.isArray(providerRoster.data) &&
                    providerRoster.data.some((provider) => provider?.id === providerId),
              provider_list_state:
                providerRoster == null
                  ? "unknown"
                  : providerRoster.ok !== true
                    ? "failed"
                    : Array.isArray(providerRoster.data)
                      ? providerRoster.data.length === 0
                        ? "empty"
                        : "nonempty"
                      : "malformed",
              selected_facility_exact:
                selectedFacility == null
                  ? null
                  : selectedFacility.ok === true && selectedFacility.data === facilityId,
              main_error_hidden: mainError?.hidden,
            };
          },
          {
            orgId: ORG_ID,
            providerId: expectedWork?.tuple?.providerId ?? "",
            facilityId: FACILITY_ID,
          },
        ),
      ),
      inspectWithinLimit(() => readActiveWork()),
      inspectWithinLimit(() => activeChromeTabId(extensionPage)),
    ]);
    const currentWork = workResult.value;
    const activeTabId = tabResult.value;
    const workExact = workResult.ok
      ? currentWork != null && activeWorkIdentity(currentWork) === activeWorkIdentity(expectedWork)
      : null;
    const tabExact = tabResult.ok
      ? activeTabId === expectedTabId && targetPage.url() === PORTAL_URL
      : null;
    const portalMatch =
      uiResult.ok && workResult.ok
        ? uiResult.value.portal_detected === true &&
          targetPage.url() === PORTAL_URL &&
          currentWork?.tuple?.portalId === expectedWork?.tuple?.portalId &&
          currentWork?.tuple?.portalKey === expectedWork?.tuple?.portalKey
        : null;
    const state = { ...unknownState, ...(uiResult.value ?? {}) };
    const booleans = [
      ["button_present", state.button_present],
      ["button_visible", state.button_visible],
      ["button_enabled", state.button_enabled],
      ["work_exact", workExact],
      ["tab_exact", tabExact],
      ["portal_match", portalMatch],
      ["org_loaded", state.org_loaded],
      ["org_selected", state.org_selected],
      ["provider_loaded", state.provider_loaded],
      ["provider_selected", state.provider_selected],
      ["facility_loaded", state.facility_loaded],
      ["facility_selected", state.facility_selected],
      ["case_work_hidden", state.case_work_hidden],
      ["provider_card_hidden", state.provider_card_hidden],
      ["fill_section_hidden", state.fill_section_hidden],
      ["case_mode_active", state.case_mode_active],
      ["provider_name_matches", state.provider_name_matches],
      ["selected_provider_exact", state.selected_provider_exact],
      ["provider_list_contains_work_id", state.provider_list_contains_work_id],
      ["selected_facility_exact", state.selected_facility_exact],
      ["main_error_hidden", state.main_error_hidden],
    ];
    const fields = booleans.map(
      ([name, value]) =>
        `${name}=${value === true ? "true" : value === false ? "false" : "unknown"}`,
    );
    fields.splice(
      fields.findIndex((field) => field.startsWith("selected_facility_exact=")),
      0,
      `provider_list_state=${state.provider_list_state}`,
    );
    const routeCounts = [
      ["work_validate_200", "panel.work_validate", 200],
      ["work_validate_409", "panel.work_validate", 409],
      ["fill_events_201", "panel.fill_events", 201],
      ["profiles_200", "supabase.rest.profiles", 200],
      ["memberships_200", "supabase.rest.memberships", 200],
      ["contracts_200", "supabase.rest.contracts", 200],
      ["provider_groups_200", "supabase.rest.provider_groups", 200],
      ["supabase_providers_200", "supabase.rest.providers", 200],
      ["provider_group_assignments_200", "supabase.rest.provider_group_assignments", 200],
      ["provider_facility_assignments_200", "supabase.rest.provider_facility_assignments", 200],
      ["facilities_200", "supabase.rest.facilities", 200],
      ["contract_sop_assignments_200", "supabase.rest.contract_sop_assignments", 200],
      ["sop_template_versions_200", "supabase.rest.sop_template_versions", 200],
      ["portals_200", "supabase.rest.portals", 200],
      ["portal_field_maps_200", "supabase.rest.portal_field_maps", 200],
      ["fill_sessions_count_200", "supabase.rest.fill_sessions_count", 200],
      ["panel_provider_roster_200", "panel.providers", 200],
      ["panel_provider_roster_preflight_204", "panel.providers_preflight", 204],
      ["contract_profile_200", "panel.provider_profile", 200],
      ["contract_profile_preflight_204", "panel.provider_profile_preflight", 204],
    ];
    fields.push(
      ...routeCounts.map(
        ([name, route, status]) => `${name}=${boundedDiagnosticCount(routeCount(route, status))}`,
      ),
    );
    safeLog(`M64|BROWSER|CONTRACT_FILL_READY|${fields.join("|")}`);
  };
  const emitEnrollmentFillReadinessDiagnostic = async (expectedWork, expectedTabId, targetPage) => {
    const inspectWithinLimit = (operation) =>
      bounded(operation, 5_000, "M64_BROWSER_ENROLLMENT_FILL_READINESS_DIAGNOSTIC_TIMEOUT").then(
        (value) => ({ ok: true, value }),
        () => ({ ok: false, value: null }),
      );
    const [uiResult, workResult, tabResult] = await Promise.all([
      inspectWithinLimit(() =>
        extensionPage.evaluate(
          async ({ orgId, providerId, facilityId, caseId }) => {
            const isVisible = (element) => {
              if (!element || element.hidden) return false;
              const style = getComputedStyle(element);
              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                element.getClientRects().length > 0
              );
            };
            const button = document.querySelector("#fill-btn");
            const orgSelect = document.querySelector("#org-select");
            const providerCard = document.querySelector("#provider-card");
            const providerName = document.querySelector("#provider-name");
            const facilitySelect = document.querySelector("#facility-select");
            const caseSelect = document.querySelector("#case-select");
            const portalStatus = document.querySelector("#portal-status");
            const mainError = document.querySelector("#main-error");
            const readBackground = (request) =>
              new Promise((resolve) => {
                const timer = setTimeout(() => resolve(null), 2_000);
                try {
                  Promise.resolve(chrome.runtime.sendMessage(request)).then(
                    (response) => {
                      clearTimeout(timer);
                      resolve(response);
                    },
                    () => {
                      clearTimeout(timer);
                      resolve(null);
                    },
                  );
                } catch {
                  clearTimeout(timer);
                  resolve(null);
                }
              });
            const [selectedProvider, selectedCase, selectedFacility] = await Promise.all([
              readBackground({ type: "GET_SELECTED_PROVIDER" }),
              readBackground({ type: "GET_SELECTED_CASE", providerId }),
              readBackground({ type: "GET_SELECTED_FACILITY", providerId }),
            ]);
            const orgOptions = orgSelect ? [...orgSelect.options] : [];
            const providerIsVisible = isVisible(providerCard);
            return {
              button_present: button !== null,
              button_visible: isVisible(button),
              button_enabled: button instanceof HTMLButtonElement ? !button.disabled : false,
              portal_detected: portalStatus?.classList.contains("detected") === true,
              org_loaded: orgOptions.some((option) => option.value === orgId),
              org_selected: orgSelect?.value === orgId,
              provider_loaded: providerIsVisible && Boolean(providerName?.textContent?.trim()),
              provider_selected:
                providerIsVisible &&
                providerName?.textContent?.trim() === "Synthetic M64 Provider" &&
                providerId === "39000000-0000-4000-a000-000000000065",
              selected_provider_exact:
                selectedProvider == null
                  ? null
                  : selectedProvider.ok === true && selectedProvider.data === providerId,
              case_option_present:
                caseSelect instanceof HTMLSelectElement &&
                [...caseSelect.options].some((option) => option.value === caseId),
              case_selected: caseSelect instanceof HTMLSelectElement && caseSelect.value === caseId,
              selected_case_exact:
                selectedCase == null
                  ? null
                  : selectedCase.ok === true && selectedCase.data === caseId,
              facility_option_present:
                facilitySelect instanceof HTMLSelectElement &&
                [...facilitySelect.options].some((option) => option.value === facilityId),
              facility_selected:
                facilitySelect instanceof HTMLSelectElement && facilitySelect.value === facilityId,
              selected_facility_exact:
                selectedFacility == null
                  ? null
                  : selectedFacility.ok === true && selectedFacility.data === facilityId,
              main_error_hidden: mainError?.hidden,
            };
          },
          {
            orgId: ORG_ID,
            providerId: PROVIDER_ID,
            facilityId: FACILITY_ID,
            caseId: ENROLLMENT_CASE_ID,
          },
        ),
      ),
      inspectWithinLimit(() => readActiveWork()),
      inspectWithinLimit(() => activeChromeTabId(extensionPage)),
    ]);
    const currentWork = workResult.value;
    const workExact = workResult.ok
      ? currentWork != null && activeWorkIdentity(currentWork) === activeWorkIdentity(expectedWork)
      : null;
    const tabExact = tabResult.ok
      ? tabResult.value === expectedTabId && targetPage.url() === PORTAL_URL
      : null;
    const portalMatch =
      uiResult.ok && workResult.ok
        ? uiResult.value.portal_detected === true &&
          targetPage.url() === PORTAL_URL &&
          currentWork?.tuple?.portalId === expectedWork?.tuple?.portalId &&
          currentWork?.tuple?.portalKey === expectedWork?.tuple?.portalKey
        : null;
    const ui = uiResult.value ?? {};
    const booleans = [
      ["button_present", ui.button_present],
      ["button_visible", ui.button_visible],
      ["button_enabled", ui.button_enabled],
      ["work_exact", workExact],
      ["tab_exact", tabExact],
      ["portal_match", portalMatch],
      ["org_loaded", ui.org_loaded],
      ["org_selected", ui.org_selected],
      ["provider_loaded", ui.provider_loaded],
      ["provider_selected", ui.provider_selected],
      ["selected_provider_exact", ui.selected_provider_exact],
      ["case_option_present", ui.case_option_present],
      ["case_selected", ui.case_selected],
      ["selected_case_exact", ui.selected_case_exact],
      ["facility_option_present", ui.facility_option_present],
      ["facility_selected", ui.facility_selected],
      ["selected_facility_exact", ui.selected_facility_exact],
      ["main_error_hidden", ui.main_error_hidden],
    ];
    const fields = booleans.map(
      ([name, value]) =>
        `${name}=${value === true ? "true" : value === false ? "false" : "unknown"}`,
    );
    const profileStatuses = [200, 401, 403, 404, 502];
    const profileRoute = "panel.enrollment_profile_get";
    const knownProfileCount = profileStatuses.reduce(
      (total, status) => total + routeCount(profileRoute, status),
      0,
    );
    fields.push(
      ...profileStatuses.map(
        (status) =>
          `enrollment_profile_get_${status}=${boundedDiagnosticCount(routeCount(profileRoute, status))}`,
      ),
      `enrollment_profile_get_other=${boundedDiagnosticCount(
        Math.max(0, routeTotal(profileRoute) - knownProfileCount),
      )}`,
      `enrollment_profile_options_204=${boundedDiagnosticCount(
        routeCount("panel.enrollment_profile_options", 204),
      )}`,
      `enrollment_profile_options_other=${boundedDiagnosticCount(
        Math.max(
          0,
          routeTotal("panel.enrollment_profile_options") -
            routeCount("panel.enrollment_profile_options", 204),
        ),
      )}`,
      `enrollment_profile_denied_get_404=${boundedDiagnosticCount(
        routeCount("panel.enrollment_profile_denied_get", 404),
      )}`,
      `enrollment_profile_denied_options_404=${boundedDiagnosticCount(
        routeCount("panel.enrollment_profile_denied_options", 404),
      )}`,
    );
    safeLog(`M64|BROWSER|ENROLLMENT_FILL_READY|${fields.join("|")}`);
  };
  const emitContractFillReceiptDiagnostic = async (expectedWork, expectedTabId, targetPage) => {
    const inspectWithinLimit = (operation) =>
      bounded(operation, 5_000, "M64_BROWSER_FILL_RECEIPT_DIAGNOSTIC_TIMEOUT").then(
        (value) => ({ ok: true, value }),
        () => ({ ok: false, value: null }),
      );
    const [uiResult, formResult, workResult, tabResult] = await Promise.all([
      inspectWithinLimit(() =>
        extensionPage.evaluate(() => {
          const isVisible = (element) => {
            if (!element || element.hidden) return false;
            const style = getComputedStyle(element);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              element.getClientRects().length > 0
            );
          };
          return {
            mainErrorVisible: isVisible(document.querySelector("#main-error")),
            fillResultsVisible: isVisible(document.querySelector("#fill-results")),
            fillSummaryVisible: isVisible(document.querySelector("#fill-summary")),
            fillButtonEnabled:
              document.querySelector("#fill-btn") instanceof HTMLButtonElement &&
              !document.querySelector("#fill-btn").disabled,
          };
        }),
      ),
      inspectWithinLimit(() =>
        targetPage.evaluate(() => {
          const input = document.querySelector("#contract-npi");
          const value = input instanceof HTMLInputElement ? input.value : "";
          return { nonempty: value.trim().length > 0, matchesExpected: value === "9999999995" };
        }),
      ),
      inspectWithinLimit(() => readActiveWork()),
      inspectWithinLimit(() => activeChromeTabId(extensionPage)),
    ]);
    const currentWork = workResult.value;
    const fields = [
      ["main_error_visible", uiResult.ok ? uiResult.value.mainErrorVisible : null],
      ["fill_results_visible", uiResult.ok ? uiResult.value.fillResultsVisible : null],
      ["fill_summary_visible", uiResult.ok ? uiResult.value.fillSummaryVisible : null],
      ["fill_button_enabled", uiResult.ok ? uiResult.value.fillButtonEnabled : null],
      ["contract_npi_nonempty", formResult.ok ? formResult.value.nonempty : null],
      ["contract_npi_matches_expected", formResult.ok ? formResult.value.matchesExpected : null],
      [
        "work_exact",
        workResult.ok
          ? currentWork != null &&
            activeWorkIdentity(currentWork) === activeWorkIdentity(expectedWork)
          : null,
      ],
      [
        "tab_exact",
        tabResult.ok ? tabResult.value === expectedTabId && targetPage.url() === PORTAL_URL : null,
      ],
    ].map(
      ([name, value]) =>
        `${name}=${value === true ? "true" : value === false ? "false" : "unknown"}`,
    );
    const route = "panel.fill_events";
    const statuses = [201, 200, 400, 401, 403, 409, 422];
    const explicitStatusTotal = statuses.reduce(
      (total, status) => total + routeCount(route, status),
      0,
    );
    const serverErrorTotal = routeStatusClassCount(
      route,
      (status) => status >= 500 && status <= 599,
    );
    const routeCounts = [
      ["fill_events_total", routeTotal(route)],
      ...statuses.map((status) => [`fill_events_${status}`, routeCount(route, status)]),
      ["fill_events_5xx", serverErrorTotal],
      [
        "fill_events_other",
        Math.max(0, routeTotal(route) - explicitStatusTotal - serverErrorTotal),
      ],
      ["fill_events_options", routeTotal("panel.fill_events_options")],
      ["work_validate_200", routeCount("panel.work_validate", 200)],
      ["work_validate_409", routeCount("panel.work_validate", 409)],
    ];
    fields.push(
      ...routeCounts.map(([name, countValue]) => `${name}=${boundedDiagnosticCount(countValue)}`),
    );
    safeLog(`M64|BROWSER|CONTRACT_FILL_RECEIPT|${fields.join("|")}`);
  };
  const emitEnrollmentFillReceiptDiagnostic = async (
    expectedWork,
    expectedTabId,
    targetPage,
    baseline,
    counterDeltas,
  ) => {
    const inspectWithinLimit = (operation) =>
      bounded(operation, 5_000, "M64_BROWSER_ENROLLMENT_FILL_RECEIPT_DIAGNOSTIC_TIMEOUT").then(
        (value) => ({ ok: true, value }),
        () => ({ ok: false, value: null }),
      );
    const [uiResult, formResult, workResult, tabResult] = await Promise.all([
      inspectWithinLimit(() =>
        extensionPage.evaluate(() => {
          const isVisible = (element) => {
            if (!element || element.hidden) return false;
            const style = getComputedStyle(element);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              element.getClientRects().length > 0
            );
          };
          return {
            mainErrorVisible: isVisible(document.querySelector("#main-error")),
            fillResultsVisible: isVisible(document.querySelector("#fill-results")),
            fillSummaryVisible: isVisible(document.querySelector("#fill-summary")),
            fillNoteVisible: isVisible(document.querySelector("#fill-note")),
          };
        }),
      ),
      inspectWithinLimit(() =>
        targetPage.evaluate(() => {
          const input = document.querySelector("#enrollment-npi");
          const value = input instanceof HTMLInputElement ? input.value : "";
          return { nonempty: value.trim().length > 0, exact: value === "9999999995" };
        }),
      ),
      inspectWithinLimit(() => readActiveWork()),
      inspectWithinLimit(() => activeChromeTabId(extensionPage)),
    ]);
    const currentWork = workResult.value;
    const boolFields = [
      ["main_error_visible", uiResult.ok ? uiResult.value.mainErrorVisible : null],
      ["fill_results_visible", uiResult.ok ? uiResult.value.fillResultsVisible : null],
      ["fill_summary_visible", uiResult.ok ? uiResult.value.fillSummaryVisible : null],
      ["fill_note_visible", uiResult.ok ? uiResult.value.fillNoteVisible : null],
      [
        "work_exact",
        workResult.ok
          ? currentWork != null &&
            activeWorkIdentity(currentWork) === activeWorkIdentity(expectedWork)
          : null,
      ],
      [
        "tab_exact",
        tabResult.ok ? tabResult.value === expectedTabId && targetPage.url() === PORTAL_URL : null,
      ],
      ["enrollment_npi_nonempty", formResult.ok ? formResult.value.nonempty : null],
      ["enrollment_npi_exact", formResult.ok ? formResult.value.exact : null],
    ];
    const values = {
      ...Object.fromEntries(
        boolFields.map(([name, value]) => [
          name,
          value === true ? "true" : value === false ? "false" : "unknown",
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(counterDeltas(baseline)).map(([name, value]) => [
          name,
          boundedDiagnosticCount(value),
        ]),
      ),
    };
    const fields = ENROLLMENT_FILL_RECEIPT_DIAGNOSTIC_FIELDS.map(
      (name) => `${name}=${values[name]}`,
    );
    const marker = `M64|BROWSER|ENROLLMENT_FILL_RECEIPT|${fields.join("|")}`;
    assert(
      safeM64EnrollmentFillReceiptDiagnostic([marker]) !== null,
      "M64_BROWSER_ENROLLMENT_FILL_RECEIPT_DIAGNOSTIC_INVALID",
    );
    safeLog(marker);
  };
  const emitContractFillSummaryDiagnostic = async (targetPage) => {
    const read = await bounded(
      () =>
        Promise.all([
          extensionPage.evaluate(() => {
            const isVisible = (element) => {
              if (!element || element.hidden) return false;
              const style = getComputedStyle(element);
              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                element.getClientRects().length > 0
              );
            };
            const summaryBox = document.querySelector("#fill-summary");
            const heading = document.querySelector("#fill-summary summary .bucket-heading");
            const headingText = heading?.textContent?.trim() ?? "";
            const bucket = (value) => (value === "0" ? "0" : value === "1" ? "1" : "2_PLUS");
            const verified = /^Verified (\d+); (\d+) setter attempts remain unverified\./.exec(
              headingText,
            );
            const confirmedStatic =
              /^Confirmed static: (\d+) · AI suggestions: (\d+) of (\d+) actual writes\./.exec(
                headingText,
              );
            let headingKind = "other";
            let verifiedCount = "unknown";
            let attemptedCount = "unknown";
            if (!headingText) {
              headingKind = "empty";
            } else if (verified) {
              headingKind = "verified";
              verifiedCount = bucket(verified[1]);
              attemptedCount = bucket(verified[2]);
            } else if (confirmedStatic) {
              headingKind = "confirmed_static";
              attemptedCount = bucket(confirmedStatic[3]);
            }
            return {
              resultsVisible: isVisible(document.querySelector("#fill-results")),
              summaryVisible: isVisible(summaryBox),
              mainErrorVisible: isVisible(document.querySelector("#main-error")),
              fillButtonEnabled:
                document.querySelector("#fill-btn") instanceof HTMLButtonElement &&
                !document.querySelector("#fill-btn").disabled,
              fillNoteVisible: isVisible(document.querySelector("#fill-note")),
              innerTextExpected:
                typeof summaryBox?.innerText === "string" &&
                summaryBox.innerText.startsWith("Verified 0; 1 setter attempts remain unverified."),
              titleExpected: document.title === "Minted Panel Workbench",
              headingKind,
              verifiedCount,
              attemptedCount,
            };
          }),
          targetPage.evaluate(() => {
            const input = document.querySelector("#contract-npi");
            const value = input instanceof HTMLInputElement ? input.value : "";
            return {
              formNonempty: value.trim().length > 0,
              formMatchesExpected: value === "9999999995",
            };
          }),
        ]),
      5_000,
      "M64_BROWSER_FILL_SUMMARY_DIAGNOSTIC_TIMEOUT",
    ).then(
      (values) => ({ ok: true, extension: values[0], form: values[1] }),
      () => ({ ok: false, extension: null, form: null }),
    );
    const boolValue = (value) => (value === true ? "true" : value === false ? "false" : "unknown");
    const allowedHeadingKinds = new Set([
      "verified",
      "confirmed_static",
      "empty",
      "other",
      "unknown",
    ]);
    const allowedCountBuckets = new Set(["0", "1", "2_PLUS", "unknown"]);
    const extension = read.extension;
    const form = read.form;
    const headingKind =
      read.ok && allowedHeadingKinds.has(extension.headingKind) ? extension.headingKind : "unknown";
    const verifiedCount =
      read.ok && allowedCountBuckets.has(extension.verifiedCount)
        ? extension.verifiedCount
        : "unknown";
    const attemptedCount =
      read.ok && allowedCountBuckets.has(extension.attemptedCount)
        ? extension.attemptedCount
        : "unknown";
    const fields = [
      ["results_visible", read.ok ? extension.resultsVisible : null],
      ["summary_visible", read.ok ? extension.summaryVisible : null],
      ["main_error_visible", read.ok ? extension.mainErrorVisible : null],
      ["fill_button_enabled", read.ok ? extension.fillButtonEnabled : null],
      ["fill_note_visible", read.ok ? extension.fillNoteVisible : null],
      ["form_nonempty", read.ok ? form.formNonempty : null],
      ["form_matches_expected", read.ok ? form.formMatchesExpected : null],
      ["innertext_expected", read.ok ? extension.innerTextExpected : null],
      ["title_expected", read.ok ? extension.titleExpected : null],
    ].map(([name, value]) => `${name}=${boolValue(value)}`);
    fields.push(
      `heading_kind=${headingKind}`,
      `verified_count=${verifiedCount}`,
      `attempted_count=${attemptedCount}`,
    );
    safeLog(`M64|BROWSER|CONTRACT_FILL_SUMMARY|${fields.join("|")}`);
  };
  const waitForFillReady = async (label, stage, expectedWork, expectedTabId, targetPage) => {
    checkpoint(`${stage}_readiness`);
    try {
      await poll(() => fillButton.isEnabled(), Boolean, label, 30_000);
    } catch (error) {
      if (stage === "contract_fill") {
        await emitContractFillReadinessDiagnostic(expectedWork, expectedTabId, targetPage).catch(
          () => {},
        );
      } else if (stage === "enrollment_fill") {
        await emitEnrollmentFillReadinessDiagnostic(expectedWork, expectedTabId, targetPage).catch(
          () => {},
        );
      }
      throw error;
    }
  };
  const fillReceiptMetricSnapshot = () => {
    const fillRoute = "panel.fill_events";
    const fillStatuses = [201, 200, 400, 401, 403, 409, 422];
    const fillKnownTotal = fillStatuses.reduce(
      (total, status) => total + routeCount(fillRoute, status),
      0,
    );
    const fillServerErrors = routeStatusClassCount(
      fillRoute,
      (status) => status >= 500 && status <= 599,
    );
    const workRoute = "panel.work_validate";
    const workServerErrors = routeStatusClassCount(
      workRoute,
      (status) => status >= 500 && status <= 599,
    );
    return {
      fill_events_post_seen: routeCount("panel.fill_events_post_seen", 0),
      fill_events_post_admitted: routeCount("panel.fill_events_post_admitted", 0),
      fill_events_post_denied: routeCount("panel.fill_events_post_denied", 404),
      fill_events_201: routeCount(fillRoute, 201),
      fill_events_200: routeCount(fillRoute, 200),
      fill_events_400: routeCount(fillRoute, 400),
      fill_events_401: routeCount(fillRoute, 401),
      fill_events_403: routeCount(fillRoute, 403),
      fill_events_409: routeCount(fillRoute, 409),
      fill_events_422: routeCount(fillRoute, 422),
      fill_events_5xx: fillServerErrors,
      fill_events_other: Math.max(0, routeTotal(fillRoute) - fillKnownTotal - fillServerErrors),
      fill_events_options_seen: routeCount("panel.fill_events_options_seen", 0),
      fill_events_options_admitted: routeCount("panel.fill_events_options_admitted", 0),
      fill_events_options_denied: routeCount("panel.fill_events_options_denied", 404),
      work_validate_200: routeCount(workRoute, 200),
      work_validate_409: routeCount(workRoute, 409),
      work_validate_5xx: workServerErrors,
      work_validate_other: Math.max(
        0,
        routeTotal(workRoute) -
          routeCount(workRoute, 200) -
          routeCount(workRoute, 409) -
          workServerErrors,
      ),
    };
  };
  const fillReceiptMetricDeltas = (baseline) => {
    const current = fillReceiptMetricSnapshot();
    return Object.fromEntries(
      Object.keys(current).map((name) => [name, Math.max(0, current[name] - baseline[name])]),
    );
  };
  const fillOnBoundWork = async (expectedTabId, targetPage, selectorId, label) => {
    const stage = label === "Contract" ? "contract_fill" : "enrollment_fill";
    checkpoint(stage);
    checkpoint(`${stage}_active_tab`);
    await assertPayerTabActive(expectedTabId);
    await waitForFillReady(
      `${label.toLowerCase()}_fill_button`,
      stage,
      label === "Contract" ? boundWork : enrollmentWork,
      expectedTabId,
      targetPage,
    );
    const previousCreated = routeCount("panel.fill_events", 201);
    const enrollmentReceiptBaseline =
      stage === "enrollment_fill" ? fillReceiptMetricSnapshot() : null;
    checkpoint(`${stage}_click`);
    await bounded(
      () => fillButton.click({ timeout: 10_000 }),
      15_000,
      label === "Contract"
        ? "M64_BROWSER_CONTRACT_FILL_FAILED"
        : "M64_BROWSER_ENROLLMENT_FILL_FAILED",
    );
    checkpoint(`${stage}_receipt_wait`);
    try {
      await poll(
        () => routeCount("panel.fill_events", 201),
        (count) => count > previousCreated,
        `${label.toLowerCase()}_fill_receipt_api`,
        45_000,
      );
    } catch (error) {
      if (stage === "contract_fill") {
        await emitContractFillReceiptDiagnostic(
          label === "Contract" ? boundWork : enrollmentWork,
          expectedTabId,
          targetPage,
        ).catch(() => {});
      } else if (stage === "enrollment_fill" && enrollmentReceiptBaseline !== null) {
        await emitEnrollmentFillReceiptDiagnostic(
          enrollmentWork,
          expectedTabId,
          targetPage,
          enrollmentReceiptBaseline,
          fillReceiptMetricDeltas,
        ).catch(() => {});
      }
      throw error;
    }
    const summary = extensionPage.locator("#fill-summary");
    checkpoint(`${stage}_summary_wait`);
    const waitForSummary = () =>
      poll(
        async () => ({
          resultsVisible: await extensionPage.locator("#fill-results").isVisible(),
          summaryVisible: await summary.isVisible(),
          summary: await summary.innerText().catch(() => ""),
          errorVisible: await mainError.isVisible(),
        }),
        (state) =>
          state.resultsVisible &&
          state.summaryVisible &&
          state.summary.startsWith("Verified 0; 1 setter attempts remain unverified.") &&
          !state.errorVisible,
        `${label.toLowerCase()}_fill_summary`,
        30_000,
      );
    if (stage === "contract_fill") {
      try {
        await waitForSummary();
      } catch (error) {
        await emitContractFillSummaryDiagnostic(targetPage).catch(() => {});
        throw error;
      }
    } else {
      await waitForSummary();
    }
    const filledValue = await targetPage.locator(`#${selectorId}`).inputValue();
    assert(filledValue === "9999999995", "M64_BROWSER_SYNTHETIC_FORM_FILL_MISMATCH");
    return summary;
  };

  await fillOnBoundWork(boundWork.boundTabId, portalPage, "contract-npi", "Contract");
  assert(
    (await portalPage.locator("#enrollment-npi").inputValue()) === "",
    "M64_BROWSER_CONTRACT_FILL_CHANGED_ENROLLMENT_CONTROL",
  );
  assert(
    await extensionPage.locator("#mark-submitted").evaluate((button) => button.hidden),
    "M64_BROWSER_CONTRACT_SUBMISSION_CONTROL_VISIBLE",
  );
  await assertWorkRecord(boundWork, contractEvidence, "contract");
  await assertPayerTabActive(boundWork.boundTabId);

  checkpoint("contract_fill");
  safeLog("M64|BROWSER|DB_CHECKPOINT|CONTRACT_FILL_COMPLETE");
  await waitForDbAck("CONTRACT_RESET_COMPLETE");

  checkpoint("stale_fill");
  await assertWorkRecord(boundWork, contractEvidence, "contract");
  await assertPayerTabActive(boundWork.boundTabId);
  await waitForFillReady(
    "stale_contract_fill_button",
    "stale_fill",
    boundWork,
    boundWork.boundTabId,
    portalPage,
  );
  const staleValidationBefore = routeCount("panel.work_validate", 409);
  const fillEventsBefore = routeTotal("panel.fill_events");
  const staleFormBefore = {
    contractValue: await portalPage.locator("#contract-npi").inputValue(),
    enrollmentValue: await portalPage.locator("#enrollment-npi").inputValue(),
  };
  await bounded(
    () => fillButton.click({ timeout: 10_000 }),
    15_000,
    "M64_BROWSER_STALE_FILL_FAILED",
  );
  await poll(
    () => routeCount("panel.work_validate", 409),
    (count) => count > staleValidationBefore,
    "stale_contract_work_validation_rejection",
    45_000,
  );
  assert(
    routeTotal("panel.fill_events") === fillEventsBefore,
    "M64_BROWSER_STALE_FILL_API_REQUESTED",
  );
  await poll(() => mainError.isVisible(), Boolean, "stale_contract_fill_error", 20_000);
  const staleFormAfter = {
    contractValue: await portalPage.locator("#contract-npi").inputValue(),
    enrollmentValue: await portalPage.locator("#enrollment-npi").inputValue(),
  };
  assert(
    staleFormAfter.contractValue === staleFormBefore.contractValue &&
      staleFormAfter.enrollmentValue === staleFormBefore.enrollmentValue &&
      (await portalPage.locator("form, button, input[type=submit]").count()) === 0,
    "M64_BROWSER_STALE_FILL_MUTATED_FORM",
  );

  checkpoint("enrollment_ui");
  const enrollmentTaskTitle = panelOrgName.replace(/ Organization$/, " Enrollment Steps");
  assert(
    /^E612 M64 [a-f0-9]{16} Enrollment Steps$/.test(enrollmentTaskTitle),
    "M64_BROWSER_ENROLLMENT_TASK_TITLE_INVALID",
  );
  checkpoint("enrollment_ui_case_document");
  await panelPage.goto(`${PANEL_ORIGIN}/cases/${ENROLLMENT_CASE_ID}`, {
    waitUntil: "domcontentloaded",
  });
  checkpoint("enrollment_ui_task_row");
  await poll(
    () => panelPage.getByText(enrollmentTaskTitle, { exact: true }).count(),
    (count) => count === 1,
    "enrollment_task_loaded",
    30_000,
  );
  const openStep = panelPage.getByRole("button", { name: "Open step", exact: true });
  checkpoint("enrollment_ui_open_step");
  await poll(
    () => openStep.count(),
    (count) => count === 1,
    "enrollment_open_step_ready",
  );
  await openStep.click();
  const taskDialog = panelPage.getByRole("dialog");
  checkpoint("enrollment_ui_task_dialog");
  await taskDialog.getByRole("heading", { name: enrollmentTaskTitle, exact: true }).waitFor({
    state: "visible",
  });
  assert(
    await taskDialog.getByText("First form", { exact: true }).isVisible(),
    "M64_BROWSER_ENROLLMENT_STEP_NOT_SELECTED",
  );
  const enrollmentLaunch = taskDialog.getByRole("button", {
    name: "Work in portal",
    exact: true,
  });
  checkpoint("enrollment_ui_launch_ready");
  await poll(() => enrollmentLaunch.isEnabled(), Boolean, "enrollment_work_launch_ready");
  const pagesBeforeEnrollmentLaunch = new Set(context.pages());
  const validationCountBeforeEnrollment = workValidationSuccesses.length;
  checkpoint("enrollment_ui_launch_click");
  await enrollmentLaunch.click();
  checkpoint("enrollment_ui_work_validation");
  const enrollmentValidation = await poll(
    () =>
      workValidationSuccesses
        .slice(validationCountBeforeEnrollment)
        .find(
          ({ tuple }) =>
            tuple.ownerKind === "case" &&
            tuple.ownerId === ENROLLMENT_CASE_ID &&
            tuple.portalId === ENROLLMENT_PORTAL_ID &&
            tuple.portalKey === "m64_enrollment",
        ) ?? null,
    Boolean,
    "enrollment_exact_work_validation",
  );
  checkpoint("enrollment_ui_portal_tab");
  const enrollmentPages = await poll(
    () =>
      context
        .pages()
        .filter((page) => !pagesBeforeEnrollmentLaunch.has(page) && page.url() === PORTAL_URL),
    (pages) => pages.length === 1,
    "synthetic_enrollment_tab",
  );
  const [enrollmentPortalPage] = enrollmentPages;
  const enrollmentEvidence = evidenceFor(enrollmentValidation);
  assert(
    enrollmentValidation.tuple.ownerKind === "case" &&
      enrollmentValidation.tuple.ownerId === ENROLLMENT_CASE_ID &&
      enrollmentValidation.tuple.portalId === ENROLLMENT_PORTAL_ID &&
      enrollmentValidation.tuple.portalKey === "m64_enrollment" &&
      enrollmentValidation.tuple.taskId === ENROLLMENT_TASK_ID &&
      enrollmentValidation.tuple.stepId === ENROLLMENT_STEP1_ID &&
      enrollmentValidation.tuple.mappingGeneration === 1 &&
      enrollmentValidation.effectiveMappingFingerprint !== validation.effectiveMappingFingerprint &&
      enrollmentPortalPage.url() === PORTAL_URL,
    "M64_BROWSER_ENROLLMENT_WORK_BINDING_MISMATCH",
  );
  checkpoint("enrollment_ui_work_binding");
  const enrollmentWork = await readActiveWork();
  assert(
    enrollmentWork?.boundTabId != null &&
      enrollmentWork.tuple?.taskId === ENROLLMENT_TASK_ID &&
      enrollmentWork.tuple?.stepId === ENROLLMENT_STEP1_ID,
    "M64_BROWSER_ENROLLMENT_WORK_BINDING_MISMATCH",
  );
  enrollmentEvidence.protocolVersion = enrollmentWork.tuple.protocolVersion;
  await assertWorkRecord(enrollmentWork, enrollmentEvidence, "enrollment");
  await assertPayerTabActive(enrollmentWork.boundTabId);
  assert(
    (await enrollmentPortalPage.locator("form, button, input[type=submit]").count()) === 0,
    "M64_BROWSER_SYNTHETIC_FORM_HAS_SUBMIT_CONTROL",
  );

  await fillOnBoundWork(
    enrollmentWork.boundTabId,
    enrollmentPortalPage,
    "enrollment-npi",
    "Enrollment",
  );
  assert(
    (await enrollmentPortalPage.locator("#contract-npi").inputValue()) === "" &&
      (await enrollmentPortalPage.locator("#enrollment-npi").inputValue()) === "9999999995" &&
      (await portalPage.locator("#contract-npi").inputValue()) === "9999999995",
    "M64_BROWSER_TYPED_KEY_FILL_ISOLATION_FAILED",
  );
  const pinnedStep = extensionPage.locator("#task-link-single");
  await poll(
    async () =>
      (await pinnedStep.isVisible()) &&
      (await pinnedStep.innerText()) === "This fill is pinned to First form.",
    Boolean,
    "enrollment_exact_step_receipt_visible",
  );
  const markSubmitted = extensionPage.locator("#mark-submitted");
  assert(
    (await markSubmitted.isVisible()) &&
      !(await markSubmitted.isDisabled()) &&
      (await enrollmentPortalPage.locator("form, button, input[type=submit]").count()) === 0,
    "M64_BROWSER_ENROLLMENT_HUMAN_SUBMISSION_CONTROL_INVALID",
  );

  checkpoint("submission");
  const touchesBeforeSubmission = routeTotal("panel.case_touches");
  await markSubmitted.click();
  await poll(
    () => routeTotal("panel.case_touches"),
    (count) => count > touchesBeforeSubmission,
    "enrollment_submission_api",
    45_000,
  );
  await poll(
    async () =>
      (await extensionPage.locator("#submit-status").isVisible()) &&
      (await markSubmitted.evaluate((button) => button.hidden)),
    Boolean,
    "enrollment_submission_receipt_ui",
    30_000,
  );
  await assertWorkRecord(enrollmentWork, enrollmentEvidence, "enrollment");
  await assertPayerTabActive(enrollmentWork.boundTabId);

  const panelRequiredPermission = await extensionPage.evaluate(
    (origin) => chrome.permissions.contains({ origins: [origin] }),
    `${PANEL_ORIGIN}/*`,
  );
  assert(panelRequiredPermission, "M64_BROWSER_PANEL_REQUIRED_PERMISSION_MISSING");
  return {
    contractValidations: [contractEvidence],
    enrollmentValidations: [enrollmentEvidence],
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
        const isFillEventsEndpoint = hostHeader === PANEL_HOST && pathname === "/api/fill-events";
        if (isFillEventsEndpoint && method === "POST") {
          count("panel.fill_events_post_seen", 0);
        }
        if (isFillEventsEndpoint && method === "OPTIONS") {
          count("panel.fill_events_options_seen", 0);
        }
        const route = routeFor(hostHeader, method, pathname, requestTarget, request.headers);
        if (!route) {
          countDeniedSupabaseOptions(hostHeader, method, pathname);
          reportDeniedProviderRoster(hostHeader, method, pathname, requestTarget, request.headers);
          countDeniedEnrollmentProfileTarget(hostHeader, method, pathname, requestTarget);
          if (isFillEventsEndpoint && method === "POST") {
            count("panel.fill_events_post_denied", 404);
          }
          if (isFillEventsEndpoint && method === "OPTIONS") {
            count("panel.fill_events_options_denied", 404);
          }
          unexpected(
            response,
            classifyDenied(hostHeader, method, pathname),
            classifyAuthPreflightDenialReason(
              hostHeader,
              method,
              pathname,
              requestTarget,
              request.headers,
            ),
          );
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
          serveSupabasePreflight(response, route);
          return;
        }
        if (route.name === "panel.fill_events") {
          if (method === "POST") count("panel.fill_events_post_admitted", 0);
          if (method === "OPTIONS") {
            count("panel.fill_events_options", 0);
            count("panel.fill_events_options_admitted", 0);
          }
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
  extensionIdObserved = extensionId;
  assertM64ProviderReadPolicy();
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
    portalUrl: PORTAL_URL,
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
    .filter((page) => page.url().startsWith(`${PANEL_ORIGIN}${PORTAL_PATH}`));
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

  const vertical = await panelContractPermissionProbe(extensionPage, extensionId);
  assert(unexpectedRoutes === 0, `M64_BROWSER_DENIED_${firstDeniedCategory ?? "UNKNOWN_HOST"}`);
  safeLog(
    "M64|BROWSER|VERTICAL|PASS|static_host=true|optional_host_consent=unverified|contract_fill_receipt=true|enrollment_fill_receipt=true|selected_step_submission=true|selected_key_reset=true|stale_fill_rejected=true",
  );
  safeLog(
    `M64_RESULT|${Buffer.from(
      JSON.stringify({
        extensionId,
        panelClientSha256,
        contractValidations: vertical.contractValidations,
        enrollmentValidations: vertical.enrollmentValidations,
      }),
    ).toString("base64url")}`,
  );
}

try {
  await run();
} catch (error) {
  driverFailed = true;
  if (currentStage === "contract_ui" || CONTRACT_UI_CHECKPOINTS.includes(currentStage)) {
    reportContractUiRouteDiagnostic();
  }
  if (currentStage === "enrollment_ui" || ENROLLMENT_UI_CHECKPOINTS.includes(currentStage)) {
    const taskTitle =
      typeof panelOrgName === "string"
        ? panelOrgName.replace(/ Organization$/, " Enrollment Steps")
        : "";
    await reportEnrollmentUiDiagnostic(panelPage, ENROLLMENT_CASE_ID, taskTitle).catch(() => {});
  }
  const code =
    currentStage === "panel_login_route_denied" &&
    lastDeniedCategory === "SUPABASE_OPTIONS_AUTH" &&
    lastDeniedReason
      ? `M64_BROWSER_DENIED_SUPABASE_OPTIONS_AUTH_REASON_${lastDeniedReason}`
      : currentStage === "panel_login_route_denied" && lastDeniedCategory
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
