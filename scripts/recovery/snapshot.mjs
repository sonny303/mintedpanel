import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { canonicalDigest } from "../release/contract.mjs";
import { RecoveryError, STAGING } from "./contract.mjs";

const fail = () => new RecoveryError("RECOVERY_SNAPSHOT_REJECTED");
const requireSnapshot = (condition) => {
  if (!condition) throw fail();
};
const MAX_LINE = 16 * 1024 * 1024;
const MAX_TOTAL = 256 * 1024 * 1024;
const CATALOG_ARRAYS = [
  "schemas",
  "relations",
  "columns",
  "constraints",
  "indexes",
  "functions",
  "aggregates",
  "types",
  "enums",
  "policies",
  "triggers",
  "rules",
  "inheritance",
  "extensions",
  "extensionMembers",
  "eventTriggers",
  "roles",
  "memberships",
  "defaultAcls",
  "roleDatabaseSettings",
  "parameterAcls",
  "tablespaces",
  "publications",
  "publicationTables",
  "publicationNamespaces",
  "sequences",
  "collations",
];
const token = (value) =>
  typeof value === "string" && /^[0-9A-F]{8}-[0-9A-F]{8}-[1-9][0-9]*$/.test(value);
const identifier = (value) => {
  requireSnapshot(typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(value));
  return `"${value}"`;
};
const qualified = (table) => `${identifier(table.schema)}.${identifier(table.name)}`;
const SETUP = `SET ROLE postgres;
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL row_security = off;
SET LOCAL timezone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL intervalstyle = 'postgres';
SET LOCAL bytea_output = 'hex';
SET LOCAL extra_float_digits = 3;
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '900s';`;

// A closed catalog query, also available to the root's existing read-only
// connector for preparation. A caller observation is not an owned capture.
// Definition/configuration values must remain private and encrypted.
export const SNAPSHOT_CATALOG_SQL = `WITH ns AS (
 SELECT oid,nspname,nspowner,nspacl FROM pg_catalog.pg_namespace
 WHERE nspname <> 'information_schema' AND nspname !~ '^pg_'
), rel AS (SELECT c.*,n.nspname FROM pg_catalog.pg_class c JOIN ns n ON n.oid=c.relnamespace)
SELECT jsonb_build_object('kind','catalog','value',jsonb_build_object(
 'database',(SELECT jsonb_build_object('owner',pg_get_userbyid(datdba),
   'encoding',pg_encoding_to_char(encoding),'collation',datcollate,'ctype',datctype,
   'localeProvider',datlocprovider,'locale',coalesce(to_jsonb(d)->>'datlocale',to_jsonb(d)->>'daticulocale'),
   'collationVersion',datcollversion,'acl',datacl,'tablespace',dattablespace)
   FROM pg_catalog.pg_database d WHERE datname=current_database()),
 'schemas',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl) ORDER BY nspname),'[]') FROM ns),
 'relations',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',nspname,'name',relname,
   'kind',relkind,'owner',pg_get_userbyid(relowner),'acl',relacl,'rls',relrowsecurity,
   'forceRls',relforcerowsecurity,'persistence',relpersistence,'options',reloptions,
   'partitionBound',pg_get_expr(relpartbound,oid)) ORDER BY nspname,relname),'[]') FROM rel),
 'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',r.nspname,'table',r.relname,
   'position',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
   'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'acl',a.attacl,
   'collation',a.attcollation,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY r.nspname,r.relname,a.attnum),'[]')
   FROM rel r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid
   LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.conname,
   'relation',c.conrelid::regclass::text,'definition',pg_get_constraintdef(c.oid,true),
   'validated',c.convalidated,'type',c.contype) ORDER BY c.oid),'[]')
   FROM pg_catalog.pg_constraint c JOIN ns n ON n.oid=c.connamespace),
 'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',r.nspname,'name',r.relname,
   'definition',pg_get_indexdef(r.oid),'valid',i.indisvalid,'ready',i.indisready) ORDER BY r.nspname,r.relname),'[]')
   FROM rel r JOIN pg_catalog.pg_index i ON i.indexrelid=r.oid),
 'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,
   'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'definition',pg_get_functiondef(p.oid)) ORDER BY p.oid),'[]')
   FROM pg_catalog.pg_proc p JOIN ns n ON n.oid=p.pronamespace WHERE p.prokind<>'a'),
 'aggregates',(SELECT coalesce(jsonb_agg(jsonb_build_object('procedure',to_jsonb(p),'aggregate',to_jsonb(a)) ORDER BY p.oid),'[]')
   FROM pg_catalog.pg_proc p JOIN ns n ON n.oid=p.pronamespace JOIN pg_catalog.pg_aggregate a ON a.aggfnoid=p.oid),
 'types',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.oid),'[]') FROM pg_catalog.pg_type t JOIN ns n ON n.oid=t.typnamespace),
 'enums',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.enumtypid,e.enumsortorder),'[]')
   FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid=e.enumtypid JOIN ns n ON n.oid=t.typnamespace),
 'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',r.nspname,'table',r.relname,
   'name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',p.polroles,
   'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.oid),'[]')
   FROM pg_catalog.pg_policy p JOIN rel r ON r.oid=p.polrelid),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',r.nspname,'table',r.relname,
   'name',t.tgname,'enabled',t.tgenabled,'internal',t.tgisinternal,'definition',pg_get_triggerdef(t.oid,true)) ORDER BY t.oid),'[]')
   FROM pg_catalog.pg_trigger t JOIN rel r ON r.oid=t.tgrelid),
 'rules',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',r.nspname,'table',r.relname,
   'name',w.rulename,'enabled',w.ev_enabled,'definition',pg_get_ruledef(w.oid,true)) ORDER BY w.oid),'[]')
   FROM pg_catalog.pg_rewrite w JOIN rel r ON r.oid=w.ev_class),
 'inheritance',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.inhrelid,i.inhseqno),'[]')
   FROM pg_catalog.pg_inherits i JOIN rel r ON r.oid=i.inhrelid),
 'extensions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,
   'owner',pg_get_userbyid(e.extowner),'schema',n.nspname,'configurationTables',e.extconfig,'rowFilters',e.extcondition)
   ORDER BY e.extname),'[]') FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace),
 'extensionMembers',(SELECT coalesce(jsonb_agg(jsonb_build_object('extension',e.extname,
   'object',pg_describe_object(d.classid,d.objid,d.objsubid)) ORDER BY e.extname,d.classid,d.objid,d.objsubid),'[]')
   FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid
   WHERE d.refclassid='pg_catalog.pg_extension'::regclass AND d.deptype='e'),
 'eventTriggers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.evtname),'[]') FROM pg_catalog.pg_event_trigger t),
 'roles',(SELECT coalesce(jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.rolname),'[]') FROM pg_catalog.pg_roles r),
 'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member,m.grantor),'[]') FROM pg_catalog.pg_auth_members m),
 'defaultAcls',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.oid),'[]') FROM pg_catalog.pg_default_acl a),
 'roleDatabaseSettings',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.setdatabase,s.setrole),'[]')
   FROM pg_catalog.pg_db_role_setting s WHERE s.setdatabase IN(0,(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()))),
 'parameterAcls',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.parname),'[]') FROM pg_catalog.pg_parameter_acl p),
 'tablespaces',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.spcname),'[]') FROM pg_catalog.pg_tablespace t),
 'publications',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.pubname),'[]') FROM pg_catalog.pg_publication p),
 'publicationTables',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]') FROM pg_catalog.pg_publication_rel p),
 'publicationNamespaces',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]') FROM pg_catalog.pg_publication_namespace p),
 'sequences',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.seqrelid),'[]') FROM pg_catalog.pg_sequence s JOIN rel r ON r.oid=s.seqrelid),
 'collations',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.oid),'[]') FROM pg_catalog.pg_collation c JOIN ns n ON n.oid=c.collnamespace),
 'outbound',jsonb_build_object('subscriptions',(SELECT count(*) FROM pg_catalog.pg_subscription),
   'foreignServers',(SELECT count(*) FROM pg_catalog.pg_foreign_server),'foreignTables',(SELECT count(*) FROM pg_catalog.pg_foreign_table)),
 'largeObjects',(SELECT count(*) FROM pg_catalog.pg_largeobject_metadata)
));`;

// Fixed session owner supplies the actual child and checked close promise.
// This module has no executable, connection, credential or arbitrary SQL API.
export function createSnapshotSession({ child, completion, checkTime, expectedRole }) {
  const decoder = new StringDecoder("utf8");
  let buffer = "",
    bytes = 0,
    serial = 0,
    pending,
    stopped = false;
  const reject = () => {
    stopped = true;
    pending?.reject(fail());
    pending = undefined;
  };
  child.stdout.on("error", reject);
  child.stdin.on("error", reject);
  child.stdout.on("end", reject);
  completion.then(reject, reject);
  child.stdout.on("data", (chunk) => {
    try {
      checkTime();
      bytes += chunk.length;
      requireSnapshot(bytes <= MAX_TOTAL);
      buffer += decoder.write(chunk);
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        requireSnapshot(line.length <= MAX_LINE && pending);
        if (line === pending.marker) {
          const job = pending;
          pending = undefined;
          job.resolve();
        } else if (line.length) pending.onRow(JSON.parse(line));
      }
      requireSnapshot(buffer.length <= MAX_LINE);
    } catch {
      reject();
    }
  });
  function run(sql, onRow) {
    checkTime();
    requireSnapshot(!stopped && !pending && ++serial <= 1000);
    return new Promise((resolve, rejectRun) => {
      pending = { resolve, reject: rejectRun, onRow, marker: `MINTED_RECOVERY_DONE_${serial}` };
      child.stdin.write(`${sql}\n\\echo ${pending.marker}\n`, (error) => {
        if (error) reject();
      });
    });
  }
  async function one(sql, kind) {
    const rows = [];
    await run(sql, (row) => {
      requireSnapshot(
        rows.length === 0 &&
          row?.kind === kind &&
          Object.keys(row).sort().join(",") === "kind,value",
      );
      rows.push(row.value);
    });
    requireSnapshot(rows.length === 1);
    return rows[0];
  }
  async function catalog() {
    const value = await one(SNAPSHOT_CATALOG_SQL, "catalog");
    requireSnapshot(
      value &&
        Object.keys(value).sort().join(",") ===
          [...CATALOG_ARRAYS, "database", "outbound", "largeObjects"].sort().join(","),
    );
    requireSnapshot(
      CATALOG_ARRAYS.every((key) => Array.isArray(value[key])) &&
        value.database &&
        value.outbound &&
        Number.isSafeInteger(value.largeObjects) &&
        value.largeObjects >= 0 &&
        ["subscriptions", "foreignServers", "foreignTables"].every(
          (key) => Number.isSafeInteger(value.outbound[key]) && value.outbound[key] >= 0,
        ),
    );
    const seen = new Set();
    for (const table of value.relations) {
      const key = qualified(table);
      requireSnapshot(!seen.has(key));
      seen.add(key);
      requireSnapshot(["r", "p", "v", "m", "S", "i", "I", "c"].includes(table.kind));
    }
    return value;
  }
  return {
    async open() {
      const value = await one(
        `${SETUP}\nSELECT jsonb_build_object('kind','identity','value',jsonb_build_object(
        'database',current_database(),'role',current_user,'sessionRole',session_user,
        'serverVersion',current_setting('server_version'),'readOnly',current_setting('transaction_read_only'),
        'isolation',current_setting('transaction_isolation'),'standby',pg_is_in_recovery(),'snapshot',pg_export_snapshot()));`,
        "identity",
      );
      requireSnapshot(
        value.database === STAGING.database &&
          value.role === "postgres" &&
          value.sessionRole === expectedRole &&
          value.serverVersion === STAGING.serverVersion &&
          value.readOnly === "on" &&
          value.isolation === "repeatable read" &&
          value.standby === false &&
          token(value.snapshot),
      );
      return value.snapshot;
    },
    catalog,
    async lineage(value) {
      const ledgers = [];
      for (const [schema, name, key] of [
        ["auth", "schema_migrations", "version"],
        ["storage", "migrations", "id"],
        ["supabase_migrations", "schema_migrations", "version"],
      ]) {
        const table = value.relations.find((r) => r.schema === schema && r.name === name);
        if (!table) {
          ledgers.push({ schema, name, present: false });
          continue;
        }
        requireSnapshot(
          table.kind === "r" &&
            value.columns.some((c) => c.schema === schema && c.table === name && c.name === key),
        );
        const rows = [],
          keys = new Set();
        await run(
          `SELECT jsonb_build_object('kind','ledger','value',to_jsonb(t)) FROM ONLY ${qualified(table)} AS t ORDER BY ${identifier(key)};`,
          (row) => {
            requireSnapshot(
              row?.kind === "ledger" &&
                Object.keys(row).sort().join(",") === "kind,value" &&
                row.value &&
                typeof row.value === "object" &&
                rows.length < 10000 &&
                (key === "id"
                  ? Number.isSafeInteger(row.value[key]) && row.value[key] >= 0
                  : typeof row.value[key] === "string" &&
                    row.value[key].length > 0 &&
                    row.value[key].length <= 255) &&
                !keys.has(row.value[key]),
            );
            keys.add(row.value[key]);
            rows.push(row.value);
          },
        );
        ledgers.push({ schema, name, present: true, rows });
      }
      return ledgers;
    },
    async integrity(value) {
      const tables = [],
        sequences = [];
      for (const table of value.relations) {
        if (table.kind === "r") {
          const name = qualified(table),
            hash = createHash("sha256");
          let count = 0,
            last = "";
          const expectedCount = await one(
            `SELECT jsonb_build_object('kind','table-count','value',count(*)) FROM ONLY ${name};`,
            "table-count",
          );
          requireSnapshot(Number.isSafeInteger(expectedCount) && expectedCount >= 0);
          await run(
            `SELECT jsonb_build_object('kind','row','value',h) FROM (
            SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS h FROM ONLY ${name} AS t
          ) AS row_hashes ORDER BY h COLLATE "C";`,
            (row) => {
              requireSnapshot(
                row?.kind === "row" &&
                  Object.keys(row).sort().join(",") === "kind,value" &&
                  typeof row.value === "string" &&
                  /^[0-9a-f]{64}$/.test(row.value) &&
                  row.value >= last,
              );
              last = row.value;
              hash.update(`${row.value}\n`);
              count++;
              requireSnapshot(Number.isSafeInteger(count));
            },
          );
          requireSnapshot(count === expectedCount);
          tables.push({
            schema: table.schema,
            name: table.name,
            rows: count,
            sha256: hash.digest("hex"),
          });
        } else if (table.kind === "S") {
          const state = await one(
            `SELECT jsonb_build_object('kind','sequence','value',jsonb_build_object('lastValue',last_value::text,'isCalled',is_called)) FROM ${qualified(table)};`,
            "sequence",
          );
          requireSnapshot(
            state &&
              Object.keys(state).sort().join(",") === "isCalled,lastValue" &&
              /^-?[0-9]+$/.test(state.lastValue) &&
              typeof state.isCalled === "boolean",
          );
          sequences.push({
            schema: table.schema,
            name: table.name,
            ...state,
            snapshotTreatment: "NON_MVCC_OBSERVATION",
          });
        }
      }
      return {
        representation: "sha256-of-sorted-sha256-jsonb-utf8-rows-v1",
        tables,
        sequences,
        catalogDigest: canonicalDigest(value),
        materializedViewCount: value.relations.filter((r) => r.kind === "m").length,
      };
    },
    async afterCatalog() {
      await run(`ROLLBACK;\n${SETUP}`, () => {
        throw fail();
      });
      return catalog();
    },
    async close() {
      await run("ROLLBACK;", () => {
        throw fail();
      });
      child.stdin.end("\\q\n");
      await completion;
    },
  };
}
