// E6.13 native SQL evidence. Runs the real migrations and role/RLS/RPC checks
// in a fresh local PostgreSQL container with synthetic data only. This is not
// HTTP, Storage, hosted-database, or application-route evidence.
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  E612,
  USERS,
  asRole,
  baseFixtureSql,
  claims,
  restrictedFixtureSql,
  sqlLiteral,
} from "./e612-fixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const context = process.env.E613_DOCKER_CONTEXT || "default";
const image = process.env.E613_POSTGRES_IMAGE || "postgres:16";
const e612Migration = "20260925035408_e612_client_access_context.sql";
const e613Migration = "20260925190537_enrollment_explorer_scope_contract.sql";
const container = `minted-e613-native-${randomUUID()}`;
const env = Object.fromEntries(
  ["PATH", "HOME", "DOCKER_CONFIG", "LANG"].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]]] : [],
  ),
);
const options = { env, encoding: "utf8", timeout: 600_000, maxBuffer: 64 * 1024 * 1024 };
const emit = (line) => process.stdout.write(`${line}\n`);
const fail = (code) => {
  throw new Error(code);
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const migrationSlug = (name) => name.replaceAll(/[^A-Za-z0-9]+/g, "_");
const sqlState = (text) =>
  text.match(/(?:ERROR|SQLSTATE|SQL state)[: ]+([A-Z0-9]{5})/i)?.[1]?.toUpperCase() ?? null;

const contextInfo = JSON.parse(
  execFileSync("docker", ["--context", context, "context", "inspect", context], options),
)[0];
const endpoint = contextInfo?.Endpoints?.docker?.Host;
if (typeof endpoint !== "string" || !endpoint.startsWith("unix://"))
  fail("E613_LOCAL_DOCKER_CONTEXT_REQUIRED");

function docker(args, input) {
  return execFileSync("docker", ["--context", context, ...args], {
    ...options,
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

const psqlArgs = [
  "exec",
  "-i",
  container,
  "psql",
  "-X",
  "-qAt",
  "-h",
  "/tmp",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-v",
  "ON_ERROR_STOP=1",
  "-v",
  "VERBOSITY=verbose",
];
const argsAs = (role) =>
  psqlArgs.map((arg, index) => (index === psqlArgs.indexOf("postgres") ? role : arg));
const sql = (input) => docker(psqlArgs, input);
function runAs(role, input) {
  const startedAt = Date.now();
  try {
    return {
      ok: true,
      out: docker(argsAs(role), input),
      err: "",
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      out: String(error.stdout ?? ""),
      err: String(error.stderr ?? ""),
      status: Number.isInteger(error.status) ? error.status : null,
      signal: typeof error.signal === "string" ? error.signal : null,
      code: typeof error.code === "string" ? error.code : null,
      elapsedMs: Date.now() - startedAt,
    };
  }
}

function expectedSqlError(label, statement, expectedStates, expectedMessage) {
  const result = runAs("postgres", statement);
  if (result.ok) fail(`E613_EXPECTED_SQL_ERROR_MISSING_${migrationSlug(label)}`);
  const state = sqlState(`${result.out}\n${result.err}`);
  if (!state || !expectedStates.includes(state))
    fail(`E613_SQLSTATE_MISMATCH_${migrationSlug(label)}_${state ?? "MISSING"}`);
  if (expectedMessage && !`${result.out}\n${result.err}`.includes(expectedMessage))
    fail(`E613_SQL_ERROR_MESSAGE_MISMATCH_${migrationSlug(label)}`);
  emit(`E613|PASS|${label}|sqlstate=${state}`);
}

function expectedServiceError(label, actorId, statement, expectedState, message) {
  const result = runAs("postgres", asRole("service_role", actorId, statement));
  if (result.ok) fail(`E613_EXPECTED_SERVICE_ERROR_MISSING_${migrationSlug(label)}`);
  const output = `${result.out}\n${result.err}`;
  const state = sqlState(output);
  if (state !== expectedState) {
    const outcome = [
      `STATUS_${result.status ?? "NONE"}`,
      `SIGNAL_${result.signal ?? "NONE"}`,
      `CODE_${result.code ?? "NONE"}`,
      `MS_${result.elapsedMs}`,
    ].join("_");
    fail(`E613_SERVICE_SQLSTATE_MISMATCH_${migrationSlug(label)}_${state ?? "MISSING"}_${outcome}`);
  }
  if (message && !output.includes(message))
    fail(`E613_SERVICE_ERROR_MESSAGE_MISMATCH_${migrationSlug(label)}`);
  emit(`E613|PASS|${label}|sqlstate=${state}`);
}

function query(statement) {
  return sql(statement).trim();
}

function callJson(actorId, statement) {
  const raw = query(asRole("service_role", actorId, statement));
  try {
    return JSON.parse(raw);
  } catch {
    fail("E613_RPC_JSON_INVALID");
  }
}

const typed = (value, type) => `${sqlLiteral(value)}::${type}`;
const jsonArg = (value) => typed(JSON.stringify(value), "jsonb");
const textArray = (values) =>
  `ARRAY[${values.map((value) => typed(value, "text")).join(", ")}]::text[]`;
function saveCall({
  actorId = E612.admin,
  orgId = E612.orgA,
  audience = "staff",
  scopeId = null,
  expectedRevisionId = null,
  providerId = E612.provider,
  groupId = E612.groupA1,
  payerProductId,
  facilityId = FIX.facilityA1,
  state = "CO",
  revision,
  sources = [],
}) {
  if (!payerProductId || !revision) fail("E613_SAVE_CALL_MISSING_ARGUMENT");
  return `public.save_enrollment_revision(
    ${typed(actorId, "uuid")}, ${typed(orgId, "uuid")}, ${typed(audience, "text")},
    ${typed(scopeId, "uuid")}, ${typed(expectedRevisionId, "uuid")},
    ${typed(providerId, "uuid")}, ${typed(groupId, "uuid")},
    ${typed(payerProductId, "uuid")}, ${typed(facilityId, "uuid")},
    ${typed(state, "text")}, ${jsonArg(revision)}, ${jsonArg(sources)}
  )`;
}

const revision = (
  status,
  { owner = "Payer", note = "e613-native", blocker = "Waiting on payer", ...rest } = {},
) => ({
  status,
  intakeDate: "2026-01-02",
  completeToSubmitDate: null,
  submittedDate: status === "submitted" || status === "approved" ? "2026-01-20" : null,
  payerAcknowledgedDate: status === "approved" ? "2026-01-22" : null,
  approvedDate: status === "approved" ? "2026-02-01" : null,
  effectiveDate: status === "approved" ? "2026-02-15" : null,
  terminationDate: null,
  payerReference: status === "approved" ? "E613-VERIFIED-REF" : null,
  clientSafeBlocker: blocker,
  owner,
  retroStatus: "unknown",
  retroDays: null,
  retroDate: null,
  retroBasis: null,
  staffNote: note,
  observedAt: "2026-02-16T12:00:00.000Z",
  ...rest,
});

function productFor(actorId, orgId, payerId, productKey) {
  return jsonResult(
    "product_curation",
    callJson(
      actorId,
      `SELECT public.curate_enrollment_payer_product(
        ${typed(actorId, "uuid")}, ${typed(orgId, "uuid")}, 'staff',
        ${typed(payerId, "uuid")}, ${typed(productKey, "text")},
        'E613 Curated Product', true);`,
    ),
  ).productId;
}

function setTarget(actorId, orgId, groupId, payerProductId, state) {
  return jsonResult(
    "target_set",
    callJson(
      actorId,
      `SELECT public.set_enrollment_group_product_target(
        ${typed(actorId, "uuid")}, ${typed(orgId, "uuid")}, 'staff',
        ${typed(groupId, "uuid")}, ${typed(payerProductId, "uuid")},
        ${typed(state, "text")}, true);`,
    ),
  );
}

function unresolvedPage(
  actorId,
  orgId = E612.orgA,
  audience = "staff",
  groupId = E612.groupA1,
  cursor = null,
  limit = 100,
) {
  const cursorArg = cursor === null ? "NULL::jsonb" : jsonArg(cursor);
  return jsonResult(
    "unresolved_page",
    callJson(
      actorId,
      `SELECT public.get_enrollment_unresolved_page(
        ${typed(actorId, "uuid")}, ${typed(orgId, "uuid")}, ${typed(audience, "text")},
        ${typed(groupId, "uuid")}, ${cursorArg}, ${typed(limit, "integer")});`,
    ),
  );
}

function detail(actorId, scopeId, audience = "staff", orgId = E612.orgA) {
  return callJson(
    actorId,
    `SELECT public.get_enrollment_scope_detail(
      ${typed(actorId, "uuid")}, ${typed(orgId, "uuid")}, ${typed(audience, "text")}, ${typed(scopeId, "uuid")});`,
  );
}

function sourceFingerprint(actorId, sourceKind, sourceId) {
  return query(
    asRole(
      "service_role",
      actorId,
      `SELECT private.e613_source_fingerprint(private.e613_source_snapshot(
      ${typed(sourceKind, "text")}, ${typed(sourceId, "uuid")}));`,
    ),
  );
}

function auditCount(scopeId) {
  return Number(
    query(
      `SELECT count(*) FROM public.audit_log WHERE entity_type = 'enrollment_scope' AND entity_id = '${scopeId}';`,
    ),
  );
}

function scopeState(orgId = E612.orgA) {
  return query(`
    SELECT (SELECT count(*) FROM private.enrollment_scopes WHERE org_id = '${orgId}')::text || '|' ||
           (SELECT count(*) FROM private.enrollment_scope_revisions WHERE org_id = '${orgId}')::text || '|' ||
           (SELECT count(*) FROM private.enrollment_scope_sources WHERE org_id = '${orgId}')::text || '|' ||
           (SELECT count(*) FROM public.audit_log WHERE org_id = '${orgId}' AND entity_type = 'enrollment_scope')::text;
  `);
}

function pageItem(page, sourceKind, sourceId) {
  if (!Array.isArray(page.items)) fail("E613_UNRESOLVED_ITEMS_MISSING");
  const item = page.items.find((row) => row.sourceKind === sourceKind && row.sourceId === sourceId);
  if (!item) fail(`E613_UNRESOLVED_SOURCE_MISSING_${sourceKind}_${sourceId.slice(-4)}`);
  if (!/^[a-f0-9]{64}$/.test(item.sourceFingerprint ?? ""))
    fail(`E613_UNRESOLVED_SOURCE_FINGERPRINT_INVALID_${sourceKind}`);
  return item;
}

function assertListContains(label, values, expected) {
  if (!Array.isArray(values) || !values.includes(expected)) fail(`E613_${migrationSlug(label)}`);
  emit(`E613|PASS|${label}`);
}

function assertAbsent(label, value, key) {
  if (value && Object.hasOwn(value, key)) fail(`E613_${migrationSlug(label)}`);
  emit(`E613|PASS|${label}`);
}

function rpc(actorId, method, args) {
  const params = [
    typed(actorId, "uuid"),
    typed(args.orgId ?? E612.orgA, "uuid"),
    typed(args.audience ?? "staff", "text"),
  ];
  const suffix =
    method === "publish_enrollment_summary"
      ? [typed(args.scopeId, "uuid"), typed(args.revisionId, "uuid")]
      : method === "get_enrollment_scope_detail"
        ? [typed(args.scopeId, "uuid")]
        : method === "get_enrollment_proof_capture_target"
          ? [
              typed(args.scopeId, "uuid"),
              typed(args.revisionId, "uuid"),
              typed(args.documentId, "uuid"),
            ]
          : method === "publish_enrollment_proof"
            ? [
                typed(args.scopeId, "uuid"),
                typed(args.revisionId, "uuid"),
                typed(args.documentId, "uuid"),
                typed(args.evidenceKind, "text"),
                textArray(args.supportedFields),
                typed(args.sha256, "text"),
                typed(args.reason ?? "Native proof fixture", "text"),
              ]
            : method === "authorize_enrollment_proof_download"
              ? [typed(args.publicationId, "uuid")]
              : method === "record_enrollment_proof_download"
                ? [
                    typed(args.publicationId, "uuid"),
                    typed(args.documentId, "uuid"),
                    typed(args.sha256, "text"),
                  ]
                : method === "revoke_enrollment_publication"
                  ? [
                      typed(args.publicationId, "uuid"),
                      typed(args.reason ?? "Native verifier", "text"),
                    ]
                  : null;
  if (!suffix) fail(`E613_RPC_HELPER_UNSUPPORTED_${method}`);
  return callJson(actorId, `SELECT public.${method}(${[...params, ...suffix].join(", ")});`);
}

function jsonResult(label, value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`E613_${migrationSlug(label)}_NOT_JSON_OBJECT`);
  return value;
}

const e613Tables = [
  "payer_products",
  "group_product_targets",
  "enrollment_scopes",
  "enrollment_scope_revisions",
  "enrollment_scope_sources",
  "enrollment_summary_publications",
  "enrollment_proof_publications",
  "publication_events",
];
const e613RpcNames = [
  "curate_enrollment_payer_product",
  "get_enrollment_catalog",
  "get_enrollment_proof_capture_target",
  "set_enrollment_group_product_target",
  "save_enrollment_revision",
  "get_enrollment_unresolved_page",
  "get_enrollment_scope_detail",
  "publish_enrollment_summary",
  "publish_enrollment_proof",
  "revoke_enrollment_publication",
  "authorize_enrollment_proof_download",
  "record_enrollment_proof_download",
];
const FIX = Object.freeze({
  providerA2: "70000000-0000-4000-8000-000000000021",
  providerB1: "70000000-0000-4000-8000-000000000022",
  payerA: "90000000-0000-4000-8000-000000000001",
  payerB: "90000000-0000-4000-8000-000000000002",
  facilityA1: "90000000-0000-4000-8000-000000000011",
  facilityA2: "90000000-0000-4000-8000-000000000012",
  facilityB1: "90000000-0000-4000-8000-000000000013",
  caseA: "a0000000-0000-4000-8000-000000000001",
  caseB: "a0000000-0000-4000-8000-000000000002",
  factA: "a0000000-0000-4000-8000-000000000003",
  factExpired: "a0000000-0000-4000-8000-000000000004",
  factLinked: "a0000000-0000-4000-8000-000000000005",
  factCaseB: "a0000000-0000-4000-8000-000000000006",
  documentA: "b0000000-0000-4000-8000-000000000001",
  documentB: "b0000000-0000-4000-8000-000000000002",
  documentWrongOwner: "b0000000-0000-4000-8000-000000000003",
  documentFact: "b0000000-0000-4000-8000-000000000004",
  documentSuperseded: "b0000000-0000-4000-8000-000000000005",
  documentSuperseding: "b0000000-0000-4000-8000-000000000006",
});

function seedDomainFixtures() {
  query(`
    INSERT INTO public.payers
      (id, org_id, name, is_active, payer_kind, payer_slug, states, status)
    VALUES ('${FIX.payerA}', '${E612.orgA}', 'E613 Synthetic Payer A', true, 'commercial',
            'e613-synthetic-payer-a', ARRAY['CO','AZ','UT']::text[], 'active'),
           ('${FIX.payerB}', '${E612.orgB}', 'E613 Synthetic Payer B', true, 'commercial',
            'e613-synthetic-payer-b', ARRAY['CO']::text[], 'active');
    INSERT INTO public.facilities (id, org_id, group_id, name, state)
    VALUES ('${FIX.facilityA1}', '${E612.orgA}', '${E612.groupA1}', 'E613 Facility A1', 'CO'),
           ('${FIX.facilityA2}', '${E612.orgA}', '${E612.groupA1}', 'E613 Facility A2', 'CO'),
           ('${FIX.facilityB1}', '${E612.orgB}', '${E612.groupB1}', 'E613 Facility B1', 'CO');
    INSERT INTO public.providers (id, org_id, group_id, first_name, last_name, email, status)
    VALUES ('${FIX.providerA2}', '${E612.orgA}', '${E612.groupA1}', 'E613', 'Provider A2', 'e613-provider-a2@test.invalid', 'active'),
           ('${FIX.providerB1}', '${E612.orgB}', '${E612.groupB1}', 'E613', 'Provider B1', 'e613-provider-b1@test.invalid', 'active');
    INSERT INTO public.provider_group_assignments (org_id, provider_id, group_id, is_primary)
    VALUES ('${E612.orgA}', '${E612.provider}', '${E612.groupA1}', true),
           ('${E612.orgA}', '${FIX.providerA2}', '${E612.groupA1}', true),
           ('${E612.orgA}', '${FIX.providerA2}', '${E612.groupA2}', false),
           ('${E612.orgB}', '${FIX.providerB1}', '${E612.groupB1}', true);
    INSERT INTO public.provider_facility_assignments (org_id, provider_id, facility_id, is_primary, start_date)
    VALUES ('${E612.orgA}', '${E612.provider}', '${FIX.facilityA1}', true, '2025-01-01'),
           ('${E612.orgA}', '${E612.provider}', '${FIX.facilityA2}', false, '2025-01-01'),
           ('${E612.orgA}', '${FIX.providerA2}', '${FIX.facilityA2}', true, '2025-01-01'),
           ('${E612.orgB}', '${FIX.providerB1}', '${FIX.facilityB1}', true, '2025-01-01');
    INSERT INTO public.credential_cases
      (id, org_id, provider_id, group_id, facility_id, payer_id, state, case_status,
       submitted_date, approved_date, confirmed_effective_date, expected_effective_date,
       termination_date, payer_reference_id, payer_individual_provider_id,
       payer_group_provider_id, contract_executed_date, created_by)
    VALUES
      ('${FIX.caseA}', '${E612.orgA}', '${E612.provider}', '${E612.groupA1}', '${FIX.facilityA1}',
       '${FIX.payerA}', 'CO', 'approved', '2026-01-05', '2026-02-01', '2026-02-15', '2026-02-10',
       NULL, 'E613-CASE-REF-A', 'E613-TYPE1-A', 'E613-TYPE2-A', '2026-01-20', '${E612.admin}'),
      ('${FIX.caseB}', '${E612.orgA}', '${FIX.providerA2}', '${E612.groupA1}', '${FIX.facilityA2}',
       '${FIX.payerA}', 'AZ', 'in_review', '2026-03-05', NULL, NULL, NULL, NULL,
       'E613-CASE-REF-B', NULL, NULL, NULL, '${E612.specialist}');
    INSERT INTO public.case_facilities (org_id, case_id, facility_id, is_primary, created_by)
    VALUES ('${E612.orgA}', '${FIX.caseA}', '${FIX.facilityA1}', true, '${E612.admin}'),
           ('${E612.orgA}', '${FIX.caseA}', '${FIX.facilityA2}', false, '${E612.admin}'),
           ('${E612.orgA}', '${FIX.caseB}', '${FIX.facilityA2}', true, '${E612.specialist}');
    INSERT INTO public.enrollment_facts
      (id, org_id, provider_id, group_id, payer_id, state, effective_date, payer_issued_id, created_by)
    VALUES ('${FIX.factA}', '${E612.orgA}', '${FIX.providerA2}', '${E612.groupA1}', '${FIX.payerA}',
            'CO', '2025-11-01', 'E613-FACT-LIVE', '${E612.specialist}'),
           ('${FIX.factExpired}', '${E612.orgA}', '${FIX.providerA2}', '${E612.groupA1}', '${FIX.payerA}',
            'UT', '2025-08-01', 'E613-FACT-EXPIRED', '${E612.specialist}'),
           ('${FIX.factLinked}', '${E612.orgA}', '${E612.provider}', '${E612.groupA1}', '${FIX.payerA}',
            'CO', '2025-12-01', 'E613-FACT-LINKED', '${E612.specialist}'),
           ('${FIX.factCaseB}', '${E612.orgA}', '${FIX.providerA2}', '${E612.groupA1}', '${FIX.payerA}',
            'AZ', '2025-12-15', 'E613-FACT-CASE-B', '${E612.specialist}');
    UPDATE public.enrollment_facts SET expired_at = now() - interval '1 day', expired_by = '${E612.admin}'
      WHERE id = '${FIX.factExpired}';
    INSERT INTO public.provider_documents
      (id, org_id, provider_id, doc_type, file_path, file_name, expiration_date, uploaded_by)
    VALUES ('${FIX.documentA}', '${E612.orgA}', '${E612.provider}', 'filled_form',
            'e613/synthetic/document-a', 'E613 synthetic proof A.pdf', '2027-12-31', '${E612.admin}'),
           ('${FIX.documentB}', '${E612.orgB}', '${FIX.providerB1}', 'filled_form',
            'e613/synthetic/document-b', 'E613 synthetic proof B.pdf', '2027-12-31', '${E612.orgBAdmin}'),
           ('${FIX.documentWrongOwner}', '${E612.orgA}', '${FIX.providerA2}', 'filled_form',
            'e613/synthetic/document-wrong-owner', 'E613 wrong owner.pdf', '2027-12-31', '${E612.admin}'),
           ('${FIX.documentFact}', '${E612.orgA}', '${FIX.providerA2}', 'filled_form',
            'e613/synthetic/document-fact', 'E613 synthetic fact proof.pdf', '2027-12-31', '${E612.admin}');
    INSERT INTO public.provider_documents
      (id, org_id, provider_id, doc_type, file_path, file_name, expiration_date, uploaded_by)
    VALUES ('${FIX.documentSuperseded}', '${E612.orgA}', '${E612.provider}', 'filled_form',
            'e613/synthetic/document-superseded', 'E613 superseded proof.pdf', '2027-12-31', '${E612.admin}');
    INSERT INTO public.provider_documents
      (id, org_id, provider_id, doc_type, file_path, file_name, expiration_date, uploaded_by, supersedes_document_id)
    VALUES ('${FIX.documentSuperseding}', '${E612.orgA}', '${E612.provider}', 'filled_form',
            'e613/synthetic/document-successor', 'E613 successor proof.pdf', '2027-12-31', '${E612.admin}', '${FIX.documentSuperseded}');
  `);
  emit("E613|PASS|fixtures.same_org_cross_org_sources_and_assignments");
}

function catalogChecks() {
  const tableRows = query(`
    SELECT c.relname || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity || '|' ||
           has_table_privilege('anon', c.oid, 'SELECT') || '|' ||
           has_table_privilege('authenticated', c.oid, 'SELECT') || '|' ||
           has_table_privilege('service_role', c.oid, 'SELECT')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'private' AND c.relkind = 'r'
       AND c.relname = ANY (${sqlLiteral(`{${e613Tables.join(",")}}`)}::text[])
     ORDER BY c.relname;
  `)
    .split("\n")
    .filter(Boolean);
  if (tableRows.length !== e613Tables.length) fail("E613_PRIVATE_TABLE_SET_DRIFT");
  for (const row of tableRows) {
    const [name, rls, force, anonSelect, authSelect, serviceSelect] = row.split("|");
    if (
      rls !== "true" ||
      force !== "true" ||
      anonSelect !== "false" ||
      authSelect !== "false" ||
      serviceSelect !== "true"
    )
      fail(`E613_PRIVATE_TABLE_ACL_RLS_${name}`);
  }
  assertEqual(
    "catalog.private_tables_rls_and_service_acl",
    query(
      `SELECT has_schema_privilege('anon','private','USAGE') || '|' || has_schema_privilege('authenticated','private','USAGE') || '|' || has_schema_privilege('service_role','private','USAGE');`,
    ),
    "false|false|true",
  );
  emit("E613|PASS|catalog.all_private_tables_forced_rls");

  const rpcRows = query(`
    SELECT p.proname || '|' || pg_get_function_identity_arguments(p.oid) || '|' ||
           pg_get_function_result(p.oid) || '|' || p.prosecdef || '|' ||
           has_function_privilege('public', p.oid, 'EXECUTE') || '|' ||
           has_function_privilege('anon', p.oid, 'EXECUTE') || '|' ||
           has_function_privilege('authenticated', p.oid, 'EXECUTE') || '|' ||
           has_function_privilege('service_role', p.oid, 'EXECUTE')
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY (${sqlLiteral(`{${e613RpcNames.join(",")}}`)}::text[])
     ORDER BY p.proname;
  `)
    .split("\n")
    .filter(Boolean);
  const normalize = (row) => row.replace(/\bp_[a-z0-9_]+ /g, "");
  const actual = new Set(rpcRows.map(normalize));
  const expected = new Set([
    "curate_enrollment_payer_product|uuid, uuid, text, uuid, text, text, boolean|jsonb|false|false|false|false|true",
    "get_enrollment_catalog|uuid, uuid, text, uuid|jsonb|false|false|false|false|true",
    "get_enrollment_proof_capture_target|uuid, uuid, text, uuid, uuid, uuid|jsonb|false|false|false|false|true",
    "record_enrollment_proof_download|uuid, uuid, text, uuid, uuid, text|jsonb|false|false|false|false|true",
    "set_enrollment_group_product_target|uuid, uuid, text, uuid, uuid, text, boolean|jsonb|false|false|false|false|true",
    "save_enrollment_revision|uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb|jsonb|false|false|false|false|true",
    "get_enrollment_unresolved_page|uuid, uuid, text, uuid, jsonb, integer|jsonb|false|false|false|false|true",
    "get_enrollment_scope_detail|uuid, uuid, text, uuid|jsonb|false|false|false|false|true",
    "publish_enrollment_summary|uuid, uuid, text, uuid, uuid|jsonb|false|false|false|false|true",
    "publish_enrollment_proof|uuid, uuid, text, uuid, uuid, uuid, text, text[], text, text|jsonb|false|false|false|false|true",
    "revoke_enrollment_publication|uuid, uuid, text, uuid, text|jsonb|false|false|false|false|true",
    "authorize_enrollment_proof_download|uuid, uuid, text, uuid|jsonb|false|false|false|false|true",
  ]);
  if (actual.size !== expected.size || [...expected].some((row) => !actual.has(row)))
    fail(`E613_RPC_SIGNATURE_ACL_DRIFT_${[...actual].join(";")}`);
  emit("E613|PASS|catalog.invoker_rpc_signatures_service_only");
  assertEqual(
    "catalog.batch_source_helper_service_role_only",
    query(`SELECT has_function_privilege('anon', 'private.e613_revision_source_batch(jsonb)', 'EXECUTE') || '|' ||
                 has_function_privilege('authenticated', 'private.e613_revision_source_batch(jsonb)', 'EXECUTE') || '|' ||
                 has_function_privilege('service_role', 'private.e613_revision_source_batch(jsonb)', 'EXECUTE');`),
    "false|false|true",
  );

  const grain = query(`
    SELECT (NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'private' AND table_name = 'payer_products' AND column_name = 'org_id'))::text || '|' ||
           (EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'private.payer_products'::regclass AND contype = 'u'
                      AND pg_get_constraintdef(oid) = 'UNIQUE (payer_id, product_key)'))::text || '|' ||
           (EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'private.enrollment_scopes'::regclass AND contype = 'u'
                      AND pg_get_constraintdef(oid) = 'UNIQUE (org_id, provider_id, group_id, payer_product_id, facility_id, state)'))::text || '|' ||
           ((SELECT count(*) = 2 FROM information_schema.columns
             WHERE table_schema = 'private' AND table_name IN ('group_product_targets', 'enrollment_scopes')
               AND column_name = 'payer_id'))::text;
  `);
  assertEqual("catalog.global_product_and_six_part_scope_grain", grain, "true|true|true|true");

  for (const role of ["anon", "authenticated"]) {
    expectedSqlError(
      `acl.${role}.private_scope_select`,
      `SET ROLE ${role}; SELECT count(*) FROM private.enrollment_scopes;`,
      ["42501"],
    );
  }
  expectedServiceError(
    "auth.null_actor_denied",
    E612.admin,
    `SELECT public.curate_enrollment_payer_product(NULL::uuid, '${E612.orgA}', 'staff', NULL::uuid, 'bad', 'Bad', true);`,
    "42501",
    "enrollment_not_authorized",
  );
  expectedServiceError(
    "auth.null_audience_denied",
    E612.admin,
    `SELECT public.curate_enrollment_payer_product('${E612.admin}', '${E612.orgA}', NULL, NULL::uuid, 'bad', 'Bad', true);`,
    "42501",
    "enrollment_not_authorized",
  );
}

function spawnSqlSession(timeoutMs = 30_000) {
  const child = spawn("docker", ["--context", context, ...psqlArgs], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  let closed = false;
  let code = null;
  child.stdout.on("data", (chunk) => {
    out += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    err += String(chunk);
  });
  child.on("close", (exitCode) => {
    closed = true;
    code = exitCode;
  });
  const waitFor = async (marker) => {
    const deadline = Date.now() + timeoutMs;
    while (!out.includes(marker)) {
      if (closed) fail(`E613_RACE_SESSION_CLOSED_${migrationSlug(marker)}`);
      if (Date.now() >= deadline) {
        child.kill("SIGKILL");
        fail(`E613_RACE_SESSION_MARKER_TIMEOUT_${migrationSlug(marker)}`);
      }
      await pause(25);
    }
  };
  const result = async () => {
    const deadline = Date.now() + timeoutMs;
    while (!closed) {
      if (Date.now() >= deadline) {
        child.kill("SIGKILL");
        fail("E613_RACE_SESSION_RESULT_TIMEOUT");
      }
      await pause(25);
    }
    return { code, out, err };
  };
  return {
    get out() {
      return out;
    },
    get err() {
      return err;
    },
    write(value) {
      child.stdin.write(value);
    },
    end() {
      child.stdin.end();
    },
    kill() {
      if (!closed) child.kill("SIGKILL");
    },
    waitFor,
    result,
  };
}

async function waitForBlock(applicationName, blockerPid) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const state = query(`
      SELECT coalesce(wait_event_type, '') || '|' || array_to_string(pg_blocking_pids(pid), ',')
        FROM pg_stat_activity WHERE application_name = ${sqlLiteral(applicationName)};
    `);
    const [event, blockers = ""] = state.split("|");
    if (event === "Lock" && blockers.split(",").includes(String(blockerPid))) return;
    await pause(50);
  }
  fail("E613_RACE_BLOCKING_NOT_OBSERVED");
}

function extractJsonLine(label, output) {
  const line = output
    .trim()
    .split("\n")
    .find((value) => value.startsWith("{"));
  try {
    return JSON.parse(line);
  } catch {
    fail(`E613_${migrationSlug(label)}_JSON_INVALID`);
  }
}

async function concurrentRevisionCheck({ scopeId, currentRevisionId, payerProductId, source }) {
  const marker = randomUUID().replaceAll("-", "").slice(0, 12);
  const firstApp = `e613-${marker}-one`;
  const secondApp = `e613-${marker}-two`;
  const firstSession = spawnSqlSession();
  const secondSession = spawnSqlSession();
  const firstPidMarker = `E613_RACE|${marker}|ONE_PID|`;
  const secondPidMarker = `E613_RACE|${marker}|TWO_PID|`;
  const firstDone = `E613_RACE|${marker}|ONE_DONE`;
  const firstCall = saveCall({
    scopeId,
    expectedRevisionId: currentRevisionId,
    payerProductId,
    facilityId: FIX.facilityA1,
    revision: revision("in_review", { note: "race-one" }),
    sources: Array.isArray(source) ? source : [source],
  });
  const secondCall = saveCall({
    scopeId,
    expectedRevisionId: currentRevisionId,
    payerProductId,
    facilityId: FIX.facilityA1,
    revision: revision("in_review", { note: "race-two" }),
    sources: Array.isArray(source) ? source : [source],
  });
  try {
    firstSession.write(`
      SET application_name = '${firstApp}'; SET ROLE service_role;
      ${claims(E612.specialist, "service_role")}
      BEGIN;
      SELECT '${firstPidMarker}' || pg_backend_pid();
      SELECT ${firstCall};
      SELECT '${firstDone}';
    `);
    await firstSession.waitFor(firstDone);
    const firstPid = Number(
      firstSession.out
        .split("\n")
        .find((line) => line.startsWith(firstPidMarker))
        ?.slice(firstPidMarker.length),
    );
    if (!Number.isInteger(firstPid)) fail("E613_RACE_FIRST_PID_MISSING");

    secondSession.write(`
      SET application_name = '${secondApp}'; SET ROLE service_role;
      ${claims(E612.specialist, "service_role")}
      BEGIN;
      SELECT '${secondPidMarker}' || pg_backend_pid();
      SELECT ${secondCall};
      COMMIT;
    `);
    await secondSession.waitFor(secondPidMarker);
    const secondPid = Number(
      secondSession.out
        .split("\n")
        .find((line) => line.startsWith(secondPidMarker))
        ?.slice(secondPidMarker.length),
    );
    if (!Number.isInteger(secondPid)) fail("E613_RACE_SECOND_PID_MISSING");
    await waitForBlock(secondApp, firstPid);

    firstSession.write("COMMIT;\\q\n");
    const [firstResult, secondResult] = await Promise.all([
      firstSession.result(),
      secondSession.result(),
    ]);
    if (firstResult.code !== 0) fail("E613_RACE_WINNER_FAILED");
    const secondState = sqlState(`${secondResult.out}\n${secondResult.err}`);
    if (
      secondResult.code === 0 ||
      secondState !== "40001" ||
      !secondResult.err.includes("enrollment_revision_conflict")
    )
      fail(`E613_RACE_LOSER_CAUSE_DRIFT_${secondState ?? "MISSING"}`);
    const winner = extractJsonLine("race_winner", firstResult.out);
    const final = query(`
      SELECT (SELECT current_revision_id::text FROM private.enrollment_scopes WHERE id = '${scopeId}') || '|' ||
             (SELECT count(*)::text FROM private.enrollment_scope_revisions WHERE scope_id = '${scopeId}') || '|' ||
             (SELECT count(*)::text FROM public.audit_log WHERE entity_type = 'enrollment_scope' AND entity_id = '${scopeId}');
    `);
    const [current, revisionCount, auditRows] = final.split("|");
    assertEqual(
      "revision.race_exactly_one_append",
      `${current === winner.revisionId}|${revisionCount}|${auditRows}`,
      `true|2|2`,
    );
    emit(`E613|PASS|revision.concurrent_one_success_one_conflict|blocked_by=${firstPid}`);
    return winner;
  } finally {
    firstSession.kill();
    secondSession.kill();
  }
}

function sourceArg(item) {
  return {
    sourceKind: item.sourceKind,
    sourceId: item.sourceId,
    sourceFingerprint: item.sourceFingerprint,
  };
}

function productAndTriageChecks() {
  const productA = productFor(E612.admin, E612.orgA, FIX.payerA, "commercial-co");
  const productB = productFor(E612.orgBAdmin, E612.orgB, FIX.payerB, "commercial-co");
  if (!productA || !productB || productA === productB) fail("E613_GLOBAL_PRODUCT_CURATION_FAILED");
  emit("E613|PASS|catalog.payer_scoped_global_product_identity");

  setTarget(E612.admin, E612.orgA, E612.groupA1, productA, "CO");
  setTarget(E612.admin, E612.orgA, E612.groupA1, productA, "AZ");
  const productAlt = productFor(E612.admin, E612.orgA, FIX.payerA, "commercial-co-alt");
  setTarget(E612.admin, E612.orgA, E612.groupA1, productAlt, "CO");
  const catalog = jsonResult(
    "catalog_read",
    callJson(
      E612.admin,
      `SELECT public.get_enrollment_catalog(
    '${E612.admin}', '${E612.orgA}', 'staff', '${E612.groupA1}');`,
    ),
  );
  if (
    !catalog.products.some((item) => item.productId === productA && item.payerId === FIX.payerA) ||
    !catalog.targets.some((item) => item.payerProductId === productA && item.state === "CO")
  )
    fail("E613_CATALOG_READ_MISSING_CURATED_PRODUCT_OR_TARGET");
  emit("E613|PASS|catalog.staff_catalog_contains_product_and_targets");
  const specialistCatalog = jsonResult(
    "catalog_specialist_read",
    callJson(
      E612.specialist,
      `SELECT public.get_enrollment_catalog(
    '${E612.specialist}', '${E612.orgA}', 'staff', '${E612.groupA1}');`,
    ),
  );
  if (!specialistCatalog.products.some((item) => item.productId === productA))
    fail("E613_CATALOG_SPECIALIST_STAFF_READ_MISSING_PRODUCT");
  emit("E613|PASS|catalog.report_staff_can_read_catalog");
  expectedServiceError(
    "catalog.client_cannot_read_staff_catalog",
    E612.clientActive,
    `SELECT public.get_enrollment_catalog('${E612.clientActive}', '${E612.orgA}', 'client', '${E612.groupA1}');`,
    "42501",
    "enrollment_not_authorized",
  );
  assertEqual(
    "target.intent_does_not_create_scope",
    query("SELECT count(*) FROM private.enrollment_scopes;"),
    "0",
  );
  expectedServiceError(
    "target.cross_org_product_denied",
    E612.orgBAdmin,
    `SELECT public.set_enrollment_group_product_target('${E612.orgBAdmin}', '${E612.orgB}', 'staff', '${E612.groupB1}', '${productA}', 'CO', true);`,
    "P0002",
    "enrollment_not_found",
  );
  expectedServiceError(
    "auth.specialist_cannot_curate_catalog",
    E612.specialist,
    `SELECT public.curate_enrollment_payer_product('${E612.specialist}', '${E612.orgA}', 'staff', '${FIX.payerA}', 'forbidden', 'Forbidden', true);`,
    "42501",
    "enrollment_not_authorized",
  );
  expectedServiceError(
    "auth.billing_member_denied",
    E612.billing,
    `SELECT public.get_enrollment_unresolved_page('${E612.billing}', '${E612.orgA}', 'staff', '${E612.groupA1}', NULL, 25);`,
    "42501",
    "enrollment_not_authorized",
  );
  const crossOrgCuration = `SELECT public.curate_enrollment_payer_product(
    '${E612.orgBAdmin}', '${E612.orgB}', 'staff', '${FIX.payerA}', 'cross-org', 'Cross org', true);`;
  expectedServiceError(
    "catalog.cross_org_payer_hidden",
    E612.orgBAdmin,
    crossOrgCuration,
    "P0002",
    "enrollment_not_found",
  );
  setTarget(E612.admin, E612.orgA, E612.groupA1, productA, "UT");
  setTarget(E612.admin, E612.orgA, E612.groupA2, productA, "CO");

  const firstPage = unresolvedPage(E612.admin, E612.orgA, "staff", E612.groupA1, null, 1);
  if (!Array.isArray(firstPage.items) || firstPage.items.length !== 1 || !firstPage.nextCursor)
    fail("E613_UNRESOLVED_KEYSET_FIRST_PAGE_INVALID");
  const nextPage = unresolvedPage(
    E612.admin,
    E612.orgA,
    "staff",
    E612.groupA1,
    firstPage.nextCursor,
    1,
  );
  if (!Array.isArray(nextPage.items) || nextPage.items.length !== 1)
    fail("E613_UNRESOLVED_KEYSET_NEXT_PAGE_INVALID");
  const tuple = (item) => `${item.sourceKind}|${item.sourceId}`;
  if (tuple(firstPage.items[0]) === tuple(nextPage.items[0]))
    fail("E613_UNRESOLVED_KEYSET_DUPLICATED_ROW");
  emit("E613|PASS|triage.created_at_kind_id_keyset");

  const fullPage = unresolvedPage(E612.admin, E612.orgA, "staff", E612.groupA1, null, 100);
  const caseItem = pageItem(fullPage, "case", FIX.caseA);
  const factItem = pageItem(fullPage, "fact", FIX.factA);
  const linkedFactItem = pageItem(fullPage, "fact", FIX.factLinked);
  assertEqual(
    "source.case_facility_ids_sorted",
    JSON.stringify(caseItem.sourceSnapshot.case_facility_ids),
    JSON.stringify([FIX.facilityA1, FIX.facilityA2]),
  );
  assertEqual(
    "source.case_snapshot_contract_fields",
    Object.keys(caseItem.sourceSnapshot).sort().join(","),
    [
      "approved_date",
      "case_facility_ids",
      "case_status",
      "confirmed_effective_date",
      "contract_executed_date",
      "expected_effective_date",
      "group_id",
      "id",
      "org_id",
      "payer_group_provider_id",
      "payer_id",
      "payer_individual_provider_id",
      "payer_reference_id",
      "provider_id",
      "state",
      "submitted_date",
      "termination_date",
    ]
      .sort()
      .join(","),
  );
  assertEqual(
    "source.fact_snapshot_contract_fields",
    Object.keys(factItem.sourceSnapshot).sort().join(","),
    [
      "effective_date",
      "expired_at",
      "group_id",
      "id",
      "org_id",
      "payer_id",
      "payer_issued_id",
      "provider_id",
      "state",
    ]
      .sort()
      .join(","),
  );
  emit("E613|PASS|source.case_and_fact_fingerprints_from_unresolved_page");

  const beforeFailure = scopeState();
  const wrongSource = { ...sourceArg(caseItem), sourceFingerprint: "0".repeat(64) };
  if (wrongSource.sourceFingerprint === caseItem.sourceFingerprint)
    wrongSource.sourceFingerprint = "f".repeat(64);
  expectedServiceError(
    "save.first_scope_stale_source_rolls_back",
    E612.admin,
    `SELECT ${saveCall({ payerProductId: productA, revision: revision("in_progress"), sources: [wrongSource] })};`,
    "40001",
    "enrollment_source_stale",
  );
  assertEqual("save.first_scope_failure_has_no_partial_rows", scopeState(), beforeFailure);

  const caseSource = sourceArg(caseItem);
  const linkedFactSource = sourceArg(linkedFactItem);
  const created = jsonResult(
    "first_save",
    callJson(
      E612.admin,
      `SELECT ${saveCall({
        payerProductId: productA,
        revision: revision("in_progress", {
          submittedDate: "2026-02-10",
          payerAcknowledgedDate: "2026-02-11",
          payerReference: "E613-PENDING-REF",
        }),
        sources: [caseSource, linkedFactSource],
      })};`,
    ),
  );
  if (created.created !== true || created.cycleNo !== 1 || created.revisionNo !== 1)
    fail("E613_FIRST_SAVE_RESULT_DRIFT");
  const scopeId = created.scopeId;
  const staffDetail = jsonResult("staff_detail", detail(E612.admin, scopeId));
  assertEqual("save.atomic_initial_scope_revision_source_audit", scopeState(), "1|1|2|1");
  assertEqual(
    "save.current_pointer_is_initial_revision",
    staffDetail.scope.currentRevisionId,
    created.revisionId,
  );
  const storedCaseSource = staffDetail.sources.find(
    (source) => source.sourceKind === "case" && source.sourceId === FIX.caseA,
  );
  const storedLinkedFact = staffDetail.sources.find(
    (source) => source.sourceKind === "fact" && source.sourceId === FIX.factLinked,
  );
  assertEqual(
    "save.stored_source_fingerprint_exact",
    storedCaseSource.sourceFingerprint,
    caseItem.sourceFingerprint,
  );
  assertEqual(
    "save.stored_linked_fact_fingerprint_exact",
    storedLinkedFact.sourceFingerprint,
    linkedFactItem.sourceFingerprint,
  );
  assertEqual(
    "save.stored_source_snapshot_exact",
    JSON.stringify(storedCaseSource.sourceSnapshot),
    JSON.stringify(caseItem.sourceSnapshot),
  );
  emit("E613|PASS|save.initial_scope_revision_pointer_audit_and_source_atomically");

  const beforeInvalidDate = scopeState();
  expectedServiceError(
    "save.invalid_date_is_normalized_to_422",
    E612.admin,
    `SELECT ${saveCall({
      scopeId,
      expectedRevisionId: created.revisionId,
      payerProductId: productA,
      revision: revision("in_progress", { intakeDate: "not-a-date" }),
      sources: [caseSource],
    })};`,
    "22023",
    "enrollment_invalid",
  );
  assertEqual(
    "save.invalid_date_has_no_partial_revision_or_audit",
    scopeState(),
    beforeInvalidDate,
  );

  const partialPage = unresolvedPage(E612.admin, E612.orgA, "staff", E612.groupA1, null, 100);
  const partialCase = pageItem(partialPage, "case", FIX.caseA);
  assertListContains("triage.partial_scope_mapping", partialCase.mappedScopeIds, scopeId);
  assertListContains(
    "triage.unmapped_second_facility",
    partialCase.unmappedFacilityIds,
    FIX.facilityA2,
  );
  assertEqual("triage.partial_case_state", partialCase.triageState, "partially_mapped");
  assertEqual(
    "triage.partial_fact_location_remains_unresolved",
    pageItem(partialPage, "fact", FIX.factLinked).triageState,
    "partially_mapped",
  );
  assertListContains(
    "triage.partial_fact_unmapped_facility",
    pageItem(partialPage, "fact", FIX.factLinked).unmappedFacilityIds,
    FIX.facilityA2,
  );

  const factSource = sourceArg(factItem);
  const factSave = jsonResult(
    "fact_scope_save",
    callJson(
      E612.specialist,
      `SELECT ${saveCall({
        actorId: E612.specialist,
        payerProductId: productA,
        providerId: FIX.providerA2,
        facilityId: FIX.facilityA2,
        revision: revision("in_progress", { owner: "Minted", note: "fact-source" }),
        sources: [factSource],
      })};`,
    ),
  );
  if (factSave.created !== true) fail("E613_SPECIALIST_DRAFT_SAVE_DENIED");
  emit("E613|PASS|authorization.specialist_can_draft");

  const expiredFingerprint = sourceFingerprint(E612.admin, "fact", FIX.factExpired);
  if (!/^[a-f0-9]{64}$/.test(expiredFingerprint)) fail("E613_EXPIRED_FACT_FINGERPRINT_INVALID");
  expectedServiceError(
    "save.expired_fact_never_verifies",
    E612.admin,
    `SELECT ${saveCall({
      payerProductId: productA,
      providerId: FIX.providerA2,
      facilityId: FIX.facilityA2,
      state: "UT",
      revision: revision("approved"),
      sources: [
        { sourceKind: "fact", sourceId: FIX.factExpired, sourceFingerprint: expiredFingerprint },
      ],
    })};`,
    "40001",
    "enrollment_source_stale",
  );
  assertEqual("save.expired_fact_failed_without_partial_scope", scopeState(), "2|2|3|2");

  const invalidAssignment = `SELECT ${saveCall({
    actorId: E612.admin,
    payerProductId: productA,
    providerId: E612.provider,
    groupId: E612.groupA2,
    facilityId: FIX.facilityA2,
    state: "WY",
    revision: revision("in_progress"),
    sources: [],
  })};`;
  expectedServiceError(
    "save.cross_group_assignment_denied",
    E612.admin,
    invalidAssignment,
    "22023",
    "enrollment_invalid",
  );

  const dualScope = jsonResult(
    "dual_staff_scope",
    callJson(
      E612.dual,
      `SELECT ${saveCall({
        actorId: E612.dual,
        payerProductId: productA,
        providerId: FIX.providerA2,
        groupId: E612.groupA2,
        facilityId: FIX.facilityA2,
        revision: revision("in_progress"),
        sources: [],
      })};`,
    ),
  );
  expectedServiceError(
    "auth.selected_client_audience_does_not_union_staff",
    E612.dual,
    `SELECT public.get_enrollment_scope_detail('${E612.dual}', '${E612.orgA}', 'client', '${dualScope.scopeId}');`,
    "42501",
    "enrollment_not_authorized",
  );
  expectedServiceError(
    "auth.client_cannot_save",
    E612.clientActive,
    `SELECT ${saveCall({
      actorId: E612.clientActive,
      audience: "client",
      payerProductId: productA,
      revision: revision("in_progress"),
      sources: [],
    })};`,
    "42501",
    "enrollment_not_authorized",
  );
  return {
    productA,
    productAlt,
    productB,
    scopeId,
    initialRevisionId: created.revisionId,
    caseSource,
    linkedFactSource,
    factSource,
    factScopeId: factSave.scopeId,
  };
}

function fingerprintFieldCoverage() {
  const sourceVariants = (kind, id, expectedMaterial, variants) => {
    const base = `private.e613_source_snapshot('${kind}', '${id}')`;
    const canonical = JSON.parse(query(`SELECT ${base};`));
    const expectedKeys = Object.keys(expectedMaterial);
    assertEqual(
      `source.${kind}_canonical_material_keyset`,
      Object.keys(canonical).sort().join(","),
      expectedKeys.slice().sort().join(","),
    );
    const sortKeys = (record) =>
      Object.fromEntries(
        Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
      );
    assertEqual(
      `source.${kind}_canonical_material_matches_fixture`,
      JSON.stringify(sortKeys(canonical)),
      JSON.stringify(sortKeys(expectedMaterial)),
    );
    const selects = [
      `SELECT ${base} AS snapshot`,
      ...variants.map(
        ([key, value]) =>
          `SELECT jsonb_set(${base}, ARRAY[${sqlLiteral(key)}], ${jsonArg(value)}, true) AS snapshot`,
      ),
    ];
    const result = query(`WITH variants AS (${selects.join(" UNION ALL ")})
      SELECT count(DISTINCT private.e613_source_fingerprint(snapshot))::text FROM variants;`);
    assertEqual(`source.${kind}_material_field_variants`, result, String(variants.length + 1));
  };

  sourceVariants(
    "case",
    FIX.caseA,
    {
      id: FIX.caseA,
      org_id: E612.orgA,
      provider_id: E612.provider,
      group_id: E612.groupA1,
      payer_id: FIX.payerA,
      state: "CO",
      case_status: "approved",
      submitted_date: "2026-01-05",
      approved_date: "2026-02-01",
      confirmed_effective_date: "2026-02-15",
      expected_effective_date: "2026-02-10",
      termination_date: null,
      payer_reference_id: "E613-CASE-REF-A",
      payer_individual_provider_id: "E613-TYPE1-A",
      payer_group_provider_id: "E613-TYPE2-A",
      contract_executed_date: "2026-01-20",
      case_facility_ids: [FIX.facilityA1, FIX.facilityA2],
    },
    [
      ["id", "a0000000-0000-4000-8000-000000000099"],
      ["org_id", E612.orgB],
      ["provider_id", FIX.providerA2],
      ["group_id", E612.groupA2],
      ["payer_id", FIX.payerB],
      ["state", "WA"],
      ["case_status", "denied"],
      ["submitted_date", "2026-01-06"],
      ["approved_date", "2026-02-02"],
      ["confirmed_effective_date", "2026-02-16"],
      ["expected_effective_date", "2026-02-11"],
      ["termination_date", "2026-03-01"],
      ["payer_reference_id", "E613-MATERIAL-CHANGE"],
      ["payer_individual_provider_id", "E613-TYPE1-CHANGE"],
      ["payer_group_provider_id", "E613-TYPE2-CHANGE"],
      ["contract_executed_date", "2026-01-21"],
      ["case_facility_ids", [FIX.facilityA2]],
    ],
  );
  sourceVariants(
    "fact",
    FIX.factA,
    {
      id: FIX.factA,
      org_id: E612.orgA,
      provider_id: FIX.providerA2,
      group_id: E612.groupA1,
      payer_id: FIX.payerA,
      state: "CO",
      effective_date: "2025-11-01",
      payer_issued_id: "E613-FACT-LIVE",
      expired_at: null,
    },
    [
      ["id", "a0000000-0000-4000-8000-000000000098"],
      ["org_id", E612.orgB],
      ["provider_id", E612.provider],
      ["group_id", E612.groupA2],
      ["payer_id", FIX.payerB],
      ["state", "WA"],
      ["effective_date", "2025-11-02"],
      ["payer_issued_id", "E613-FACT-MATERIAL-CHANGE"],
      ["expired_at", "2026-01-01T00:00:00Z"],
    ],
  );
}

function auditAppendOnlyChecks({ scopeId, revisionId, factScopeId }) {
  const scopeSourceId = query(
    `SELECT id FROM private.enrollment_scope_sources WHERE scope_id = '${scopeId}' LIMIT 1;`,
  );
  const summaryId = query(
    `SELECT id FROM private.enrollment_summary_publications WHERE scope_id = '${scopeId}' LIMIT 1;`,
  );
  const proofId = query(
    `SELECT id FROM private.enrollment_proof_publications WHERE scope_id = '${scopeId}' LIMIT 1;`,
  );
  const eventId = query(
    `SELECT id FROM private.publication_events WHERE scope_id = '${scopeId}' LIMIT 1;`,
  );
  if (!scopeSourceId || !summaryId || !proofId || !eventId)
    fail("E613_APPEND_ONLY_FIXTURE_ROW_MISSING");

  const checks = [
    [
      "revision_update",
      `UPDATE private.enrollment_scope_revisions SET staff_note = 'tampered' WHERE id = '${revisionId}';`,
    ],
    [
      "revision_delete",
      `DELETE FROM private.enrollment_scope_revisions WHERE id = '${revisionId}';`,
    ],
    [
      "source_update",
      `UPDATE private.enrollment_scope_sources SET source_fingerprint = repeat('0',64) WHERE id = '${scopeSourceId}';`,
    ],
    [
      "source_delete",
      `DELETE FROM private.enrollment_scope_sources WHERE id = '${scopeSourceId}';`,
    ],
    [
      "summary_update",
      `UPDATE private.enrollment_summary_publications SET published_status = 'denied' WHERE id = '${summaryId}';`,
    ],
    [
      "summary_delete",
      `DELETE FROM private.enrollment_summary_publications WHERE id = '${summaryId}';`,
    ],
    [
      "proof_update",
      `UPDATE private.enrollment_proof_publications SET sha256 = repeat('0',64) WHERE id = '${proofId}';`,
    ],
    ["proof_delete", `DELETE FROM private.enrollment_proof_publications WHERE id = '${proofId}';`],
    [
      "event_update",
      `UPDATE private.publication_events SET reason = 'tampered' WHERE id = '${eventId}';`,
    ],
    ["event_delete", `DELETE FROM private.publication_events WHERE id = '${eventId}';`],
    [
      "scope_identity",
      `UPDATE private.enrollment_scopes SET provider_id = '${FIX.providerA2}' WHERE id = '${scopeId}';`,
    ],
  ];
  for (const [label, statement] of checks) {
    expectedSqlError(`append_only.${label}`, statement, ["42501"], "enrollment_");
  }
  const foreignRevision = query(
    `SELECT current_revision_id::text FROM private.enrollment_scopes WHERE id = '${factScopeId}';`,
  );
  expectedSqlError(
    "append_only.cross_wired_current_pointer_denied",
    `UPDATE private.enrollment_scopes SET current_revision_id = '${foreignRevision}' WHERE id = '${scopeId}';`,
    ["42501"],
    "enrollment_current_revision_must_advance",
  );
}

function publishSummary(actorId, scopeId, revisionId, orgId = E612.orgA) {
  return jsonResult(
    "summary_publication",
    rpc(actorId, "publish_enrollment_summary", { orgId, scopeId, revisionId }),
  );
}

function publishProof(
  actorId,
  {
    scopeId,
    revisionId,
    documentId = FIX.documentA,
    evidenceKind = "payer_approval_letter",
    supportedFields,
    sha256 = "a".repeat(64),
    orgId = E612.orgA,
  },
) {
  return jsonResult(
    "proof_publication",
    rpc(actorId, "publish_enrollment_proof", {
      orgId,
      scopeId,
      revisionId,
      documentId,
      evidenceKind,
      supportedFields,
      sha256,
      reason: "E6.13 native synthetic evidence",
    }),
  );
}

function clientDetail(actorId, scopeId, orgId = E612.orgA) {
  return jsonResult("client_detail", detail(actorId, scopeId, "client", orgId));
}

function downloadAuditCount(publicationId) {
  return Number(
    query(`SELECT count(*) FROM public.audit_log
    WHERE entity_type = 'enrollment_proof_publication' AND entity_id = '${publicationId}' AND action_type = 'READ';`),
  );
}

function initialPublicationChecks({ scopeId, initialRevisionId }) {
  expectedServiceError(
    "client.no_summary_is_hidden",
    E612.clientActive,
    `SELECT public.get_enrollment_scope_detail('${E612.clientActive}', '${E612.orgA}', 'client', '${scopeId}');`,
    "P0002",
    "enrollment_not_found",
  );
  const firstSummary = publishSummary(E612.admin, scopeId, initialRevisionId);
  const initialClient = clientDetail(E612.clientActive, scopeId);
  assertEqual(
    "publication.pending_summary_visible_without_proof",
    initialClient.status,
    "in_progress",
  );
  assertEqual(
    "publication.pending_summary_exposes_captured_milestones_without_proof",
    [
      initialClient.submittedDate,
      initialClient.payerAcknowledgedDate,
      initialClient.payerReference,
    ].join("|"),
    "2026-02-10|2026-02-11|E613-PENDING-REF",
  );
  assertEqual(
    "publication.pending_summary_has_no_proofs",
    JSON.stringify(initialClient.proofs),
    "[]",
  );
  assertAbsent("privacy.client_detail_excludes_staff_note", initialClient, "staffNote");
  assertAbsent("privacy.client_detail_excludes_source_links", initialClient, "sources");
  assertAbsent("privacy.client_detail_excludes_document_hash", initialClient, "sha256");
  expectedServiceError(
    "auth.pending_client_classification_denied",
    E612.clientPending,
    `SELECT public.get_enrollment_scope_detail('${E612.clientPending}', '${E612.orgA}', 'client', '${scopeId}');`,
    "42501",
    "enrollment_not_authorized",
  );

  query(`UPDATE auth.users SET email = 'changed@e612.test' WHERE id = '${E612.clientActive}';`);
  expectedServiceError(
    "auth.current_verified_email_must_match_classification",
    E612.clientActive,
    `SELECT public.get_enrollment_scope_detail('${E612.clientActive}', '${E612.orgA}', 'client', '${scopeId}');`,
    "42501",
    "enrollment_not_authorized",
  );
  query(`UPDATE auth.users SET email = 'active@e612.test' WHERE id = '${E612.clientActive}';`);
  return firstSummary;
}

function publicationChecks({
  scopeId,
  currentRevisionId,
  initialSummaryId,
  caseSource,
  linkedFactSource,
  productA,
  factScopeId,
}) {
  const approved = jsonResult(
    "approved_revision",
    callJson(
      E612.admin,
      `SELECT ${saveCall({
        scopeId,
        expectedRevisionId: currentRevisionId,
        payerProductId: productA,
        revision: revision("approved", {
          note: "approved status remains private",
          retroStatus: "documented",
          retroDays: 30,
          retroBasis: "Native verified letter",
        }),
        sources: [caseSource, linkedFactSource],
      })};`,
    ),
  );
  assertEqual(
    "revision.approved_save_starts_new_revision",
    `${approved.cycleNo}|${approved.revisionNo}|${approved.created}`,
    "1|3|false",
  );
  const approvedSummary = publishSummary(E612.admin, scopeId, approved.revisionId);
  const captureTarget = jsonResult(
    "proof_capture_target",
    rpc(E612.admin, "get_enrollment_proof_capture_target", {
      orgId: E612.orgA,
      audience: "staff",
      scopeId,
      revisionId: approved.revisionId,
      documentId: FIX.documentA,
    }),
  );
  assertEqual(
    "proof.capture_target_returns_server_version",
    captureTarget.documentVersionId,
    FIX.documentA,
  );
  assertEqual(
    "proof.capture_target_returns_server_storage_key",
    captureTarget.storagePath,
    "e613/synthetic/document-a",
  );
  expectedServiceError(
    "proof.capture_target_specialist_denied",
    E612.specialist,
    `SELECT public.get_enrollment_proof_capture_target('${E612.specialist}', '${E612.orgA}', 'staff', '${scopeId}', '${approved.revisionId}', '${FIX.documentA}');`,
    "42501",
    "enrollment_not_authorized",
  );
  expectedServiceError(
    "proof.capture_target_wrong_owner_hidden",
    E612.admin,
    `SELECT public.get_enrollment_proof_capture_target('${E612.admin}', '${E612.orgA}', 'staff', '${scopeId}', '${approved.revisionId}', '${FIX.documentWrongOwner}');`,
    "P0002",
    "enrollment_not_found",
  );
  const unproved = clientDetail(E612.clientActive, scopeId);
  assertEqual(
    "proof_gate.approved_without_proof_needs_verification",
    unproved.status,
    "needs_verification",
  );
  assertEqual(
    "proof_gate.unproved_shell_redacts_approved_fields",
    [
      unproved.approvedDate,
      unproved.effectiveDate,
      unproved.payerReference,
      unproved.retroDays,
      unproved.cycleNo,
      unproved.revisionNo,
    ]
      .map((value) => (value == null ? "null" : String(value)))
      .join("|"),
    "null|null|null|null|null|null",
  );
  assertEqual("proof_gate.unproved_shell_has_no_proofs", JSON.stringify(unproved.proofs), "[]");
  assertAbsent("privacy.unproved_shell_excludes_sources", unproved, "sources");

  const statusOnlyProof = publishProof(E612.admin, {
    scopeId,
    revisionId: approved.revisionId,
    supportedFields: ["enrollment_status"],
    sha256: "f".repeat(64),
  });
  assertEqual(
    "proof_gate.status_only_cannot_certify_product_location",
    clientDetail(E612.clientActive, scopeId).status,
    "needs_verification",
  );
  rpc(E612.admin, "revoke_enrollment_publication", {
    orgId: E612.orgA,
    audience: "staff",
    publicationId: statusOnlyProof.publicationId,
    reason: "Remove status-only proof before full proof",
  });

  expectedServiceError(
    "proof.invalid_field_is_rejected",
    E612.admin,
    `SELECT public.publish_enrollment_proof('${E612.admin}', '${E612.orgA}', 'staff', '${scopeId}', '${approved.revisionId}', '${FIX.documentA}', 'payer_approval_letter', ARRAY['staff_note'], '${"a".repeat(64)}', 'Invalid native field');`,
    "22023",
    "enrollment_invalid",
  );
  expectedServiceError(
    "proof.license_does_not_prove_enrollment",
    E612.admin,
    `SELECT public.publish_enrollment_proof('${E612.admin}', '${E612.orgA}', 'staff', '${scopeId}', '${approved.revisionId}', '${FIX.documentA}', 'license_psv', ARRAY['enrollment_status'], '${"b".repeat(64)}', 'Invalid license field');`,
    "22023",
    "enrollment_invalid",
  );
  expectedServiceError(
    "proof.wrong_owner_document_hidden",
    E612.admin,
    `SELECT public.publish_enrollment_proof('${E612.admin}', '${E612.orgA}', 'staff', '${scopeId}', '${approved.revisionId}', '${FIX.documentWrongOwner}', 'payer_approval_letter', ARRAY['enrollment_status'], '${"c".repeat(64)}', 'Wrong owner document');`,
    "P0002",
    "enrollment_not_found",
  );
  expectedServiceError(
    "proof.cross_org_document_hidden",
    E612.admin,
    `SELECT public.publish_enrollment_proof('${E612.admin}', '${E612.orgA}', 'staff', '${scopeId}', '${approved.revisionId}', '${FIX.documentB}', 'payer_approval_letter', ARRAY['enrollment_status'], '${"d".repeat(64)}', 'Wrong org document');`,
    "P0002",
    "enrollment_not_found",
  );
  expectedServiceError(
    "proof.superseded_document_capture_denied",
    E612.admin,
    `SELECT public.get_enrollment_proof_capture_target('${E612.admin}', '${E612.orgA}', 'staff', '${scopeId}', '${approved.revisionId}', '${FIX.documentSuperseded}');`,
    "P0002",
    "enrollment_not_found",
  );
  expectedServiceError(
    "proof.superseded_document_publish_denied",
    E612.admin,
    `SELECT public.publish_enrollment_proof('${E612.admin}', '${E612.orgA}', 'staff', '${scopeId}', '${approved.revisionId}', '${FIX.documentSuperseded}', 'payer_approval_letter', ARRAY['enrollment_status'], '${"5".repeat(64)}', 'Superseded evidence must not publish');`,
    "P0002",
    "enrollment_not_found",
  );
  expectedServiceError(
    "proof.specialist_cannot_publish",
    E612.specialist,
    `SELECT public.publish_enrollment_proof('${E612.specialist}', '${E612.orgA}', 'staff', '${scopeId}', '${approved.revisionId}', '${FIX.documentA}', 'payer_approval_letter', ARRAY['enrollment_status'], '${"e".repeat(64)}', 'Specialist publication denied');`,
    "42501",
    "enrollment_not_authorized",
  );

  const supported = [
    "enrollment_status",
    "payer_reference",
    "approved_date",
    "effective_date",
    "retro_status",
    "retro_days",
    "facility_id",
    "product_id",
  ];
  const proof = publishProof(E612.admin, {
    scopeId,
    revisionId: approved.revisionId,
    supportedFields: supported,
  });
  const approvedClient = clientDetail(E612.clientActive, scopeId);
  assertEqual("proof_gate.current_approved_status_proof_gated", approvedClient.status, "approved");
  assertEqual(
    "proof_gate.current_supported_values_visible",
    [
      approvedClient.submittedDate,
      approvedClient.payerAcknowledgedDate,
      approvedClient.approvedDate,
      approvedClient.effectiveDate,
      approvedClient.payerReference,
      approvedClient.retroStatus,
      approvedClient.retroDays,
    ].join("|"),
    "2026-01-20|2026-01-22|2026-02-01|2026-02-15|E613-VERIFIED-REF|documented|30",
  );
  assertEqual(
    "privacy.client_proof_metadata_safe",
    JSON.stringify(approvedClient.proofs.map((item) => item.supportedFields)),
    JSON.stringify([supported]),
  );
  assertAbsent(
    "privacy.client_detail_excludes_staff_note_after_proof",
    approvedClient,
    "staffNote",
  );
  assertAbsent(
    "privacy.client_detail_excludes_source_links_after_proof",
    approvedClient,
    "sources",
  );
  assertAbsent(
    "privacy.client_detail_excludes_sha_after_proof",
    approvedClient.proofs[0],
    "sha256",
  );

  query(`UPDATE public.providers SET is_test_provider = true WHERE id = '${E612.provider}';`);
  expectedServiceError(
    "privacy.published_test_provider_detail_hidden",
    E612.clientActive,
    `SELECT public.get_enrollment_scope_detail('${E612.clientActive}', '${E612.orgA}', 'client', '${scopeId}');`,
    "P0002",
    "enrollment_not_found",
  );
  expectedServiceError(
    "privacy.published_test_provider_download_hidden",
    E612.clientActive,
    `SELECT public.authorize_enrollment_proof_download('${E612.clientActive}', '${E612.orgA}', 'client', '${proof.publicationId}');`,
    "P0002",
    "enrollment_not_found",
  );
  query(`UPDATE public.providers SET is_test_provider = false WHERE id = '${E612.provider}';`);
  assertEqual(
    "privacy.restored_non_test_publication_visible",
    clientDetail(E612.clientActive, scopeId).status,
    "approved",
  );

  const download = jsonResult(
    "proof_download_authorized",
    rpc(E612.clientActive, "authorize_enrollment_proof_download", {
      orgId: E612.orgA,
      audience: "client",
      publicationId: proof.publicationId,
    }),
  );
  assertEqual("proof.download_returns_document_version", download.documentVersionId, FIX.documentA);
  assertEqual(
    "proof.download_returns_server_storage_key",
    download.storagePath,
    "e613/synthetic/document-a",
  );
  const readsBefore = downloadAuditCount(proof.publicationId);
  const record = jsonResult(
    "proof_download_recorded",
    rpc(E612.clientActive, "record_enrollment_proof_download", {
      orgId: E612.orgA,
      audience: "client",
      publicationId: proof.publicationId,
      documentId: FIX.documentA,
      sha256: "a".repeat(64),
    }),
  );
  assertEqual(
    "proof.download_audit_records_after_hash_match",
    `${record.recorded}|${downloadAuditCount(proof.publicationId)}`,
    `true|${readsBefore + 1}`,
  );
  expectedServiceError(
    "proof.download_audit_rejects_hash_mismatch",
    E612.clientActive,
    `SELECT public.record_enrollment_proof_download('${E612.clientActive}', '${E612.orgA}', 'client', '${proof.publicationId}', '${FIX.documentA}', '${"b".repeat(64)}');`,
    "40001",
    "enrollment_source_stale",
  );
  assertEqual(
    "proof.hash_mismatch_has_no_download_audit",
    String(downloadAuditCount(proof.publicationId)),
    String(readsBefore + 1),
  );

  query(
    `UPDATE public.provider_documents SET expiration_date = current_date - 1 WHERE id = '${FIX.documentA}';`,
  );
  expectedServiceError(
    "proof.expired_document_download_denied",
    E612.clientActive,
    `SELECT public.authorize_enrollment_proof_download('${E612.clientActive}', '${E612.orgA}', 'client', '${proof.publicationId}');`,
    "P0002",
    "enrollment_not_found",
  );
  expectedServiceError(
    "proof.expired_document_capture_denied",
    E612.admin,
    `SELECT public.get_enrollment_proof_capture_target('${E612.admin}', '${E612.orgA}', 'staff', '${scopeId}', '${approved.revisionId}', '${FIX.documentA}');`,
    "P0002",
    "enrollment_not_found",
  );
  expectedServiceError(
    "proof.expired_document_publish_denied",
    E612.admin,
    `SELECT public.publish_enrollment_proof('${E612.admin}', '${E612.orgA}', 'staff', '${scopeId}', '${approved.revisionId}', '${FIX.documentA}', 'payer_approval_letter', ARRAY['enrollment_status'], '${"6".repeat(64)}', 'Expired document must not prove current');`,
    "P0002",
    "enrollment_not_found",
  );
  const expiredDocumentClient = clientDetail(E612.clientActive, scopeId);
  assertEqual(
    "proof.expired_document_redacts_current_client_status",
    expiredDocumentClient.status,
    "needs_verification",
  );
  assertEqual(
    "proof.expired_document_clears_current_proofs",
    JSON.stringify(expiredDocumentClient.proofs),
    "[]",
  );
  expectedServiceError(
    "proof.expired_document_download_record_denied",
    E612.clientActive,
    `SELECT public.record_enrollment_proof_download('${E612.clientActive}', '${E612.orgA}', 'client', '${proof.publicationId}', '${FIX.documentA}', '${"a".repeat(64)}');`,
    "P0002",
    "enrollment_not_found",
  );
  query(
    `UPDATE public.provider_documents SET expiration_date = '2027-12-31' WHERE id = '${FIX.documentA}';`,
  );
  expectedServiceError(
    "proof.cross_org_publication_hidden",
    E612.orgBAdmin,
    `SELECT public.authorize_enrollment_proof_download('${E612.orgBAdmin}', '${E612.orgB}', 'staff', '${proof.publicationId}');`,
    "P0002",
    "enrollment_not_found",
  );

  const event = jsonResult(
    "proof_revoked",
    rpc(E612.admin, "revoke_enrollment_publication", {
      orgId: E612.orgA,
      audience: "staff",
      publicationId: proof.publicationId,
      reason: "E6.13 native revocation test",
    }),
  );
  if (!event.eventId) fail("E613_PROOF_REVOKE_EVENT_MISSING");
  expectedServiceError(
    "proof.revoked_download_denied",
    E612.clientActive,
    `SELECT public.authorize_enrollment_proof_download('${E612.clientActive}', '${E612.orgA}', 'client', '${proof.publicationId}');`,
    "P0002",
    "enrollment_not_found",
  );
  const afterRevoke = clientDetail(E612.clientActive, scopeId);
  assertEqual(
    "proof.revocation_redacts_previously_supported_fields",
    afterRevoke.status,
    "needs_verification",
  );
  assertEqual("proof.revocation_clears_client_proofs", JSON.stringify(afterRevoke.proofs), "[]");

  const approvedSummaryRevoke = jsonResult(
    "approved_summary_revoke",
    rpc(E612.admin, "revoke_enrollment_publication", {
      orgId: E612.orgA,
      audience: "staff",
      publicationId: approvedSummary.publicationId,
      reason: "E6.13 native summary revocation",
    }),
  );
  const initialSummaryRevoke = jsonResult(
    "initial_summary_revoke",
    rpc(E612.admin, "revoke_enrollment_publication", {
      orgId: E612.orgA,
      audience: "staff",
      publicationId: initialSummaryId,
      reason: "E6.13 native older summary revocation",
    }),
  );
  if (!approvedSummaryRevoke.eventId || !initialSummaryRevoke.eventId)
    fail("E613_SUMMARY_REVOKE_EVENT_MISSING");
  expectedServiceError(
    "publication.revoked_summaries_hide_client_scope",
    E612.clientActive,
    `SELECT public.get_enrollment_scope_detail('${E612.clientActive}', '${E612.orgA}', 'client', '${scopeId}');`,
    "P0002",
    "enrollment_not_found",
  );

  auditAppendOnlyChecks({ scopeId, revisionId: approved.revisionId, factScopeId });
  return {
    approvedRevisionId: approved.revisionId,
    proofPublicationId: proof.publicationId,
    factScopeId,
  };
}

function createFactProof(factScopeId) {
  const factRevisionId = query(
    `SELECT current_revision_id::text FROM private.enrollment_scopes WHERE id = '${factScopeId}';`,
  );
  const proof = publishProof(E612.admin, {
    scopeId: factScopeId,
    revisionId: factRevisionId,
    documentId: FIX.documentFact,
    supportedFields: ["enrollment_status", "facility_id", "product_id"],
    sha256: "9".repeat(64),
  });
  emit("E613|PASS|proof.live_fact_current_proof_registered");
  return { revisionId: factRevisionId, publicationId: proof.publicationId };
}

function reapplicationCycleChecks({ productId, factSource }) {
  const first = jsonResult(
    "reapplication_initial_denial",
    callJson(
      E612.admin,
      `SELECT ${saveCall({
        providerId: FIX.providerA2,
        facilityId: FIX.facilityA2,
        payerProductId: productId,
        revision: revision("denied", { note: "cycle one denial" }),
        sources: [factSource],
      })};`,
    ),
  );
  const second = jsonResult(
    "reapplication_after_denial",
    callJson(
      E612.admin,
      `SELECT ${saveCall({
        scopeId: first.scopeId,
        expectedRevisionId: first.revisionId,
        providerId: FIX.providerA2,
        facilityId: FIX.facilityA2,
        payerProductId: productId,
        revision: revision("in_progress", { note: "cycle two restart" }),
        sources: [factSource],
      })};`,
    ),
  );
  assertEqual(
    "revision.denial_reapplication_increments_cycle",
    `${second.cycleNo}|${second.revisionNo}`,
    "2|1",
  );
  assertEqual(
    "revision.reapplication_retains_both_immutable_histories",
    query(`
    SELECT (SELECT count(*) FROM private.enrollment_scope_revisions WHERE scope_id = '${first.scopeId}') || '|' ||
           (SELECT count(*) FROM private.enrollment_scope_sources WHERE scope_id = '${first.scopeId}') || '|' ||
           (SELECT count(*) FROM public.audit_log WHERE entity_type = 'enrollment_scope' AND entity_id = '${first.scopeId}') || '|' ||
           (SELECT count(DISTINCT revision_id) FROM private.enrollment_scope_sources WHERE scope_id = '${first.scopeId}');
  `),
    "2|2|2|2",
  );
}

function sourceInvalidationChecks({
  scopeId,
  approvedRevisionId,
  factScopeId,
  factProof,
  productA,
}) {
  publishSummary(E612.admin, scopeId, approvedRevisionId);
  publishProof(E612.admin, {
    scopeId,
    revisionId: approvedRevisionId,
    supportedFields: [
      "enrollment_status",
      "product_id",
      "facility_id",
      "effective_date",
      "retro_status",
      "retro_days",
    ],
    sha256: "7".repeat(64),
  });
  assertEqual(
    "publication.source_stale_test_starts_from_valid_client_scope",
    clientDetail(E612.clientActive, scopeId).status,
    "approved",
  );

  setTarget(E612.admin, E612.orgA, E612.groupA1, productA, "AZ");
  const preDeletePage = unresolvedPage(E612.admin, E612.orgA, "staff", E612.groupA1, null, 100);
  const caseSibling = pageItem(preDeletePage, "case", FIX.caseB);
  const factSibling = pageItem(preDeletePage, "fact", FIX.factCaseB);
  const cursorAfterSiblingCase = {
    observedAt: caseSibling.observedAt,
    sourceKind: caseSibling.sourceKind,
    sourceId: caseSibling.sourceId,
  };
  const siblingSave = jsonResult(
    "deleted_sibling_scope",
    callJson(
      E612.admin,
      `SELECT ${saveCall({
        providerId: FIX.providerA2,
        facilityId: FIX.facilityA2,
        state: "AZ",
        payerProductId: productA,
        revision: revision("in_review"),
        sources: [sourceArg(caseSibling), sourceArg(factSibling)],
      })};`,
    ),
  );
  publishSummary(E612.admin, siblingSave.scopeId, siblingSave.revisionId);
  const beforeSiblingDeletePage = unresolvedPage(
    E612.admin,
    E612.orgA,
    "staff",
    E612.groupA1,
    null,
    100,
  );
  assertEqual(
    "triage.published_complete_sibling_is_not_unresolved",
    String(
      beforeSiblingDeletePage.items.some(
        (item) => item.sourceKind === "fact" && item.sourceId === FIX.factCaseB,
      ),
    ),
    "false",
  );
  const siblingLinkBefore =
    query(`SELECT source_id::text || '|' || source_fingerprint || '|' || source_snapshot::text
    FROM private.enrollment_scope_sources WHERE scope_id = '${siblingSave.scopeId}'
      AND source_kind = 'case' AND source_id = '${FIX.caseB}' LIMIT 1;`);
  query(
    asRole(
      "authenticated",
      E612.admin,
      `SELECT public.delete_case('${E612.orgA}', '${FIX.caseB}');`,
    ),
  );
  const siblingLinkAfter =
    query(`SELECT source_id::text || '|' || source_fingerprint || '|' || source_snapshot::text
    FROM private.enrollment_scope_sources WHERE scope_id = '${siblingSave.scopeId}'
      AND source_kind = 'case' AND source_id = '${FIX.caseB}' LIMIT 1;`);
  assertEqual(
    "source.case_purge_preserves_immutable_source_link",
    siblingLinkAfter,
    siblingLinkBefore,
  );
  assertEqual(
    "source.case_row_purged",
    query(`SELECT count(*) FROM public.credential_cases WHERE id = '${FIX.caseB}';`),
    "0",
  );
  assertEqual(
    "source.deleted_sibling_invalidates_revision_batch",
    query(
      `SELECT private.e613_revision_sources_valid('${siblingSave.scopeId}', '${siblingSave.revisionId}');`,
    ),
    "f",
  );
  const afterDeletedSiblingCursor = unresolvedPage(
    E612.admin,
    E612.orgA,
    "staff",
    E612.groupA1,
    cursorAfterSiblingCase,
    100,
  );
  assertEqual(
    "triage.deleted_source_before_cursor_keeps_surviving_batch_member_unresolved",
    pageItem(afterDeletedSiblingCursor, "fact", FIX.factCaseB).triageState,
    "needs_verification",
  );

  const initialFingerprint = sourceFingerprint(E612.admin, "case", FIX.caseA);
  const initialFacilities = JSON.stringify(
    JSON.parse(
      query(`SELECT private.e613_source_snapshot('case', '${FIX.caseA}') -> 'case_facility_ids';`),
    ),
  );
  assertEqual(
    "source.fingerprint_facilities_sorted_exact",
    initialFacilities,
    JSON.stringify([FIX.facilityA1, FIX.facilityA2]),
  );

  query(`UPDATE public.case_facilities SET is_primary = false WHERE case_id = '${FIX.caseA}' AND facility_id = '${FIX.facilityA1}';
    UPDATE public.case_facilities SET is_primary = true WHERE case_id = '${FIX.caseA}' AND facility_id = '${FIX.facilityA2}';`);
  assertEqual(
    "source.noise_field_does_not_change_fingerprint",
    sourceFingerprint(E612.admin, "case", FIX.caseA),
    initialFingerprint,
  );
  query(`UPDATE public.case_facilities SET is_primary = false WHERE case_id = '${FIX.caseA}' AND facility_id = '${FIX.facilityA2}';
    UPDATE public.case_facilities SET is_primary = true WHERE case_id = '${FIX.caseA}' AND facility_id = '${FIX.facilityA1}';`);

  query(
    `DELETE FROM public.case_facilities WHERE case_id = '${FIX.caseA}' AND facility_id = '${FIX.facilityA2}';`,
  );
  const fewerFacilities = JSON.stringify(
    JSON.parse(
      query(`SELECT private.e613_source_snapshot('case', '${FIX.caseA}') -> 'case_facility_ids';`),
    ),
  );
  const changedFacilityFingerprint = sourceFingerprint(E612.admin, "case", FIX.caseA);
  assertEqual(
    "source.facility_change_is_fingerprinted",
    `${fewerFacilities}|${changedFacilityFingerprint !== initialFingerprint}`,
    `${JSON.stringify([FIX.facilityA1])}|true`,
  );
  query(`INSERT INTO public.case_facilities (org_id, case_id, facility_id, is_primary, created_by)
    VALUES ('${E612.orgA}', '${FIX.caseA}', '${FIX.facilityA2}', false, '${E612.admin}');`);
  const restoredFingerprint = sourceFingerprint(E612.admin, "case", FIX.caseA);
  assertEqual(
    "source.sorted_facility_snapshot_reversible",
    restoredFingerprint,
    initialFingerprint,
  );

  query(
    `UPDATE public.credential_cases SET payer_reference_id = 'E613-CASE-REF-CHANGED' WHERE id = '${FIX.caseA}';`,
  );
  const changedSourceFingerprint = sourceFingerprint(E612.admin, "case", FIX.caseA);
  if (changedSourceFingerprint === initialFingerprint)
    fail("E613_CASE_MUTATION_DID_NOT_CHANGE_FINGERPRINT");
  expectedServiceError(
    "publication.stale_source_blocks_new_summary",
    E612.admin,
    `SELECT public.publish_enrollment_summary('${E612.admin}', '${E612.orgA}', 'staff', '${scopeId}', '${approvedRevisionId}');`,
    "40001",
    "enrollment_source_stale",
  );
  const staleClient = clientDetail(E612.clientActive, scopeId);
  assertEqual("publication.stale_source_redacts_client", staleClient.status, "needs_verification");
  for (const key of [
    "approvedDate",
    "effectiveDate",
    "payerReference",
    "retroDays",
    "cycleNo",
    "revisionNo",
    "sources",
    "staffNote",
  ])
    assertAbsent(`privacy.stale_client_excludes_${key}`, staleClient, key);
  expectedServiceError(
    "proof.stale_source_download_denied",
    E612.clientActive,
    `SELECT public.authorize_enrollment_proof_download('${E612.clientActive}', '${E612.orgA}', 'client', (SELECT id FROM private.enrollment_proof_publications WHERE scope_id = '${scopeId}' LIMIT 1));`,
    "P0002",
    "enrollment_not_found",
  );
  const stalePage = unresolvedPage(E612.admin, E612.orgA, "staff", E612.groupA1, null, 100);
  assertEqual(
    "triage.changed_source_needs_verification",
    pageItem(stalePage, "case", FIX.caseA).triageState,
    "needs_verification",
  );

  query(
    `UPDATE public.enrollment_facts SET expired_at = now(), expired_by = '${E612.admin}' WHERE id = '${FIX.factA}';`,
  );
  assertEqual(
    "source.expiry_invalidates_fact_revision",
    query(
      `SELECT private.e613_revision_sources_valid('${factScopeId}', (SELECT current_revision_id FROM private.enrollment_scopes WHERE id = '${factScopeId}'));`,
    ),
    "f",
  );
  expectedServiceError(
    "publication.expired_fact_blocks_summary",
    E612.admin,
    `SELECT public.publish_enrollment_summary('${E612.admin}', '${E612.orgA}', 'staff', '${factScopeId}', (SELECT current_revision_id FROM private.enrollment_scopes WHERE id = '${factScopeId}'));`,
    "40001",
    "enrollment_source_stale",
  );
  expectedServiceError(
    "proof.expired_fact_blocks_new_proof",
    E612.admin,
    `SELECT public.publish_enrollment_proof('${E612.admin}', '${E612.orgA}', 'staff', '${factScopeId}', '${factProof.revisionId}', '${FIX.documentFact}', 'payer_approval_letter', ARRAY['enrollment_status','facility_id','product_id'], '${"8".repeat(64)}', 'Expired source must not prove current');`,
    "40001",
    "enrollment_source_stale",
  );
  expectedServiceError(
    "proof.expired_fact_denies_current_download",
    E612.admin,
    `SELECT public.authorize_enrollment_proof_download('${E612.admin}', '${E612.orgA}', 'staff', '${factProof.publicationId}');`,
    "P0002",
    "enrollment_not_found",
  );
  const expiredPage = unresolvedPage(E612.admin, E612.orgA, "staff", E612.groupA1, null, 100);
  assertEqual(
    "triage.expired_fact_needs_verification",
    pageItem(expiredPage, "fact", FIX.factA).triageState,
    "needs_verification",
  );
  emit("E613|PASS|source.change_expiry_purge_and_immutable_lineage");
}

function benchmarkDistinctSources(productId) {
  const processStartedAt = Date.now();
  const output = query(`
    SET track_functions = 'all';
    CREATE TEMP TABLE e613_bench_timer (name text PRIMARY KEY, at timestamptz NOT NULL) ON COMMIT PRESERVE ROWS;
    INSERT INTO e613_bench_timer VALUES ('setup_start', clock_timestamp());
    CREATE TEMP TABLE e613_bench_sources ON COMMIT PRESERVE ROWS AS
    SELECT source_no::integer AS provider_no,
      public.uuid_generate_v5('f5a8a54d-54ba-4bd2-94a0-e61300000001'::uuid, 'e613-bench-provider-' || source_no) AS provider_id,
      public.uuid_generate_v5('f5a8a54d-54ba-4bd2-94a0-e61300000001'::uuid, 'e613-bench-case-' || source_no) AS case_id,
      public.uuid_generate_v5('f5a8a54d-54ba-4bd2-94a0-e61300000001'::uuid, 'e613-bench-base-scope-' || source_no) AS base_scope_id,
      public.uuid_generate_v5('f5a8a54d-54ba-4bd2-94a0-e61300000001'::uuid, 'e613-bench-base-revision-' || source_no) AS base_revision_id
    FROM generate_series(1, 100000) AS source_no;

    CREATE TEMP TABLE e613_bench_products ON COMMIT PRESERVE ROWS AS
      SELECT 1 AS product_no, '${productId}'::uuid AS product_id
      UNION ALL
      SELECT product_no,
        public.uuid_generate_v5('f5a8a54d-54ba-4bd2-94a0-e61300000001'::uuid, 'e613-bench-product-' || product_no)
      FROM generate_series(2, 20) AS product_no;
    INSERT INTO private.payer_products (id, payer_id, product_key, display_name, is_active, created_by)
    SELECT product.product_id, '${FIX.payerA}', 'e613-benchmark-product-' || lpad(product.product_no::text, 2, '0'),
      'E613 benchmark product ' || product.product_no, true, '${E612.admin}'
    FROM e613_bench_products product WHERE product.product_no > 1;
    INSERT INTO private.group_product_targets
      (org_id, group_id, payer_product_id, payer_id, state, is_active, created_by, updated_by)
    SELECT '${E612.orgA}', '${E612.groupA1}', product.product_id, '${FIX.payerA}', 'CO', true,
      '${E612.admin}', '${E612.admin}'
    FROM e613_bench_products product
    ON CONFLICT (org_id, group_id, payer_product_id, state) DO UPDATE
      SET is_active = EXCLUDED.is_active, updated_by = EXCLUDED.updated_by, updated_at = now();

    INSERT INTO public.providers (id, org_id, group_id, first_name, last_name, status)
    SELECT source.provider_id, '${E612.orgA}', '${E612.groupA1}', 'Perf', 'Clinician ' || source.provider_no, 'active'
    FROM e613_bench_sources source;
    INSERT INTO public.provider_group_assignments (org_id, provider_id, group_id, is_primary, start_date)
    SELECT '${E612.orgA}', source.provider_id, '${E612.groupA1}', true, '2025-01-01'
    FROM e613_bench_sources source;
    INSERT INTO public.provider_facility_assignments (org_id, provider_id, facility_id, is_primary, start_date)
    SELECT '${E612.orgA}', source.provider_id, '${FIX.facilityA1}', true, '2025-01-01'
    FROM e613_bench_sources source
    UNION ALL
    SELECT '${E612.orgA}', source.provider_id, '${FIX.facilityA2}', false, '2025-01-01'
    FROM e613_bench_sources source WHERE source.provider_no <= 3000;
    INSERT INTO public.credential_cases
      (id, org_id, provider_id, group_id, facility_id, payer_id, state, case_status,
       submitted_date, approved_date, confirmed_effective_date, expected_effective_date,
       payer_reference_id, payer_individual_provider_id, payer_group_provider_id,
       contract_executed_date, created_by)
    SELECT source.case_id, '${E612.orgA}', source.provider_id, '${E612.groupA1}', '${FIX.facilityA1}',
      '${FIX.payerA}', 'CO', CASE WHEN source.provider_no % 2 = 0 THEN 'approved' ELSE 'in_review' END,
      date '2024-01-01' + (source.provider_no % 700),
      CASE WHEN source.provider_no % 2 = 0 THEN date '2024-01-01' + (source.provider_no % 700) ELSE NULL END,
      CASE WHEN source.provider_no % 2 = 0 THEN date '2024-04-01' + (source.provider_no % 365) ELSE NULL END,
      date '2024-02-01' + (source.provider_no % 365),
      'E613-BENCH-REF-' || source.provider_no,
      'E613-BENCH-TYPE1-' || source.provider_no,
      'E613-BENCH-TYPE2-' || source.provider_no,
      date '2024-03-01' + (source.provider_no % 365), '${E612.admin}'
    FROM e613_bench_sources source;
    INSERT INTO public.case_facilities (org_id, case_id, facility_id, is_primary, created_by)
    SELECT '${E612.orgA}', source.case_id, '${FIX.facilityA1}', true, '${E612.admin}' FROM e613_bench_sources source
    UNION ALL
    SELECT '${E612.orgA}', source.case_id, '${FIX.facilityA2}', false, '${E612.admin}'
    FROM e613_bench_sources source WHERE source.provider_no <= 3000;

    CREATE TEMP TABLE e613_bench_revisions ON COMMIT PRESERVE ROWS AS
    SELECT source.provider_no, source.provider_id, source.case_id,
      source.base_scope_id AS scope_id, source.base_revision_id AS revision_id,
      product.product_id, '${FIX.facilityA1}'::uuid AS facility_id
    FROM e613_bench_sources source
    JOIN e613_bench_products product ON product.product_no = 1
    UNION ALL
    SELECT source.provider_no, source.provider_id, source.case_id,
      public.uuid_generate_v5('f5a8a54d-54ba-4bd2-94a0-e61300000001'::uuid,
        'e613-bench-scope-' || source.provider_no || '-' || product.product_no || '-' || facility.facility_no) AS scope_id,
      public.uuid_generate_v5('f5a8a54d-54ba-4bd2-94a0-e61300000001'::uuid,
        'e613-bench-revision-' || source.provider_no || '-' || product.product_no || '-' || facility.facility_no) AS revision_id,
      product.product_id, facility.facility_id
    FROM e613_bench_sources source
    CROSS JOIN e613_bench_products product
    CROSS JOIN (VALUES (1, '${FIX.facilityA1}'::uuid), (2, '${FIX.facilityA2}'::uuid)) facility(facility_no, facility_id)
    WHERE source.provider_no <= 3000
      AND NOT (product.product_no = 1 AND facility.facility_no = 1);
    CREATE UNIQUE INDEX e613_bench_revisions_scope_uq ON e613_bench_revisions(scope_id);
    CREATE INDEX e613_bench_revisions_case_idx ON e613_bench_revisions(case_id);

    CREATE INDEX e613_bench_audit_guard_idx ON public.audit_log(entity_type, entity_id);
    BEGIN;
    INSERT INTO private.enrollment_scopes
      (id, org_id, provider_id, group_id, payer_product_id, payer_id, facility_id, state, current_revision_id, created_by)
    SELECT revision.scope_id, '${E612.orgA}', revision.provider_id, '${E612.groupA1}', revision.product_id,
      '${FIX.payerA}', revision.facility_id, 'CO', revision.revision_id, '${E612.admin}'
    FROM e613_bench_revisions revision;
    INSERT INTO private.enrollment_scope_revisions
      (id, org_id, scope_id, cycle_no, revision_no, status, action_owner, retro_status, observed_at, created_by)
    SELECT revision.revision_id, '${E612.orgA}', revision.scope_id, 1, 1, 'in_progress', 'Payer', 'unknown',
      now(), '${E612.admin}'
    FROM e613_bench_revisions revision;
    INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, after, description)
    SELECT '${E612.orgA}', '${E612.admin}', 'CREATE', 'enrollment_scope', revision.scope_id,
      jsonb_build_object('revisionId', revision.revision_id, 'cycleNo', 1, 'revisionNo', 1, 'sourceCount', 1),
      'E613 synthetic batch benchmark revision'
    FROM e613_bench_revisions revision;
    COMMIT;
    DROP INDEX public.e613_bench_audit_guard_idx;

    CREATE TEMP TABLE e613_bench_snapshots ON COMMIT PRESERVE ROWS AS
    WITH material AS MATERIALIZED (
      SELECT source.provider_no, source.case_id, private.e613_source_snapshot('case', source.case_id) AS snapshot
      FROM e613_bench_sources source
    )
    SELECT material.provider_no, material.case_id, material.snapshot,
      private.e613_source_fingerprint(material.snapshot) AS fingerprint
    FROM material;
    CREATE UNIQUE INDEX e613_bench_snapshots_case_uq ON e613_bench_snapshots(case_id);
    INSERT INTO private.enrollment_scope_sources
      (org_id, scope_id, revision_id, source_kind, source_id, source_identity,
       source_snapshot, source_fingerprint, created_by)
    SELECT '${E612.orgA}', revision.scope_id, revision.revision_id, 'case', revision.case_id,
      jsonb_build_object('org_id', '${E612.orgA}', 'provider_id', revision.provider_id,
        'group_id', '${E612.groupA1}', 'payer_product_id', revision.product_id,
        'facility_id', revision.facility_id, 'state', 'CO'),
      snapshot.snapshot, snapshot.fingerprint, '${E612.admin}'
    FROM e613_bench_revisions revision
    JOIN e613_bench_snapshots snapshot ON snapshot.case_id = revision.case_id;
    ANALYZE public.credential_cases;
    ANALYZE public.case_facilities;
    ANALYZE private.enrollment_scope_revisions;
    ANALYZE private.enrollment_scope_sources;
    INSERT INTO e613_bench_timer VALUES ('setup_end', clock_timestamp());

    SELECT pg_stat_reset_single_function_counters('private.e613_source_snapshot(text,uuid)'::regprocedure);
    SELECT pg_stat_reset_single_function_counters('private.e613_source_fingerprint(jsonb)'::regprocedure);
    BEGIN;
    WITH started AS MATERIALIZED (
      SELECT clock_timestamp() AS at
    ), input AS MATERIALIZED (
      SELECT started.at AS started_at,
        jsonb_agg(jsonb_build_object('scope_id', revision.scope_id, 'revision_id', revision.revision_id)) AS revisions
      FROM started CROSS JOIN e613_bench_revisions revision GROUP BY started.at
    ), checked AS MATERIALIZED (
      SELECT batch.* FROM input
      CROSS JOIN LATERAL private.e613_revision_source_batch(input.revisions) batch
    ), counts AS MATERIALIZED (
      SELECT count(*) AS revision_count, count(*) FILTER (WHERE source_valid) AS valid_count FROM checked
    ), finished AS MATERIALIZED (
      SELECT clock_timestamp() AS at FROM counts
    )
    SELECT counts.revision_count::text || '|' || counts.valid_count::text || '|' ||
      round((extract(epoch FROM (finished.at - input.started_at)) * 1000)::numeric, 2)::text || '|' ||
      (SELECT extract(epoch FROM (setup_end.at - setup_start.at)) * 1000
         FROM e613_bench_timer setup_start JOIN e613_bench_timer setup_end
           ON setup_start.name = 'setup_start' AND setup_end.name = 'setup_end')::numeric(14,2)::text
    FROM counts CROSS JOIN finished CROSS JOIN input;
    SELECT pg_stat_force_next_flush();
    COMMIT;
    SELECT pg_stat_clear_snapshot();
    SELECT COALESCE((SELECT calls::text FROM pg_stat_user_functions
      WHERE funcid = 'private.e613_source_snapshot(text,uuid)'::regprocedure::oid), '0') || '|' ||
      COALESCE((SELECT calls::text FROM pg_stat_user_functions
      WHERE funcid = 'private.e613_source_fingerprint(jsonb)'::regprocedure::oid), '0');
  `)
    .split("\n")
    .filter(Boolean);
  const elapsedMs = Date.now() - processStartedAt;
  const [batchRow, functionCounters] = output;
  if (!batchRow || !functionCounters) fail("E613_BENCHMARK_OUTPUT_MISSING");
  const [revisionCount, validCount, batchMs, fixtureMs] = batchRow.split("|");
  const [snapshotCalls, fingerprintCalls] = functionCounters.split("|");
  const counts = query(`
    SELECT count(*) || '|' || (SELECT count(*) FROM private.enrollment_scope_sources WHERE scope_id IN (
      SELECT id FROM private.enrollment_scopes WHERE created_by = '${E612.admin}' AND provider_id IN (
        SELECT id FROM public.providers WHERE last_name LIKE 'Clinician %'))
    ) || '|' || (SELECT count(DISTINCT source_id) FROM private.enrollment_scope_sources WHERE source_kind = 'case'
      AND scope_id IN (SELECT id FROM private.enrollment_scopes WHERE provider_id IN (
        SELECT id FROM public.providers WHERE last_name LIKE 'Clinician %'))) || '|' ||
      (SELECT count(*) FROM private.enrollment_scopes scope JOIN public.providers provider ON provider.id = scope.provider_id
        WHERE provider.last_name ~ '^Clinician [0-9]+$'
          AND substring(provider.last_name from '^Clinician ([0-9]+)$')::integer <= 3000) || '|' ||
      (SELECT count(*) FROM private.enrollment_scope_sources source JOIN private.enrollment_scopes scope
          ON scope.id = source.scope_id JOIN public.providers provider ON provider.id = scope.provider_id
        WHERE source.source_kind = 'case' AND provider.last_name ~ '^Clinician [0-9]+$'
          AND substring(provider.last_name from '^Clinician ([0-9]+)$')::integer <= 3000)
    FROM public.providers WHERE last_name LIKE 'Clinician %';
  `);
  const [providers, links, distinctSources, fanoutScopes, fanoutLinks] = counts.split("|");
  assertEqual(
    "benchmark.100k_real_canonical_sources_and_revision_batches",
    `${providers}|${distinctSources}|${revisionCount}|${validCount}|${snapshotCalls}|${fingerprintCalls}|${links}`,
    `100000|100000|217000|217000|100000|100000|217000`,
  );
  assertEqual(
    "benchmark.source_snapshot_compute_count_is_distinct_reference_count",
    snapshotCalls,
    "100000",
  );
  assertEqual(
    "benchmark.fingerprint_compute_count_is_distinct_reference_count",
    fingerprintCalls,
    "100000",
  );
  assertEqual(
    "benchmark.three_thousand_provider_twenty_product_two_location_fanout",
    `${fanoutScopes}|${fanoutLinks}`,
    "120000|120000",
  );
  emit(
    `E613|BENCHMARK|canonical_source_batch|source_records=100000|distinct_source_refs=${distinctSources}|source_links=${links}|revision_batches=${revisionCount}|valid=${validCount}|snapshot_calls=${snapshotCalls}|fingerprint_calls=${fingerprintCalls}|batch_ms=${batchMs}|fixture_setup_ms=${fixtureMs}|process_ms=${elapsedMs}`,
  );
  emit(
    `E613|BENCHMARK|catalog_publication_source_fanout|clinicians=3000|products=20|locations_per_product=2|scope_rows=${fanoutScopes}|source_link_rows=${fanoutLinks}`,
  );
}

function migrations() {
  const files = readdirSync(`${root}supabase/migrations`)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (!files.includes(e612Migration)) fail("E613_E612_MIGRATION_MISSING");
  if (!files.includes(e613Migration)) fail("E613_MIGRATION_MISSING");
  const source = readFileSync(`${root}supabase/migrations/${e613Migration}`, "utf8");
  if (!source.trim()) fail("E613_MIGRATION_EMPTY");
  return files;
}

const bootstrap = `
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, email_confirmed_at timestamptz,
  banned_until timestamptz, deleted_at timestamptz, is_anonymous boolean NOT NULL DEFAULT false,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), current_user::text)
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'sub', NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    'role', NULLIF(current_setting('request.jwt.claim.role', true), ''),
    'email', NULLIF(current_setting('request.jwt.claim.email', true), '')
  )
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;
`;

function authFixtureSql() {
  return `INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
    VALUES ${USERS.map(
      ([id, email]) => `('${id}', ${sqlLiteral(email)}, now(), '{}'::jsonb, '{}'::jsonb)`,
    ).join(",\n")}
    ON CONFLICT (id) DO NOTHING;`;
}

function applyOne(name, role = "postgres") {
  const source = readFileSync(`${root}supabase/migrations/${name}`, "utf8");
  const result = runAs(role, source);
  if (!result.ok) {
    const state = sqlState(`${result.out}\n${result.err}`);
    emit(`E613|MIGRATION_ERROR|${name}|sqlstate=${state ?? "unknown"}`);
    fail(`E613_MIGRATION_FAILED_${migrationSlug(name)}_${state ?? "UNKNOWN"}`);
  }
}

function applyWithRestrictedMigrator(name) {
  sql(`CREATE ROLE e613_restricted_migrator LOGIN CREATEROLE NOSUPERUSER BYPASSRLS;
       GRANT postgres TO e613_restricted_migrator WITH INHERIT TRUE, SET FALSE;`);
  try {
    applyOne(name, "e613_restricted_migrator");
  } finally {
    sql(`REASSIGN OWNED BY e613_restricted_migrator TO postgres;
         DROP OWNED BY e613_restricted_migrator;
         REVOKE postgres FROM e613_restricted_migrator;
         DROP ROLE e613_restricted_migrator;`);
  }
}

function applyMigrationChain(files) {
  const at612 = files.indexOf(e612Migration);
  const at613 = files.indexOf(e613Migration);
  if (at612 < 0 || at613 <= at612) fail("E613_MIGRATION_ORDER_INVALID");
  for (const name of files.slice(0, at612)) applyOne(name);
  applyWithRestrictedMigrator(e612Migration);
  for (const name of files.slice(at612 + 1, at613)) applyOne(name);
  applyWithRestrictedMigrator(e613Migration);
  for (const name of files.slice(at613 + 1)) applyOne(name);
}

function assertEqual(label, actual, expected) {
  if (actual !== expected)
    fail(`E613_${migrationSlug(label)}_EXPECTED_${String(expected)}_GOT_${String(actual)}`);
  emit(`E613|PASS|${label}`);
}

// E6.13-specific synthetic fixture, assertions, and benchmark follow below.

let started = false;
try {
  const imageId = docker(["image", "inspect", image, "--format", "{{.Id}}"]).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) fail("E613_CACHED_POSTGRES_IMAGE_REQUIRED");
  docker([
    "run",
    "--detach",
    "--rm",
    "--pull",
    "never",
    "--name",
    container,
    "--label",
    "com.minted.e613=synthetic-only",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    "postgres",
    "--tmpfs",
    "/tmp:rw,mode=1777",
    "--entrypoint",
    "/bin/sh",
    imageId,
    "-c",
    "initdb -D /tmp/e613-data --no-locale --encoding=UTF8 --auth=trust >/tmp/init.log 2>&1 && exec postgres -D /tmp/e613-data -k /tmp -c listen_addresses='' -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse",
  ]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      docker(["exec", container, "pg_isready", "-q", "-h", "/tmp", "-U", "postgres"]);
      ready = true;
      break;
    } catch {
      await pause(250);
    }
  }
  if (!ready) fail("E613_DATABASE_NOT_READY");
  emit(`E613|IMAGE|${imageId}`);
  emit(`E613|POSTGRES|${sql("SHOW server_version;").trim()}`);
  sql(bootstrap);
  applyMigrationChain(migrations());
  sql(authFixtureSql());
  sql(baseFixtureSql());
  sql(restrictedFixtureSql());
  emit("E613|PHASE|auth_fixtures_ready");
  catalogChecks();
  seedDomainFixtures();
  fingerprintFieldCoverage();
  const saved = productAndTriageChecks();
  const initialSummary = initialPublicationChecks({
    scopeId: saved.scopeId,
    initialRevisionId: saved.initialRevisionId,
  });
  const factProof = createFactProof(saved.factScopeId);
  reapplicationCycleChecks({ productId: saved.productAlt, factSource: saved.factSource });
  const raceWinner = await concurrentRevisionCheck({
    scopeId: saved.scopeId,
    currentRevisionId: saved.initialRevisionId,
    payerProductId: saved.productA,
    source: [saved.caseSource, saved.linkedFactSource],
  });
  const publications = publicationChecks({
    scopeId: saved.scopeId,
    currentRevisionId: raceWinner.revisionId,
    initialSummaryId: initialSummary.publicationId,
    caseSource: saved.caseSource,
    linkedFactSource: saved.linkedFactSource,
    productA: saved.productA,
    factScopeId: saved.factScopeId,
  });
  sourceInvalidationChecks({
    scopeId: saved.scopeId,
    approvedRevisionId: publications.approvedRevisionId,
    factScopeId: saved.factScopeId,
    factProof,
    productA: saved.productA,
  });
  benchmarkDistinctSources(saved.productA);
  emit("E613|NATIVE|PASS");
} catch (error) {
  const code =
    error instanceof Error && /^E613_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "E613_NATIVE_VERIFICATION_FAILED";
  const detail =
    error instanceof Error
      ? [error.stderr, error.stdout, error.message].filter(Boolean).map(String).join("\n")
      : String(error);
  const state = sqlState(detail);
  if (state) {
    emit(`E613|ERROR|sqlstate=${state}`);
    process.stderr.write(`${detail.slice(0, 3000)}\n`);
  } else if (code === "E613_NATIVE_VERIFICATION_FAILED")
    process.stderr.write(`${detail.slice(0, 1500)}\n`);
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      docker(["rm", "--force", container]);
      emit("E613|CLEANUP|PASS");
    } catch {
      process.stderr.write("E613_CLEANUP_FAILED\n");
      process.exitCode = 1;
    }
  }
}
