// E6.14 native SQL evidence. Applies the complete migration chain to one
// isolated, networkless PostgreSQL container and exercises report RPCs with
// synthetic actors and data. This is not hosted-database or HTTP evidence.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { E614_SCALE_FIXTURE, e614ScaleFixtureSql } from "./e614-report-fixtures.mjs";
import {
  E612,
  USERS,
  asRole,
  baseFixtureSql,
  restrictedFixtureSql,
  sqlLiteral,
} from "./e612-fixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const context = process.env.E614_DOCKER_CONTEXT || "default";
const image = process.env.E614_POSTGRES_IMAGE || "postgres:16";
const container = `minted-e614-native-${randomUUID()}`;
const compileOnly = process.env.E614_COMPILE_ONLY === "1";
const scale = process.env.E614_SCALE === "1";
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
const stateFrom = (text) =>
  text.match(/(?:ERROR|SQLSTATE|SQL state)[: ]+([A-Z0-9]{5})/i)?.[1]?.toUpperCase() ?? null;
const slug = (value) => value.replaceAll(/[^A-Za-z0-9]+/g, "_");

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
const sql = (input) => docker(psqlArgs, input);

function migrations() {
  const files = readdirSync(`${root}supabase/migrations`)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (!files.some((name) => name.endsWith("_e614_enrollment_explorer_report.sql")))
    fail("E614_REPORT_MIGRATION_MISSING");
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
  SELECT jsonb_build_object('sub', NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    'role', NULLIF(current_setting('request.jwt.claim.role', true), ''))
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;
`;

function authFixtures() {
  return `INSERT INTO auth.users (id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data)
    VALUES ${USERS.map(([id, email]) => `('${id}',${sqlLiteral(email)},now(),'{}','{}')`).join(",")}
    ON CONFLICT (id) DO NOTHING;`;
}

function applyMigrations(files) {
  for (const name of files) {
    try {
      sql(readFileSync(`${root}supabase/migrations/${name}`, "utf8"));
    } catch (error) {
      const stderr = String(error.stderr ?? "");
      const state = stateFrom(stderr);
      emit(`E614|MIGRATION_ERROR|${name}|sqlstate=${state ?? "unknown"}`);
      if (name.endsWith("_e614_enrollment_explorer_report.sql")) {
        const safe = stderr
          .split("\n")
          .filter((line) => /ERROR:|POSITION:|LINE:|QUERY:|CONTEXT:/i.test(line));
        for (const line of safe.slice(0, 5)) emit(`E614|PG|${line.trim().slice(0, 500)}`);
      }
      fail(`E614_MIGRATION_FAILED_${slug(name)}_${state ?? "UNKNOWN"}`);
    }
  }
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) fail(`E614_${slug(label)}_EXPECTED_${expected}_GOT_${actual}`);
  emit(`E614|PASS|${label}`);
}

function expectSqlState(label, actor, statement, expected) {
  let stderr = "";
  try {
    sql(asRole("service_role", actor, statement));
  } catch (error) {
    stderr = String(error.stderr ?? "");
  }
  if (!stderr) fail(`E614_${slug(label)}_EXPECTED_ERROR_${expected}`);
  const actual = stateFrom(stderr);
  assertEqual(label, actual, expected);
}

const FIX = Object.freeze({
  payer: "90000000-0000-4000-8000-000000000001",
  facility: "90000000-0000-4000-8000-000000000011",
  case: "90000000-0000-4000-8000-000000000021",
});

function callJson(actor, statement) {
  return JSON.parse(
    sql(asRole("service_role", actor, statement))
      .toString()
      .trim(),
  );
}

function seedReportFixture() {
  sql(`
    INSERT INTO public.payers
      (id, org_id, name, is_active, payer_kind, payer_slug, states, status)
    VALUES ('${FIX.payer}', '${E612.orgA}', 'E614 Synthetic Payer', true, 'commercial',
      'e614-synthetic-payer', ARRAY['CO']::text[], 'active');
    INSERT INTO public.facilities (id, org_id, group_id, name, state, is_active)
    VALUES ('${FIX.facility}', '${E612.orgA}', '${E612.groupA1}', 'E614 Synthetic Facility', 'CO', true);
    UPDATE public.providers
      SET verification_state = 'verified', taxonomy_code = '225100000X'
      WHERE id = '${E612.provider}' AND org_id = '${E612.orgA}';
    INSERT INTO public.provider_group_assignments (org_id, provider_id, group_id, is_primary)
    VALUES ('${E612.orgA}', '${E612.provider}', '${E612.groupA1}', true);
    INSERT INTO public.provider_facility_assignments (org_id, provider_id, facility_id, is_primary, start_date)
    VALUES ('${E612.orgA}', '${E612.provider}', '${FIX.facility}', true, CURRENT_DATE);
  `);
}

function paginationChecks() {
  sql(`
    INSERT INTO public.providers
      (id, org_id, group_id, first_name, last_name, status, taxonomy_code,
       verification_state, reference_only, is_test_provider)
    SELECT ('71000000-0000-4000-8000-' || lpad(provider_no::text, 12, '0'))::uuid,
      '${E612.orgA}', '${E612.groupA1}', 'Batch', lpad(provider_no::text, 3, '0'),
      'active', '225100000X', 'verified', false, false
    FROM generate_series(1, 101) AS provider_no;
    INSERT INTO public.provider_group_assignments (org_id, provider_id, group_id, is_primary)
    SELECT '${E612.orgA}', ('71000000-0000-4000-8000-' || lpad(provider_no::text, 12, '0'))::uuid,
      '${E612.groupA1}', true
    FROM generate_series(1, 101) AS provider_no;
  `);

  const request = (cursor) => `SELECT public.get_enrollment_report_snapshot(
    '${E612.admin}', '${E612.orgA}', 'staff', ${sqlLiteral(JSON.stringify({ search: "Batch" }))}::jsonb,
    ARRAY[]::text[], ARRAY[]::text[], ${cursor ? `${sqlLiteral(JSON.stringify(cursor))}::jsonb` : "NULL::jsonb"}, 'page');`;
  const first = callJson(E612.admin, request(null));
  assertEqual("pagination.filtered_count", first.providerCount, 101);
  assertEqual("pagination.first_page_size", first.providers.length, 50);
  assertEqual("pagination.first_page_more", first.hasMore, true);
  const second = callJson(E612.admin, request(first.nextCursorKey));
  assertEqual("pagination.second_page_size", second.providers.length, 50);
  assertEqual("pagination.second_page_more", second.hasMore, true);
  const third = callJson(E612.admin, request(second.nextCursorKey));
  assertEqual("pagination.third_page_size", third.providers.length, 1);
  assertEqual("pagination.third_page_more", third.hasMore, false);
  const uniqueIds = new Set(
    [...first.providers, ...second.providers, ...third.providers].map(
      (provider) => provider.providerId,
    ),
  );
  assertEqual("pagination.exactly_once_rows", uniqueIds.size, 101);
}

function reportRpcChecks() {
  const emptyConfig = callJson(
    E612.admin,
    `SELECT public.get_enrollment_report_snapshot(
    '${E612.admin}', '${E612.orgA}', 'staff', '{}'::jsonb,
    ARRAY[]::text[], ARRAY[]::text[], NULL::jsonb, 'page');`,
  );
  assertEqual("report.zero_target_provider_count", emptyConfig.providerCount, 1);
  assertEqual(
    "report.zero_target_provider_has_no_sections",
    emptyConfig.providers[0].sectionKeys.length,
    0,
  );
  assertEqual("report.zero_target_provider_has_no_cells", emptyConfig.providers[0].cells.length, 0);

  sql(`UPDATE public.provider_group_assignments SET end_date = CURRENT_DATE - 1
    WHERE org_id = '${E612.orgA}' AND provider_id = '${E612.provider}'
      AND group_id = '${E612.groupA1}';`);
  const endedGroup = callJson(
    E612.admin,
    `SELECT public.get_enrollment_report_snapshot(
    '${E612.admin}', '${E612.orgA}', 'staff', '{}'::jsonb,
    ARRAY[]::text[], ARRAY[]::text[], NULL::jsonb, 'page');`,
  );
  assertEqual("report.ended_group_assignment_excluded", endedGroup.providerCount, 0);
  sql(`UPDATE public.provider_group_assignments SET end_date = NULL
    WHERE org_id = '${E612.orgA}' AND provider_id = '${E612.provider}'
      AND group_id = '${E612.groupA1}';`);

  sql(`UPDATE public.facilities SET is_active = false WHERE id = '${FIX.facility}';`);
  const inactiveFacility = callJson(
    E612.admin,
    `SELECT public.get_enrollment_report_snapshot(
    '${E612.admin}', '${E612.orgA}', 'staff',
    '{"facilityId":"${FIX.facility}"}'::jsonb,
    ARRAY[]::text[], ARRAY[]::text[], NULL::jsonb, 'page');`,
  );
  assertEqual("report.inactive_facility_assignment_excluded", inactiveFacility.providerCount, 0);
  sql(`UPDATE public.facilities SET is_active = true WHERE id = '${FIX.facility}';`);

  const noGrant = callJson(
    E612.clientNoGrant,
    `SELECT public.get_enrollment_report_snapshot(
    '${E612.clientNoGrant}', '${E612.orgA}', 'client', '{}'::jsonb,
    ARRAY[]::text[], ARRAY[]::text[], NULL::jsonb, 'page');`,
  );
  assertEqual("report.no_grants_access_state", noGrant.accessState, "no_grants");
  assertEqual("report.no_grants_provider_count", noGrant.providerCount, 0);

  const product = callJson(
    E612.admin,
    `SELECT public.curate_enrollment_payer_product(
    '${E612.admin}', '${E612.orgA}', 'staff', '${FIX.payer}', 'e614-plan', 'E614 Plan', true);`,
  ).productId;
  callJson(
    E612.admin,
    `SELECT public.set_enrollment_group_product_target(
    '${E612.admin}', '${E612.orgA}', 'staff', '${E612.groupA1}', '${product}', 'CO', true);`,
  );

  const saved = callJson(
    E612.admin,
    `SELECT public.save_enrollment_revision(
    '${E612.admin}', '${E612.orgA}', 'staff', NULL, NULL, '${E612.provider}',
    '${E612.groupA1}', '${product}', '${FIX.facility}', 'CO',
    ${sqlLiteral(
      JSON.stringify({
        status: "submitted",
        intakeDate: "2026-01-02",
        submittedDate: "2026-01-15",
        payerAcknowledgedDate: "2026-01-18",
        approvedDate: "2026-01-25",
        effectiveDate: "2026-02-01",
        terminationDate: "2026-12-31",
        payerReference: "E614-DRAFT-REF",
        clientSafeBlocker: "Awaiting payer review",
        owner: "Payer",
        retroStatus: "unknown",
      }),
    )}::jsonb, '[]'::jsonb);`,
  );

  const snapshot = callJson(
    E612.admin,
    `SELECT public.get_enrollment_report_snapshot(
    '${E612.admin}', '${E612.orgA}', 'staff', '{}'::jsonb,
    ARRAY['225100000X']::text[], ARRAY['225100000X']::text[], NULL::jsonb, 'page');`,
  );
  assertEqual("report.scope_access_state", snapshot.accessState, "ready");
  assertEqual("report.scope_provider_count", snapshot.providerCount, 1);
  assertEqual("report.scope_cell_count", snapshot.providers[0].cells.length, 1);
  assertEqual("report.scope_location_count", snapshot.providers[0].cells[0].locationCount, 1);
  assertEqual(
    "report.scope_publication_state",
    snapshot.providers[0].cells[0].locations[0].publicationState,
    "draft",
  );
  assertEqual(
    "report.scope_draft_status",
    snapshot.providers[0].cells[0].locations[0].status,
    "submitted",
  );

  sql(`UPDATE public.facilities SET name = 'E614 Renamed Facility' WHERE id = '${FIX.facility}';`);
  const facilityRename = callJson(
    E612.admin,
    `SELECT public.get_enrollment_report_snapshot(
    '${E612.admin}', '${E612.orgA}', 'staff', '{}'::jsonb,
    ARRAY['225100000X']::text[], ARRAY['225100000X']::text[], NULL::jsonb, 'page');`,
  );
  if (facilityRename.snapshotDigest === snapshot.snapshotDigest)
    fail("E614_DIGEST_IGNORES_FACILITY_LABEL_CHANGE");
  emit("E614|PASS|digest_binds_facility_labels");

  sql(`UPDATE private.group_product_targets SET is_active = false
    WHERE org_id = '${E612.orgA}' AND group_id = '${E612.groupA1}'
      AND payer_product_id = '${product}' AND state = 'CO';`);
  const retiredTarget = callJson(
    E612.admin,
    `SELECT public.get_enrollment_report_snapshot(
    '${E612.admin}', '${E612.orgA}', 'staff', '{}'::jsonb,
    ARRAY['225100000X']::text[], ARRAY['225100000X']::text[], NULL::jsonb, 'page');`,
  );
  if (retiredTarget.snapshotDigest === facilityRename.snapshotDigest)
    fail("E614_DIGEST_IGNORES_TARGET_RETIREMENT");
  assertEqual(
    "report.retired_target_scope_still_visible",
    retiredTarget.providers[0].cells.length,
    1,
  );
  emit("E614|PASS|digest_binds_target_lifecycle");
  sql(`UPDATE private.group_product_targets SET is_active = true
    WHERE org_id = '${E612.orgA}' AND group_id = '${E612.groupA1}'
      AND payer_product_id = '${product}' AND state = 'CO';`);

  const exportSnapshot = callJson(
    E612.admin,
    `SELECT public.get_enrollment_report_snapshot(
    '${E612.admin}', '${E612.orgA}', 'staff', '{}'::jsonb,
    ARRAY['225100000X']::text[], ARRAY['225100000X']::text[], NULL::jsonb, 'export');`,
  );
  assertEqual("report.draft_export_row_count", exportSnapshot.rowCount, 1);
  assertEqual(
    "report.draft_export_publication_state",
    exportSnapshot.records[0].publicationState,
    "draft",
  );
  assertEqual(
    "report.draft_export_submitted_date",
    exportSnapshot.records[0].submittedDate,
    "2026-01-15",
  );
  assertEqual(
    "report.draft_export_payer_reference",
    exportSnapshot.records[0].payerReference,
    "E614-DRAFT-REF",
  );
  assertEqual(
    "report.draft_export_approved_date",
    exportSnapshot.records[0].approvedDate,
    "2026-01-25",
  );
  assertEqual(
    "report.draft_export_effective_date",
    exportSnapshot.records[0].effectiveDate,
    "2026-02-01",
  );
  assertEqual(
    "report.draft_export_termination_date",
    exportSnapshot.records[0].terminationDate,
    "2026-12-31",
  );
  assertEqual("report.draft_export_owner", exportSnapshot.records[0].owner, "Payer");
  assertEqual(
    "report.draft_export_blocker",
    exportSnapshot.records[0].clientSafeBlocker,
    "Awaiting payer review",
  );

  const history = callJson(
    E612.admin,
    `SELECT public.get_enrollment_scope_history_page(
    '${E612.admin}', '${E612.orgA}', 'staff', '${saved.scopeId}', NULL::jsonb, 10);`,
  );
  assertEqual("history.staff_scope_id", history.scopeId, saved.scopeId);
  assertEqual("history.staff_revision_count", history.items.length, 1);
  assertEqual("history.staff_revision_id", history.items[0].revisionId, saved.revisionId);
  assertEqual("history.staff_cycle_number", history.items[0].cycleNo, 1);
  assertEqual("history.staff_revision_number", history.items[0].revisionNo, 1);

  expectSqlState(
    "history.client_never_published_scope_hidden",
    E612.clientActive,
    `SELECT public.get_enrollment_scope_history_page(
      '${E612.clientActive}', '${E612.orgA}', 'client', '${saved.scopeId}', NULL::jsonb, 10);`,
    "P0002",
  );

  callJson(
    E612.admin,
    `SELECT public.publish_enrollment_summary(
    '${E612.admin}', '${E612.orgA}', 'staff', '${saved.scopeId}', '${saved.revisionId}');`,
  );
  const clientHistory = callJson(
    E612.clientActive,
    `SELECT public.get_enrollment_scope_history_page(
    '${E612.clientActive}', '${E612.orgA}', 'client', '${saved.scopeId}', NULL::jsonb, 10);`,
  );
  assertEqual("history.client_item_count", clientHistory.items.length, 1);
  assertEqual(
    "history.client_publication_state",
    clientHistory.items[0].publicationState,
    "published",
  );
  assertEqual(
    "history.client_status_with_unproved_effective_date",
    clientHistory.items[0].status,
    "needs_verification",
  );
  assertEqual("history.client_product_label", clientHistory.items[0].productLabel, "E614 Plan");
  assertEqual(
    "history.client_facility_label",
    clientHistory.items[0].facilityLabel,
    "E614 Renamed Facility",
  );
  if (
    /sourceFingerprint|sourceSnapshot|staff_note|sha256|storagePath/.test(
      JSON.stringify(clientHistory),
    )
  )
    fail("E614_HISTORY_CLIENT_PRIVATE_MATERIAL_LEAK");
  emit("E614|PASS|history.client_private_material_redacted");

  const clientSnapshot = callJson(
    E612.clientActive,
    `SELECT public.get_enrollment_report_snapshot(
    '${E612.clientActive}', '${E612.orgA}', 'client', '{}'::jsonb,
    ARRAY['225100000X']::text[], ARRAY['225100000X']::text[], NULL::jsonb, 'page');`,
  );
  assertEqual("report.client_access_state", clientSnapshot.accessState, "ready");
  assertEqual("report.client_provider_count", clientSnapshot.providerCount, 1);
  assertEqual(
    "report.client_unproved_effective_date_stale",
    clientSnapshot.providers[0].cells[0].locations[0].publicationState,
    "stale",
  );

  const revised = callJson(
    E612.admin,
    `SELECT public.save_enrollment_revision(
    '${E612.admin}', '${E612.orgA}', 'staff', '${saved.scopeId}', '${saved.revisionId}',
    '${E612.provider}', '${E612.groupA1}', '${product}', '${FIX.facility}', 'CO',
    ${sqlLiteral(
      JSON.stringify({
        status: "in_review",
        submittedDate: "2026-01-15",
        payerAcknowledgedDate: "2026-01-18",
        payerReference: "E614-REV2-REF",
        clientSafeBlocker: "Payer review in progress",
        owner: "Payer",
        retroStatus: "unknown",
      }),
    )}::jsonb, '[]'::jsonb);`,
  );
  const unpublishedCorrection = callJson(
    E612.admin,
    `SELECT public.get_enrollment_report_snapshot(
    '${E612.admin}', '${E612.orgA}', 'staff', '{}'::jsonb,
    ARRAY['225100000X']::text[], ARRAY['225100000X']::text[], NULL::jsonb, 'export');`,
  );
  assertEqual("report.unpublished_correction_row_count", unpublishedCorrection.rowCount, 1);
  assertEqual(
    "report.unpublished_correction_publication_state",
    unpublishedCorrection.records[0].publicationState,
    "draft",
  );
  assertEqual(
    "report.unpublished_correction_status",
    unpublishedCorrection.records[0].status,
    "in_review",
  );
  assertEqual(
    "report.unpublished_correction_owner",
    unpublishedCorrection.records[0].owner,
    "Payer",
  );
  assertEqual(
    "report.unpublished_correction_blocker",
    unpublishedCorrection.records[0].clientSafeBlocker,
    "Payer review in progress",
  );
  callJson(
    E612.admin,
    `SELECT public.publish_enrollment_summary(
    '${E612.admin}', '${E612.orgA}', 'staff', '${saved.scopeId}', '${revised.revisionId}');`,
  );

  const historyPageOne = callJson(
    E612.admin,
    `SELECT public.get_enrollment_scope_history_page(
    '${E612.admin}', '${E612.orgA}', 'staff', '${saved.scopeId}', NULL::jsonb, 1);`,
  );
  assertEqual(
    "history.page_one_latest_revision",
    historyPageOne.items[0].revisionId,
    revised.revisionId,
  );
  assertEqual("history.page_one_has_more", historyPageOne.nextCursor !== null, true);
  const historyPageTwo = callJson(
    E612.admin,
    `SELECT public.get_enrollment_scope_history_page(
    '${E612.admin}', '${E612.orgA}', 'staff', '${saved.scopeId}',
    ${sqlLiteral(JSON.stringify(historyPageOne.nextCursor))}::jsonb, 1);`,
  );
  assertEqual(
    "history.page_two_prior_revision",
    historyPageTwo.items[0].revisionId,
    saved.revisionId,
  );
  assertEqual("history.page_two_has_no_more", historyPageTwo.nextCursor === null, true);

  const clientHistoryOne = callJson(
    E612.clientActive,
    `SELECT public.get_enrollment_scope_history_page(
    '${E612.clientActive}', '${E612.orgA}', 'client', '${saved.scopeId}', NULL::jsonb, 1);`,
  );
  assertEqual("history.client_latest_status", clientHistoryOne.items[0].status, "in_review");
  assertEqual(
    "history.client_pending_submitted_date",
    clientHistoryOne.items[0].submittedDate,
    "2026-01-15",
  );
  assertEqual(
    "history.client_pending_ack_date",
    clientHistoryOne.items[0].payerAcknowledgedDate,
    "2026-01-18",
  );
  assertEqual(
    "history.client_pending_payer_reference",
    clientHistoryOne.items[0].payerReference,
    "E614-REV2-REF",
  );
  assertEqual("history.client_pending_no_proofs", clientHistoryOne.items[0].proofs.length, 0);
  assertEqual("history.client_has_more", clientHistoryOne.nextCursor !== null, true);
  const clientHistoryTwo = callJson(
    E612.clientActive,
    `SELECT public.get_enrollment_scope_history_page(
    '${E612.clientActive}', '${E612.orgA}', 'client', '${saved.scopeId}',
    ${sqlLiteral(JSON.stringify(clientHistoryOne.nextCursor))}::jsonb, 1);`,
  );
  assertEqual(
    "history.client_prior_publication_state",
    clientHistoryTwo.items[0].publicationState,
    "superseded",
  );
  assertEqual(
    "history.client_prior_safe_status",
    clientHistoryTwo.items[0].status,
    "needs_verification",
  );
  if (
    clientHistoryTwo.items[0].payerReference !== null ||
    clientHistoryTwo.items[0].submittedDate !== null
  )
    fail("E614_HISTORY_SUPERSEDED_DETAILS_NOT_REDACTED");
  emit("E614|PASS|history.superseded_client_details_redacted");

  const currentClientSnapshot = callJson(
    E612.clientActive,
    `SELECT public.get_enrollment_report_snapshot(
    '${E612.clientActive}', '${E612.orgA}', 'client', '{}'::jsonb,
    ARRAY['225100000X']::text[], ARRAY['225100000X']::text[], NULL::jsonb, 'page');`,
  );
  assertEqual(
    "report.client_current_pending_publication_state",
    currentClientSnapshot.providers[0].cells[0].locations[0].publicationState,
    "published",
  );
  assertEqual(
    "report.client_current_pending_status",
    currentClientSnapshot.providers[0].cells[0].locations[0].status,
    "in_review",
  );

  sql(`INSERT INTO public.credential_cases
      (id, org_id, provider_id, group_id, facility_id, payer_id, state, case_status, payer_reference_id)
    VALUES ('${FIX.case}', '${E612.orgA}', '${E612.provider}', '${E612.groupA1}',
      '${FIX.facility}', '${FIX.payer}', 'CO', 'submitted', 'E614-CASE-1');
    INSERT INTO public.case_facilities (org_id, case_id, facility_id, is_primary, created_by)
    VALUES ('${E612.orgA}', '${FIX.case}', '${FIX.facility}', true, '${E612.admin}');`);
  const caseFingerprint = sql(`SELECT private.e613_source_fingerprint(
    private.e613_source_snapshot('case', '${FIX.case}'));`)
    .toString()
    .trim();
  callJson(
    E612.admin,
    `SELECT public.save_enrollment_revision(
    '${E612.admin}', '${E612.orgA}', 'staff', '${saved.scopeId}', '${revised.revisionId}',
    '${E612.provider}', '${E612.groupA1}', '${product}', '${FIX.facility}', 'CO',
    '{"status":"action_required","owner":"Payer","retroStatus":"unknown"}'::jsonb,
    ${sqlLiteral(JSON.stringify([{ sourceKind: "case", sourceId: FIX.case, sourceFingerprint: caseFingerprint }]))}::jsonb);`,
  );
  const linkedDraft = callJson(
    E612.admin,
    `SELECT public.get_enrollment_report_snapshot(
    '${E612.admin}', '${E612.orgA}', 'staff', '{}'::jsonb,
    ARRAY['225100000X']::text[], ARRAY['225100000X']::text[], NULL::jsonb, 'page');`,
  );
  assertEqual(
    "report.linked_draft_state",
    linkedDraft.providers[0].cells[0].locations[0].publicationState,
    "draft",
  );
  sql(`UPDATE public.credential_cases SET payer_reference_id = 'E614-CASE-CHANGED'
    WHERE id = '${FIX.case}';`);
  const staleDraft = callJson(
    E612.admin,
    `SELECT public.get_enrollment_report_snapshot(
    '${E612.admin}', '${E612.orgA}', 'staff', '{}'::jsonb,
    ARRAY['225100000X']::text[], ARRAY['225100000X']::text[], NULL::jsonb, 'page');`,
  );
  assertEqual(
    "report.stale_draft_publication_state",
    staleDraft.providers[0].cells[0].locations[0].publicationState,
    "stale",
  );
  assertEqual(
    "report.stale_draft_status",
    staleDraft.providers[0].cells[0].locations[0].status,
    "needs_verification",
  );
  const historicalSnapshot = callJson(
    E612.clientActive,
    `SELECT public.get_enrollment_report_snapshot(
    '${E612.clientActive}', '${E612.orgA}', 'client', '{"historical":true}'::jsonb,
    ARRAY['225100000X']::text[], ARRAY['225100000X']::text[], NULL::jsonb, 'page');`,
  );
  assertEqual(
    "report.historical_column_retained",
    historicalSnapshot.sections[0].columns.length,
    1,
  );
  assertEqual(
    "report.historical_published_status",
    historicalSnapshot.providers[0].cells[0].locations[0].status,
    "in_review",
  );
  assertEqual(
    "report.historical_row_labeled",
    historicalSnapshot.providers[0].cells[0].locations[0].historical,
    true,
  );

  paginationChecks();

  const acl = sql(`SELECT has_function_privilege('anon',
      'public.get_enrollment_report_snapshot(uuid,uuid,text,jsonb,text[],text[],jsonb,text)', 'EXECUTE')
      || '|' || has_function_privilege('authenticated',
      'public.get_enrollment_scope_history_page(uuid,uuid,text,uuid,jsonb,integer)', 'EXECUTE');`)
    .toString()
    .trim();
  assertEqual("report.public_client_rpc_acl_denied", acl, "false|false");
}

function scaleChecks() {
  const seeded = sql(
    e614ScaleFixtureSql({
      orgId: E612.orgA,
      groupId: E612.groupA1,
      payerId: FIX.payer,
      actorId: E612.admin,
    }),
  ).toString();
  const marker = seeded.split("\n").find((line) => line.startsWith("E614_FIXTURE|"));
  if (!marker) fail("E614_SCALE_FIXTURE_MARKER_MISSING");
  const fixture = JSON.parse(marker.slice("E614_FIXTURE|".length));
  assertEqual(
    "scale.fixture_provider_count",
    fixture.providerCount,
    E614_SCALE_FIXTURE.providerCount,
  );
  assertEqual("scale.fixture_product_count", fixture.productCount, E614_SCALE_FIXTURE.productCount);
  assertEqual("scale.fixture_scope_count", fixture.scopeCount, E614_SCALE_FIXTURE.scopeCount);
  const counts = sql(`SELECT (SELECT count(*) FROM public.providers WHERE org_id = '${E612.orgA}'
      AND first_name = 'E614 Synthetic') || '|' ||
    (SELECT count(*) FROM private.payer_products WHERE payer_id = '${FIX.payer}'
      AND product_key LIKE 'e614-scale-%') || '|' ||
    (SELECT count(*) FROM private.enrollment_scopes WHERE org_id = '${E612.orgA}'
      AND provider_id::text LIKE '93000000-0000-4000-8000-%');`)
    .toString()
    .trim()
    .split("|")
    .map(Number);
  assertEqual("scale.actual_provider_count", counts[0], E614_SCALE_FIXTURE.providerCount);
  assertEqual("scale.actual_product_count", counts[1], E614_SCALE_FIXTURE.productCount);
  assertEqual("scale.actual_scope_count", counts[2], E614_SCALE_FIXTURE.scopeCount);
  const started = performance.now();
  const page = callJson(
    E612.admin,
    `SET statement_timeout = '120s';
    SELECT public.get_enrollment_report_snapshot(
    '${E612.admin}', '${E612.orgA}', 'staff', '{"search":"E614 Synthetic"}'::jsonb,
    ARRAY['225100000X']::text[], ARRAY['225100000X']::text[], NULL::jsonb, 'page');`,
  );
  const elapsedMs = Math.round(performance.now() - started);
  assertEqual("scale.report_provider_count", page.providerCount, E614_SCALE_FIXTURE.providerCount);
  assertEqual("scale.report_page_size", page.providers.length, 50);
  assertEqual(
    "scale.report_columns",
    page.sections[0].columns.length,
    E614_SCALE_FIXTURE.productCount + 1,
  );
  assertEqual(
    "scale.report_first_provider_location_count",
    page.providers[0].cells.find((cell) => cell.productId === fixture.firstProductId)
      ?.locationCount,
    E614_SCALE_FIXTURE.locationsPerProvider,
  );
  emit(
    `E614|SCALE|providers=${counts[0]}|products=${counts[1]}|scopes=${counts[2]}|page_ms=${elapsedMs}|page_bytes=${Buffer.byteLength(JSON.stringify(page))}`,
  );
}

let started = false;
try {
  const imageId = docker(["image", "inspect", image, "--format", "{{.Id}}"]).toString().trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) fail("E614_CACHED_POSTGRES_IMAGE_REQUIRED");
  docker([
    "run",
    "--detach",
    "--rm",
    "--pull",
    "never",
    "--name",
    container,
    "--label",
    "com.minted.e614=synthetic-only",
    "--network",
    "none",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    "postgres",
    ...(scale ? [] : ["--read-only", "--tmpfs", "/tmp:rw,mode=1777,size=512m"]),
    "--entrypoint",
    "/bin/sh",
    imageId,
    "-c",
    // Durability is unnecessary in this networkless, disposable fixture.
    "initdb -D /tmp/e614-data --no-locale --encoding=UTF8 --auth=trust >/tmp/init.log 2>&1 && exec postgres -D /tmp/e614-data -k /tmp -c listen_addresses='' -c fsync=off -c full_page_writes=off -c synchronous_commit=off -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse",
  ]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      docker(["exec", container, "pg_isready", "-q", "-h", "/tmp", "-U", "postgres"]);
      ready = true;
      break;
    } catch {
      await pause(250);
    }
  }
  if (!ready) fail("E614_DATABASE_NOT_READY");
  emit(`E614|IMAGE|${imageId}`);
  emit(`E614|POSTGRES|${sql("SHOW server_version;").toString().trim()}`);
  sql(bootstrap);
  applyMigrations(migrations());
  sql(authFixtures());
  sql(baseFixtureSql());
  sql(restrictedFixtureSql());
  emit("E614|PHASE|base_fixtures_ready");
  seedReportFixture();

  if (!compileOnly) {
    reportRpcChecks();
    if (scale) scaleChecks();
  }
  emit("E614|RESULT|PASS");
} catch (error) {
  const code =
    error instanceof Error && /^E614_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : `SQLSTATE_${stateFrom(String(error?.stderr ?? error?.message ?? "")) ?? "UNKNOWN"}`;
  emit(`E614|RESULT|FAIL|${code}`);
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      docker(["rm", "--force", container]);
      emit("E614|CLEANUP|PASS");
    } catch {
      emit("E614|CLEANUP|FAIL");
    }
  }
}
