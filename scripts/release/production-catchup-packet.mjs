import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const migrationPaths = Object.freeze([
  "supabase/migrations/20260918172142_p01_vault_authorization.sql",
  "supabase/migrations/20260919033009_provider_csv_add_provider_parity.sql",
]);
export function verifyMigrationOnly(sql) {
  // This gate supports only these reviewed dollar-quoted function migrations.
  // It is not a general SQL parser; reject unsupported comment forms outright.
  if (/--[^\n]*\$\$|\/\*/.test(sql)) {
    throw new Error("Unsupported SQL comments in production packet");
  }
  // Reject all top-level data operations; function bodies run only on later RPC calls.
  const outsideBodies = sql
    .replace(/\$\$[\s\S]*?\$\$/g, "FUNCTION_BODY")
    .replace(/--[^\n]*/g, "")
    .trim();
  const statements = outsideBodies
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    !statements.length ||
    statements.some(
      (s) =>
        !/^(BEGIN|COMMIT)$|^CREATE OR REPLACE FUNCTION public\.[a-z_]+\s*\(|^(REVOKE|GRANT)\s[\s\S]*\bON FUNCTION public\./i.test(
          s,
        ),
    )
  ) {
    throw new Error("Production packet accepts reviewed function DDL and grants only");
  }
  if (/minted-uat|@minted\.invalid|uat_uuid|seed-uat/i.test(sql)) {
    throw new Error("UAT content is forbidden in the production packet");
  }
}
export async function buildProductionPacket(output) {
  const manifest = JSON.parse(
    await readFile(resolve(root, "docs/ops/release-packets/2026-09-22/manifest.json"), "utf8"),
  );
  if (
    JSON.stringify(manifest.migrations.map((x) => x.path)) !== JSON.stringify(migrationPaths) ||
    manifest.uatDataRequired !== false ||
    manifest.productionProject !== "fkvuhfsqcmujywzgczmc"
  ) {
    throw new Error("Production packet manifest does not match the reviewed allowlist");
  }
  const files = [];
  for (const entry of manifest.migrations) {
    const sql = await readFile(resolve(root, entry.path), "utf8");
    if (createHash("sha256").update(sql).digest("hex") !== entry.sha256)
      throw new Error("Migration checksum changed; review required");
    verifyMigrationOnly(sql);
    files.push([basename(entry.path), sql]);
  }
  await mkdir(output, { recursive: false });
  for (const [name, sql] of files) await writeFile(resolve(output, name), sql, { flag: "wx" });
  await writeFile(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
  });
  return { status: "PREPARED_NOT_APPLIED", migrations: files.length, fixtureFiles: 0 };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3)
    throw new Error(
      "Usage: node scripts/release/production-catchup-packet.mjs /absolute/new-directory",
    );
  if (!process.argv[2].startsWith("/")) throw new Error("Absolute output directory required");
  process.stdout.write(JSON.stringify(await buildProductionPacket(process.argv[2])) + "\n");
}
