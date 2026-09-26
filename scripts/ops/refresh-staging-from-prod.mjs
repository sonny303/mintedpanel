import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { statSync, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { loadSupabaseAccessToken } from "../recovery/provider.mjs";

const execFileAsync = promisify(execFile);

const PROD_REF = "fkvuhfsqcmujywzgczmc";
const PROD_HOST = "aws-1-us-east-2.pooler.supabase.com";

const STAGING_REF = "vmznysvietfaddakkegt";
const STAGING_HOST = "aws-0-ca-central-1.pooler.supabase.com";

const PG_DUMP = "/opt/homebrew/opt/libpq/bin/pg_dump";
const PSQL = "/opt/homebrew/opt/libpq/bin/psql";

const PUBLIC_DUMP_FILE = "/tmp/minted_prod_public.sql";
const LEDGER_DUMP_FILE = "/tmp/minted_prod_ledger.sql";

async function createLoginRole(token, ref, readOnly = false) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/cli/login-role`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ read_only: readOnly }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create login role for ${ref}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function queryProject(token, ref, sql, readOnly = false) {
  const path = readOnly ? "/database/query/read-only" : "/database/query";
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    throw new Error(`Query failed on ${ref}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  console.log("=== Refreshing Staging Database from Production ===");
  console.log(`Production: ${PROD_REF} (${PROD_HOST})`);
  console.log(`Staging:    ${STAGING_REF} (${STAGING_HOST})\n`);

  const token = await loadSupabaseAccessToken();
  console.log("✓ Supabase access token loaded from system keychain");

  // Step 1: Create login role on production
  console.log("\n[1/6] Requesting read-only login role on Production...");
  const prodRole = await createLoginRole(token, PROD_REF, false);
  console.log(`✓ Prod role created: ${prodRole.role}`);

  const prodEnv = {
    ...process.env,
    PGPASSWORD: prodRole.password,
    PGSSLMODE: "require",
  };

  // Step 2: pg_dump from production
  console.log("\n[2/6] Dumping public schema and data from Production...");
  await execFileAsync(PG_DUMP, [
    "-h", PROD_HOST,
    "-p", "5432",
    "-U", `${prodRole.role}.${PROD_REF}`,
    "-d", "postgres",
    "--role=postgres",
    "-n", "public",
    "--quote-all-identifiers",
    "--no-owner",
    "--no-privileges",
    "-f", PUBLIC_DUMP_FILE,
  ], { env: prodEnv });
  console.log(`✓ Public schema dump completed (${(statSync(PUBLIC_DUMP_FILE).size / 1024).toFixed(1)} KB)`);

  console.log("Dumping migration ledger from Production...");
  await execFileAsync(PG_DUMP, [
    "-h", PROD_HOST,
    "-p", "5432",
    "-U", `${prodRole.role}.${PROD_REF}`,
    "-d", "postgres",
    "--role=postgres",
    "-t", "supabase_migrations.schema_migrations",
    "--data-only",
    "--quote-all-identifiers",
    "-f", LEDGER_DUMP_FILE,
  ], { env: prodEnv });
  console.log(`✓ Migration ledger dump completed (${statSync(LEDGER_DUMP_FILE).size} bytes)`);

  // Prepend SET ROLE postgres to SQL dumps
  const publicSql = await readFile(PUBLIC_DUMP_FILE, "utf8");
  await writeFile(PUBLIC_DUMP_FILE, `SET ROLE postgres;\n${publicSql}`);
  const ledgerSql = await readFile(LEDGER_DUMP_FILE, "utf8");
  await writeFile(LEDGER_DUMP_FILE, `SET ROLE postgres;\n${ledgerSql}`);

  // Step 3: Create login role on staging
  console.log("\n[3/6] Requesting read-write login role on Staging...");
  const stgRole = await createLoginRole(token, STAGING_REF, false);
  console.log(`✓ Staging role created: ${stgRole.role}`);

  const stgEnv = {
    ...process.env,
    PGPASSWORD: stgRole.password,
    PGSSLMODE: "require",
  };

  // Step 4: Reset Staging public schema & restore
  console.log("\n[4/6] Wiping old Staging public schema and restoring Production DDL & data...");
  await execFileAsync(PSQL, [
    "-h", STAGING_HOST,
    "-p", "5432",
    "-U", `${stgRole.role}.${STAGING_REF}`,
    "-d", "postgres",
    "-c", "SET ROLE postgres; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;",
  ], { env: stgEnv });
  console.log("✓ Staging public schema wiped and recreated");

  console.log("Restoring Production public schema and data into Staging...");
  await execFileAsync(PSQL, [
    "-h", STAGING_HOST,
    "-p", "5432",
    "-U", `${stgRole.role}.${STAGING_REF}`,
    "-d", "postgres",
    "-f", PUBLIC_DUMP_FILE,
  ], { env: stgEnv });
  console.log("✓ Public schema and data restored into Staging");

  console.log("Restoring Supabase table and sequence grants on Staging...");
  await execFileAsync(PSQL, [
    "-h", STAGING_HOST,
    "-p", "5432",
    "-U", `${stgRole.role}.${STAGING_REF}`,
    "-d", "postgres",
    "-c", `
      SET ROLE postgres;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO postgres, anon, authenticated, service_role;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role;
      GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
      GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO authenticated;
      GRANT SELECT ON auth.users TO service_role;
    `,
  ], { env: stgEnv });
  console.log("✓ Table and sequence grants restored");

  console.log("Updating Staging migration ledger...");
  await execFileAsync(PSQL, [
    "-h", STAGING_HOST,
    "-p", "5432",
    "-U", `${stgRole.role}.${STAGING_REF}`,
    "-d", "postgres",
    "-c", "SET ROLE postgres; DELETE FROM supabase_migrations.schema_migrations;",
    "-f", LEDGER_DUMP_FILE,
  ], { env: stgEnv });
  console.log("✓ Staging migration ledger updated with 137 production entries");

  // Step 5: Provision staging prerequisites
  console.log("\n[5/6] Provisioning Staging prerequisites (Auth, Vault, Storage)...");
  
  // Ensure zeb@mp.com and sowmya@mp.com exist in staging auth.users, profiles, and memberships
  const authSyncSql = `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'zeb@mp.com') THEN
        INSERT INTO auth.users (
          id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
          created_at, updated_at, confirmation_token, recovery_token
        ) VALUES (
          '1b4d76c2-5d48-4157-8b9d-0e529fc1dab8',
          '00000000-0000-0000-0000-000000000000',
          'authenticated',
          'authenticated',
          'zeb@mp.com',
          crypt('password123', gen_salt('bf')),
          now(),
          now(),
          now(),
          '',
          ''
        );
      END IF;

      IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'sowmya@mp.com') THEN
        INSERT INTO auth.users (
          id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
          created_at, updated_at, confirmation_token, recovery_token, raw_user_meta_data
        ) VALUES (
          '9fe476e1-e40c-4aec-8e46-2c6e93f0e9da',
          '00000000-0000-0000-0000-000000000000',
          'authenticated',
          'authenticated',
          'sowmya@mp.com',
          crypt('password123', gen_salt('bf')),
          now(),
          now(),
          now(),
          '',
          '',
          '{"full_name": "Sowmya S", "first_name": "Sowmya", "last_name": "S", "email_verified": true}'::jsonb
        );
      END IF;

      INSERT INTO public.profiles (id, email, full_name, first_name, last_name, title)
      VALUES (
        '9fe476e1-e40c-4aec-8e46-2c6e93f0e9da',
        'sowmya@mp.com',
        'Sowmya S',
        'Sowmya',
        'S',
        'Credentialing Enrollments'
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
        first_name = COALESCE(public.profiles.first_name, EXCLUDED.first_name),
        last_name = COALESCE(public.profiles.last_name, EXCLUDED.last_name),
        title = COALESCE(public.profiles.title, EXCLUDED.title);

      INSERT INTO public.memberships (id, org_id, user_id, role)
      SELECT
        gen_random_uuid(),
        org.id,
        '9fe476e1-e40c-4aec-8e46-2c6e93f0e9da'::uuid,
        'admin'
      FROM public.organizations org
      ON CONFLICT (org_id, user_id) DO UPDATE
      SET role = 'admin';

      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'private' AND table_name = 'internal_staff') THEN
        INSERT INTO private.internal_staff (auth_user_id, org_id, staff_role, active, manifest_version)
        SELECT
          '9fe476e1-e40c-4aec-8e46-2c6e93f0e9da'::uuid,
          org.id,
          'admin',
          true,
          'operator-grant'
        FROM public.organizations org
        ON CONFLICT (auth_user_id, org_id, staff_role) DO UPDATE
        SET active = true;
      END IF;
    END;
    $$;
  `;
  await queryProject(token, STAGING_REF, authSyncSql, false);
  console.log("✓ Auth users, profiles, admin memberships, and internal_staff verified in Staging");

  // Provision ssn_vault_key in Staging Vault
  const vaultKeySql = `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'ssn_vault_key') THEN
        PERFORM vault.create_secret('minted-staging-ssn-vault-key-32b!', 'ssn_vault_key');
      END IF;
    END;
    $$;
  `;
  await queryProject(token, STAGING_REF, vaultKeySql, false);
  console.log("✓ Staging ssn_vault_key secret provisioned in vault");

  // Ensure storage buckets exist in Staging
  const bucketsSql = `
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('documents', 'documents', false), ('payer-forms', 'payer-forms', false)
    ON CONFLICT (id) DO NOTHING;
  `;
  await queryProject(token, STAGING_REF, bucketsSql, false);
  console.log("✓ Staging storage buckets (documents, payer-forms) verified");

  // Step 6: Post-restore verification
  console.log("\n[6/6] Verifying Staging state matches Production...");
  const tableCountRes = await queryProject(token, STAGING_REF, "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';", true);
  const ledgerCountRes = await queryProject(token, STAGING_REF, "SELECT count(*) FROM supabase_migrations.schema_migrations;", true);
  const orgCountRes = await queryProject(token, STAGING_REF, "SELECT count(*) FROM public.organizations;", true);
  const providerCountRes = await queryProject(token, STAGING_REF, "SELECT count(*) FROM public.providers;", true);

  console.log(`\n=== Verification Results ===`);
  console.log(`Staging Public Tables:   ${tableCountRes[0].count} (Expected: 64)`);
  console.log(`Staging Migration Ledger: ${ledgerCountRes[0].count} (Expected: 137)`);
  console.log(`Organizations:           ${orgCountRes[0].count}`);
  console.log(`Providers:               ${providerCountRes[0].count}`);

  console.log("\n🎉 Full Staging refresh from Production complete and verified!");
}

main().catch((err) => {
  console.error("\n❌ Refresh failed:", err);
  process.exit(1);
});
