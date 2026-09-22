#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget, counts, ids, personas } from "./uat-fixture.mjs";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing protected environment variable ${name}`);
  return value;
}

async function query(databaseUrl, sql) {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      "psql",
      [databaseUrl, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
      {
        env: { ...process.env, PGPASSWORD: undefined },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve(output.trim()) : reject(new Error(`psql exited ${code}`)),
    );
  });
}

async function verifyAuth(supabaseUrl, anonKey, password) {
  for (const persona of personas) {
    const client = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: session, error: signInError } = await client.auth.signInWithPassword({
      email: persona.email,
      password,
    });
    if (signInError) throw signInError;
    const { data, error } = await client.from("memberships").select("org_id,role");
    if (error) throw error;
    const authorizedOrg = ids.organizations[persona.org - 1];
    assert.ok(data.length > 0, `${persona.key} sees its organization memberships`);
    assert.ok(
      data.every((row) => row.org_id === authorizedOrg),
      `${persona.key} cannot read another organization`,
    );
    assert.ok(
      data.some((row) => row.role === persona.role),
      `${persona.key} expected role is present`,
    );
    await client.auth.signOut();
    assert.ok(session.user.id);
  }
}

export async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const databaseUrl = requiredEnv("UAT_DATABASE_URL");
  assertSafeTarget({ supabaseUrl, databaseUrl });
  const uuidList = (values) => values.map((id) => `'${id}'::uuid`).join(",");
  const summary = JSON.parse(
    await query(
      databaseUrl,
      `
    WITH owned_orgs AS (SELECT unnest(ARRAY[${ids.organizations.map((id) => `'${id}'::uuid`).join(",")}]) id)
    SELECT json_build_object(
      'organizations',(SELECT count(*) FROM organizations WHERE id IN (SELECT id FROM owned_orgs)),
      'personas',(SELECT count(*) FROM profiles WHERE email IN (${personas.map((persona) => `'${persona.email}'`).join(",")})),
      'groups',(SELECT count(*) FROM provider_groups WHERE org_id IN (SELECT id FROM owned_orgs)),
      'facilities',(SELECT count(*) FROM facilities WHERE org_id IN (SELECT id FROM owned_orgs)),
      'payers',(SELECT count(*) FROM payers WHERE id IN (${uuidList(ids.payers)})),
      'providers',(SELECT count(*) FROM providers WHERE org_id IN (SELECT id FROM owned_orgs)),
      'licenses',(SELECT count(*) FROM state_licenses WHERE id IN (${uuidList(ids.licenses)})),
      'providerFacilities',(SELECT count(*) FROM provider_facility_assignments WHERE id IN (${uuidList(ids.providerFacilities)})),
      'payerTargets',(SELECT count(*) FROM payer_network_targets WHERE id IN (${uuidList(ids.payerTargets)})),
      'enrollmentFacts',(SELECT count(*) FROM enrollment_facts WHERE id IN (${uuidList(ids.enrollmentFacts)})),
      'cases',(SELECT count(*) FROM credential_cases WHERE id IN (${uuidList(ids.cases)})),
      'deletionCases',(SELECT count(*) FROM credential_cases WHERE id IN (${ids.deletionCases.map((id) => `'${id}'::uuid`).join(",")})),
      'tasks',(SELECT count(*) FROM tasks WHERE id IN (${uuidList(ids.tasks)})),
      'touches',(SELECT count(*) FROM touches WHERE id IN (${uuidList(ids.touches)})),
      'invalidCases',(SELECT count(*) FROM credential_cases c LEFT JOIN providers p ON p.id=c.provider_id AND p.org_id=c.org_id LEFT JOIN provider_groups g ON g.id=c.group_id AND g.org_id=c.org_id LEFT JOIN payers y ON y.id=c.payer_id WHERE c.org_id IN (SELECT id FROM owned_orgs) AND (p.id IS NULL OR g.id IS NULL OR y.id IS NULL OR c.state !~ '^[A-Z]{2}$')),
      'crossTenant',(SELECT count(*) FROM provider_facility_assignments a JOIN providers p ON p.id=a.provider_id JOIN facilities f ON f.id=a.facility_id WHERE a.org_id IN (SELECT id FROM owned_orgs) AND (a.org_id<>p.org_id OR a.org_id<>f.org_id))
    );`,
    ),
  );
  for (const [key, minimum] of Object.entries(counts))
    assert.ok(summary[key] >= minimum, `${key}: expected >=${minimum}, got ${summary[key]}`);
  assert.equal(summary.invalidCases, 0, "case relationship invariants");
  assert.equal(summary.crossTenant, 0, "provider-location tenant invariants");
  if (process.env.UAT_SUPABASE_ANON_KEY && process.env.UAT_SHARED_PASSWORD) {
    await verifyAuth(
      supabaseUrl,
      process.env.UAT_SUPABASE_ANON_KEY,
      process.env.UAT_SHARED_PASSWORD,
    );
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
