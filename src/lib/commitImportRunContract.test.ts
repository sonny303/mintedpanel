import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

function latestCommitImportRunSql(): string {
  const definitions = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"))
    .filter((sql) => /CREATE OR REPLACE FUNCTION public\.commit_import_run\s*\(/i.test(sql));
  const latest = definitions.at(-1);
  if (!latest) throw new Error("No commit_import_run migration found");
  return latest;
}

const sql = latestCommitImportRunSql();
const executableSql = sql.replace(/--.*$/gm, "");

function providerInsertColumns(source: string): string[] {
  const match = source.match(/INSERT INTO providers\s*\(([\s\S]*?)\)\s*VALUES\s*\(/i);
  if (!match) throw new Error("Provider INSERT not found in commit_import_run");
  return match[1]
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

describe("latest commit_import_run migration contract", () => {
  it("writes every create-only Add Provider parity column while leaving status to its default", () => {
    expect(providerInsertColumns(executableSql)).toEqual(
      expect.arrayContaining([
        "credentials",
        "email",
        "phone",
        "start_date",
        "degree",
        "school_name",
        "graduation_date",
        "caqh_last_attested_date",
        "is_new_grad",
      ]),
    );
    expect(providerInsertColumns(executableSql)).not.toContain("status");
  });

  it("keeps the provider update allowlist narrow", () => {
    const updateBlock = executableSql.match(/UPDATE providers SET([\s\S]*?)WHERE id = v_pid/i)?.[1];
    if (!updateBlock) throw new Error("Provider UPDATE block not found in commit_import_run");
    const assignedColumns = [...updateBlock.matchAll(/^\s*([a-z_]+)\s*=/gm)].map(
      (match) => match[1],
    );
    expect(assignedColumns).toEqual(["first_name", "last_name", "npi", "specialty", "updated_at"]);
  });

  it("writes license_type on create and insert-only update paths", () => {
    const inserts = [
      ...executableSql.matchAll(
        /INSERT INTO state_licenses\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\);/gi,
      ),
    ];
    expect(inserts).toHaveLength(2);
    for (const insert of inserts) {
      expect(insert[1]).toMatch(/\blicense_type\b/);
      expect(insert[2]).toMatch(/v_license\s*->>\s*'license_type'/);
    }

    const licenseUpdateLoop = executableSql.match(
      /jsonb_array_elements\(COALESCE\(v_entry -> 'license_updates'[\s\S]*?END LOOP;/i,
    )?.[0];
    if (!licenseUpdateLoop) throw new Error("License update loop not found in commit_import_run");
    expect(licenseUpdateLoop).not.toMatch(/license_type/i);
  });

  it("preserves the privileged RPC security boundary", () => {
    expect(executableSql).toMatch(/SECURITY DEFINER/i);
    expect(executableSql).toMatch(/SET search_path = public/i);
    expect(executableSql).toMatch(/auth\.uid\(\)/i);
    expect(executableSql).toMatch(/user_role\(v_org\) = 'admin'/i);
    expect(executableSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.commit_import_run\(uuid, jsonb\) FROM PUBLIC/i,
    );
    expect(executableSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.commit_import_run\(uuid, jsonb\) FROM anon/i,
    );
    expect(executableSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.commit_import_run\(uuid, jsonb\) TO authenticated/i,
    );
  });
});
