// MINT-82 (RC-07) — SQL for the Luna-scale seed. Pure string builders; the
// runner (seed-luna-scale.mjs) pipes the output to psql in ONE transaction,
// the way scripts/uat/seed-staging-uat.mjs applies supabase/seed-uat.sql.
//
// Both scripts refuse to run unless psql is given the database identity the
// runner observed and the exact confirmation token, so pasting the SQL into
// an editor or running it with bare psql fails before any write.
import {
  ID_TAG_SALT,
  LUNA_FIXTURE_VERSION,
  LUNA_ORG_ID,
  LUNA_OWNERSHIP_MARKER,
  PRODUCTION_CLUSTER,
  UAT_ORGANIZATION_IDS,
  confirmationToken,
  membershipId,
  ownedIdSqlPredicate,
} from "./luna-fixture.mjs";
import { LUNA_TABLES, planCounts } from "./luna-dataset.mjs";

export const INSERT_CHUNK_ROWS = 500;

// Every column the seed writes, with the type used to render its literal.
const C = {
  uuid: "uuid",
  text: "text",
  int: "int",
  bool: "bool",
  date: "date",
  ts: "timestamptz",
  textArray: "text[]",
  jsonb: "jsonb",
};
export const TABLE_COLUMNS = Object.freeze({
  organizations: { id: C.uuid, name: C.text, lifecycle_state: C.text },
  status_configs: {
    id: C.uuid,
    org_id: C.uuid,
    track: C.text,
    label: C.text,
    color: C.text,
    sort_order: C.int,
    action_bucket: C.text,
  },
  payers: {
    id: C.uuid,
    org_id: C.uuid,
    name: C.text,
    payer_kind: C.text,
    states: C.textArray,
    status: C.text,
    is_active: C.bool,
    source: C.text,
    aliases: C.textArray,
  },
  org_payer_assignments: { id: C.uuid, org_id: C.uuid, payer_id: C.uuid, status: C.text },
  provider_groups: {
    id: C.uuid,
    org_id: C.uuid,
    name: C.text,
    tin: C.text,
    npi_type2: C.text,
    states: C.textArray,
    is_active: C.bool,
    billing_street: C.text,
    billing_city: C.text,
    billing_state: C.text,
    billing_zip: C.text,
    billing_phone: C.text,
    billing_email: C.text,
    credentialing_email: C.text,
  },
  facilities: {
    id: C.uuid,
    org_id: C.uuid,
    group_id: C.uuid,
    name: C.text,
    street: C.text,
    city: C.text,
    state: C.text,
    zip: C.text,
    phone: C.text,
    email: C.text,
    is_active: C.bool,
    effective_date: C.date,
  },
  payer_network_targets: {
    id: C.uuid,
    org_id: C.uuid,
    group_id: C.uuid,
    payer_id: C.uuid,
    state: C.text,
    status: C.text,
  },
  providers: {
    id: C.uuid,
    org_id: C.uuid,
    group_id: C.uuid,
    first_name: C.text,
    last_name: C.text,
    credentials: C.text,
    npi: C.text,
    specialty: C.text,
    taxonomy_code: C.text,
    status: C.text,
    terminated_date: C.date,
    verification_state: C.text,
    reference_only: C.bool,
    is_test_provider: C.bool,
    start_date: C.date,
    caqh_id: C.text,
    caqh_last_attested_date: C.date,
    date_of_birth: C.date,
    ssn_last4: C.text,
    email: C.text,
    phone: C.text,
    home_street: C.text,
    home_city: C.text,
    home_state: C.text,
    home_zip: C.text,
  },
  provider_group_assignments: {
    id: C.uuid,
    org_id: C.uuid,
    provider_id: C.uuid,
    group_id: C.uuid,
    is_primary: C.bool,
    start_date: C.date,
  },
  provider_facility_assignments: {
    id: C.uuid,
    org_id: C.uuid,
    provider_id: C.uuid,
    facility_id: C.uuid,
    is_primary: C.bool,
    start_date: C.date,
  },
  state_licenses: {
    id: C.uuid,
    org_id: C.uuid,
    provider_id: C.uuid,
    state: C.text,
    license_number: C.text,
    license_type: C.text,
    issue_date: C.date,
    expiration_date: C.date,
    status: C.text,
    verified_status: C.text,
    verified_at: C.ts,
    verification_source_url: C.text,
  },
  credential_cases: {
    id: C.uuid,
    org_id: C.uuid,
    provider_id: C.uuid,
    group_id: C.uuid,
    facility_id: C.uuid,
    payer_id: C.uuid,
    state: C.text,
    specialty: C.text,
    case_status: C.text,
    payer_pipeline_state: C.text,
    credentialing_status_id: C.uuid,
    submitted_date: C.date,
    approved_date: C.date,
    confirmed_effective_date: C.date,
    expected_effective_date: C.date,
    termination_date: C.date,
    payer_reference_id: C.text,
    payer_individual_provider_id: C.text,
    created_at: C.ts,
    updated_at: C.ts,
  },
  case_facilities: {
    id: C.uuid,
    org_id: C.uuid,
    case_id: C.uuid,
    facility_id: C.uuid,
    is_primary: C.bool,
    created_by: C.uuid,
    created_at: C.ts,
  },
  case_status_history: {
    id: C.uuid,
    org_id: C.uuid,
    case_id: C.uuid,
    from_status: C.text,
    to_status: C.text,
    actor_kind: C.text,
    is_correction: C.bool,
    changed_at: C.ts,
  },
  tasks: {
    id: C.uuid,
    org_id: C.uuid,
    case_id: C.uuid,
    provider_id: C.uuid,
    title: C.text,
    description: C.text,
    sop_content: C.jsonb,
    status: C.text,
    sort_order: C.int,
    due_date: C.date,
    completed_date: C.date,
    is_auto_generated: C.bool,
    created_at: C.ts,
  },
  touches: {
    id: C.uuid,
    org_id: C.uuid,
    case_id: C.uuid,
    touch_date: C.date,
    entry_type: C.text,
    touch_type: C.text,
    outcome: C.text,
    notes: C.text,
    source: C.text,
    next_follow_up_date: C.date,
    clears_follow_up: C.bool,
    created_at: C.ts,
  },
  enrollment_facts: {
    id: C.uuid,
    org_id: C.uuid,
    provider_id: C.uuid,
    group_id: C.uuid,
    payer_id: C.uuid,
    state: C.text,
    effective_date: C.date,
    source: C.text,
  },
});

const SEED_TABLES = LUNA_TABLES.filter((table) => table !== "organizations");

/** Teardown order: children before parents, then the memberships. The
 * organization row itself is never deleted (see the runbook). */
export const TEARDOWN_TABLES = Object.freeze([
  ...LUNA_TABLES.filter((table) => table !== "organizations").reverse(),
  "memberships",
]);

// Tables the teardown never deletes from: the audit trail (never deleted, by
// rule) and the roster ledger, which is append-only by trigger. The
// organization insert trigger seeds three roster_templates rows, so the org
// row stays behind as an inactive, memberless shell.
export const PRESERVED_ORG_TABLES = Object.freeze([
  "audit_log",
  "roster_templates",
  "roster_mappings",
  "roster_export_snapshots",
  "roster_export_overrides",
]);

const PG_TYPES = Object.freeze({
  uuid: "uuid",
  text: "text",
  int: "integer",
  bool: "boolean",
  date: "date",
  timestamptz: "timestamptz",
  "text[]": "text[]",
  jsonb: "jsonb",
});

/** A literal with an explicit cast. The inserts read from a VALUES list in a
 * subquery, where an uncast literal would resolve to text and then fail the
 * assignment to a uuid or date column, so every value carries its type. */
export function sqlLiteral(value, type) {
  const pgType = PG_TYPES[type];
  if (!pgType) throw new Error(`Unknown column type ${type}`);
  if (value === null || value === undefined) return `NULL::${pgType}`;
  switch (type) {
    case "int":
      if (!Number.isSafeInteger(value)) throw new Error(`Not an integer: ${value}`);
      return `${value}::integer`;
    case "bool":
      if (typeof value !== "boolean") throw new Error(`Not a boolean: ${value}`);
      return value ? "true" : "false";
    case "text[]":
      if (!Array.isArray(value)) throw new Error("Expected an array");
      return value.length === 0
        ? "'{}'::text[]"
        : `ARRAY[${value.map((item) => quote(String(item))).join(",")}]::text[]`;
    case "jsonb":
      return `${quote(JSON.stringify(value))}::jsonb`;
    default:
      return `${quote(String(value))}::${pgType}`;
  }
}

function quote(text) {
  if (/[\0\\]/.test(text)) throw new Error("Refusing a NUL or backslash in seed text");
  return `'${text.replaceAll("'", "''")}'`;
}

/**
 * Inserts only the rows whose id is not there yet. A plain INSERT ... ON
 * CONFLICT evaluates column defaults before the conflict check, so every
 * re-run would burn one credential_cases_case_number_seq value per existing
 * case (sequences never roll back). Filtering on NOT EXISTS first means a
 * repair touches the sequence only for cases it really adds. ON CONFLICT stays
 * as the backstop for a concurrent writer.
 */
export function buildInsertStatements(table, rows) {
  const spec = TABLE_COLUMNS[table];
  if (!spec) throw new Error(`No column spec for ${table}`);
  const columns = Object.keys(spec);
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!(key in spec)) throw new Error(`${table}.${key} is not in the column spec`);
    }
  }
  const statements = [];
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS);
    const values = chunk
      .map((row) => `(${columns.map((column) => sqlLiteral(row[column], spec[column])).join(",")})`)
      .join(",\n");
    const list = columns.join(", ");
    statements.push(
      `INSERT INTO public.${table} (${list})\nSELECT ${columns.map((column) => `v.${column}`).join(", ")}\nFROM (VALUES\n${values}\n) AS v (${list})\nWHERE NOT EXISTS (SELECT 1 FROM public.${table} e WHERE e.id = v.id)\nON CONFLICT (id) DO NOTHING;`,
    );
  }
  return statements;
}

function preamble(action, target) {
  const expectedToken = confirmationToken(action, target);
  const reviewOnly = target.kind === "review";
  return `BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '600s';
SET LOCAL idle_in_transaction_session_timeout = '120s';
SET LOCAL timezone = 'UTC';
SELECT set_config('minted.luna_expected_database_identity', :'expected_database_identity', true);
SELECT set_config('minted.luna_confirm_token', :'confirm_token', true);
DO $luna$
DECLARE v_identity text := (SELECT system_identifier::text FROM pg_control_system());
BEGIN
  ${reviewOnly ? "RAISE EXCEPTION 'Luna-scale SQL refused: this is a review copy (--emit-sql without a target) and never runs';" : ""}
  IF v_identity = ${quote(PRODUCTION_CLUSTER)} THEN
    RAISE EXCEPTION 'Luna-scale SQL refused: this is the production database';
  END IF;
  IF v_identity IS DISTINCT FROM current_setting('minted.luna_expected_database_identity') THEN
    RAISE EXCEPTION 'Luna-scale SQL refused: database identity does not match the runner preflight';
  END IF;
  IF current_setting('minted.luna_confirm_token') IS DISTINCT FROM ${quote(expectedToken)} THEN
    RAISE EXCEPTION 'Luna-scale SQL refused: confirmation token mismatch';
  END IF;
END
$luna$;
CREATE OR REPLACE FUNCTION pg_temp.luna_owned(p_id uuid) RETURNS boolean LANGUAGE sql IMMUTABLE AS $luna$
  SELECT ${ownedIdSqlPredicate("p_id")}
$luna$;
`;
}

function receipt(event, fields) {
  return {
    minted_luna_scale_fixture: {
      ...LUNA_OWNERSHIP_MARKER.minted_luna_scale_fixture,
      event,
      ...fields,
    },
  };
}

/**
 * The apply transaction: guards, a parameter check against the last receipt,
 * every insert (ON CONFLICT (id) DO NOTHING, so a re-run only repairs),
 * memberships, an exact owned-row count per table, and one audit receipt.
 */
export function buildApplySql(dataset, { target, members = [], allowMultiOrgMember = false }) {
  const counts = planCounts(dataset);
  const org = quote(LUNA_ORG_ID);
  const parts = [
    `-- Luna-scale synthetic organization (MINT-82). Generated by scripts/luna-scale/seed-luna-scale.mjs.`,
    `-- Fixture ${LUNA_FIXTURE_VERSION}; params sha256 ${dataset.paramsSha256}; anchor ${dataset.anchorDate}.`,
    `-- Run only through the runner. Every row id is self-certifying (pg_temp.luna_owned).`,
    preamble("apply", target),
    `DO $luna$
DECLARE v_last jsonb;
BEGIN
  SELECT a.after -> 'minted_luna_scale_fixture' INTO v_last
    FROM public.audit_log a
   WHERE a.org_id = ${org}::uuid AND a.entity_type = 'organization' AND a.entity_id = ${org}::uuid
     AND a.after ? 'minted_luna_scale_fixture'
   ORDER BY a.created_at DESC NULLS LAST, a.id DESC
   LIMIT 1;
  IF v_last ->> 'event' = 'apply' AND v_last ->> 'params_sha256' IS DISTINCT FROM ${quote(dataset.paramsSha256)} THEN
    RAISE EXCEPTION 'Luna-scale seed refused: the org holds a seed built from other parameters or another fixture version; run the teardown first';
  END IF;
END
$luna$;`,
    `INSERT INTO public.organizations (id, name, lifecycle_state) VALUES (${org}, ${quote(dataset.tables.organizations[0].name)}, 'active')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, lifecycle_state = 'active';`,
    // Rows in the org the seed does not own, before any insert. If a trigger
    // (for example the touch auto-status trigger) adds one during this
    // transaction, the check after the inserts aborts the whole apply.
    `CREATE TEMP TABLE luna_unowned_before ON COMMIT DROP AS
${SEED_TABLES.map(
  (table) =>
    `SELECT 'public.${table}'::regclass AS rel, count(*) AS n FROM public.${table} WHERE org_id = ${org}::uuid AND NOT pg_temp.luna_owned(id)`,
).join("\nUNION ALL\n")};`,
  ];
  for (const table of LUNA_TABLES) {
    if (table === "organizations") continue;
    parts.push(`-- ${table}: ${counts[table]} rows`);
    parts.push(...buildInsertStatements(table, dataset.tables[table]));
  }
  for (const member of members) {
    parts.push(`DO $luna$
DECLARE v_user uuid;
BEGIN
  SELECT u.id INTO v_user FROM auth.users u WHERE lower(u.email) = ${quote(member.email)};
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Luna-scale seed refused: no Auth user has the member email (create the login first)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user) THEN
    RAISE EXCEPTION 'Luna-scale seed refused: the member has no profiles row';
  END IF;
  IF EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id = v_user
               AND m.org_id = ANY (ARRAY[${UAT_ORGANIZATION_IDS.map((id) => `${quote(id)}::uuid`).join(", ")}])) THEN
    RAISE EXCEPTION 'Luna-scale seed refused: the member belongs to a UAT fixture org';
  END IF;
${
  allowMultiOrgMember
    ? "  -- --allow-multi-org-member: membership in other orgs was accepted by the operator.\n"
    : `  IF EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id = v_user AND m.org_id <> ${org}::uuid) THEN
    RAISE EXCEPTION 'Luna-scale seed refused: the member already belongs to another organization; re-run with --allow-multi-org-member to add them anyway';
  END IF;
`
}  INSERT INTO public.memberships (id, org_id, user_id, role)
  VALUES (${quote(membershipId(member.email))}::uuid, ${org}::uuid, v_user, ${quote(member.role)})
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role;
END
$luna$;`);
  }
  const checks = LUNA_TABLES.filter((table) => table !== "organizations")
    .map(
      (
        table,
      ) => `  SELECT count(*) INTO v_count FROM public.${table} WHERE org_id = ${org}::uuid AND pg_temp.luna_owned(id);
  IF v_count <> ${counts[table]} THEN
    RAISE EXCEPTION 'Luna-scale seed verification failed: ${table} holds % seed rows, expected ${counts[table]}', v_count;
  END IF;`,
    )
    .join("\n");
  parts.push(`DO $luna$
DECLARE v_count bigint;
BEGIN
${checks}
END
$luna$;`);
  parts.push(`DO $luna$
DECLARE r record; v_count bigint;
BEGIN
  FOR r IN SELECT rel, n FROM pg_temp.luna_unowned_before LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE org_id = $1 AND NOT pg_temp.luna_owned(id)', r.rel)
      INTO v_count USING ${org}::uuid;
    IF v_count <> r.n THEN
      RAISE EXCEPTION 'Luna-scale seed refused: the database added % row(s) to % that the seed does not own (a trigger side effect); nothing was committed', v_count - r.n, r.rel;
    END IF;
  END LOOP;
END
$luna$;`);
  const after = receipt("apply", {
    params: dataset.params,
    params_sha256: dataset.paramsSha256,
    anchor_date: dataset.anchorDate,
    counts,
  });
  parts.push(`INSERT INTO public.audit_log (org_id, user_id, user_name, action_type, entity_type, entity_id, after, description)
VALUES (${org}::uuid, NULL, 'Luna-scale seed (MINT-82)', 'CREATE', 'organization', ${org}::uuid, ${sqlLiteral(after, "jsonb")},
  ${quote(`Luna-scale synthetic fixture ${LUNA_FIXTURE_VERSION} applied (anchor ${dataset.anchorDate})`)});`);
  parts.push("COMMIT;");
  parts.push(`\\echo 'Luna-scale synthetic org committed'`);
  return `${parts.join("\n")}\n`;
}

/**
 * The teardown transaction: guards; refuse when the org holds rows the seed
 * did not create (unless allowUnowned); delete every seed-owned row child
 * first; leave the org row inactive and memberless; one audit receipt.
 */
export function buildTeardownSql({ target, allowUnowned = false }) {
  const org = quote(LUNA_ORG_ID);
  const targets = TEARDOWN_TABLES.map((table) => `'public.${table}'::regclass::oid`).join(", ");
  const preserved = PRESERVED_ORG_TABLES.map(quote).join(", ");
  const deletes = TEARDOWN_TABLES.map(
    (
      table,
    ) => `  DELETE FROM public.${table} WHERE org_id = ${org}::uuid AND pg_temp.luna_owned(id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('${table}', v_count);`,
  ).join("\n");
  return `-- Luna-scale synthetic organization teardown (MINT-82). Generated by scripts/luna-scale/seed-luna-scale.mjs.
-- Removes only seed-owned rows (pg_temp.luna_owned) inside the Luna org; never another org.
${preamble("teardown", target)}SELECT set_config('minted.luna_allow_unowned', ${quote(allowUnowned ? "true" : "false")}, true);
DO $luna$
DECLARE
  r record;
  v_count bigint;
  v_me oid := (SELECT ro.oid FROM pg_catalog.pg_roles ro WHERE ro.rolname = current_user);
  v_bypass boolean := (SELECT ro.rolsuper OR ro.rolbypassrls FROM pg_catalog.pg_roles ro WHERE ro.rolname = current_user);
  v_targets oid[] := ARRAY[${targets}];
  v_unreadable jsonb := '[]'::jsonb;
  v_dependents jsonb := '{}'::jsonb;
  v_unowned jsonb := '{}'::jsonb;
  v_preserved jsonb := '{}'::jsonb;
  v_deleted jsonb := '{}'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = ${org}::uuid) THEN
    RAISE NOTICE 'Luna-scale teardown: the synthetic org does not exist; nothing to do';
    RETURN;
  END IF;
  -- 1. Rows in the Luna org the seed did not create: every public table with
  -- an org_id, whatever its key. A table without a uuid id (the SSN vault is
  -- keyed by provider_id) holds no seed rows, so every row there counts.
  -- Catalog OIDs, never names, so a row from another schema cannot raise.
  FOR r IN
    SELECT c.oid AS rel, c.relname,
           a.atttypid = 'uuid'::regtype AS org_is_uuid,
           EXISTS (SELECT 1 FROM pg_catalog.pg_attribute i
                    WHERE i.attrelid = c.oid AND i.attname = 'id' AND i.attnum > 0
                      AND NOT i.attisdropped AND i.atttypid = 'uuid'::regtype) AS has_uuid_id,
           has_table_privilege(c.oid, 'SELECT')
             AND (NOT c.relrowsecurity OR v_bypass
                  OR (NOT c.relforcerowsecurity AND c.relowner = v_me)) AS readable
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid = c.oid AND a.attname = 'org_id' AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
     ORDER BY c.relname
  LOOP
    IF NOT r.readable THEN
      v_unreadable := v_unreadable || to_jsonb(r.rel::regclass::text);
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM %s WHERE %s%s', r.rel::regclass,
        CASE WHEN r.org_is_uuid THEN format('org_id = %L::uuid', ${org}) ELSE format('org_id::text = %L', ${org}) END,
        CASE WHEN r.has_uuid_id THEN ' AND NOT pg_temp.luna_owned(id)' ELSE '' END)
      INTO v_count;
    CONTINUE WHEN v_count = 0;
    IF r.relname = ANY (ARRAY[${preserved}]) THEN
      v_preserved := v_preserved || jsonb_build_object(r.relname, v_count);
    ELSE
      v_unowned := v_unowned || jsonb_build_object(r.relname, v_count);
    END IF;
  END LOOP;
  -- 2. Rows anywhere, in any schema, that reference a seed row through a
  -- foreign key into a table the teardown deletes from, other than seed rows
  -- themselves. Deleting would cascade into them, null or default them out,
  -- or be blocked by them, so --allow-unowned never overrides this.
  FOR r IN
    SELECT con.conname, con.conrelid AS child, con.confrelid AS parent, con.confdeltype,
           con.conrelid = ANY (v_targets) AS child_is_seed_table,
           has_table_privilege(con.conrelid, 'SELECT')
             AND (NOT ch.relrowsecurity OR v_bypass
                  OR (NOT ch.relforcerowsecurity AND ch.relowner = v_me)) AS readable,
           (SELECT string_agg(format('d.%I = p.%I', ca.attname, pa.attname), ' AND ' ORDER BY k.ord)
              FROM unnest(con.conkey, con.confkey) WITH ORDINALITY AS k (child_att, parent_att, ord)
              JOIN pg_catalog.pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = k.child_att
              JOIN pg_catalog.pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = k.parent_att
           ) AS join_condition
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class ch ON ch.oid = con.conrelid
     WHERE con.contype = 'f' AND con.confrelid = ANY (v_targets)
     ORDER BY con.conrelid::regclass::text, con.conname
  LOOP
    IF NOT r.readable THEN
      -- A RESTRICT / NO ACTION dependent blocks the DELETE itself, which rolls
      -- the whole teardown back; only an unreadable cascade, set null or set
      -- default FK could change rows silently, so only that refuses here.
      IF r.confdeltype IN ('c', 'n', 'd') THEN
        v_unreadable := v_unreadable || to_jsonb(r.child::regclass::text);
      END IF;
      CONTINUE;
    END IF;
    EXECUTE format(
        'SELECT count(*) FROM %s d WHERE EXISTS (SELECT 1 FROM %s p WHERE p.org_id = %L::uuid AND pg_temp.luna_owned(p.id) AND %s)%s',
        r.child::regclass, r.parent::regclass, ${org}, r.join_condition,
        CASE WHEN r.child_is_seed_table
          THEN format(' AND NOT (d.org_id = %L::uuid AND pg_temp.luna_owned(d.id))', ${org})
          ELSE '' END)
      INTO v_count;
    CONTINUE WHEN v_count = 0;
    v_dependents := v_dependents || jsonb_build_object(
      format('%s.%s (on delete %s)', r.child::regclass, r.conname,
        CASE r.confdeltype WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null'
          WHEN 'd' THEN 'set default' WHEN 'r' THEN 'restrict' ELSE 'no action' END),
      v_count);
  END LOOP;
  IF v_unreadable <> '[]'::jsonb THEN
    RAISE EXCEPTION 'Luna-scale teardown refused: this role cannot read % (privilege or forced row security), so it cannot prove no other row depends on the seed', v_unreadable;
  END IF;
  IF v_dependents <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Luna-scale teardown refused: rows the seed did not create reference seed rows: %. Deleting would cascade into, null out or be blocked by them. Remove or re-point them first; --allow-unowned does not override this', v_dependents;
  END IF;
  IF v_unowned <> '{}'::jsonb AND current_setting('minted.luna_allow_unowned') <> 'true' THEN
    RAISE EXCEPTION 'Luna-scale teardown refused: the synthetic org holds rows the seed did not create: %. Review them, then re-run with --allow-unowned to keep them and remove only seed rows', v_unowned;
  END IF;
${deletes}
  UPDATE public.organizations SET lifecycle_state = 'inactive' WHERE id = ${org}::uuid;
  INSERT INTO public.audit_log (org_id, user_id, user_name, action_type, entity_type, entity_id, after, description)
  VALUES (${org}::uuid, NULL, 'Luna-scale seed (MINT-82)', 'DELETE', 'organization', ${org}::uuid,
    jsonb_build_object('minted_luna_scale_fixture', jsonb_build_object(
      'version', ${quote(LUNA_FIXTURE_VERSION)}, 'event', 'teardown', 'deleted', v_deleted,
      'kept_unowned', v_unowned, 'kept_preserved', v_preserved)),
    'Luna-scale synthetic fixture removed; the inactive org row, its roster templates and audit rows remain');
  RAISE NOTICE 'Luna-scale teardown deleted %', v_deleted;
  RAISE NOTICE 'Luna-scale teardown kept (append-only or audit) %', v_preserved;
  IF v_unowned <> '{}'::jsonb THEN
    RAISE NOTICE 'Luna-scale teardown kept rows the seed did not create %', v_unowned;
  END IF;
END
$luna$;
COMMIT;
\\echo 'Luna-scale teardown committed'
`;
}

/** Read-only verification query: owned and unowned counts per seed table in
 * the Luna org, plus relationship invariants. Returns one JSON object. */
export function buildVerifySql() {
  const org = quote(LUNA_ORG_ID);
  const ownedCounts = [...LUNA_TABLES.filter((table) => table !== "organizations"), "memberships"]
    .map(
      (table) =>
        `'${table}', (SELECT count(*) FROM public.${table} WHERE org_id = ${org}::uuid AND ${ownedIdSqlPredicate("id")})`,
    )
    .join(",\n    ");
  const unownedCounts = LUNA_TABLES.filter((table) => table !== "organizations")
    .map(
      (table) =>
        `'${table}', (SELECT count(*) FROM public.${table} WHERE org_id = ${org}::uuid AND NOT ${ownedIdSqlPredicate("id")})`,
    )
    .join(",\n    ");
  return `BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';
SELECT json_build_object(
  'org', (SELECT json_build_object('name', name, 'lifecycle_state', lifecycle_state) FROM public.organizations WHERE id = ${org}::uuid),
  'last_receipt', (SELECT a.after -> 'minted_luna_scale_fixture' FROM public.audit_log a
     WHERE a.org_id = ${org}::uuid AND a.after ? 'minted_luna_scale_fixture'
     ORDER BY a.created_at DESC NULLS LAST, a.id DESC LIMIT 1),
  'owned', json_build_object(
    ${ownedCounts}),
  'unowned', json_build_object(
    ${unownedCounts}),
  'cross_org_case_links', (SELECT count(*) FROM public.credential_cases c
     LEFT JOIN public.providers p ON p.id = c.provider_id AND p.org_id = c.org_id
     LEFT JOIN public.provider_groups g ON g.id = c.group_id AND g.org_id = c.org_id
     LEFT JOIN public.payers y ON y.id = c.payer_id AND y.org_id = c.org_id
     LEFT JOIN public.facilities f ON f.id = c.facility_id AND f.org_id = c.org_id
     WHERE c.org_id = ${org}::uuid AND (p.id IS NULL OR g.id IS NULL OR y.id IS NULL OR f.id IS NULL)),
  'cases_without_primary_location', (SELECT count(*) FROM public.credential_cases c
     WHERE c.org_id = ${org}::uuid AND NOT EXISTS (
       SELECT 1 FROM public.case_facilities cf WHERE cf.case_id = c.id AND cf.is_primary AND cf.facility_id = c.facility_id)),
  'seed_rows_outside_org', (SELECT count(*) FROM public.providers WHERE org_id <> ${org}::uuid AND ${ownedIdSqlPredicate("id")}),
  'org_rows', (${ORG_ROWS_SQL.replaceAll("$ORG", org)})
);
COMMIT;
`;
}

// Every row in the Luna org, per public table with an org_id, seed-owned or
// not: after a teardown only the roster templates and audit receipts remain.
// query_to_xml runs one count per table inside a single read-only SELECT.
const ORG_ROWS_SQL = `SELECT json_object_agg(c.relname, (xpath('/row/n/text()', query_to_xml(
       format('SELECT count(*) AS n FROM %s WHERE %s', c.oid::regclass,
         CASE WHEN a.atttypid = 'uuid'::regtype THEN format('org_id = %L::uuid', $ORG)
              ELSE format('org_id::text = %L', $ORG) END),
       false, true, '')))[1]::text::bigint ORDER BY c.relname)
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_catalog.pg_attribute a
       ON a.attrelid = c.oid AND a.attname = 'org_id' AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
       AND has_table_privilege(c.oid, 'SELECT')`;

/**
 * Read-only md5 fingerprints, one per table, for the CI job:
 * - "outside": every public table's rows that are NOT the Luna org's (the
 *   organizations row itself excluded), so an apply or teardown that changes
 *   anything else is caught;
 * - "seed": every row in the Luna org's seed tables and memberships, plus the
 *   org row, so a second apply that changes anything is caught.
 */
export function buildFingerprintSql(scope) {
  const org = quote(LUNA_ORG_ID);
  if (scope === "outside") {
    return `BEGIN READ ONLY;
SET LOCAL statement_timeout = '120s';
SELECT json_object_agg(c.relname, (xpath('/row/h/text()', query_to_xml(format(
    'SELECT md5(coalesce(string_agg(r, %L ORDER BY r), %L)) AS h FROM (SELECT row_to_json(x)::text AS r FROM %s x WHERE %s) s',
    ',', '', c.oid::regclass,
    CASE
      WHEN c.relname = 'organizations' THEN format('x.id <> %L::uuid', ${org})
      WHEN a.atttypid = 'uuid'::regtype THEN format('x.org_id IS DISTINCT FROM %L::uuid', ${org})
      WHEN a.attname IS NOT NULL THEN format('x.org_id::text IS DISTINCT FROM %L', ${org})
      ELSE 'true'
    END), false, true, '')))[1]::text ORDER BY c.relname)
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attribute a
  ON a.attrelid = c.oid AND a.attname = 'org_id' AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
  AND has_table_privilege(c.oid, 'SELECT');
COMMIT;
`;
  }
  if (scope === "seed") {
    const tables = [...LUNA_TABLES.filter((table) => table !== "organizations"), "memberships"];
    const parts = [
      `'organizations', (SELECT md5(row_to_json(x)::text) FROM public.organizations x WHERE x.id = ${org}::uuid)`,
      ...tables.map(
        (table) =>
          `'${table}', (SELECT md5(coalesce(string_agg(row_to_json(x)::text, ',' ORDER BY x.id), '')) FROM public.${table} x WHERE x.org_id = ${org}::uuid)`,
      ),
    ];
    return `BEGIN READ ONLY;
SET LOCAL statement_timeout = '120s';
SELECT json_build_object(
  ${parts.join(",\n  ")}
);
COMMIT;
`;
  }
  throw new Error('Fingerprint scope must be "outside" or "seed"');
}
