import { canonicalDigest } from "../release/contract.mjs";
import { RecoveryError } from "./contract.mjs";
import { localSql } from "./auth-rest-qualifier.mjs";
import { collectLocalTarget, LOCAL_SOCKET } from "./local-target.mjs";
import { inspectSealedBackup, verifyRestoredBackup } from "./restore.mjs";
import { SNAPSHOT_CATALOG_SQL } from "./snapshot.mjs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, open } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

export const APPLICATION_BASELINE_STATUS = "LOCAL_APPLICATION_BASELINE_VERIFIED";
export const APPLICATION_BASELINE_RELEASE_ADMISSION = "BLOCKED";
export const APPLICATION_BASELINE_SCOPES = Object.freeze([]);

// Source and restored reads use the existing sealed snapshot shape. The
// qualifier only adds the stable public-field normalization below.
export const APPLICATION_CATALOG_SQL = SNAPSHOT_CATALOG_SQL;

// The snapshot intentionally omits OIDs from stable relation rows. This
// read-only companion supplies only the OID-to-name edges needed to normalize
// raw public sequence, type, enum, inheritance, default-ACL, and collation
// rows; it never leaves the target.
export const APPLICATION_OID_SQL = `SELECT jsonb_build_object(
  'namespaces',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',n.oid,'name',n.nspname) ORDER BY n.oid),'[]') FROM pg_catalog.pg_namespace n WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'),
  'relations',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',c.oid,'schema',n.nspname,'name',c.relname,'kind',c.relkind) ORDER BY c.oid),'[]') FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'),
  'collations',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',c.oid,'schema',n.nspname,'name',c.collname) ORDER BY c.oid),'[]') FROM pg_catalog.pg_collation c JOIN pg_catalog.pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_')
);`;

const CATEGORIES = Object.freeze([
  "schema",
  "relations",
  "columns",
  "aggregates",
  "types",
  "enums",
  "rules",
  "inheritance",
  "defaultAcls",
  "sequences",
]);
const HASH = /^[a-f0-9]{64}$/;
// Only raw catalog identifier fields are discarded. Semantic fields such as
// owner, type, elementType, baseType, and relationType remain evidence.
const OID_KEYS =
  /^(?:oid|typnamespace|typowner|typelem|typarray|typbasetype|typrelid|typcollation|enumtypid|ev_class|inhrelid|inhparent|defaclrole|defaclnamespace|seqrelid|seqtypid|collnamespace|collowner|aggfnoid)$/;
const DOCKER = "/opt/homebrew/bin/docker";
const AGE = "/opt/homebrew/bin/age";
const fail = (code = "LOCAL_APPLICATION_BASELINE_REJECTED") => {
  throw new RecoveryError(code);
};
const object = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  return value;
};
const required = (value, key) => {
  object(value);
  if (!Object.hasOwn(value, key)) fail();
  return value[key];
};
const array = (value) => {
  if (!Array.isArray(value)) fail();
  return value;
};
const acl = (value) => {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) fail();
  return [...value].sort();
};
const options = (value) => {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) fail();
  return [...value].sort();
};
const sortRows = (rows, key) =>
  [...rows].sort((left, right) => {
    const comparison = key(left).localeCompare(key(right));
    return comparison || canonicalDigest(left).localeCompare(canonicalDigest(right));
  });
const stableRaw = (value) => {
  if (Array.isArray(value)) return value.map(stableRaw);
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (OID_KEYS.test(key)) continue;
    out[key] = stableRaw(item);
  }
  return out;
};

const TOC_TYPES = new Set([
  "SCHEMA",
  "TABLE",
  "MATERIALIZED VIEW",
  "VIEW",
  "FOREIGN TABLE",
  "SEQUENCE",
  "TYPE",
  "DEFAULT ACL",
]);
const unquote = (value) => value?.replace(/^"(.*)"$/, "$1");

export function parseArchiveTableOfContents(text) {
  if (typeof text !== "string" || text.length > 8 * 1024 * 1024) fail("TOC_INVALID");
  const entries = [];
  for (const line of text.split("\n")) {
    const match =
      line.match(
        /^(\d+);\s+(\d+)\s+(\d+)\s+((?:MATERIALIZED VIEW)|(?:FOREIGN TABLE)|\S+)\s+-\s+(.+)$/,
      ) ??
      line.match(
        /^(\d+);\s+(\d+)\s+(\d+)\s+((?:DEFAULT ACL)|(?:TABLE DATA)|(?:TABLE ATTACH)|(?:MATERIALIZED VIEW DATA)|(?:MATERIALIZED VIEW)|(?:FOREIGN TABLE)|\S+)\s+(.+)$/,
      );
    if (!match) continue;
    const [, dumpId, catalogId, objectId, type, descriptor] = match;
    if (!TOC_TYPES.has(type)) continue;
    if (Number(objectId) === 0 && type !== "SCHEMA") continue;
    const parts = descriptor.trim().split(/\s+/);
    if (parts.length < 2) fail("TOC_INVALID");
    const schema = type === "SCHEMA" ? null : unquote(parts[0]);
    const name =
      type === "SCHEMA"
        ? unquote(parts[0])
        : type === "DEFAULT ACL"
          ? parts.slice(1, -1).join(" ")
          : unquote(parts[1]);
    const owner = type === "SCHEMA" ? unquote(parts[1]) : unquote(parts.at(-1));
    if (!name || !owner) fail("TOC_INVALID");
    entries.push({
      dumpId: Number(dumpId),
      catalogId: Number(catalogId),
      objectId: Number(objectId),
      type,
      schema,
      name,
      owner,
    });
  }
  if (entries.length === 0) fail("TOC_EMPTY");
  const seen = new Map();
  for (const entry of entries) {
    const key = `${entry.catalogId}:${entry.objectId}:${entry.type}`;
    const prior = seen.get(key);
    if (prior && canonicalDigest(prior) !== canonicalDigest(entry)) fail("TOC_AMBIGUOUS");
    seen.set(key, entry);
  }
  return Object.freeze(entries);
}

function tocMaps(toc, catalog = {}) {
  const schemas = new Map(),
    objects = new Map();
  for (const entry of array(toc)) {
    if (entry.type === "SCHEMA") {
      const key = String(entry.objectId),
        prior = schemas.get(key);
      if (prior && prior !== entry.name) fail("TOC_AMBIGUOUS");
      schemas.set(key, entry.name);
    } else if (entry.schema && entry.name && entry.objectId !== 0) {
      const key = String(entry.objectId),
        value = { schema: entry.schema, name: entry.name, type: entry.type },
        prior = objects.get(key);
      if (prior && canonicalDigest(prior) !== canonicalDigest(value)) fail("TOC_AMBIGUOUS");
      objects.set(key, value);
    }
  }
  if (![...schemas.values()].includes("public")) {
    // pg_dump omits the pre-existing public schema. Its DEFAULT ACL entries
    // carry the sealed namespace OID, while the TOC names that schema.
    const tocPublicDefaults = new Set(
      array(toc)
        .filter((entry) => entry.type === "DEFAULT ACL" && entry.schema === "public")
        .map((entry) => String(entry.objectId)),
    );
    const sourcePublicNamespaces = new Set(
      array(catalog.defaultAcls ?? [])
        .filter((row) => tocPublicDefaults.has(String(row.oid)) && row.defaclnamespace !== null)
        .map((row) => String(row.defaclnamespace)),
    );
    if (sourcePublicNamespaces.size !== 1) fail("TOC_PUBLIC_SCHEMA_MISSING");
    schemas.set([...sourcePublicNamespaces][0], "public");
  }
  return { schemas, objects };
}

function oidReadbackMaps(value) {
  object(value);
  const namespaces = new Map(
    array(value.namespaces).map((row) => [String(required(row, "oid")), required(row, "name")]),
  );
  const objects = new Map(
    array(value.relations).map((row) => [
      String(required(row, "oid")),
      {
        schema: required(row, "schema"),
        name: required(row, "name"),
        type: required(row, "kind"),
      },
    ]),
  );
  const collations = new Map(
    array(value.collations).map((row) => [String(required(row, "oid")), required(row, "name")]),
  );
  if (!namespaces.size || ![...namespaces.values()].includes("public"))
    fail("TARGET_NAMESPACE_MAP_INVALID");
  return { namespaces, objects, collations };
}

function catalogCollationMap(catalog, namespaces) {
  const collations = new Map();
  for (const row of array(catalog.collations ?? [])) {
    const schema = namespaces.get(String(row.collnamespace));
    if (schema === "public") collations.set(String(row.oid), row.collname);
  }
  return collations;
}

function normalizationMaps(catalog, maps) {
  object(catalog);
  const namespaces = maps.namespaces ?? maps.schemas;
  if (!(namespaces instanceof Map) || !(maps.objects instanceof Map)) fail("OID_MAP_INVALID");
  return {
    namespaces,
    objects: maps.objects,
    collations: new Map([
      ...catalogCollationMap(catalog, namespaces),
      ...(maps.collations ?? new Map()),
    ]),
  };
}

async function observeArchiveTableOfContents(target, workspace, identityPath, launch = spawn) {
  if (
    !HASH.test(target?.containerId) ||
    typeof workspace !== "string" ||
    typeof identityPath !== "string"
  )
    fail("TOC_TARGET_INVALID");
  const age = launch(
    AGE,
    ["--decrypt", "--identity", identityPath, join(workspace, "backup.age")],
    {
      stdio: ["ignore", "pipe", "ignore"],
      env: { PATH: "/usr/bin:/bin", LANG: "C" },
    },
  );
  const listing = launch(
    DOCKER,
    [
      "--host",
      LOCAL_SOCKET,
      "exec",
      "--interactive",
      "--user",
      "postgres",
      target.containerId,
      "/nix/var/nix/profiles/default/bin/pg_restore",
      "--list",
    ],
    {
      stdio: ["pipe", "pipe", "ignore"],
      env: {
        PATH: "/usr/bin:/bin",
        HOME: "/Users/ar",
        DOCKER_CONFIG: "/Users/ar/.docker",
        LANG: "C",
      },
    },
  );
  let text = "";
  let overflow = false;
  listing.stdout.on("data", (chunk) => {
    if (text.length + chunk.length > 8 * 1024 * 1024) {
      overflow = true;
      age.kill("SIGKILL");
      listing.kill("SIGKILL");
    } else text += chunk.toString("utf8");
  });
  const closed = (child) =>
    new Promise((resolvePromise) => child.once("close", (code) => resolvePromise(code)));
  const ageDone = closed(age),
    listingDone = closed(listing);
  const transfer = pipeline(age.stdout, listing.stdin).catch(() => {});
  try {
    const [ageCode, listingCode] = await Promise.all([ageDone, listingDone]);
    if (ageCode !== 0 && ageCode !== null) fail("TOC_DECRYPT_REJECTED");
    if (listingCode !== 0 || overflow) fail("TOC_READ_REJECTED");
    return parseArchiveTableOfContents(text);
  } finally {
    age.kill("SIGKILL");
    listing.kill("SIGKILL");
    await Promise.allSettled([ageDone, listingDone, transfer]);
  }
}

function typeLabel(row, typeMap, namespaceMap) {
  if (!row || row === 0 || row === "0") return null;
  if (typeof row === "string" && !/^\d+$/.test(row)) return row;
  const found = typeMap.get(String(row));
  if (!found) return BUILTIN_TYPES.get(String(row)) ?? fail("TYPE_OID_UNRESOLVED");
  const schema = namespaceMap.get(String(found.typnamespace));
  if (!schema) fail("TYPE_NAMESPACE_UNRESOLVED");
  return schema === "pg_catalog" ? found.typname : `${schema}.${found.typname}`;
}

const BUILTIN_COLLATIONS = new Map([
  ["0", null],
  ["100", "default"],
]);
const BUILTIN_TYPES = new Map([
  ["16", "boolean"],
  ["20", "bigint"],
  ["21", "smallint"],
  ["23", "integer"],
  ["25", "text"],
  ["26", "oid"],
  ["700", "real"],
  ["701", "double precision"],
  ["1043", "character varying"],
  ["1082", "date"],
  ["1114", "timestamp without time zone"],
  ["1184", "timestamp with time zone"],
  ["1700", "numeric"],
  ["2950", "uuid"],
  ["3802", "jsonb"],
]);
const collationLabel = (value, collations) => {
  if (value === null || value === undefined) return null;
  const key = String(value);
  return BUILTIN_COLLATIONS.has(key)
    ? BUILTIN_COLLATIONS.get(key)
    : (collations.get(key) ?? fail("COLLATION_OID_UNRESOLVED"));
};
const relationTypeLabel = (value, typeMap, namespaceMap) => {
  if (!value || value === 0 || value === "0") return null;
  const found = [...typeMap.values()].find((row) => String(row.typrelid) === String(value));
  if (!found) fail("RELATION_TYPE_OID_UNRESOLVED");
  const schema = namespaceMap.get(String(found.typnamespace));
  if (!schema) fail("TYPE_NAMESPACE_UNRESOLVED");
  return schema === "pg_catalog" ? found.typname : `${schema}.${found.typname}`;
};

// The captured public types are exactly PostgreSQL 17 composite rows and
// their generated array rows. Their regproc fields are emitted as stable
// names by to_jsonb(pg_type); reject any standalone/custom public type rather
// than exporting a new pg_proc mapping surface for this qualifier.
const PUBLIC_TYPE_SHAPES = Object.freeze({ b: "A", c: "C" });
const PUBLIC_TYPE_FUNCTIONS = new Set([
  "-",
  "array_in",
  "array_out",
  "array_recv",
  "array_send",
  "array_subscript_handler",
  "array_typanalyze",
  "record_in",
  "record_out",
  "record_recv",
  "record_send",
]);
const typeFunctionLabel = (row, key) => {
  const value = required(row, key);
  if (typeof value !== "string" || !PUBLIC_TYPE_FUNCTIONS.has(value))
    fail("UNSUPPORTED_PUBLIC_TYPE_FUNCTION");
  return value;
};

function normalizeCatalogRow(value, category, context) {
  const row = object(value);
  if (category === "schema") {
    if (required(row, "name") !== "public") return null;
    return { name: row.name, owner: required(row, "owner"), acl: acl(required(row, "acl")) };
  }
  if (category === "relations") {
    if (required(row, "schema") !== "public") return null;
    return {
      schema: row.schema,
      name: required(row, "name"),
      kind: required(row, "kind"),
      owner: required(row, "owner"),
      acl: acl(required(row, "acl")),
      rls: required(row, "rls"),
      forceRls: required(row, "forceRls"),
      persistence: required(row, "persistence"),
      options: options(required(row, "options")),
      partitionBound: required(row, "partitionBound"),
    };
  }
  if (category === "columns") {
    if (required(row, "schema") !== "public") return null;
    return {
      schema: row.schema,
      table: required(row, "table"),
      position: required(row, "position"),
      name: required(row, "name"),
      type: required(row, "type"),
      notNull: required(row, "notNull"),
      identity: required(row, "identity"),
      generated: required(row, "generated"),
      acl: acl(required(row, "acl")),
      collation:
        typeof row.collation === "number" ||
        (typeof row.collation === "string" && /^\d+$/.test(row.collation))
          ? collationLabel(row.collation, context.collations)
          : required(row, "collation"),
      default: required(row, "default"),
    };
  }
  if (category === "aggregates") {
    const procedure = row.procedure && typeof row.procedure === "object" ? row.procedure : row;
    const aggregate = row.aggregate ?? {};
    const identity = row.identity ?? procedure.identity;
    if (typeof identity !== "string" || identity.length === 0) fail();
    return {
      identity,
      owner: row.owner ?? procedure.owner ?? null,
      acl: acl(row.acl ?? procedure.acl ?? null),
      definition: row.definition ?? procedure.definition ?? null,
      aggregate: stableRaw(object(aggregate)),
    };
  }
  if (category === "types") {
    if (row.schema) return row.schema === "public" ? stableRaw(row) : null;
    const schema = context.namespaces.get(String(row.typnamespace));
    if (schema !== "public") return null;
    const kind = required(row, "typtype");
    const typeCategory = required(row, "typcategory");
    if (PUBLIC_TYPE_SHAPES[kind] !== typeCategory) fail("UNSUPPORTED_PUBLIC_TYPE");
    const elementType = typeLabel(row.typelem, context.types, context.namespaces);
    const arrayType = typeLabel(row.typarray, context.types, context.namespaces);
    const relationType = relationTypeLabel(row.typrelid, context.types, context.namespaces);
    if (
      (kind === "c" && (!relationType || !arrayType || elementType !== null)) ||
      (kind === "b" && (!elementType || relationType !== null || arrayType !== null))
    )
      fail("PUBLIC_TYPE_SHAPE_INVALID");
    return {
      schema,
      name: required(row, "typname"),
      owner: context.roles.get(String(row.typowner)) ?? fail("TYPE_OWNER_UNRESOLVED"),
      kind,
      category: typeCategory,
      acl: acl(required(row, "typacl")),
      length: required(row, "typlen"),
      byValue: required(row, "typbyval"),
      align: required(row, "typalign"),
      storage: required(row, "typstorage"),
      notNull: required(row, "typnotnull"),
      delimiter: required(row, "typdelim"),
      default: required(row, "typdefault"),
      isDefined: required(row, "typisdefined"),
      ndims: required(row, "typndims"),
      typeModifier: required(row, "typtypmod"),
      input: typeFunctionLabel(row, "typinput"),
      output: typeFunctionLabel(row, "typoutput"),
      receive: typeFunctionLabel(row, "typreceive"),
      send: typeFunctionLabel(row, "typsend"),
      analyze: typeFunctionLabel(row, "typanalyze"),
      modifierInput: typeFunctionLabel(row, "typmodin"),
      modifierOutput: typeFunctionLabel(row, "typmodout"),
      subscript: typeFunctionLabel(row, "typsubscript"),
      elementType,
      baseType: typeLabel(row.typbasetype, context.types, context.namespaces),
      arrayType,
      relationType,
      collation: collationLabel(row.typcollation, context.collations),
    };
  }
  if (category === "enums") {
    if (row.schema) return row.schema === "public" ? stableRaw(row) : null;
    const type = context.types.get(String(row.enumtypid));
    if (!type) fail("ENUM_TYPE_UNRESOLVED");
    const schema = context.namespaces.get(String(type.typnamespace));
    if (schema !== "public") return null;
    return {
      schema,
      type: type.typname,
      label: required(row, "enumlabel"),
      sortOrder: required(row, "enumsortorder"),
    };
  }
  if (category === "rules") {
    if (row.schema) return row.schema === "public" ? stableRaw(row) : null;
    const relation = context.objects.get(String(row.ev_class));
    if (!relation || relation.schema !== "public") return null;
    return {
      schema: relation.schema,
      table: relation.name,
      name: required(row, "rulename"),
      enabled: required(row, "ev_enabled"),
      definition:
        context.ruleDefinitions.get(String(row.oid)) ?? fail("RULE_DEFINITION_UNRESOLVED"),
    };
  }
  if (category === "inheritance") {
    if (row.child)
      return row.child.startsWith("public.") || row.parent?.startsWith("public.")
        ? stableRaw(row)
        : null;
    const child = context.objects.get(String(row.inhrelid)),
      parent = context.objects.get(String(row.inhparent));
    if (!child || !parent || (child.schema !== "public" && parent.schema !== "public")) return null;
    return {
      child: `${child.schema}.${child.name}`,
      parent: `${parent.schema}.${parent.name}`,
      sequence: required(row, "inhseqno"),
      detached: required(row, "inhdetachpending"),
    };
  }
  if (category === "defaultAcls") {
    if (row.schema !== undefined || row.role !== undefined)
      return row.schema === null || row.schema === "public" ? stableRaw(row) : null;
    const schema =
      row.defaclnamespace === null || row.defaclnamespace === 0 || row.defaclnamespace === "0"
        ? null
        : context.namespaces.get(String(row.defaclnamespace));
    if (schema !== null && schema !== "public") return null;
    return {
      role: context.roles.get(String(row.defaclrole)) ?? fail("DEFAULT_ACL_OWNER_UNRESOLVED"),
      schema,
      objectType: required(row, "defaclobjtype"),
      acl: acl(required(row, "defaclacl")),
    };
  }
  if (category === "sequences") {
    let schema = row.schema,
      name = row.name;
    if (!schema) {
      const relation = context.objects.get(String(row.seqrelid));
      schema = relation?.schema;
      name = relation?.name;
    }
    if (!schema || !name) return null;
    const relation = context.relations.get(`${schema}.${name}`);
    const definition = row.definition
      ? object(row.definition)
      : {
          type: typeLabel(row.seqtypid, context.types, context.namespaces),
          start: required(row, "seqstart"),
          increment: required(row, "seqincrement"),
          max: required(row, "seqmax"),
          min: required(row, "seqmin"),
          cache: required(row, "seqcache"),
          cycle: required(row, "seqcycle"),
        };
    return {
      schema,
      name,
      owner: Object.hasOwn(row, "owner")
        ? row.owner
        : (relation?.owner ?? fail("SEQUENCE_OWNER_UNRESOLVED")),
      acl: acl(
        Object.hasOwn(row, "acl") ? row.acl : (relation?.acl ?? fail("SEQUENCE_ACL_UNRESOLVED")),
      ),
      definition: stableRaw(definition),
    };
  }
  fail();
}

const ROW_KEYS = {
  schema: (row) => row.name,
  relations: (row) => `${row.schema}.${row.name}`,
  columns: (row) => `${row.schema}.${row.table}.${String(row.position).padStart(8, "0")}`,
  aggregates: (row) => row.identity,
  types: (row) => `${row.schema ?? ""}.${row.name ?? row.typname ?? ""}`,
  enums: (row) => `${row.schema ?? ""}.${row.type ?? row.name ?? ""}.${row.label ?? ""}`,
  rules: (row) => `${row.schema}.${row.table}.${row.name}`,
  inheritance: (row) => `${row.child ?? row.relation ?? ""}.${row.sequence ?? ""}`,
  defaultAcls: (row) => `${row.role ?? ""}.${row.schema ?? ""}.${row.objectType ?? ""}`,
  sequences: (row) => `${row.schema}.${row.name}`,
};

export function normalizeApplicationCatalog(catalog, options = {}) {
  object(catalog);
  const context = {
    namespaces: options.namespaces ?? new Map(),
    objects: options.objects ?? new Map(),
    types: new Map(array(catalog.types ?? []).map((row) => [String(row.oid), row])),
    roles: new Map(array(catalog.roles ?? []).map((row) => [String(row.oid), row.rolname])),
    relations: new Map(
      array(catalog.relations ?? []).map((row) => [`${row.schema}.${row.name}`, row]),
    ),
    collations: options.collations ?? new Map(),
    ruleDefinitions: options.ruleDefinitions ?? new Map(),
  };
  const rawSchemas = catalog.schemas ?? catalog.schema;
  const output = {};
  for (const category of CATEGORIES) {
    const source = category === "schema" ? rawSchemas : catalog[category];
    const rows = array(source);
    const normalized = rows
      .map((row) => normalizeCatalogRow(row, category, context))
      .filter((row) => row !== null);
    output[category] = sortRows(normalized, ROW_KEYS[category]);
  }
  if (output.schema.length !== 1 || output.schema[0].name !== "public") fail();
  return output;
}

export function compareApplicationCatalog(captured, restored, normalization = {}) {
  const source = normalizeApplicationCatalog(captured, normalization.captured ?? normalization);
  const target = normalizeApplicationCatalog(restored, normalization.restored ?? normalization);
  const capturedDigest = canonicalDigest(source);
  const restoredDigest = canonicalDigest(target);
  if (capturedDigest !== restoredDigest) fail("APPLICATION_CATALOG_MISMATCH");
  return Object.freeze({ capturedDigest, restoredDigest, categories: [...CATEGORIES] });
}

function sourceBinding(capture) {
  object(capture);
  const captured = object(capture.captured ?? capture);
  const source = object(captured.source ?? capture.source);
  if (!HASH.test(source.schemaDigest) || !HASH.test(source.lineageDigest))
    fail("CAPTURE_BINDING_INVALID");
  const artifacts = array(captured.artifacts ?? capture.artifacts);
  const artifactDigest = canonicalDigest(artifacts);
  return {
    captureDigest: HASH.test(capture.captureDigest ?? "")
      ? capture.captureDigest
      : canonicalDigest(capture),
    artifactDigest: HASH.test(capture.artifactDigest ?? "")
      ? capture.artifactDigest
      : artifactDigest,
    schemaDigest: source.schemaDigest,
    lineageDigest: source.lineageDigest,
  };
}

function receiptBinding(receipt, binding, label) {
  object(receipt);
  for (const key of ["captureDigest", "artifactDigest", "schemaDigest", "lineageDigest"])
    if (receipt[key] !== binding[key]) fail(`${label.toUpperCase()}_BINDING_MISMATCH`);
}

function proofBinding(proof, binding, label) {
  object(proof);
  const observed = object(required(proof, "observedBackup"));
  if (
    proof.captureDigest !== binding.captureDigest ||
    observed.artifactDigest !== binding.artifactDigest ||
    observed.schemaDigest !== binding.schemaDigest ||
    observed.lineageDigest !== binding.lineageDigest
  )
    fail(`${label.toUpperCase()}_BINDING_MISMATCH`);
}

export function compareRestoredLedgers({ capturedLineage, restoredLineage, expectedDigest } = {}) {
  const source = array(capturedLineage);
  const target = array(restoredLineage);
  const capturedDigest = canonicalDigest(source);
  const restoredDigest = canonicalDigest(target);
  if (expectedDigest !== undefined && expectedDigest !== capturedDigest)
    fail("LEDGER_BINDING_MISMATCH");
  if (capturedDigest !== restoredDigest) fail("LEDGER_MISMATCH");
  const names = source.map((row) => `${row.schema}.${row.name}`).sort();
  if (new Set(names).size !== names.length) fail("LEDGER_DUPLICATE");
  return Object.freeze({ capturedDigest, restoredDigest, ledgers: names });
}

export function compareSequenceLowerBounds(captured, restored) {
  const source = array(captured),
    target = array(restored);
  const byName = (rows) => new Map(rows.map((row) => [`${row.schema}.${row.name}`, row]));
  const sourceMap = byName(source),
    targetMap = byName(target);
  if (
    sourceMap.size !== source.length ||
    targetMap.size !== target.length ||
    sourceMap.size !== targetMap.size
  )
    fail("SEQUENCE_SET_MISMATCH");
  let drift = 0;
  for (const [name, expected] of sourceMap) {
    const actual = targetMap.get(name);
    if (
      !actual ||
      !/^[-]?\d+$/.test(String(expected.lastValue)) ||
      !/^[-]?\d+$/.test(String(actual.lastValue))
    )
      fail("SEQUENCE_OBSERVATION_INVALID");
    if (BigInt(actual.lastValue) < BigInt(expected.lastValue)) fail("SEQUENCE_REGRESSION");
    if (
      String(actual.lastValue) !== String(expected.lastValue) ||
      actual.isCalled !== expected.isCalled
    )
      drift++;
  }
  return Object.freeze({ sequenceCount: source.length, nonMvccSequenceDriftCount: drift });
}

function serviceCounts(value, label) {
  object(value);
  const storage = object(required(value, "storage"));
  const vault = object(required(value, "vault"));
  const storageKeys = Object.keys(storage).sort().join(",");
  const vaultKeys = Object.keys(vault).sort().join(",");
  if (storageKeys !== "buckets,objects" || vaultKeys !== "ssn_vault_key_count")
    fail(`${label}_SERVICE_SHAPE_INVALID`);
  if (storage.buckets !== 0 || storage.objects !== 0 || vault.ssn_vault_key_count !== 0)
    fail(`${label}_SERVICE_COUNTS_NONZERO`);
  return { storageBuckets: 0, storageObjects: 0, ssnVaultKeyCount: 0 };
}

export function compareServiceCounts(captured, restored) {
  const source = serviceCounts(captured, "CAPTURED");
  const target = serviceCounts(restored, "RESTORED");
  if (canonicalDigest(source) !== canonicalDigest(target)) fail("SERVICE_COUNTS_MISMATCH");
  return Object.freeze(target);
}

function validateClones(clones, binding, reviewedCodeHashes) {
  object(clones);
  const names = ["authRest", "untouchedBaseline", "rehearsal"];
  const ids = new Set();
  for (const name of names) {
    const clone = object(required(clones, name));
    if (typeof clone.cloneId !== "string" || clone.cloneId.length < 8 || ids.has(clone.cloneId))
      fail("CLONE_ID_INVALID");
    ids.add(clone.cloneId);
    receiptBinding(clone, binding, name);
    if (canonicalDigest(object(clone.codeHashes)) !== canonicalDigest(object(reviewedCodeHashes)))
      fail("CLONE_CODE_HASH_MISMATCH");
  }
  if (clones.authRest.status !== "DESTROYED" || clones.authRest.remaining?.length !== 0)
    fail("AUTH_REST_CLONE_NOT_DESTROYED");
  if (clones.untouchedBaseline.status !== "UNTOUCHED_BASELINE_VERIFIED")
    fail("BASELINE_CLONE_INVALID");
  if (clones.rehearsal.status !== "REHEARSAL_VERIFIED") fail("REHEARSAL_CLONE_INVALID");
  return Object.freeze({ cloneIds: [...ids] });
}

function validateCaptureRestoreAuthRest(capture, restore, authRest, authRestore, binding) {
  if (capture?.status !== "CAPTURED_ONLY" || capture.captured?.status !== "CAPTURED_ONLY")
    fail("CAPTURE_NOT_FRESH");
  if (restore?.status !== "REHEARSED_ONLY" || restore.releaseAdmission !== "BLOCKED")
    fail("RESTORE_RECEIPT_INVALID");
  const proof = restore.proof ?? restore.restored?.proof;
  if (proof?.status !== "RESTORE_VERIFIED_ONLY" || proof.releaseAdmission !== "BLOCKED")
    fail("RESTORE_PROOF_INVALID");
  proofBinding(proof, binding, "restore");
  if (
    authRest?.status !== "LOCAL_AUTH_REST_VERIFIED_ONLY" ||
    authRest.releaseAdmission !== "BLOCKED"
  )
    fail("AUTH_REST_RECEIPT_INVALID");
  if (
    authRest.cleanup?.status !== "DESTROYED" ||
    !Array.isArray(authRest.cleanup.remaining) ||
    authRest.cleanup.remaining.length !== 0
  )
    fail("AUTH_REST_CLEANUP_INVALID");
  if (authRest.captureDigest !== binding.captureDigest) fail("AUTH_REST_BINDING_MISMATCH");
  if (authRest.schemaDigest || authRest.lineageDigest || authRest.artifactDigest)
    receiptBinding(authRest, binding, "auth_rest");
  if (authRestore) {
    const authProof = authRestore.proof ?? authRestore.restored?.proof;
    if (
      authRestore.status !== "REHEARSED_ONLY" ||
      authRestore.releaseAdmission !== "BLOCKED" ||
      authProof?.status !== "RESTORE_VERIFIED_ONLY"
    )
      fail("AUTH_REST_RESTORE_INVALID");
    proofBinding(authProof, binding, "auth_rest_restore");
    if (authRest.restoreProofDigest !== canonicalDigest(authProof))
      fail("AUTH_REST_PROOF_BINDING_MISMATCH");
  }
  return Object.freeze({
    restoreProofDigest: canonicalDigest(proof),
    authRestDigest: canonicalDigest(authRest),
  });
}

export function verifyApplicationBaseline(input) {
  object(input);
  const binding = sourceBinding(required(input, "capture"));
  const captureRestore = validateCaptureRestoreAuthRest(
    input.capture,
    input.restore,
    input.authRest,
    input.authRestore,
    binding,
  );
  const catalog = compareApplicationCatalog(
    required(input, "capturedCatalog"),
    required(input, "restoredCatalog"),
  );
  const ledger = compareRestoredLedgers({
    capturedLineage: required(input, "capturedLineage"),
    restoredLineage: required(input, "restoredLineage"),
    expectedDigest: binding.lineageDigest,
  });
  const sequences = compareSequenceLowerBounds(
    required(input, "capturedSequences"),
    required(input, "restoredSequences"),
  );
  const services = compareServiceCounts(
    required(input, "capturedServices"),
    required(input, "restoredServices"),
  );
  const clones = validateClones(
    required(input, "clones"),
    binding,
    required(input, "reviewedCodeHashes"),
  );
  return Object.freeze({
    status: APPLICATION_BASELINE_STATUS,
    releaseAdmission: APPLICATION_BASELINE_RELEASE_ADMISSION,
    qualifiedRecoveryScopes: [...APPLICATION_BASELINE_SCOPES],
    binding,
    catalog,
    ledger,
    sequences,
    services,
    clones,
    ...captureRestore,
  });
}

export async function collectRestoredApplicationCatalog(
  target,
  { execute, query = localSql, normalization = {} } = {},
) {
  const raw = JSON.parse(await query(target, APPLICATION_CATALOG_SQL, { execute }));
  const value = raw?.kind === "catalog" ? raw.value : raw;
  return normalizeApplicationCatalog(value, normalization);
}

export async function qualifyApplicationBaselineWithAdapters({
  capture,
  restore,
  authRest,
  capturedCatalog,
  queryCatalog,
  capturedLineage,
  queryLineage,
  capturedSequences,
  querySequences,
  capturedServices,
  queryServices,
  clones,
  reviewedCodeHashes,
}) {
  if (
    typeof queryCatalog !== "function" ||
    typeof queryLineage !== "function" ||
    typeof querySequences !== "function" ||
    typeof queryServices !== "function"
  )
    fail("QUERY_ADAPTER_REQUIRED");
  return verifyApplicationBaseline({
    capture,
    restore,
    authRest,
    capturedCatalog,
    restoredCatalog: await queryCatalog(),
    capturedLineage,
    restoredLineage: await queryLineage(),
    capturedSequences,
    restoredSequences: await querySequences(),
    capturedServices,
    restoredServices: await queryServices(),
    clones,
    reviewedCodeHashes,
  });
}

async function readPrivateJson(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) fail("RECEIPT_FILE_INVALID");
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset);
      if (result.bytesRead === 0) fail("RECEIPT_FILE_INVALID");
      offset += result.bytesRead;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } finally {
    await handle.close();
  }
}

const sqlIdentifier = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(value))
    fail("LEDGER_IDENTIFIER_INVALID");
  return `"${value}"`;
};

async function readRestoredLineage(target, capturedLineage, execute) {
  const actual = [];
  for (const entry of array(capturedLineage)) {
    if (!entry.present) {
      actual.push({ schema: entry.schema, name: entry.name, present: false });
      continue;
    }
    const key = entry.schema === "storage" ? "id" : "version";
    const table = `${sqlIdentifier(entry.schema)}.${sqlIdentifier(entry.name)}`;
    const rows = JSON.parse(
      await localSql(
        target,
        `SELECT coalesce(json_agg(to_jsonb(t) ORDER BY ${sqlIdentifier(key)}), '[]') FROM ONLY ${table} t;`,
        { execute },
      ),
    );
    actual.push({ schema: entry.schema, name: entry.name, present: true, rows });
  }
  return actual;
}

async function readRestoredSequences(target, capturedSequences, execute) {
  const actual = [];
  for (const sequence of array(capturedSequences)) {
    const table = `${sqlIdentifier(sequence.schema)}.${sqlIdentifier(sequence.name)}`;
    const value = JSON.parse(
      await localSql(
        target,
        `SELECT json_build_object('lastValue',last_value::text,'isCalled',is_called) FROM ${table};`,
        { execute },
      ),
    );
    actual.push({ schema: sequence.schema, name: sequence.name, ...value });
  }
  return actual;
}

async function readServiceCounts(target, execute) {
  return JSON.parse(
    await localSql(
      target,
      "SELECT json_build_object('storage',json_build_object('buckets',(SELECT count(*) FROM storage.buckets),'objects',(SELECT count(*) FROM storage.objects)),'vault',json_build_object('ssn_vault_key_count',(SELECT count(*) FROM vault.secrets WHERE name='ssn_vault_key')));",
      { execute },
    ),
  );
}

async function readTargetOidMaps(target, execute) {
  const value = JSON.parse(await localSql(target, APPLICATION_OID_SQL, { execute }));
  return oidReadbackMaps(value);
}

function readSourceServiceCounts(verified) {
  // The sealed integrity proof carries row counts for these exact managed
  // tables. A zero-row vault.secrets table proves a zero ssn_vault_key count
  // without exposing secret names, descriptions, or ciphertext.
  const tables = verified.integrity?.tables ?? [];
  const buckets = tables.find((row) => row.schema === "storage" && row.name === "buckets")?.rows;
  const objects = tables.find((row) => row.schema === "storage" && row.name === "objects")?.rows;
  const secrets = tables.find((row) => row.schema === "vault" && row.name === "secrets")?.rows;
  if (![buckets, objects, secrets].every((value) => Number.isSafeInteger(value) && value >= 0))
    fail("SOURCE_SERVICE_COUNTS_REQUIRED");
  if (buckets !== 0 || objects !== 0 || secrets !== 0) fail("SOURCE_SERVICE_COUNTS_NONZERO");
  return { storage: { buckets: 0, objects: 0 }, vault: { ssn_vault_key_count: 0 } };
}

const REVIEWED_CODE_FILES = Object.freeze([
  "auth-rest-qualifier.mjs",
  "service-contract.mjs",
  "local-services.mjs",
  "restore.mjs",
  "local-target.mjs",
  "contract.mjs",
]);

async function reviewedCodeHashes() {
  const hashes = {};
  for (const file of REVIEWED_CODE_FILES) {
    const content = await readFile(new URL(`./${file}`, import.meta.url));
    hashes[file] = createHash("sha256").update(content).digest("hex");
  }
  return hashes;
}

async function observerCodeHash() {
  const content = await readFile(new URL("./application-baseline.mjs", import.meta.url));
  return createHash("sha256").update(content).digest("hex");
}

function cloneReceipt(binding, codeHashes, cloneId, status, cleanup) {
  return {
    ...binding,
    cloneId,
    status,
    codeHashes,
    ...(cleanup ? { remaining: cleanup.remaining } : {}),
  };
}

async function readSystemIdentity(target, execute) {
  const value = JSON.parse(
    await localSql(
      target,
      "SELECT json_build_object('database',current_database(),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()));",
      { execute },
    ),
  );
  if (
    value.database !== "minted_recovery" ||
    typeof value.systemIdentifier !== "string" ||
    !/^\d+$/.test(value.systemIdentifier)
  )
    fail("SYSTEM_IDENTITY_INVALID");
  return value.systemIdentifier;
}

function assertLiveProofMatchesReceipt(receipt, live) {
  const expected = receipt?.proof;
  if (
    !expected ||
    expected.status !== live.status ||
    expected.releaseAdmission !== live.releaseAdmission
  )
    fail("RESTORE_LIVE_PROOF_MISMATCH");
  for (const key of [
    "captureDigest",
    "sealedArtifacts",
    "data",
    "accessDigest",
    "rolesDigest",
    "structureDigest",
    "lineageDigest",
    "outbound",
  ])
    if (canonicalDigest(expected[key]) !== canonicalDigest(live[key]))
      fail("RESTORE_LIVE_PROOF_MISMATCH");
  const expectedBackup = { ...expected.observedBackup },
    liveBackup = { ...live.observedBackup };
  delete expectedBackup.verifiedAt;
  delete liveBackup.verifiedAt;
  if (canonicalDigest(expectedBackup) !== canonicalDigest(liveBackup))
    fail("RESTORE_LIVE_PROOF_MISMATCH");
}

// Production/local operator entry. It reads the sealed capture and existing
// receipts, owns the fresh local targets, and only emits the sanitized receipt.
// The adapters are dependency seams for tests; they are not required in normal
// operation and callers cannot supply observed PASS values.
export async function qualifyLocalApplicationBaseline(
  { workspace, identityPath } = {},
  dependencies = {},
) {
  if (
    typeof workspace !== "string" ||
    !workspace.startsWith("/") ||
    typeof identityPath !== "string" ||
    !identityPath.startsWith("/")
  )
    fail("WORKSPACE_INVALID");
  const inspect = dependencies.inspect ?? inspectSealedBackup;
  const verified = await inspect({ workspace, identityPath });
  const capture = verified.capture;
  const binding = sourceBinding({
    ...capture,
    captureDigest: verified.captureDigest,
    artifactDigest: verified.artifactDigest,
  });
  const restore = await readPrivateJson(join(workspace, "restore-rehearsal.json"));
  const baselineRestore = await readPrivateJson(join(workspace, "restore-baseline.json"));
  const authRestore = await readPrivateJson(join(workspace, "restore-auth-rest.json"));
  const authRest = await readPrivateJson(join(workspace, "auth-rest.json"));
  const codeHashes = await (dependencies.codeHashes ?? reviewedCodeHashes)();
  const observedCodeHash = await (dependencies.observerCodeHash ?? observerCodeHash)();
  const recordedCodeHashes = object(authRest.codeHashes);
  if (
    Object.keys(recordedCodeHashes).sort().join(",") !== [...REVIEWED_CODE_FILES].sort().join(",")
  )
    fail("AUTH_REST_CODE_HASH_SET_MISMATCH");
  for (const file of REVIEWED_CODE_FILES) {
    const hash = recordedCodeHashes[file];
    if (!HASH.test(hash) || codeHashes[file] !== hash) fail("AUTH_REST_CODE_HASH_MISMATCH");
  }
  const collectTarget = dependencies.collectTarget ?? collectLocalTarget;
  const baselineTarget = await collectTarget(baselineRestore.runId);
  const rehearsalTarget = await collectTarget(restore.runId);
  const queryExecute = dependencies.execute;
  const sourceCatalog = verified.schema.before;
  const capturedLineage = verified.lineage;
  const capturedSequences = verified.integrity.sequences;
  const capturedServices = readSourceServiceCounts(verified);
  const toc =
    dependencies.toc ??
    (await observeArchiveTableOfContents(
      rehearsalTarget,
      workspace,
      identityPath,
      dependencies.launch ?? spawn,
    ));
  const sourceMaps = tocMaps(toc, sourceCatalog);
  const sourceNormalization = normalizationMaps(sourceCatalog, sourceMaps);
  const capturedCatalog = normalizeApplicationCatalog(sourceCatalog, sourceNormalization);
  const verifier = dependencies.verifyRestoredBackup ?? verifyRestoredBackup;
  const baselineProof = await verifier(
    { target: baselineTarget, verifiedBackup: verified },
    { execute: queryExecute },
  );
  const rehearsalProof = await verifier(
    { target: rehearsalTarget, verifiedBackup: verified },
    { execute: queryExecute },
  );
  assertLiveProofMatchesReceipt(baselineRestore, baselineProof);
  assertLiveProofMatchesReceipt(restore, rehearsalProof);
  const baselineSystemIdentifier = await readSystemIdentity(baselineTarget, queryExecute);
  const rehearsalSystemIdentifier = await readSystemIdentity(rehearsalTarget, queryExecute);
  if (baselineSystemIdentifier === rehearsalSystemIdentifier) fail("CLONE_SYSTEM_ID_REUSED");
  const baselineOidMaps =
    dependencies.baselineOidMaps ?? (await readTargetOidMaps(baselineTarget, queryExecute));
  const rehearsalOidMaps =
    dependencies.rehearsalOidMaps ?? (await readTargetOidMaps(rehearsalTarget, queryExecute));
  const baselineNormalization = normalizationMaps(sourceCatalog, baselineOidMaps);
  const rehearsalNormalization = normalizationMaps(sourceCatalog, rehearsalOidMaps);
  const baselineCatalog = await collectRestoredApplicationCatalog(baselineTarget, {
    execute: queryExecute,
    normalization: baselineNormalization,
  });
  const restoredCatalog = await collectRestoredApplicationCatalog(rehearsalTarget, {
    execute: queryExecute,
    normalization: rehearsalNormalization,
  });
  const validateTarget = async (cloneTarget, cloneCatalog, cloneNormalization) => {
    compareApplicationCatalog(capturedCatalog, cloneCatalog, {
      captured: sourceNormalization,
      restored: cloneNormalization,
    });
    const cloneLineage = await readRestoredLineage(cloneTarget, capturedLineage, queryExecute);
    compareRestoredLedgers({
      capturedLineage,
      restoredLineage: cloneLineage,
      expectedDigest: binding.lineageDigest,
    });
    const cloneSequences = await readRestoredSequences(
      cloneTarget,
      capturedSequences,
      queryExecute,
    );
    compareSequenceLowerBounds(capturedSequences, cloneSequences);
    compareServiceCounts(capturedServices, await readServiceCounts(cloneTarget, queryExecute));
  };
  await validateTarget(baselineTarget, baselineCatalog, baselineNormalization);
  const restoredLineage = await readRestoredLineage(rehearsalTarget, capturedLineage, queryExecute);
  const restoredSequences = await readRestoredSequences(
    rehearsalTarget,
    capturedSequences,
    queryExecute,
  );
  const restoredServices = await readServiceCounts(rehearsalTarget, queryExecute);
  const result = verifyApplicationBaseline({
    capture,
    restore,
    authRest,
    authRestore,
    capturedCatalog,
    restoredCatalog,
    capturedLineage,
    restoredLineage,
    capturedSequences,
    restoredSequences,
    capturedServices,
    restoredServices,
    clones: {
      authRest: cloneReceipt(binding, codeHashes, authRest.runId, "DESTROYED", authRest.cleanup),
      untouchedBaseline: cloneReceipt(
        binding,
        codeHashes,
        baselineRestore.runId,
        "UNTOUCHED_BASELINE_VERIFIED",
      ),
      rehearsal: cloneReceipt(binding, codeHashes, restore.runId, "REHEARSAL_VERIFIED"),
    },
    reviewedCodeHashes: codeHashes,
  });
  return Object.freeze({
    ...result,
    observerCodeHash: observedCodeHash,
    targets: Object.freeze({
      baseline: {
        runId: baselineRestore.runId,
        systemIdentifier: baselineSystemIdentifier,
        targetDigest: canonicalDigest(baselineTarget),
      },
      rehearsal: {
        runId: restore.runId,
        systemIdentifier: rehearsalSystemIdentifier,
        targetDigest: canonicalDigest(rehearsalTarget),
      },
    }),
  });
}
