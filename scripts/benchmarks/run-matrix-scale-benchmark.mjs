#!/usr/bin/env node

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import os from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const PRODUCTION_REF = "fkvuhfsqcmujywzgczmc";
const SCRATCH_REF = "vmznysvietfaddakkegt";
const target = process.env.MATRIX_BENCH_TARGET;
const databaseUrl = process.env.MATRIX_BENCH_DATABASE_URL;
const runs = Number.parseInt(process.env.MATRIX_BENCH_RUNS ?? "30", 10);

if (!databaseUrl) {
  throw new Error("Set MATRIX_BENCH_DATABASE_URL to an isolated benchmark database.");
}
if (target === PRODUCTION_REF || databaseUrl.includes(PRODUCTION_REF)) {
  throw new Error("Refusing to run the write benchmark against the production project.");
}
if (target !== "local" && target !== SCRATCH_REF) {
  throw new Error(`MATRIX_BENCH_TARGET must be "local" or the scratch ref ${SCRATCH_REF}.`);
}
if (target === SCRATCH_REF && !databaseUrl.includes(SCRATCH_REF)) {
  throw new Error("The scratch target URL must contain the approved scratch project ref.");
}
if (!Number.isFinite(runs) || runs < 20) {
  throw new Error("MATRIX_BENCH_RUNS must be at least 20 so p95 is meaningful.");
}

const command = (name, args, options = {}) => {
  const result = spawnSync(name, args, {
    cwd: resolve(import.meta.dirname, "../.."),
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${name} failed (${result.status ?? "signal"}):\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return result.stdout.trim();
};

const psql = (sql, extraArgs = []) =>
  command("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", ...extraArgs, databaseUrl], {
    input: sql,
  });

const deterministicUuid = (value) => {
  const hex = createHash("md5").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
};

const uuid = (kind, scale, suffix = "") =>
  deterministicUuid(`${kind}-${scale}${suffix === "" ? "" : `-${suffix}`}`);

const percentile = (sorted, fraction) => {
  const rank = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[rank];
};

const summarizeMicros = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    runs: sorted.length,
    p50Ms: Number((percentile(sorted, 0.5) / 1000).toFixed(3)),
    p95Ms: Number((percentile(sorted, 0.95) / 1000).toFixed(3)),
    minMs: Number((sorted[0] / 1000).toFixed(3)),
    maxMs: Number((sorted.at(-1) / 1000).toFixed(3)),
  };
};

const setupPath = resolve(import.meta.dirname, "matrix-scale-setup.sql");
const setupOutput = command("psql", [
  "-X",
  "-qAt",
  "-v",
  "ON_ERROR_STOP=1",
  "-f",
  setupPath,
  databaseUrl,
]);

const tempDir = mkdtempSync(resolve(tmpdir(), "minted-matrix-bench-"));

const prelude = (scale, rls) => {
  if (!rls) return "RESET ROLE;\nSET row_security = off;";
  return [
    `SET matrix_spike.user_id = '${uuid("user", scale)}';`,
    "SET ROLE matrix_spike_client;",
  ].join("\n");
};

const grantedGroupsSql = (scale) => {
  const values = Array.from({ length: 7 }, (_, index) => `'${uuid("group", scale, index + 1)}'::uuid`);
  return `ARRAY[${values.join(", ")}]`;
};

const selectColumns = `
  c.id AS "caseId",
  c.case_number AS "caseNumber",
  p.id AS "providerId",
  concat_ws(' ', p.first_name, p.last_name) AS "providerName",
  p.credentials AS "providerCredentials",
  p.specialty AS "specialty",
  y.id AS "payerId",
  y.name AS "payerName",
  g.id AS "groupId",
  g.name AS "groupName",
  c.state AS "state",
  f.id AS "facilityId",
  f.name AS "facilityName",
  f.city AS "facilityCity",
  f.state AS "facilityState",
  c.case_status AS "caseStatus",
  c.submitted_date AS "submittedDate",
  c.expected_effective_date AS "expectedEffectiveDate",
  c.confirmed_effective_date AS "confirmedEffectiveDate",
  ct.contracting_status AS "contractStatus",
  ct.effective_date AS "contractEffectiveDate",
  c.updated_at AS "updatedAt"`;

const joins = `
FROM matrix_spike.credential_cases c
JOIN matrix_spike.providers p
  ON p.id = c.provider_id AND p.org_id = c.org_id
JOIN matrix_spike.payers y
  ON y.id = c.payer_id
JOIN matrix_spike.provider_groups g
  ON g.id = c.group_id AND g.org_id = c.org_id
LEFT JOIN matrix_spike.facilities f
  ON f.id = c.facility_id AND f.org_id = c.org_id
LEFT JOIN matrix_spike.contracts ct
  ON ct.org_id = c.org_id
 AND ct.group_id = c.group_id
 AND ct.payer_id = c.payer_id
 AND ct.state = c.state`;

const orderBy = `
ORDER BY lower(p.last_name), lower(p.first_name), p.id, y.name, y.id`;

const queriesFor = (scale) => {
  const orgId = uuid("org", scale);
  const payerId = deterministicUuid("payer-1");
  const providerId = uuid("provider", scale, 42);
  const groups = grantedGroupsSql(scale);
  const baseWhere = `
WHERE c.org_id = '${orgId}'::uuid
  AND c.group_id = ANY (${groups})
  AND p.status <> 'terminated'
  AND NOT p.reference_only
  AND NOT p.is_test_provider
  AND p.verification_state <> 'pending_verification'`;
  const full = `SELECT ${selectColumns} ${joins} ${baseWhere} ${orderBy}`;
  const state = `${full.replace(orderBy, "")}
  AND c.state = 'NC'
${orderBy}`;
  const statePayerSearch = `${full.replace(orderBy, "")}
  AND c.state = 'NC'
  AND c.payer_id = '${payerId}'::uuid
  AND (
    p.first_name ILIKE '%00042%'
    OR p.last_name ILIKE '%00042%'
  )
${orderBy}`;
  const providerDrilldown = `${full.replace(orderBy, "")}
  AND c.provider_id = '${providerId}'::uuid
${orderBy}`;
  const pagedMatrix = `
WITH provider_page AS MATERIALIZED (
  SELECT p.id, p.first_name, p.last_name, p.credentials, p.specialty
  FROM matrix_spike.providers p
  WHERE p.org_id = '${orgId}'::uuid
    AND p.group_id = ANY (${groups})
    AND p.status <> 'terminated'
    AND NOT p.reference_only
    AND NOT p.is_test_provider
    AND p.verification_state <> 'pending_verification'
  ORDER BY lower(p.last_name), lower(p.first_name), p.id
  LIMIT 50
)
SELECT
  c.id AS "caseId",
  c.case_number AS "caseNumber",
  p.id AS "providerId",
  concat_ws(' ', p.first_name, p.last_name) AS "providerName",
  p.credentials AS "providerCredentials",
  p.specialty AS "specialty",
  y.id AS "payerId",
  y.name AS "payerName",
  g.id AS "groupId",
  g.name AS "groupName",
  c.state AS "state",
  f.id AS "facilityId",
  f.name AS "facilityName",
  f.city AS "facilityCity",
  f.state AS "facilityState",
  c.case_status AS "caseStatus",
  c.submitted_date AS "submittedDate",
  c.expected_effective_date AS "expectedEffectiveDate",
  c.confirmed_effective_date AS "confirmedEffectiveDate",
  ct.contracting_status AS "contractStatus",
  ct.effective_date AS "contractEffectiveDate",
  c.updated_at AS "updatedAt"
FROM provider_page p
JOIN matrix_spike.credential_cases c
  ON c.provider_id = p.id
 AND c.org_id = '${orgId}'::uuid
 AND c.group_id = ANY (${groups})
JOIN matrix_spike.payers y ON y.id = c.payer_id
JOIN matrix_spike.provider_groups g
  ON g.id = c.group_id AND g.org_id = c.org_id
LEFT JOIN matrix_spike.facilities f
  ON f.id = c.facility_id AND f.org_id = c.org_id
LEFT JOIN matrix_spike.contracts ct
  ON ct.org_id = c.org_id
 AND ct.group_id = c.group_id
 AND ct.payer_id = c.payer_id
 AND ct.state = c.state
ORDER BY lower(p.last_name), lower(p.first_name), p.id, y.name, y.id`;
  return {
    full_matrix: full,
    state_filter: state,
    state_payer_name_search: statePayerSearch,
    provider_drilldown: providerDrilldown,
    provider_page_50: pagedMatrix,
  };
};

const measureLatency = (name, scale, rls, query) => {
  const mode = rls ? "rls" : "bypass";
  const scriptPath = resolve(tempDir, `${scale}-${name}-${mode}.sql`);
  writeFileSync(
    scriptPath,
    `${prelude(scale, rls)}\n${query};\n${rls ? "RESET ROLE;" : ""}\n`,
    "utf8",
  );

  command("pgbench", [
    "-n",
    "-c",
    "1",
    "-j",
    "1",
    "-t",
    "3",
    "-f",
    scriptPath,
    databaseUrl,
  ]);

  const prefix = resolve(tempDir, `${scale}-${name}-${mode}-latency`);
  command("pgbench", [
    "-n",
    "-c",
    "1",
    "-j",
    "1",
    "-t",
    String(runs),
    "-l",
    "--log-prefix",
    prefix,
    "-f",
    scriptPath,
    databaseUrl,
  ]);

  const logFile = readdirSync(tempDir)
    .filter((file) => file.startsWith(`${scale}-${name}-${mode}-latency.`))
    .sort()
    .at(-1);
  if (!logFile) throw new Error(`pgbench did not produce a latency log for ${name}/${mode}.`);
  const samples = readFileSync(resolve(tempDir, logFile), "utf8")
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => Number.parseInt(line.trim().split(/\s+/)[2], 10))
    .filter(Number.isFinite);
  if (samples.length !== runs) {
    throw new Error(`Expected ${runs} samples for ${name}/${mode}; found ${samples.length}.`);
  }
  return summarizeMicros(samples);
};

const explain = (scale, rls, query) => {
  const output = psql(`${prelude(scale, rls)}
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
${query};
${rls ? "RESET ROLE;" : ""}`);
  const parsed = JSON.parse(output);
  const plan = parsed[0];
  return {
    planningMs: Number(plan["Planning Time"].toFixed(3)),
    executionMs: Number(plan["Execution Time"].toFixed(3)),
    sharedHitBlocks: plan.Plan["Shared Hit Blocks"] ?? null,
    sharedReadBlocks: plan.Plan["Shared Read Blocks"] ?? null,
    topNode: plan.Plan["Node Type"],
  };
};

const payloadBytes = (scale, rls, query) =>
  Number.parseInt(
    psql(`${prelude(scale, rls)}
SELECT octet_length(COALESCE(json_agg(matrix_row)::text, '[]'))
FROM (${query}) AS matrix_row;
${rls ? "RESET ROLE;" : ""}`),
    10,
  );

const rowCount = (scale, rls, query) =>
  Number.parseInt(
    psql(`${prelude(scale, rls)}
SELECT count(*) FROM (${query}) AS matrix_row;
${rls ? "RESET ROLE;" : ""}`),
    10,
  );

const measurements = [];
try {
  for (const scale of [500, 1500, 3000]) {
    const queries = queriesFor(scale);
    for (const [queryName, query] of Object.entries(queries)) {
      for (const rls of [false, true]) {
        const count = rowCount(scale, rls, query);
        const bytes = payloadBytes(scale, rls, query);
        measurements.push({
          scale,
          query: queryName,
          mode: rls ? "rls" : "api_bypass",
          rowCount: count,
          payloadBytes: bytes,
          payloadKiB: Number((bytes / 1024).toFixed(1)),
          latency: measureLatency(queryName, scale, rls, query),
          explain: explain(scale, rls, query),
        });
      }
    }
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

const pgVersion = psql("SHOW server_version;");
const output = {
  generatedAt: new Date().toISOString(),
  target,
  scratchProjectRef: SCRATCH_REF,
  productionProjectRefRejected: PRODUCTION_REF,
  environment: {
    postgres: pgVersion,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpuModel: os.cpus()[0]?.model ?? null,
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    connection: target === "local" ? "local Unix socket" : "remote TLS",
  },
  method: {
    seedOutput: setupOutput.split("\n").filter(Boolean),
    measuredRunsPerQuery: runs,
    warmupRunsPerQuery: 3,
    latencyIncludes: "database execution plus local PostgreSQL protocol transfer to pgbench",
    payload: "raw UTF-8 JSON bytes generated with json_agg; no HTTP envelope or compression",
    rls: "current org-membership SELECT policies; explicit seven-group grant filter in both modes",
  },
  measurements,
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
