import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readInventory } from "./inventory.mjs";
import { createDatabase } from "./database.mjs";
import { runMigrations } from "./runner.mjs";

const connectionString = process.env.MIGRATION_TEST_DATABASE_URL;
test(
  "real Supabase CLI: ledger tracking, repeat execution, missing columns and atomic failure",
  { skip: !connectionString, timeout: 120_000 },
  async () => {
    const url = new URL(connectionString);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname),
      "Synthetic tests accept loopback only",
    );
    assert.equal(url.pathname, "/postgres");
    const psql = process.env.MIGRATION_TEST_PSQL ?? "psql";
    const supabase = process.env.MIGRATION_TEST_SUPABASE ?? "supabase";
    const sql = (input) =>
      execFileSync(psql, ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", connectionString], {
        input,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    // This database must be the dedicated CI service or an owned disposable container.
    assert.equal(
      sql(
        "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'",
      ),
      "0",
    );
    const root = await mkdtemp(join(tmpdir(), "minted-migration-fixture-"));
    const adapters = [];
    async function database() {
      const inventory = await readInventory(root);
      const adapter = await createDatabase({
        root,
        inventory,
        connectionString,
        binaries: { psql, supabase },
      });
      adapters.push(adapter);
      return { inventory, database: adapter };
    }
    try {
      await mkdir(join(root, "supabase/migrations"), { recursive: true });
      await writeFile(
        join(root, "supabase/migrations/20260101000000_initial.sql"),
        "CREATE TABLE public.migration_runner_fixture (id integer PRIMARY KEY);\n",
      );
      const initial = await database();
      await initial.database.push({ dryRun: false });
      const before = await initial.database.snapshot();
      assert.deepEqual(before.versions, ["20260101000000"]);

      await writeFile(
        join(root, "supabase/migrations/20260102000000_add_name.sql"),
        "ALTER TABLE public.migration_runner_fixture ADD COLUMN name text;\n",
      );
      // Independently establish expected catalog on synthetic data; no hosted SQL.
      sql("ALTER TABLE public.migration_runner_fixture ADD COLUMN name text");
      const expected = await initial.database.snapshot();
      sql("ALTER TABLE public.migration_runner_fixture DROP COLUMN name");
      const current = await database();
      const plan = {
        status: "reconciled",
        systemIdentifier: before.systemIdentifier,
        baselineVersions: before.versions,
        baselineSchemaDigest: before.schemaDigest,
        resultSchemaDigest: expected.schemaDigest,
        inventory: current.inventory,
      };
      const input = { ...current, plan, sourceSha: "a".repeat(40) };
      assert.equal((await runMigrations(input)).status, "APPLIED");
      assert.equal((await runMigrations(input)).status, "ALREADY_APPLIED");
      assert.equal(sql("SELECT count(*) FROM supabase_migrations.schema_migrations"), "2");

      sql("ALTER TABLE public.migration_runner_fixture DROP COLUMN name");
      await assert.rejects(runMigrations(input), { code: "SCHEMA_DRIFT" });
      sql("ALTER TABLE public.migration_runner_fixture ADD COLUMN name text");

      await writeFile(
        join(root, "supabase/migrations/20260103000000_fails.sql"),
        "CREATE TABLE public.must_rollback (id integer); SELECT no_such_function();\n",
      );
      const failing = await database();
      const failurePlan = {
        ...plan,
        inventory: failing.inventory,
        baselineVersions: ["20260101000000", "20260102000000"],
        baselineSchemaDigest: expected.schemaDigest,
      };
      await assert.rejects(
        runMigrations({ ...failing, plan: failurePlan, sourceSha: input.sourceSha }),
        { code: "MIGRATION_COMMAND_FAILED" },
      );
      assert.equal(sql("SELECT count(*) FROM supabase_migrations.schema_migrations"), "2");
      assert.equal(sql("SELECT to_regclass('public.must_rollback') IS NULL"), "t");
    } finally {
      for (const adapter of adapters) await adapter.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
