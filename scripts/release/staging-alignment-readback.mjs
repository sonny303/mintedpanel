import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectSealedBackup } from "../recovery/restore.mjs";
import { loadSupabaseAccessToken } from "../recovery/provider.mjs";
import { SNAPSHOT_CATALOG_SQL } from "../recovery/snapshot.mjs";
import { canonicalDigest } from "./contract.mjs";

const WORKSPACE = "/Users/ar/Codex-Minted/staging-recovery-fresh-20260924-4oF4BR";
const IDENTITY = "/Users/ar/Codex-Minted/staging-recovery-keys-20260922/identity.txt";
const REF = "vmznysvietfaddakkegt";
const SYSTEM = "7662742571317219726";
const CAPTURE = "9cd07f296ce4eab010bfa1391094c02e7299e4edc8872965e0e08b9eefb8e0de";
const id = (value) => {
  if (!/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(value)) throw Error("IDENTIFIER_REJECTED");
  return `"${value}"`;
};
const lit = (value) => `'${value.replaceAll("'", "''")}'`;
const table = (value) => `${id(value.schema)}.${id(value.name)}`;

export function buildSourceReadback(backup) {
  const tables = backup.integrity.tables
    .map(
      (t) =>
        `SELECT ${lit(t.schema)} AS schema,${lit(t.name)} AS name,count(*)::int AS rows,encode(sha256(convert_to(coalesce(string_agg(h||E'\\n','' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') AS sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM ONLY ${table(t)} t) x`,
    )
    .join(" UNION ALL ");
  const ledgers = backup.lineage
    .map((t) => {
      if (!t.present)
        return `jsonb_build_object('schema',${lit(t.schema)},'name',${lit(t.name)},'present',false)`;
      return `jsonb_build_object('schema',${lit(t.schema)},'name',${lit(t.name)},'present',true,'rows',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY ${id(t.schema === "storage" ? "id" : "version")}), '[]') FROM ONLY ${table(t)} t))`;
    })
    .join(",");
  const sequences = backup.integrity.sequences
    .map(
      (t) =>
        `SELECT ${lit(t.schema)} AS schema,${lit(t.name)} AS name,last_value::text AS "lastValue",is_called AS "isCalled",'NON_MVCC_OBSERVATION'::text AS "snapshotTreatment" FROM ${table(t)}`,
    )
    .join(" UNION ALL ");
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog; SET LOCAL row_security=off;
SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; SET LOCAL intervalstyle='postgres'; SET LOCAL bytea_output='hex'; SET LOCAL extra_float_digits=3; SET LOCAL statement_timeout='60s';
WITH catalog AS (${SNAPSHOT_CATALOG_SQL.trim().replace(/;$/, "")}), tables AS (${tables}), sequences AS (${sequences})
SELECT jsonb_build_object('database',current_database(),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'catalog',(SELECT jsonb_build_object->'value' FROM catalog),'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY schema,name) FROM tables t),'lineage',jsonb_build_array(${ledgers}),'sequences',(SELECT jsonb_agg(to_jsonb(t) ORDER BY schema,name) FROM sequences t),'cliRoles',(SELECT count(*) FROM pg_roles WHERE rolname LIKE 'cli\\_login\\_%' ESCAPE '\\')) AS evidence;
COMMIT;`;
}

export function compareSourceReadback(backup, live) {
  if (backup.captureDigest !== CAPTURE) throw Error("CAPTURE_MISMATCH");
  if (live?.systemIdentifier !== SYSTEM || live.database !== "postgres")
    throw Error("SOURCE_IDENTITY_REJECTED");
  const capturedRole = backup.schema.before.roles.filter(
    (role) => canonicalDigest(role) === backup.capture.captured.snapshot.temporaryLoginRoleDigest,
  );
  if (
    capturedRole.length !== 1 ||
    canonicalDigest(capturedRole[0].rolname) !== backup.capture.loginRoleLifecycle.roleDigest ||
    backup.capture.loginRoleLifecycle.exactRoleAbsent !== true ||
    backup.capture.loginRoleLifecycle.poststateRoleCount !== 0
  )
    throw Error("CAPTURE_ROLE_BINDING_REJECTED");
  const sourceCatalog = structuredClone(backup.schema.before);
  const roleOid = capturedRole[0].oid;
  sourceCatalog.roles = sourceCatalog.roles.filter((r) => r.oid !== roleOid);
  sourceCatalog.memberships = sourceCatalog.memberships.filter(
    (r) => ![r.roleid, r.member, r.grantor].includes(roleOid),
  );
  const byName = new Map(live.tables.map((t) => [`${t.schema}.${t.name}`, t]));
  const tableDrift = backup.integrity.tables
    .filter((t) => canonicalDigest(t) !== canonicalDigest(byName.get(`${t.schema}.${t.name}`)))
    .map((t) => ({
      schema: t.schema,
      name: t.name,
      beforeRows: t.rows,
      nowRows: byName.get(`${t.schema}.${t.name}`)?.rows,
    }));
  const catalogKeys = [...new Set([...Object.keys(sourceCatalog), ...Object.keys(live.catalog)])];
  const catalogDrift = catalogKeys.filter(
    (k) => canonicalDigest(sourceCatalog[k]) !== canonicalDigest(live.catalog[k]),
  );
  const lineageMatches = canonicalDigest(backup.lineage) === canonicalDigest(live.lineage);
  const sequencesMatch =
    canonicalDigest(backup.integrity.sequences) === canonicalDigest(live.sequences);
  return {
    version: 1,
    observedAt: new Date().toISOString(),
    scope: "READ_ONLY_SOURCE_DRIFT_COMPARISON",
    releaseAdmission: "BLOCKED",
    eligibleForApply: false,
    projectRef: REF,
    physicalSystemIdentifier: SYSTEM,
    captureDigest: backup.captureDigest,
    capturedAt: backup.capture.captured.capturedAt,
    comparedTables: backup.integrity.tables.length,
    tableDrift,
    catalogDrift,
    lineageMatches,
    sequencesMatch,
    cliRoles: live.cliRoles,
    capturedRoleAbsent: !live.catalog.roles.some((r) => r.rolname === capturedRole[0].rolname),
    exactRoleCleanupNormalized: true,
    liveCatalogDigest: canonicalDigest(live.catalog),
    liveTablesDigest: canonicalDigest(live.tables),
    liveSequencesDigest: canonicalDigest(live.sequences),
    unchanged:
      tableDrift.length === 0 &&
      catalogDrift.length === 0 &&
      lineageMatches &&
      sequencesMatch &&
      live.cliRoles === 0,
  };
}

export async function readSourceDrift() {
  const backup = await inspectSealedBackup({ workspace: WORKSPACE, identityPath: IDENTITY });
  if (backup.captureDigest !== CAPTURE) throw Error("CAPTURE_MISMATCH");
  const token = await loadSupabaseAccessToken();
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query/read-only`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(70000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: buildSourceReadback(backup) }),
    },
  );
  if (!response.ok) throw Error("SOURCE_READ_REJECTED");
  const rows = await response.json();
  return compareSourceReadback(backup, rows?.[0]?.evidence);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 2) throw Error("ARGUMENTS_REJECTED");
    const result = await readSourceDrift();
    const receiptPath = `${WORKSPACE}/source-readback-${Date.now()}.json`;
    const file = await open(receiptPath, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(result, null, 2) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    process.stdout.write(JSON.stringify({ ...result, receiptPath }) + "\n");
    if (!result.unchanged) process.exitCode = 2;
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        status: "BLOCKED",
        code: /^[A-Z_]+$/.test(error?.message) ? error.message : "SOURCE_READBACK_FAILED",
      }) + "\n",
    );
    process.exitCode = 2;
  }
}
