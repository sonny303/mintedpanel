import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PACKET = resolve(ROOT, "docs/ops/release-packets/2026-09-22");
const MANIFEST_PATH = resolve(PACKET, "staging-alignment-slice-5-manifest.json");
const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
const SQL_PATH = resolve(PACKET, manifest.packet.files[0]);
const sql = await readFile(SQL_PATH, "utf8");
const REPAIR_MIGRATION_PATH = resolve(
  ROOT,
  "supabase/migrations/20260923214607_repair_party_capture_link_org_guard.sql",
);
const repairSql = await readFile(REPAIR_MIGRATION_PATH, "utf8");

function stripDollarQuotedBodies(source) {
  let output = "";
  let cursor = 0;
  while (cursor < source.length) {
    const match = source.slice(cursor).match(/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/);
    if (!match) {
      output += source.slice(cursor);
      break;
    }
    const open = cursor + match.index;
    const delimiter = match[0];
    const close = source.indexOf(delimiter, open + delimiter.length);
    if (close < 0) return source;
    output += source.slice(cursor, open);
    output += " ".repeat(close + delimiter.length - open);
    cursor = close + delimiter.length;
  }
  return output;
}

test("slice 5 manifest pins the reviewed base, source, packet, and target", async () => {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.status, "AUTHOR_ONLY_NOT_APPLIED");
  assert.equal(manifest.baseCommit, "99e805abee603da618d71aaa406d096e4da95620");
  assert.equal(manifest.sourceSha, "7a40fc7876c4b53810e1391426afbed865176c3b");
  assert.equal(manifest.stagingProjectRef, "vmznysvietfaddakkegt");
  assert.equal(manifest.forbiddenProductionProjectRef, "fkvuhfsqcmujywzgczmc");
  assert.equal(
    manifest.targetBinding.hosted.requiredPhysicalSystemIdentifier,
    "7662742571317219726",
  );
  assert.equal(manifest.targetBinding.local.requiredDatabase, "minted_recovery");
  assert.equal(manifest.targetBinding.local.requiredExternalReceiptBinding, true);
  assert.equal(
    manifest.targetBinding.local.expectedApplicationStatus,
    "LOCAL_APPLICATION_BASELINE_VERIFIED",
  );
  assert.equal(manifest.targetBinding.local.applicationBinding.status, "BOUND");
  assert.equal(
    manifest.targetBinding.local.applicationBinding.baselineQualificationDigest,
    "0feaecb6544f20a899cc169c472c5e668ef3d73f61f3e15a5ea170cb63abea7b",
  );
  assert.deepEqual(manifest.targetBinding.local.applicationBinding.baselineTarget, {
    runId: "2e465ae49df2037d",
    systemIdentifier: "7688816016043610151",
  });
  assert.equal(
    manifest.targetBinding.local.applicationBinding.captureDigest,
    "efe2bdaecddf7e3ea83d0afd42110e775c637e867f06499e75537b89f66da4a5",
  );
  assert.deepEqual(manifest.targetBinding.local.applicationBinding.rehearsalTarget, {
    runId: "7dc905282a047aa2",
    containerId: "d7ed97e0cb0baceab4ea2a9eb94a6357fad2a6ddb10fd536a9bd1b2731bfdb84",
    systemIdentifier: "7688850032395546663",
  });
  assert.equal(
    manifest.targetBinding.local.requiredPhysicalSystemIdentifier,
    "7688850032395546663",
  );
  assert.equal(
    manifest.targetBinding.local.currentReceipt.status,
    "LOCAL_APPLICATION_BASELINE_VERIFIED",
  );
  assert.equal(manifest.targetBinding.local.currentReceipt.receiptId, "0feaecb6544f20a8");
  assert.equal(manifest.targetBinding.local.currentReceipt.eligibleForApply, false);
  assert.deepEqual(manifest.packet.files, ["staging-alignment-slice-5.sql"]);
  assert.equal(
    createHash("sha256")
      .update(await readFile(SQL_PATH))
      .digest("hex"),
    manifest.packet.checksums["staging-alignment-slice-5.sql"],
  );
  for (const [relativePath, expectedDigest] of Object.entries(manifest.sourceFiles)) {
    assert.equal(
      createHash("sha256")
        .update(await readFile(resolve(ROOT, relativePath)))
        .digest("hex"),
      expectedDigest,
      `source checksum drift: ${relativePath}`,
    );
  }
});

test("slice 5 is one guarded additive transaction", () => {
  const executable = stripDollarQuotedBodies(sql);
  assert.match(sql, /^-- AUTHOR-ONLY staging alignment packet/m);
  assert.match(sql, /BEGIN;\s*SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s';/);
  assert.match(sql, /SET LOCAL statement_timeout = '120s';/);
  assert.match(
    sql,
    /pg_advisory_xact_lock\(hashtextextended\('mintedpanel:staging-alignment:slice-5'/,
  );
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /7662742571317219726::bigint/);
  assert.match(sql, /current_database\(\) <> 'minted_recovery'/);
  assert.match(
    sql,
    /current_setting\('minted\.restore_status', true\) IS DISTINCT FROM 'LOCAL_APPLICATION_BASELINE_VERIFIED'/,
  );
  assert.match(sql, /current_setting\('minted\.restore_receipt_id', true\) IS NULL/);
  assert.match(
    sql,
    /current_setting\('minted\.restore_receipt_id', true\) !~ '\^\[a-f0-9\]\{16\}\$'/,
  );
  assert.match(
    sql,
    /current_setting\('minted\.restore_capture_digest', true\) IS DISTINCT FROM 'efe2bdaecddf7e3ea83d0afd42110e775c637e867f06499e75537b89f66da4a5'/,
  );
  assert.match(
    sql,
    /current_setting\('minted\.restore_system_identifier', true\) IS DISTINCT FROM '7688850032395546663'/,
  );
  assert.match(
    sql,
    /current_setting\('minted\.restore_system_identifier', true\) !~ '\^\[0-9\]\+\$'/,
  );
  assert.match(
    sql,
    /current_setting\('minted\.release_project_ref', true\) IS DISTINCT FROM 'vmznysvietfaddakkegt'/,
  );
  assert.match(
    sql,
    /current_setting\('minted\.release_source_sha', true\) IS DISTINCT FROM '7a40fc7876c4b53810e1391426afbed865176c3b'/,
  );
  assert.match(sql, /current_setting\('transaction_read_only'\) = 'on'/);
  assert.doesNotMatch(sql, /fkvuhfsqcmujywzgczmc/);
  assert.doesNotMatch(executable, /^\s*DELETE\s+FROM\s+public\.parties\b/im);
  assert.doesNotMatch(executable, /m\.user_id\s*=\s*p\.created_by/);
  assert.doesNotMatch(executable, /^\s*DROP\s+(?:TABLE|DATABASE|SCHEMA)\b/im);
});

test("slice 5 resolves contacts only from assignments and guards preservation", () => {
  assert.match(sql, /SELECT count\(\*\)\s+FROM public\.parties\) <> 17/);
  assert.match(
    sql,
    /WHERE NOT EXISTS \(\s*SELECT 1 FROM public\.party_role_assignments a WHERE a\.party_id = p\.id\s*\)/s,
  );
  assert.match(sql, /HAVING count\(DISTINCT a\.org_id\) <> 1/);
  assert.match(sql, /SET org_id = resolved\.org_id/);
  assert.match(sql, /min\(a\.org_id::text\)::uuid AS org_id/);
  assert.match(sql, /ORDER BY org_id, role_key, created_at, id/);
  for (const table of ["party", "assignment", "capture_link", "audit"]) {
    assert.match(sql, new RegExp(`minted_alignment_${table}_guard`));
  }
  assert.match(sql, /FULL JOIN public\.parties p ON p\.id = g\.id/);
  assert.match(sql, /FULL JOIN public\.party_role_assignments a ON a\.id = g\.id/);
  assert.match(sql, /FULL JOIN public\.party_capture_links l ON l\.id = g\.id/);
  assert.match(sql, /FULL JOIN public\.audit_log a ON a\.id = g\.id/);
  assert.match(sql, /md5\(to_jsonb\(a\)::text\)/);
  assert.match(sql, /ALIGNMENT_CONTACT_MULTIPLE_DEFAULTS/);
  assert.match(sql, /ALIGNMENT_CONTACT_CROSS_ORG_PRESTATE/);
  assert.match(sql, /HAVING count\(\*\) FILTER \(WHERE is_default\) <> 1/);
});

test("slice 5 includes final role model definitions and scoped ACLs", () => {
  for (const column of ["org_id", "first_name", "last_name", "title", "fax", "phone_extension"]) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.match(sql, /ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false/);
  assert.match(sql, /SET label = 'Authorized contact'/);
  assert.match(sql, /SET label = 'Organization contact'/);
  assert.match(sql, /SET is_active = true/);
  assert.match(sql, /party_role_assignments_org_party_fkey/);
  assert.match(sql, /parties_org_id_immutable/);
  assert.match(sql, /to_regprocedure\('public\.insert_contact_party\(jsonb,uuid\)'\) IS NULL/);
  for (const name of [
    "insert_contact_party",
    "create_organization",
    "create_capture_link",
    "submit_capture",
    "validate_capture_token",
    "set_default_party_role",
  ]) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`));
  }
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.insert_contact_party\(jsonb, uuid\) FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.insert_contact_party\(jsonb, uuid, uuid\) FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.create_capture_link\(uuid, uuid, text, text\) FROM PUBLIC, anon/,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.submit_capture\(text, jsonb\) TO anon, authenticated/,
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.reject_party_org_change\(\) FROM public, anon, authenticated/,
  );
  assert.doesNotMatch(sql, /DROP FUNCTION[^;]*insert_contact_party\(jsonb, uuid\)/i);
});

test("slice 5 proves effective ACLs after the final grants", () => {
  const aclStart = sql.lastIndexOf("DO $acl_poststate$");
  assert.ok(
    aclStart > sql.lastIndexOf("GRANT EXECUTE ON FUNCTION public.validate_capture_token(text)"),
  );
  const aclPoststate = sql.slice(aclStart);
  assert.match(aclPoststate, /has_function_privilege\('anon', v_signature, 'EXECUTE'\)/);
  assert.match(aclPoststate, /has_function_privilege\('authenticated', v_signature, 'EXECUTE'\)/);
  const loopMarker = "FOREACH v_signature IN ARRAY ARRAY[";
  const privateLoopStart = aclPoststate.indexOf(loopMarker);
  const authLoopStart = aclPoststate.indexOf(loopMarker, privateLoopStart + 1);
  const publicLoopStart = aclPoststate.indexOf(loopMarker, authLoopStart + 1);
  assert.ok(privateLoopStart > 0);
  assert.ok(authLoopStart > 0);
  assert.ok(publicLoopStart > authLoopStart);
  const privateAcl = aclPoststate.slice(privateLoopStart, authLoopStart);
  const authenticatedAcl = aclPoststate.slice(authLoopStart, publicLoopStart);
  const publicAcl = aclPoststate.slice(publicLoopStart);
  assert.equal(aclPoststate.indexOf("GRANT EXECUTE"), -1);
  for (const signature of [
    "public._party_first_name(text)",
    "public._party_last_name(text)",
    "public.insert_contact_party(jsonb, uuid)",
    "public.insert_contact_party(jsonb, uuid, uuid)",
    "public.reject_party_org_change()",
  ]) {
    assert.ok(privateAcl.includes(`'${signature}'`), `private ACL poststate missing ${signature}`);
  }
  for (const signature of [
    "public.create_organization(text, text, text)",
    "public.create_organization(text, text, text, jsonb, jsonb)",
    "public.create_capture_link(uuid, uuid, text, text)",
    "public.set_default_party_role(uuid, uuid, text)",
  ]) {
    assert.ok(
      authenticatedAcl.includes(`'${signature}'`),
      `authenticated ACL poststate missing ${signature}`,
    );
  }
  for (const signature of [
    "public.submit_capture(text, jsonb)",
    "public.validate_capture_token(text)",
  ]) {
    assert.ok(publicAcl.includes(`'${signature}'`), `public ACL poststate missing ${signature}`);
  }
  assert.match(privateAcl, /has_function_privilege\('anon', v_signature, 'EXECUTE'\)/);
  assert.match(privateAcl, /has_function_privilege\('authenticated', v_signature, 'EXECUTE'\)/);
  assert.match(authenticatedAcl, /has_function_privilege\('anon', v_signature, 'EXECUTE'\)/);
  assert.match(
    authenticatedAcl,
    /NOT has_function_privilege\('authenticated', v_signature, 'EXECUTE'\)/,
  );
  assert.match(publicAcl, /NOT has_function_privilege\('anon', v_signature, 'EXECUTE'\)/);
  assert.match(publicAcl, /NOT has_function_privilege\('authenticated', v_signature, 'EXECUTE'\)/);
});

test("capture boundary repair is exact, ordered, and limited to the two RPCs", () => {
  const functionBody = (source, name) => {
    const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
    assert.ok(start >= 0, `${name} definition is present`);
    const end = source.indexOf("\n$$;", start);
    assert.ok(end > start, `${name} definition is terminated`);
    return source.slice(start, end + 4);
  };
  const submitRepair = functionBody(repairSql, "submit_capture");
  const validateRepair = functionBody(repairSql, "validate_capture_token");
  const submitSlice = functionBody(sql, "submit_capture");
  const validateSlice = functionBody(sql, "validate_capture_token");

  assert.equal(submitRepair, submitSlice, "slice 5 carries the reviewed submit_capture definition");
  assert.equal(
    validateRepair,
    validateSlice,
    "slice 5 carries the reviewed validate_capture_token definition",
  );

  for (const [name, body, invalidShape] of [
    ["submit_capture", submitRepair, "jsonb_build_object('ok', false, 'state', 'invalid')"],
    ["validate_capture_token", validateRepair, "jsonb_build_object('state', 'invalid')"],
  ]) {
    const tokenLookup = body.indexOf("SELECT * INTO v_link");
    const tokenLock = body.indexOf("FOR UPDATE;", tokenLookup);
    const lock = body.indexOf("FOR KEY SHARE;", tokenLookup);
    const markValid = body.indexOf("mark_rpc_attempt_valid", tokenLookup);
    assert.ok(tokenLookup >= 0, `${name} looks up the token`);
    assert.ok(tokenLock > tokenLookup, `${name} locks the link after token lookup`);
    assert.ok(lock > tokenLock, `${name} locks the party after the link`);
    assert.ok(markValid > lock, `${name} marks the attempt valid after the party lock`);
    assert.ok(body.indexOf(invalidShape, lock) > lock, `${name} has a uniform invalid result`);
    assert.match(
      body.slice(tokenLookup, markValid),
      /PERFORM 1\s+FROM public\.parties p[\s\S]*?p\.id = v_link\.party_id[\s\S]*?p\.org_id = v_link\.org_id[\s\S]*?FOR KEY SHARE;[\s\S]*?IF NOT FOUND THEN[\s\S]*?state', 'invalid'/,
      `${name} checks the same-org party under lock before any valid-token work`,
    );
  }

  assert.match(
    submitRepair,
    /UPDATE public\.parties[\s\S]*?WHERE id = v_link\.party_id\s+AND org_id = v_link\.org_id;[\s\S]*?IF NOT FOUND THEN[\s\S]*?state', 'invalid'/,
  );
  assert.match(
    submitRepair,
    /UPDATE public\.party_capture_links[\s\S]*?WHERE id = v_link\.id\s+AND org_id = v_link\.org_id;[\s\S]*?IF NOT FOUND THEN[\s\S]*?state', 'invalid'/,
  );
  assert.match(
    validateRepair,
    /SELECT \* INTO v_party FROM public\.parties WHERE id = v_link\.party_id AND org_id = v_link\.org_id;/,
  );
  assert.match(
    repairSql,
    /REVOKE ALL ON FUNCTION public\.submit_capture\(text, jsonb\) FROM PUBLIC, anon, authenticated;/,
  );
  assert.match(
    repairSql,
    /GRANT EXECUTE ON FUNCTION public\.validate_capture_token\(text\) TO anon, authenticated;/,
  );
  assert.doesNotMatch(repairSql, /FOREIGN KEY[^;]*party_capture_links/i);
  assert.doesNotMatch(repairSql, /CREATE\s+(?:TABLE|INDEX|TRIGGER)\b/i);
});

test("slice 5 rejects unresolved active links while preserving inactive rows", () => {
  const prestate = sql.slice(
    sql.indexOf("DO $prestate$"),
    sql.indexOf("$prestate$;", sql.indexOf("DO $prestate$")),
  );
  const poststate = sql.slice(sql.indexOf("DO $poststate$"));
  assert.match(
    prestate,
    /l\.state = 'active'[\s\S]*?a\.party_id = l\.party_id[\s\S]*?a\.org_id = l\.org_id/,
  );
  assert.match(prestate, /ALIGNMENT_CONTACT_ACTIVE_CAPTURE_LINK_ORG_UNRESOLVED/);
  assert.doesNotMatch(
    prestate,
    /p\.org_id/,
    "prestate cannot read the party column before it is added",
  );
  assert.match(poststate, /l\.state = 'active'[\s\S]*?l\.org_id IS DISTINCT FROM p\.org_id/);
  assert.match(poststate, /ALIGNMENT_CONTACT_ACTIVE_CAPTURE_LINK_ORG_UNRESOLVED_POSTSTATE/);
  assert.match(sql, /minted_alignment_capture_link_guard/);
  assert.match(sql, /md5\(to_jsonb\(l\)::text\)/);
  assert.match(sql, /FULL JOIN public\.party_capture_links l ON l\.id = g\.id/);
  assert.match(sql, /ALIGNMENT_CONTACT_CAPTURE_LINK_PRESERVATION_FAILED/);
  assert.doesNotMatch(sql, /CREATE\s+.*FOREIGN KEY[^;]*party_capture_links/i);
});
