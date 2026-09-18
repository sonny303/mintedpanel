import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, chmod, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { captureStagingSnapshot } from "./export.mjs";
import { canonicalDigest } from "../release/contract.mjs";
import { STAGING } from "./contract.mjs";
import { verifySealed } from "./encrypted-stream.mjs";

const NOW = Date.parse("2026-09-08T22:00:00.000Z");
const bin = process.platform === "darwin" ? "/opt/homebrew/bin" : "/usr/bin";
const ageBinary = join(bin, "age"),
  keygen = join(bin, "age-keygen");
assert.equal(spawnSync(ageBinary, ["--version"]).status, 0, "Install age before recovery tests");
assert.equal(
  spawnSync(keygen, ["--version"]).status,
  0,
  "Install age-keygen before recovery tests",
);
function catalog() {
  const result = {
    database: { owner: "postgres" },
    outbound: { subscriptions: 0, foreignServers: 0, foreignTables: 0 },
    largeObjects: 0,
  };
  for (const key of [
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
  ])
    result[key] = [];
  result.relations = [
    { schema: "public", name: "synthetic_table", kind: "r" },
    { schema: "public", name: "synthetic_sequence", kind: "S" },
  ];
  result.functions = [{ definition: "synthetic-private-function-canary" }];
  result.roles = [{ rolname: "cli_login_synthetic", rolcanlogin: true }];
  return result;
}
async function setup(t) {
  const workspace = await mkdtemp(join(realpathSync(tmpdir()), "minted-snapshot-synthetic-"));
  await chmod(workspace, 0o700);
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const key = spawnSync(keygen, [], { encoding: "utf8" });
  assert.equal(key.status, 0);
  const identityPath = join(workspace, "identity.txt");
  await writeFile(identityPath, key.stdout, { mode: 0o600 });
  const recipient = spawnSync(keygen, ["-y", identityPath], { encoding: "utf8" }).stdout.trim();
  const expected = catalog();
  return {
    identityPath,
    expected,
    options: {
      workspace,
      recipient,
      response: {
        role: "cli_login_synthetic",
        password: "synthetic-private-password-canary",
        ttl_seconds: 900,
      },
      requestedAt: new Date(NOW).toISOString(),
      receivedAt: new Date(NOW).toISOString(),
      sourceObserved: {
        capturedAt: new Date(NOW).toISOString(),
        source: {
          ...STAGING,
          schemaDigest: canonicalDigest(expected),
          lineageDigest: "b".repeat(64),
        },
      },
    },
  };
}

function harness(expected, scenario = "success") {
  const calls = [],
    children = [],
    closed = [],
    queries = [];
  let holder,
    now = NOW;
  const values = ["a".repeat(64), "b".repeat(64), "b".repeat(64)];
  const program = `const {createInterface}=require('node:readline');
 const catalog=${JSON.stringify(expected)}, scenario=${JSON.stringify(scenario)}, hashes=${JSON.stringify(values)};
 let sql='', catalogReads=0;
 createInterface({input:process.stdin}).on('line',line=>{
  if(line==='\\\\q') process.exit(0);
  if(!line.startsWith('\\\\echo ')){sql+=line+'\\n';return;}
  const marker=line.slice(6);let rows=[];
  if(sql.includes('pg_export_snapshot')) rows=[{kind:'identity',value:{database:'postgres',role:scenario==='wrong-role'?'anon':'postgres',sessionRole:'cli_login_synthetic',serverVersion:scenario==='wrong-server'?'18.4':'17.6',readOnly:'on',isolation:'repeatable read',standby:false,snapshot:scenario==='bad-token'?'private-canary':'00000003-0000001B-1'}}];
  else if(sql.includes('WITH ns AS')) {
   catalogReads++;const value=structuredClone(catalog);
   if(scenario==='drift'&&catalogReads===2)value.functions.push({definition:'changed'});
   if(scenario==='missing-catalog')delete value.roles;
   if(scenario==='unsafe-identifier')value.relations[0].name='bad; DROP DATABASE postgres';
   if(scenario==='duplicate-table')value.relations.push(value.relations[0]);
   if(scenario==='temporary-role-missing')value.roles=[];
   rows=[{kind:'catalog',value}];
  } else if(sql.includes("'kind','table-count'"))rows=[{kind:'table-count',value:3}];
  else if(sql.includes("'kind','ledger'"))rows=(scenario==='incomplete-ledger'?[1,2]:scenario==='duplicate-ledger'?[1,1,3]:[1,2,3]).map(id=>({kind:'ledger',value:{version:String(id)}}));
  else if(sql.includes('encode(sha256')) {
   if(scenario==='permission'){process.stderr.write('private-permission-canary');process.exit(2);}
   if(scenario==='holder-death')process.exit(3);
   if(scenario==='hang-integrity')return;
   rows=(scenario==='missing-row'?hashes.slice(1):scenario==='unordered-rows'?[...hashes].reverse():hashes).map(value=>({kind:'row',value}));
  } else if(sql.includes("'kind','sequence'"))rows=[{kind:'sequence',value:{lastValue:'12',isCalled:true}}];
  if(scenario==='malformed'&&catalogReads===1){process.stdout.write('private-not-json-canary\\n');return;}
  process.stdout.write(rows.map(row=>JSON.stringify(row)+'\\n').join('')+marker+'\\n');sql='';
 });`;
  const dependencies = {
    clock: () => now,
    verifyClient: async () => {},
    spawn(path, args, configuration) {
      if (basename(path) === "age") return spawn(path, args, configuration);
      calls.push({ path, args, configuration });
      const version = args[0] === "--version";
      const sourcePsql = basename(path) === "psql" && !version;
      const script = version
        ? `process.stdout.write(${JSON.stringify(`${basename(path)} (PostgreSQL) 17.10\n`)});`
        : sourcePsql
          ? program
          : 'process.stdout.write("synthetic-archive-or-roles");';
      const child = spawn(process.execPath, ["-e", script], configuration);
      children.push(child);
      child.on("close", () => closed.push(child.pid));
      if (sourcePsql) {
        holder = child;
        if (scenario === "hang-integrity")
          setTimeout(() => {
            now += 895001;
          }, 150);
      }
      if (!version && basename(path) === "pg_dump" && scenario === "holder-dies-during-dump")
        holder.kill("SIGKILL");
      return child;
    },
    killGroup(pid) {
      process.kill(-pid, "SIGKILL");
    },
  };
  return { dependencies, calls, children, closed, queries, values };
}
const redacted = (error) => {
  assert.equal(error.code, "RECOVERY_EXPORT_REJECTED");
  assert.equal(error.message, "RECOVERY_EXPORT_REJECTED");
  return true;
};

test("shared snapshot capture encrypts catalog/integrity while binding exact internal snapshot to pg_dump", async (t) => {
  const f = await setup(t),
    h = harness(f.expected);
  const result = await captureStagingSnapshot(f.options, h.dependencies);
  assert.equal(result.status, "CAPTURED_ONLY");
  assert.equal(result.snapshot.method, "single-data-snapshot-catalog-bracketed");
  assert.equal(result.snapshot.physicalTableCount, 1);
  assert.equal(result.snapshot.rowCount, 3);
  assert.equal(result.snapshot.sequenceTreatment, "NON_MVCC_OBSERVATION");
  assert.equal(result.snapshot.temporaryLoginRolePresence, "PRESENT");
  assert.equal(result.snapshot.temporaryLoginRoleDependencyReview, "PENDING");
  assert.equal(result.snapshot.declaredSchemaMatch, "NOT_CLAIMED");
  assert.equal(result.snapshot.lineageMeaning, "OBSERVED_DATABASE_LEDGERS_ONLY");
  assert.equal(result.snapshot.catalogBeforeDigest, canonicalDigest(f.expected));
  assert.equal(result.snapshot.catalogAfterDigest, canonicalDigest(f.expected));
  assert.deepEqual(
    result.artifacts.map((a) => a.name),
    ["backup", "roles", "schema", "integrity", "migration-lineage"],
  );
  assert.ok(!JSON.stringify(result).includes("private-function-canary"));
  assert.ok(!JSON.stringify(result).includes("private-password-canary"));
  assert.ok(!JSON.stringify(result).includes("00000003-0000001B-1"));
  const dump = h.calls.find((c) => basename(c.path) === "pg_dump" && c.args[0] !== "--version");
  assert.equal(dump.args.at(-1), "--snapshot=00000003-0000001B-1");
  const psql = h.calls.find((c) => basename(c.path) === "psql" && c.args[0] !== "--version");
  assert.deepEqual(psql.args, [
    "-X",
    "--no-password",
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--set=ON_ERROR_STOP=1",
    "--dbname=postgres",
  ]);
  for (const artifact of result.artifacts) {
    assert.deepEqual(
      await verifySealed({
        workspace: f.options.workspace,
        identityPath: f.identityPath,
        ageBinary,
        name: artifact.name,
      }),
      artifact,
    );
    assert.ok(
      !(await readFile(join(f.options.workspace, `${artifact.name}.age`))).includes(
        Buffer.from("synthetic-private-function-canary"),
      ),
    );
  }
  assert.equal(h.closed.length, h.children.length);
  const expectedIntegrity = {
    representation: "sha256-of-sorted-sha256-jsonb-utf8-rows-v1",
    tables: [
      {
        schema: "public",
        name: "synthetic_table",
        rows: 3,
        sha256: createHash("sha256")
          .update(h.values.map((x) => x + "\n").join(""))
          .digest("hex"),
      },
    ],
    sequences: [
      {
        schema: "public",
        name: "synthetic_sequence",
        lastValue: "12",
        isCalled: true,
        snapshotTreatment: "NON_MVCC_OBSERVATION",
      },
    ],
    catalogDigest: canonicalDigest(f.expected),
    materializedViewCount: 0,
  };
  assert.equal(result.snapshot.integrityDigest, canonicalDigest(expectedIntegrity));
});

for (const scenario of [
  "wrong-role",
  "wrong-server",
  "bad-token",
  "missing-catalog",
  "unsafe-identifier",
  "duplicate-table",
  "temporary-role-missing",
  "permission",
  "holder-death",
  "missing-row",
  "unordered-rows",
  "malformed",
  "drift",
  "holder-dies-during-dump",
  "hang-integrity",
]) {
  test(`${scenario} rejects shared capture, closes every producer and never leaks private diagnostics`, async (t) => {
    const f = await setup(t),
      h = harness(f.expected, scenario);
    await assert.rejects(captureStagingSnapshot(f.options, h.dependencies), redacted);
    assert.equal(h.closed.length, h.children.length);
    assert.ok(!(await readdir(f.options.workspace)).some((name) => name.endsWith(".partial")));
    if (!["drift", "holder-dies-during-dump"].includes(scenario))
      assert.equal(
        h.calls.filter((c) => basename(c.path) === "pg_dump" && c.args[0] !== "--version").length,
        0,
      );
  });
}

test("owned catalog establishes actual digests while a different declared observation remains non-authoritative", async (t) => {
  const f = await setup(t),
    h = harness(f.expected);
  f.options.sourceObserved.source.schemaDigest = "f".repeat(64);
  const result = await captureStagingSnapshot(f.options, h.dependencies);
  assert.equal(result.source.schemaDigest, canonicalDigest(f.expected));
  assert.equal(result.declaredInputObservationDigest, canonicalDigest(f.options.sourceObserved));
  assert.equal(result.snapshot.declaredSchemaMatch, "NOT_CLAIMED");
  assert.equal(Object.hasOwn(result, "sourceObservedDigest"), false);
});

test("snapshot and query overrides remain outside the public API", async (t) => {
  const f = await setup(t),
    h = harness(f.expected);
  for (const key of ["snapshot", "snapshotId", "sql", "query", "tables"])
    await assert.rejects(
      captureStagingSnapshot({ ...f.options, [key]: "private-canary" }, h.dependencies),
      redacted,
    );
  assert.equal(h.calls.length, 0);
});

for (const scenario of ["success", "incomplete-ledger", "duplicate-ledger"]) {
  test(`${scenario} ledger capture preserves actual rows or rejects inconsistent/duplicate inventory`, async (t) => {
    const f = await setup(t);
    f.expected.relations.push({ schema: "auth", name: "schema_migrations", kind: "r" });
    f.expected.columns.push({ schema: "auth", table: "schema_migrations", name: "version" });
    const h = harness(f.expected, scenario);
    if (scenario !== "success")
      await assert.rejects(captureStagingSnapshot(f.options, h.dependencies), redacted);
    else {
      const result = await captureStagingSnapshot(f.options, h.dependencies);
      const lineage = [
        {
          schema: "auth",
          name: "schema_migrations",
          present: true,
          rows: [{ version: "1" }, { version: "2" }, { version: "3" }],
        },
        { schema: "storage", name: "migrations", present: false },
        { schema: "supabase_migrations", name: "schema_migrations", present: false },
      ];
      assert.equal(result.snapshot.lineageDigest, canonicalDigest(lineage));
      assert.equal(result.source.lineageDigest, canonicalDigest(lineage));
    }
  });
}
