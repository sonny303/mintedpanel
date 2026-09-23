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
    /current_setting\('minted\.restore_status', true\) IS DISTINCT FROM 'QUALIFIED'/,
  );
  assert.match(sql, /current_setting\('minted\.restore_receipt_id', true\) IS NULL/);
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
