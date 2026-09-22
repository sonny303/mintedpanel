import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FIXTURE_VERSION,
  assertSafeTarget,
  fixtureUuid,
  hasExactOwnershipMarker,
} from "./uat-fixture.mjs";

test("fixture UUIDs are deterministic and unique", () => {
  assert.equal(fixtureUuid("case", 1), fixtureUuid("case", 1));
  assert.notEqual(fixtureUuid("case", 1), fixtureUuid("case", 2));
  assert.match(
    fixtureUuid("case", 1),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("target guard accepts exact staging and loopback pairs", () => {
  assert.equal(
    assertSafeTarget({
      supabaseUrl: "https://vmznysvietfaddakkegt.supabase.co",
      databaseUrl: "postgres://postgres:x@db.vmznysvietfaddakkegt.supabase.co:5432/postgres",
    }),
    "staging",
  );
  assert.equal(
    assertSafeTarget({
      supabaseUrl: "https://vmznysvietfaddakkegt.supabase.co",
      databaseUrl:
        "postgres://postgres.vmznysvietfaddakkegt:x@aws-0-us-west-1.pooler.supabase.com:5432/postgres",
    }),
    "staging",
  );
  assert.equal(
    assertSafeTarget({
      supabaseUrl: "http://127.0.0.1:54321",
      databaseUrl: "postgres://postgres:postgres@localhost:54322/postgres",
    }),
    "local",
  );
});

test("target guard rejects production, unknown refs, arbitrary URLs, and mixed targets", () => {
  for (const pair of [
    [
      "https://fkvuhfsqcmujywzgczmc.supabase.co",
      "postgres://postgres:x@db.fkvuhfsqcmujywzgczmc.supabase.co/postgres",
    ],
    ["https://unknown.supabase.co", "postgres://postgres:x@db.unknown.supabase.co/postgres"],
    ["http://127.0.0.1:54321", "postgres://postgres:x@remote.example/postgres"],
    [
      "https://vmznysvietfaddakkegt.supabase.co",
      "postgres://postgres:x@db.other.supabase.co/postgres",
    ],
  ])
    assert.throws(
      () => assertSafeTarget({ supabaseUrl: pair[0], databaseUrl: pair[1] }),
      /Refusing unsafe target/,
    );
});

test("ownership requires the exact version marker", () => {
  assert.equal(
    hasExactOwnershipMarker({
      user_metadata: { minted_uat_fixture: { version: FIXTURE_VERSION } },
    }),
    true,
  );
  assert.equal(
    hasExactOwnershipMarker({ user_metadata: { minted_uat_fixture: { version: "older" } } }),
    false,
  );
  assert.equal(hasExactOwnershipMarker({ user_metadata: {} }), false);
});

test("manifest exactly matches generated reset boundaries", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("./uat-fixture-manifest.json", import.meta.url), "utf8"),
  );
  const { ids } = await import("./uat-fixture.mjs");
  assert.deepEqual(manifest.ownership.organizations, ids.organizations);
  assert.deepEqual(manifest.ownership.deletionCases, ids.deletionCases);
});

test("SQL owns exact reset modes and deletion-fidelity children", async () => {
  const sql = await readFile(new URL("../../supabase/seed-uat.sql", import.meta.url), "utf8");
  for (const text of [
    "deletion-pool",
    "case_generation_run_rows",
    "case_generation_exclusions",
    "enrollment_facts",
    "case_status_history",
    "payer_pipeline_history",
    "fill_sessions",
    "case_facilities",
  ])
    assert.match(sql, new RegExp(text));
  assert.doesNotMatch(sql, /DELETE FROM public\.audit_log/i);
});
