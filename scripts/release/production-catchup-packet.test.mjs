import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { migrationPaths, verifyMigrationOnly } from "./production-catchup-packet.mjs";

test("reviewed production changes contain no top-level data writes", async () => {
  for (const path of migrationPaths)
    verifyMigrationOnly(await readFile(new URL(`../../${path}`, import.meta.url), "utf8"));
});
test("rejects fixture, backfill, auth provisioning, and destructive SQL", async () => {
  for (const sql of [
    "INSERT INTO providers VALUES ('x');",
    "UPDATE providers SET name='x';",
    "DELETE FROM providers;",
    "DROP TABLE providers;",
    "SELECT vault.create_secret('x');",
    "CREATE OR REPLACE FUNCTION public.test() RETURNS text LANGUAGE sql AS $$ SELECT 'uat.admin.alpha@minted.invalid'; $$;",
  ])
    assert.throws(() => verifyMigrationOnly(sql));
  const seed = await readFile(new URL("../../supabase/seed-uat.sql", import.meta.url), "utf8");
  assert.throws(() => verifyMigrationOnly(seed));
});

test("comment delimiters cannot conceal a top-level data write", () => {
  assert.throws(() =>
    verifyMigrationOnly(
      "BEGIN;\n-- $$\nINSERT INTO public.providers DEFAULT VALUES;\n-- $$\nCOMMIT;",
    ),
  );
  assert.throws(() =>
    verifyMigrationOnly(
      "BEGIN; /* $$ */ INSERT INTO public.providers DEFAULT VALUES; /* $$ */ COMMIT;",
    ),
  );
});
