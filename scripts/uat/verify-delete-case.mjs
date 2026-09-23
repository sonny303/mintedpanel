#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import { psqlEnvironment, assertSafeTarget, fixtureUuid, ids } from "./uat-fixture.mjs";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing protected environment variable ${name}`);
  return value;
}

async function main() {
  const databaseUrl = requiredEnv("UAT_DATABASE_URL");
  assertSafeTarget({ supabaseUrl: requiredEnv("SUPABASE_URL"), databaseUrl });
  const caseId = fixtureUuid("case", 46);
  const enrollmentId = fixtureUuid("enrollment", 20);
  const exclusionId = fixtureUuid("exclusion", 1);
  const generationRowId = fixtureUuid("generation-row", 46);
  const sql = `
    BEGIN;
    SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM profiles WHERE email='uat.admin.alpha@minted.invalid'),true);
    SELECT set_config('request.jwt.claim.role','authenticated',true);
    SELECT public.delete_case('${ids.organizations[0]}'::uuid,'${caseId}'::uuid);
    DO $verify$
    BEGIN
      IF EXISTS (SELECT 1 FROM credential_cases WHERE id='${caseId}') THEN RAISE EXCEPTION 'case retained'; END IF;
      IF EXISTS (SELECT 1 FROM tasks WHERE case_id='${caseId}') OR EXISTS (SELECT 1 FROM touches WHERE case_id='${caseId}') OR EXISTS (SELECT 1 FROM status_history WHERE case_id='${caseId}') OR EXISTS (SELECT 1 FROM case_status_history WHERE case_id='${caseId}') OR EXISTS (SELECT 1 FROM payer_pipeline_history WHERE case_id='${caseId}') OR EXISTS (SELECT 1 FROM fill_sessions WHERE case_id='${caseId}') OR EXISTS (SELECT 1 FROM case_facilities WHERE case_id='${caseId}') THEN RAISE EXCEPTION 'case children retained'; END IF;
      IF (SELECT case_id IS NOT NULL FROM case_generation_run_rows WHERE id='${generationRowId}') THEN RAISE EXCEPTION 'generation row did not SET NULL'; END IF;
      IF NOT EXISTS (SELECT 1 FROM enrollment_facts WHERE id='${enrollmentId}' AND expired_at IS NOT NULL) THEN RAISE EXCEPTION 'enrollment not expired'; END IF;
      IF NOT EXISTS (SELECT 1 FROM case_generation_exclusions WHERE id='${exclusionId}' AND status='voided') THEN RAISE EXCEPTION 'exclusion not voided'; END IF;
      IF NOT EXISTS (SELECT 1 FROM audit_log WHERE entity_id='${caseId}' AND action_type='DELETE') THEN RAISE EXCEPTION 'audit receipt missing'; END IF;
    END $verify$;
    COMMIT;`;
  await new Promise((resolve, reject) => {
    const child = spawn("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-c", sql], {
      env: psqlEnvironment(),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`psql exited ${code}`)),
    );
  });
  process.stdout.write(`delete_case contract verified for ${caseId}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
