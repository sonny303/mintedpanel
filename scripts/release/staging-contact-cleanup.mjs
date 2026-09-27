import { createHash } from "node:crypto";

// AUD-07 / PR #396. SQL generator only: no connection, CLI or file-write path.
// This one operation is fixed to five staging contacts and their measured closure.
const STAGING = "vmznysvietfaddakkegt";
const STAGING_CLUSTER = "7662742571317219726";
const PRODUCTION_CLUSTER = "7642734024280108049";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MD5 = /^[a-f0-9]{32}$/;
const SHA = /^[a-f0-9]{64}$/;
const TABLES = ["parties", "party_role_assignments", "party_capture_links"];
const COUNTS = [5, 3, 4];
const PRESERVED = [
  "providers",
  "facilities",
  "organizations",
  "memberships",
  "notes",
  "communication_event",
];
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const assert = (value) => {
  if (!value) throw new Error("STAGING_CONTACT_CLEANUP_REJECTED");
};
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
};
const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const keys = (value, allowed) => {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert(Object.keys(value).sort().join() === allowed.slice().sort().join());
};
const fingerprint = (value) => {
  keys(value, ["count", "hash"]);
  assert(Number.isSafeInteger(value.count) && value.count >= 0 && MD5.test(value.hash));
};

export function validateContactCleanupManifest(manifest) {
  keys(manifest, [
    "version",
    "projectRef",
    "sourceRef",
    "capturedAt",
    "runMarker",
    "tables",
    "auditBaseline",
    "orgContexts",
    "auditRows",
    "preserved",
  ]);
  assert(manifest.version === 1 && manifest.projectRef === STAGING);
  assert(/^[a-f0-9]{40}$/.test(manifest.sourceRef));
  assert(
    typeof manifest.capturedAt === "string" && Number.isFinite(Date.parse(manifest.capturedAt)),
  );
  assert(/^aud-07-[a-z0-9-]{12,80}$/.test(manifest.runMarker));
  keys(manifest.tables, TABLES);
  const allIds = new Set();
  TABLES.forEach((table, index) => {
    const value = manifest.tables[table];
    keys(value, ["targets", "untouched"]);
    fingerprint(value.untouched);
    assert(Array.isArray(value.targets) && value.targets.length === COUNTS[index]);
    value.targets.forEach((target) => {
      keys(target, ["id", "hash"]);
      assert(UUID.test(target.id) && MD5.test(target.hash) && !allIds.has(target.id));
      allIds.add(target.id);
    });
  });
  fingerprint(manifest.auditBaseline);
  keys(manifest.preserved, PRESERVED);
  PRESERVED.forEach((table) => fingerprint(manifest.preserved[table]));
  assert(Array.isArray(manifest.orgContexts) && manifest.orgContexts.length === 7);
  const parties = new Set(manifest.tables.parties.targets.map((row) => row.id));
  const assignmentIds = new Set(
    manifest.tables.party_role_assignments.targets.map((row) => row.id),
  );
  const linkIds = new Set(manifest.tables.party_capture_links.targets.map((row) => row.id));
  const used = new Set();
  const orgPairs = new Set();
  const coveredParties = new Set();
  for (const context of manifest.orgContexts) {
    keys(context, ["partyId", "orgId", "basis", "referenceId"]);
    assert(parties.has(context.partyId) && UUID.test(context.orgId));
    assert(!used.has(context.referenceId));
    assert(
      (context.basis === "party_role_assignment" && assignmentIds.has(context.referenceId)) ||
        (context.basis === "party_capture_link" && linkIds.has(context.referenceId)),
    );
    used.add(context.referenceId);
    orgPairs.add(`${context.partyId}:${context.orgId}`);
    coveredParties.add(context.partyId);
  }
  assert(orgPairs.size === 6 && coveredParties.size === 5 && used.size === 7);
  assert(Array.isArray(manifest.auditRows) && manifest.auditRows.length === 6);
  const auditedPairs = new Set();
  for (const audit of manifest.auditRows) {
    keys(audit, ["id", "partyId", "orgId"]);
    assert(UUID.test(audit.id) && !allIds.has(audit.id));
    allIds.add(audit.id);
    const pair = `${audit.partyId}:${audit.orgId}`;
    assert(orgPairs.has(pair) && !auditedPairs.has(pair));
    auditedPairs.add(pair);
  }
  return manifest;
}

function snapshot(table, predicate = "true") {
  return `(SELECT jsonb_build_object('count',count(*),'hash',md5(COALESCE(string_agg(md5(to_jsonb(r)::text),'' ORDER BY r.id),''))) FROM public.${table} r WHERE ${predicate})`;
}

// Use before any decision after a missing write response. Never retry the DML
// automatically: the aggregate proves prestate, committed state, or neither.
export function buildContactCleanupInspectionSql(manifest) {
  validateContactCleanupManifest(manifest);
  const manifestSha256 = digest(manifest);
  const target = (table) =>
    `r.id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(m.value->'tables'->'${table}'->'targets') x)`;
  const tableResults = TABLES.map(
    (table) => `'${table}',jsonb_build_object(
    'target_count',(SELECT count(*) FROM public.${table} r WHERE ${target(table)}),
    'target_hashes_match',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'hash',md5(to_jsonb(r)::text)) ORDER BY r.id),'[]'::jsonb) FROM public.${table} r WHERE ${target(table)})=(SELECT jsonb_agg(x ORDER BY x->>'id') FROM jsonb_array_elements(m.value->'tables'->'${table}'->'targets') x),
    'untouched_match',${snapshot(table, `NOT (${target(table)})`)}=m.value->'tables'->'${table}'->'untouched')`,
  ).join(",\n");
  const protectedResults = PRESERVED.map(
    (table) => `'${table}',${snapshot(table)}=m.value->'preserved'->'${table}'`,
  ).join(",\n");
  return `-- AUD-07 read-only poststate
-- Staging only; private IDs, aggregate output only. Never auto-retry a write.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL timezone='UTC';
SET LOCAL search_path=pg_catalog,public;
WITH m AS MATERIALIZED (SELECT ${literal(JSON.stringify(manifest))}::jsonb AS value),
identity AS MATERIALIZED (SELECT 1/(CASE WHEN current_database()='postgres' AND (SELECT system_identifier::text FROM pg_control_system())=${literal(STAGING_CLUSTER)} THEN 1 ELSE 0 END) AS guarded),
audits AS MATERIALIZED (SELECT r.* FROM public.audit_log r,m WHERE r.after->>'cleanup_run'=m.value->>'runMarker'),
expected_audits AS MATERIALIZED (SELECT x FROM m,jsonb_array_elements(m.value->'auditRows') x),
state AS MATERIALIZED (
SELECT jsonb_build_object(
 'identity_guard_passed',identity.guarded=1,
 'manifest_sha256',${literal(manifestSha256)},
 'tables',jsonb_build_object(${tableResults}),
 'protected_tables_match',jsonb_build_object(${protectedResults}),
 'original_audits_match',${snapshot("audit_log", "NOT (COALESCE(r.after->>'cleanup_run','')=m.value->>'runMarker')")}=m.value->'auditBaseline',
 'audit_marker_count',(SELECT count(*) FROM audits),
 'known_audit_id_count',(SELECT count(*) FROM public.audit_log r WHERE r.id IN (SELECT (x->>'id')::uuid FROM expected_audits)),
 'exact_audits_match',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'partyId',r.entity_id,'orgId',r.org_id) ORDER BY r.id),'[]'::jsonb) FROM audits r
   WHERE r.action_type='DELETE' AND r.entity_type='party' AND r.user_id IS NULL AND r.user_name IS NULL
   AND r.before=jsonb_build_object('party_id',r.entity_id::text)
   AND r.after=jsonb_build_object('cleanup_run',m.value->>'runMarker','manifest_sha256',${literal(manifestSha256)})
   AND r.description='Owner-authorized staging contact cleanup; AUD-07; PR #396; operator identity recorded in maintenance receipt')=(SELECT jsonb_agg(x ORDER BY x->>'id') FROM expected_audits)
) AS value FROM m CROSS JOIN identity),
classified AS (SELECT value, (value->>'identity_guard_passed')::boolean
 AND (value->>'original_audits_match')::boolean
 AND NOT EXISTS (SELECT 1 FROM jsonb_each(value->'protected_tables_match') e WHERE e.value<>'true'::jsonb)
 AND NOT EXISTS (SELECT 1 FROM jsonb_each(value->'tables') e WHERE e.value->'untouched_match'<>'true'::jsonb) AS preserved FROM state)
SELECT value || jsonb_build_object('status',CASE
 WHEN preserved AND value->>'audit_marker_count'='6' AND value->>'known_audit_id_count'='6'
  AND (value->>'exact_audits_match')::boolean
  AND NOT EXISTS(SELECT 1 FROM jsonb_each(value->'tables') e WHERE e.value->>'target_count'<>'0') THEN 'APPLIED'
 WHEN preserved AND value->>'audit_marker_count'='0' AND value->>'known_audit_id_count'='0'
  AND NOT EXISTS(SELECT 1 FROM jsonb_each(value->'tables') e WHERE e.value->'target_hashes_match'<>'true'::jsonb)
  AND value->'tables'->'parties'->>'target_count'='5'
  AND value->'tables'->'party_role_assignments'->>'target_count'='3'
  AND value->'tables'->'party_capture_links'->>'target_count'='4' THEN 'NOT_APPLIED'
 ELSE 'INCONSISTENT' END) AS contact_cleanup_state FROM classified;
COMMIT;
`;
}

export function buildContactCleanupSql(input, options) {
  const manifest = validateContactCleanupManifest(input);
  keys(options, options?.mode === "hosted-commit" ? ["mode"] : ["mode", "isolation"]);
  assert(["hosted-commit", "rehearse-rollback", "rehearse-restore"].includes(options.mode));
  let identity;
  if (options.mode === "hosted-commit") {
    identity = `current_database()='postgres' AND v_cluster=${literal(STAGING_CLUSTER)}`;
  } else {
    keys(options.isolation, ["systemIdentifier", "restoreRunId", "targetDigest"]);
    assert(/^\d{16,24}$/.test(options.isolation.systemIdentifier));
    assert(![STAGING_CLUSTER, PRODUCTION_CLUSTER].includes(options.isolation.systemIdentifier));
    assert(
      /^[a-f0-9]{16}$/.test(options.isolation.restoreRunId) &&
        SHA.test(options.isolation.targetDigest),
    );
    identity = `current_database()='minted_recovery' AND v_cluster=${literal(options.isolation.systemIdentifier)}`;
  }
  const manifestSha256 = digest(manifest);
  const ids = (table) =>
    `ARRAY[${manifest.tables[table].targets.map((r) => `${literal(r.id)}::uuid`).join(",")}]::uuid[]`;
  const targetPredicates = Object.fromEntries(
    TABLES.map((table) => [table, `r.id=ANY(${ids(table)})`]),
  );
  const verifyTargets = TABLES.map(
    (table) => `
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'hash',md5(to_jsonb(r)::text)) ORDER BY r.id),'[]'::jsonb)
    INTO v_observed FROM public.${table} r WHERE ${targetPredicates[table]};
  SELECT jsonb_agg(x ORDER BY x->>'id') INTO v_expected FROM jsonb_array_elements(v_manifest->'tables'->'${table}'->'targets') x;
  IF v_observed IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'AUD07 target drift: ${table}'; END IF;`,
  ).join("\n");
  const verifyUntouched = TABLES.map(
    (table) => `
  IF ${snapshot(table, `NOT (${targetPredicates[table]})`)} IS DISTINCT FROM v_manifest->'tables'->'${table}'->'untouched'
    THEN RAISE EXCEPTION 'AUD07 non-target drift: ${table}'; END IF;`,
  ).join("\n");
  const verifyPreserved = PRESERVED.map(
    (table) => `
  IF ${snapshot(table)} IS DISTINCT FROM v_manifest->'preserved'->'${table}'
    THEN RAISE EXCEPTION 'AUD07 protected table drift: ${table}'; END IF;`,
  ).join("\n");
  const checkAuditBaseline = `
  IF ${snapshot("audit_log", `NOT (COALESCE(r.after->>'cleanup_run','')=${literal(manifest.runMarker)})`)} IS DISTINCT FROM v_manifest->'auditBaseline'
    THEN RAISE EXCEPTION 'AUD07 original audit drift'; END IF;`;
  const verifyAuditAppend = `
  SELECT jsonb_agg(jsonb_build_object('id',r.id,'partyId',r.entity_id,'orgId',r.org_id) ORDER BY r.id)
    INTO v_observed FROM public.audit_log r WHERE r.after->>'cleanup_run'=${literal(manifest.runMarker)}
    AND r.action_type='DELETE' AND r.entity_type='party' AND r.user_id IS NULL AND r.user_name IS NULL
    AND r.before=jsonb_build_object('party_id',r.entity_id::text)
    AND r.after=jsonb_build_object('cleanup_run',${literal(manifest.runMarker)},'manifest_sha256',${literal(manifestSha256)})
    AND r.description='Owner-authorized staging contact cleanup; AUD-07; PR #396; operator identity recorded in maintenance receipt';
  SELECT jsonb_agg(x ORDER BY x->>'id') INTO v_expected FROM jsonb_array_elements(v_manifest->'auditRows') x;
  IF v_observed IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'AUD07 audit content mismatch'; END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE after->>'cleanup_run'=${literal(manifest.runMarker)})<>6 THEN RAISE EXCEPTION 'AUD07 audit marker mismatch'; END IF;`;
  const otherPublic = (capture) => `
  v_other_observed := '{}'::jsonb;
  FOR v_table IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname NOT IN ('parties','party_role_assignments','party_capture_links','audit_log')
    ORDER BY c.relname LOOP
    EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''hash'',md5(COALESCE(string_agg(h,'''' ORDER BY h),''''))) FROM (SELECT md5(to_jsonb(r)::text) AS h FROM public.%I r) s',v_table) INTO v_observed;
    v_other_observed := v_other_observed || jsonb_build_object(v_table,v_observed);
  END LOOP;
  ${capture ? "v_other_before := v_other_observed;" : "IF v_other_observed IS DISTINCT FROM v_other_before THEN RAISE EXCEPTION 'AUD07 other public rows changed'; END IF;"}`;
  const recover =
    options.mode === "rehearse-restore"
      ? `
  -- Reinsert only from transaction-local memory; never emit/save row payloads.
  INSERT INTO public.parties SELECT * FROM jsonb_populate_recordset(NULL::public.parties,v_saved_parties);
  INSERT INTO public.party_role_assignments SELECT * FROM jsonb_populate_recordset(NULL::public.party_role_assignments,v_saved_assignments);
  INSERT INTO public.party_capture_links SELECT * FROM jsonb_populate_recordset(NULL::public.party_capture_links,v_saved_links);
  ${verifyTargets}
  ${verifyUntouched}
  ${verifyPreserved}
  ${checkAuditBaseline}
  ${verifyAuditAppend}
  ${otherPublic(false)}
  RAISE NOTICE 'AUD07 local recovery verified; original contacts/dependencies restored; six audit rows retained';`
      : "";

  const sql = `-- AUD-07 / PR #396. PRIVATE IDs; do not commit this generated SQL.
-- Mode: ${options.mode}. Manifest SHA-256: ${manifestSha256}
-- Execute only after independent review and the scoped recovery gate.
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='30s';
SET LOCAL timezone='UTC';
SET LOCAL search_path=pg_catalog,public;
DO $aud07$
DECLARE
  v_manifest constant jsonb := ${literal(JSON.stringify(manifest))}::jsonb;
  v_cluster text;
  v_observed jsonb;
  v_expected jsonb;
  v_saved_parties jsonb;
  v_saved_assignments jsonb;
  v_saved_links jsonb;
  v_cases_before jsonb;
  v_other_before jsonb;
  v_other_observed jsonb;
  v_table text;
  v_count bigint;
BEGIN
  SELECT system_identifier::text INTO v_cluster FROM pg_control_system();
  IF NOT (${identity}) THEN RAISE EXCEPTION 'AUD07 wrong target'; END IF;
  -- These locks fence app writes and metadata changes over the complete closure.
  LOCK TABLE public.audit_log,public.parties,public.party_capture_links,public.party_role_assignments IN SHARE ROW EXCLUSIVE MODE;
  -- No new incoming FK may expand the deletion closure, including outside public.
  SELECT jsonb_agg(jsonb_build_object('name',k.conname,'child',n.nspname||'.'||c.relname,'definition',pg_get_constraintdef(k.oid),'validated',k.convalidated) ORDER BY k.conname)
  INTO v_observed FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE k.contype='f' AND k.confrelid IN ('public.parties'::regclass,'public.party_role_assignments'::regclass,'public.party_capture_links'::regclass);
  v_expected := '[{"name":"party_capture_links_party_id_fkey","child":"public.party_capture_links","definition":"FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE","validated":true},{"name":"party_role_assignments_party_id_fkey","child":"public.party_role_assignments","definition":"FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE","validated":true}]'::jsonb;
  IF v_observed IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'AUD07 FK closure changed'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.parties'::regclass,'public.party_role_assignments'::regclass,'public.party_capture_links'::regclass,'public.audit_log'::regclass)) <> 1
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.party_role_assignments'::regclass AND tgname='party_role_assignments_active_role' AND tgtype=23 AND tgenabled='O' AND md5(pg_get_functiondef(tgfoid))='5c41c404f2fdeb570d59d95c1bf4fc4d')
    THEN RAISE EXCEPTION 'AUD07 trigger effects changed'; END IF;
  IF EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class IN ('public.parties'::regclass,'public.party_role_assignments'::regclass,'public.party_capture_links'::regclass,'public.audit_log'::regclass) AND rulename<>'_RETURN') THEN RAISE EXCEPTION 'AUD07 rewrite effects changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.audit_log WHERE after->>'cleanup_run'=${literal(manifest.runMarker)}) THEN RAISE EXCEPTION 'AUD07 marker already used'; END IF;
  IF EXISTS (SELECT 1 FROM public.audit_log WHERE id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(v_manifest->'auditRows') x)) THEN RAISE EXCEPTION 'AUD07 audit ID already used'; END IF;
  ${verifyTargets}
  ${verifyUntouched}
  ${verifyPreserved}
  ${checkAuditBaseline}
  v_cases_before := ${snapshot("credential_cases")};
  ${otherPublic(true)}
  -- Every dependent row and audit org must match the private reviewed manifest.
  SELECT jsonb_agg(x ORDER BY x->>'referenceId') INTO v_observed FROM (
    SELECT jsonb_build_object('partyId',party_id,'orgId',org_id,'basis','party_role_assignment','referenceId',id) AS x FROM public.party_role_assignments WHERE party_id=ANY(${ids("parties")})
    UNION ALL SELECT jsonb_build_object('partyId',party_id,'orgId',org_id,'basis','party_capture_link','referenceId',id) FROM public.party_capture_links WHERE party_id=ANY(${ids("parties")})
  ) c;
  SELECT jsonb_agg(x ORDER BY x->>'referenceId') INTO v_expected FROM jsonb_array_elements(v_manifest->'orgContexts') x;
  IF v_observed IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'AUD07 dependent relationship drift'; END IF;
  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) INTO v_saved_parties FROM public.parties r WHERE ${targetPredicates.parties};
  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) INTO v_saved_assignments FROM public.party_role_assignments r WHERE ${targetPredicates.party_role_assignments};
  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) INTO v_saved_links FROM public.party_capture_links r WHERE ${targetPredicates.party_capture_links};
  DELETE FROM public.parties WHERE id=ANY(${ids("parties")});
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>5 THEN RAISE EXCEPTION 'AUD07 wrong parent deletion count'; END IF;
  IF EXISTS(SELECT 1 FROM public.parties WHERE id=ANY(${ids("parties")}))
    OR EXISTS(SELECT 1 FROM public.party_role_assignments WHERE id=ANY(${ids("party_role_assignments")}))
    OR EXISTS(SELECT 1 FROM public.party_capture_links WHERE id=ANY(${ids("party_capture_links")})) THEN RAISE EXCEPTION 'AUD07 incomplete closure deletion'; END IF;
  INSERT INTO public.audit_log (id,org_id,user_id,user_name,action_type,entity_type,entity_id,before,after,description)
  SELECT (x->>'id')::uuid,(x->>'orgId')::uuid,NULL,NULL,'DELETE','party',(x->>'partyId')::uuid,
    jsonb_build_object('party_id',x->>'partyId'),
    jsonb_build_object('cleanup_run',${literal(manifest.runMarker)},'manifest_sha256',${literal(manifestSha256)}),
    'Owner-authorized staging contact cleanup; AUD-07; PR #396; operator identity recorded in maintenance receipt'
  FROM jsonb_array_elements(v_manifest->'auditRows') x;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>6 THEN RAISE EXCEPTION 'AUD07 wrong audit append count'; END IF;
  ${verifyAuditAppend}
  ${verifyUntouched}
  ${verifyPreserved}
  ${checkAuditBaseline}
  IF ${snapshot("credential_cases")} IS DISTINCT FROM v_cases_before THEN RAISE EXCEPTION 'AUD07 cases changed'; END IF;
  ${otherPublic(false)}
  RAISE NOTICE 'AUD07 verified: five parties, three assignments, four capture links removed; exactly six audits appended; other original records unchanged';
  ${recover}
END;
$aud07$;
${options.mode === "rehearse-rollback" ? "ROLLBACK" : "COMMIT"};
`;
  return { sql, manifestSha256, sqlSha256: createHash("sha256").update(sql).digest("hex") };
}
