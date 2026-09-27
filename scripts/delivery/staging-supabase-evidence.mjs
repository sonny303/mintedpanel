import { canonicalDigest, releaseTarget } from "../release/contract.mjs";
import { DeliveryError, requireCondition } from "./boundary.mjs";
import {
  assertFreshStagingEvidence,
  blockedQualification,
  exactTimestamp,
  evidenceDigest,
  redactedError,
} from "./staging-evidence.mjs";

const TARGET = Object.freeze(releaseTarget("staging"));
const API = "https://api.supabase.com";
const TOKEN = /^sbp_(?:oauth_)?[a-f0-9]{40}$/;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 50_000;
const REQUEST_MS = 30_000;
const COLLECTION_MS = 60_000;
const QUERY_PATH = `/v1/projects/${TARGET.supabaseRef}/database/query/read-only`;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 256) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f]/.test(value);

// Structural reads only. These queries never select provider, user, or UAT
// rows. The migration ledger is intentionally metadata-only; source-file
// hashes remain a separate trusted source-admission concern.
export const CATALOG_SQL = `SELECT jsonb_build_object(
  'database', jsonb_build_object('name', current_database()),
  'relations', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'name', c.relname, 'kind', c.relkind,
    'rls', c.relrowsecurity, 'forceRls', c.relforcerowsecurity,
    'owner', pg_get_userbyid(c.relowner),
    'aclDigest', encode(extensions.digest(
      (CASE WHEN c.relacl IS NULL THEN 'DEFAULT|' ELSE 'EXPLICIT|' END) || coalesce((
        SELECT string_agg(format('%s:%s:%s:%s', x.grantee, x.grantor, x.privilege_type, x.is_grantable), ','
          ORDER BY x.grantee, x.grantor, x.privilege_type, x.is_grantable)
        FROM pg_catalog.aclexplode(CASE WHEN c.relacl IS NULL THEN pg_catalog.acldefault('r', c.relowner) ELSE c.relacl END) AS x
      ), ''), 'sha256'), 'hex')
  ) ORDER BY n.nspname, c.relname)
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')), '[]'::jsonb),
  'columns', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'table', r.relname, 'position', a.attnum,
    'name', a.attname, 'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
    'notNull', a.attnotnull, 'identity', a.attidentity, 'generated', a.attgenerated,
    'collation', coalesce(colln.nspname || '.' || coll.collname, ''),
    'defaultDigest', encode(extensions.digest(coalesce(pg_get_expr(d.adbin, d.adrelid), ''), 'sha256'), 'hex')
  ) ORDER BY n.nspname, r.relname, a.attnum)
    FROM pg_catalog.pg_attribute AS a
    JOIN pg_catalog.pg_class AS r ON r.oid = a.attrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    LEFT JOIN pg_catalog.pg_collation AS coll ON coll.oid = a.attcollation
    LEFT JOIN pg_catalog.pg_namespace AS colln ON colln.oid = coll.collnamespace
    WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
      AND r.relkind IN ('r', 'p', 'v', 'm', 'f')), '[]'::jsonb),
  'constraints', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'table', r.relname, 'name', c.conname,
    'type', c.contype, 'deferrable', c.condeferrable,
    'initiallyDeferred', c.condeferred,
    'definitionDigest', encode(extensions.digest(coalesce(pg_get_constraintdef(c.oid, true), ''), 'sha256'), 'hex'),
    'validated', c.convalidated
  ) ORDER BY n.nspname, r.relname, c.conname)
    FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_class AS r ON r.oid = c.conrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'), '[]'::jsonb),
  'indexes', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'table', r.relname, 'name', i.relname,
    'definitionDigest', encode(extensions.digest(pg_get_indexdef(i.oid), 'sha256'), 'hex'), 'valid', x.indisvalid,
    'ready', x.indisready
  ) ORDER BY n.nspname, r.relname, i.relname)
    FROM pg_catalog.pg_index AS x
    JOIN pg_catalog.pg_class AS r ON r.oid = x.indrelid
    JOIN pg_catalog.pg_class AS i ON i.oid = x.indexrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'), '[]'::jsonb),
  'policies', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'schema', schemaname, 'table', tablename, 'name', policyname,
    'command', cmd, 'permissive', permissive,
    'rolesDigest', encode(extensions.digest(coalesce(array_to_string(roles, ','), ''), 'sha256'), 'hex'),
    'usingDigest', encode(extensions.digest(coalesce(qual, ''), 'sha256'), 'hex'),
    'checkDigest', encode(extensions.digest(coalesce(with_check, ''), 'sha256'), 'hex')
  ) ORDER BY schemaname, tablename, policyname)
    FROM pg_catalog.pg_policies WHERE schemaname = 'public'), '[]'::jsonb),
  'grants', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'table', c.relname,
    'grantee', coalesce(grantee.rolname, 'PUBLIC'),
    'grantor', coalesce(grantor.rolname, 'PUBLIC'),
    'privilege', x.privilege_type, 'grantable', x.is_grantable
  ) ORDER BY n.nspname, c.relname, coalesce(grantee.rolname, 'PUBLIC'), x.privilege_type)
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    LEFT JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) AS x ON true
    LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = x.grantee
    LEFT JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = x.grantor
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')), '[]'::jsonb),
  'defaultAcls', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'schema', coalesce(n.nspname, 'GLOBAL'), 'owner', r.rolname,
    'objectType', a.defaclobjtype,
    'aclDigest', encode(extensions.digest(
      (CASE WHEN a.defaclacl IS NULL THEN 'NULL|' ELSE 'EXPLICIT|' END) || coalesce((
        SELECT string_agg(format('%s:%s:%s:%s', x.grantee, x.grantor, x.privilege_type, x.is_grantable), ','
          ORDER BY x.grantee, x.grantor, x.privilege_type, x.is_grantable)
        FROM pg_catalog.aclexplode(coalesce(a.defaclacl, pg_catalog.acldefault(a.defaclobjtype, a.defaclrole))) AS x
      ), ''), 'sha256'), 'hex')
  ) ORDER BY coalesce(n.nspname, 'GLOBAL'), r.rolname, a.defaclobjtype)
    FROM pg_catalog.pg_default_acl AS a
    JOIN pg_catalog.pg_roles AS r ON r.oid = a.defaclrole
    LEFT JOIN pg_catalog.pg_namespace AS n ON n.oid = a.defaclnamespace), '[]'::jsonb),
  'triggers', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'table', r.relname, 'name', t.tgname,
    'enabled', t.tgenabled, 'internal', t.tgisinternal,
    'definitionDigest', encode(extensions.digest(pg_get_triggerdef(t.oid, true), 'sha256'), 'hex')
  ) ORDER BY n.nspname, r.relname, t.tgname)
    FROM pg_catalog.pg_trigger AS t
    JOIN pg_catalog.pg_class AS r ON r.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal), '[]'::jsonb),
  'functions', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'name', p.proname,
    'identity', pg_get_function_identity_arguments(p.oid),
    'kind', p.prokind, 'owner', pg_get_userbyid(p.proowner),
    'bodyDigest', encode(extensions.digest(pg_get_functiondef(p.oid), 'sha256'), 'hex'),
    'aclDigest', encode(extensions.digest(
      (CASE WHEN p.proacl IS NULL THEN 'DEFAULT|' ELSE 'EXPLICIT|' END) || coalesce((
        SELECT string_agg(format('%s:%s:%s:%s', x.grantee, x.grantor, x.privilege_type, x.is_grantable), ','
          ORDER BY x.grantee, x.grantor, x.privilege_type, x.is_grantable)
        FROM pg_catalog.aclexplode(CASE WHEN p.proacl IS NULL THEN pg_catalog.acldefault('f', p.proowner) ELSE p.proacl END) AS x
      ), ''), 'sha256'), 'hex'),
    'configDigest', encode(extensions.digest(coalesce(array_to_string(p.proconfig, ','), ''), 'sha256'), 'hex')
  ) ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind <> 'a'), '[]'::jsonb)
) AS catalog;`;

export const MIGRATION_LEDGER_SQL = `SELECT version::text AS version, name::text AS name
FROM supabase_migrations.schema_migrations
ORDER BY version, name;`;

function optionsOnly(value, keys) {
  requireCondition(
    object(value) && Object.keys(value).every((key) => keys.includes(key)),
    "STAGING_SUPABASE_OPTIONS_REJECTED",
  );
}

function pathFor(path) {
  requireCondition(
    path === `/v1/projects/${TARGET.supabaseRef}` ||
      path.startsWith(`${QUERY_PATH}?`) ||
      path === QUERY_PATH,
    "STAGING_SUPABASE_PATH",
  );
  return path;
}

async function httpsRead({ credential, method, path, body, signal }) {
  requireCondition(TOKEN.test(credential), "STAGING_SUPABASE_CREDENTIAL_MISSING");
  let response;
  try {
    response = await fetch(`${API}${pathFor(path)}`, {
      method,
      headers: {
        Authorization: `Bearer ${credential}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal,
    });
  } catch {
    throw new DeliveryError("STAGING_SUPABASE_READ_FAILED");
  }
  requireCondition(response.ok, "STAGING_SUPABASE_READ_REJECTED");
  requireCondition(
    /^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? ""),
    "STAGING_SUPABASE_RESPONSE_INVALID",
  );
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      requireCondition(size <= MAX_BYTES, "STAGING_SUPABASE_RESPONSE_TOO_LARGE");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError("STAGING_SUPABASE_RESPONSE_INVALID");
  }
}

function normalizeProject(project) {
  const database = project?.database;
  requireCondition(
    object(project) &&
      project.id === TARGET.supabaseRef &&
      project.ref === TARGET.supabaseRef &&
      project.name === "mintedpanel-staging" &&
      project.status === "ACTIVE_HEALTHY" &&
      object(database) &&
      database.host === `db.${TARGET.supabaseRef}.supabase.co`,
    "STAGING_SUPABASE_PROJECT_IDENTITY",
  );
  requireCondition(text(database.version, 128), "STAGING_SUPABASE_PROJECT_METADATA");
  requireCondition(text(database.postgres_engine, 32), "STAGING_SUPABASE_PROJECT_METADATA");
  requireCondition(text(database.release_channel, 32), "STAGING_SUPABASE_PROJECT_METADATA");
  return {
    ref: TARGET.supabaseRef,
    name: "mintedpanel-staging",
    region: text(project.region, 64) ? project.region : null,
    status: "ACTIVE_HEALTHY",
    database: {
      host: database.host,
      version: database.version,
      postgresEngine: database.postgres_engine,
      releaseChannel: database.release_channel,
    },
  };
}

const CATALOG_KEYS = [
  "database",
  "relations",
  "columns",
  "constraints",
  "indexes",
  "policies",
  "grants",
  "defaultAcls",
  "triggers",
  "functions",
];
const CATALOG_FIELDS = Object.freeze({
  relations: ["schema", "name", "kind", "rls", "forceRls", "owner", "aclDigest"],
  columns: [
    "schema",
    "table",
    "position",
    "name",
    "type",
    "notNull",
    "identity",
    "generated",
    "collation",
    "defaultDigest",
  ],
  constraints: [
    "schema",
    "table",
    "name",
    "type",
    "deferrable",
    "initiallyDeferred",
    "definitionDigest",
    "validated",
  ],
  indexes: ["schema", "table", "name", "definitionDigest", "valid", "ready"],
  policies: [
    "schema",
    "table",
    "name",
    "command",
    "permissive",
    "rolesDigest",
    "usingDigest",
    "checkDigest",
  ],
  grants: ["schema", "table", "grantee", "grantor", "privilege", "grantable"],
  defaultAcls: ["schema", "owner", "objectType", "aclDigest"],
  triggers: ["schema", "table", "name", "enabled", "internal", "definitionDigest"],
  functions: [
    "schema",
    "name",
    "identity",
    "kind",
    "owner",
    "bodyDigest",
    "aclDigest",
    "configDigest",
  ],
});
const rowKey = (keys) => keys.join("\u0000");
const sortRows = (rows, keys) =>
  [...rows].sort((left, right) =>
    rowKey(keys.map((key) => String(left[key] ?? ""))).localeCompare(
      rowKey(keys.map((key) => String(right[key] ?? ""))),
    ),
  );

function normalizeCatalog(response) {
  requireCondition(
    Array.isArray(response) && response.length === 1 && object(response[0]),
    "STAGING_SUPABASE_CATALOG_SHAPE",
  );
  const row = response[0];
  requireCondition(
    Object.keys(row).length === 1 && Object.hasOwn(row, "catalog") && object(row.catalog),
    "STAGING_SUPABASE_CATALOG_SHAPE",
  );
  const value = row.catalog;
  requireCondition(
    Object.keys(value).sort().join(",") === CATALOG_KEYS.slice().sort().join(","),
    "STAGING_SUPABASE_CATALOG_SHAPE",
  );
  requireCondition(
    object(value.database) && value.database.name === "postgres",
    "STAGING_SUPABASE_CATALOG_IDENTITY",
  );
  const collections = {};
  for (const key of CATALOG_KEYS.slice(1)) {
    requireCondition(
      Array.isArray(value[key]) && value[key].length <= MAX_ROWS,
      "STAGING_SUPABASE_CATALOG_SHAPE",
    );
    collections[key] = value[key].map((entry) => {
      requireCondition(object(entry), "STAGING_SUPABASE_CATALOG_SHAPE");
      const fields = CATALOG_FIELDS[key];
      requireCondition(
        Object.keys(entry).every((field) => fields.includes(field)),
        "STAGING_SUPABASE_CATALOG_SHAPE",
      );
      const clean = {};
      for (const field of fields) {
        const item = entry[field];
        requireCondition(item !== undefined, "STAGING_SUPABASE_CATALOG_SHAPE");
        if (field.endsWith("Digest"))
          requireCondition(
            typeof item === "string" && /^[a-f0-9]{64}$/.test(item),
            "STAGING_SUPABASE_CATALOG_SHAPE",
          );
        requireCondition(
          item === null ||
            typeof item === "boolean" ||
            typeof item === "string" ||
            Number.isSafeInteger(item),
          "STAGING_SUPABASE_CATALOG_SHAPE",
        );
        clean[field] = item;
      }
      return clean;
    });
  }
  return {
    database: { name: "postgres" },
    relations: sortRows(collections.relations, ["schema", "name"]),
    columns: sortRows(collections.columns, ["schema", "table", "position", "name"]),
    constraints: sortRows(collections.constraints, ["schema", "table", "name"]),
    indexes: sortRows(collections.indexes, ["schema", "table", "name"]),
    policies: sortRows(collections.policies, ["schema", "table", "name"]),
    grants: sortRows(collections.grants, ["schema", "table", "grantee", "privilege"]),
    defaultAcls: sortRows(collections.defaultAcls, ["schema", "owner", "objectType"]),
    triggers: sortRows(collections.triggers, ["schema", "table", "name"]),
    functions: sortRows(collections.functions, ["schema", "name", "identity"]),
  };
}

function normalizeLedger(response) {
  requireCondition(
    Array.isArray(response) && response.length <= MAX_ROWS,
    "STAGING_SUPABASE_LEDGER_SHAPE",
  );
  const rows = response.map((entry) => {
    requireCondition(
      object(entry) &&
        Object.keys(entry).sort().join(",") === "name,version" &&
        /^\d{14}$/.test(entry.version) &&
        /^[A-Za-z0-9][A-Za-z0-9_-]{0,149}$/.test(entry.name),
      "STAGING_SUPABASE_LEDGER_SHAPE",
    );
    return { version: entry.version, name: entry.name };
  });
  const sorted = sortRows(rows, ["version", "name"]);
  requireCondition(
    new Set(sorted.map((entry) => `${entry.version}:${entry.name}`)).size === sorted.length,
    "STAGING_SUPABASE_LEDGER_SHAPE",
  );
  return sorted;
}

function queryDigest(sql) {
  return canonicalDigest({ target: TARGET, query: sql });
}

export function createStagingSupabaseEvidence(options = {}) {
  optionsOnly(options, ["credential", "transport", "clock"]);
  requireCondition(
    options.transport === undefined || typeof options.transport === "function",
    "STAGING_SUPABASE_TRANSPORT_INVALID",
  );
  requireCondition(
    !(options.transport && options.credential),
    "STAGING_SUPABASE_TRANSPORT_AMBIGUOUS",
  );
  const transport =
    options.transport ?? ((input) => httpsRead({ credential: options.credential, ...input }));
  const clock = options.clock ?? (() => new Date().toISOString());
  requireCondition(typeof clock === "function", "STAGING_SUPABASE_CLOCK_INVALID");

  return Object.freeze({
    async collect() {
      const startedAt = exactTimestamp(clock());
      const started = Date.now();
      const request = async (input) => {
        const remaining = COLLECTION_MS - (Date.now() - started);
        requireCondition(remaining > 0, "STAGING_SUPABASE_COLLECTION_TIMEOUT");
        const controller = new AbortController();
        let timer;
        let deadlineTimer;
        try {
          timer = setTimeout(() => controller.abort(), Math.min(REQUEST_MS, remaining));
          const value = await Promise.race([
            transport({ ...input, signal: controller.signal }),
            new Promise((_, reject) => {
              deadlineTimer = setTimeout(
                () => reject(new DeliveryError("STAGING_SUPABASE_COLLECTION_TIMEOUT")),
                Math.min(REQUEST_MS, remaining),
              );
            }),
          ]);
          requireCondition(
            (Array.isArray(value) || object(value)) &&
              Buffer.byteLength(JSON.stringify(value)) <= MAX_BYTES,
            "STAGING_SUPABASE_RESPONSE_INVALID",
          );
          return value;
        } catch (error) {
          throw redactedError("STAGING_SUPABASE_READ_FAILED", error);
        } finally {
          clearTimeout(timer);
          clearTimeout(deadlineTimer);
        }
      };
      const readSet = async () => {
        const project = normalizeProject(
          await request({ method: "GET", path: `/v1/projects/${TARGET.supabaseRef}` }),
        );
        const catalogResponse = await request({
          method: "POST",
          path: QUERY_PATH,
          body: { query: CATALOG_SQL },
        });
        const ledgerResponse = await request({
          method: "POST",
          path: QUERY_PATH,
          body: { query: MIGRATION_LEDGER_SQL },
        });
        const catalog = normalizeCatalog(catalogResponse);
        const appliedMigrations = normalizeLedger(ledgerResponse);
        return { project, catalog, appliedMigrations };
      };
      const first = await readSet();
      const second = await readSet();
      requireCondition(
        canonicalDigest(first) === canonicalDigest(second),
        "STAGING_SUPABASE_COLLECTION_DRIFT",
      );
      const observedAt = exactTimestamp(clock());
      const schemaDigest = evidenceDigest(first.catalog);
      const lineageDigest = evidenceDigest({
        supabaseRef: TARGET.supabaseRef,
        appliedMigrations: first.appliedMigrations,
      });
      const result = {
        version: 1,
        observedAt,
        target: { ...TARGET },
        project: first.project,
        catalog: first.catalog,
        schemaDigest,
        appliedMigrations: first.appliedMigrations,
        lineageDigest,
        migrationLedgerDigest: evidenceDigest(first.appliedMigrations),
        queryDigests: {
          catalog: queryDigest(CATALOG_SQL),
          ledger: queryDigest(MIGRATION_LEDGER_SQL),
        },
        runtimeIdentity: {
          source: "supabase-management-api-and-read-only-query",
          projectRef: TARGET.supabaseRef,
          database: "postgres",
        },
        qualification: blockedQualification([
          "RUNTIME_DATABASE_BINDING_UNVERIFIED",
          "NATIVE_EXTENSION_PROOF_UNAVAILABLE",
        ]),
      };
      assertFreshStagingEvidence(result, { now: observedAt, maxAgeSeconds: 1 });
      return result;
    },
  });
}
