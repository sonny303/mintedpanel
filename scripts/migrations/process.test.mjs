import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "./database.mjs";

async function probeDatabase(t, script, connectionString) {
  const root = await mkdtemp(join(tmpdir(), "minted-migration-process-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binary = join(root, "probe.mjs");
  await writeFile(binary, `#!${process.execPath}\n${script}`, { mode: 0o700 });
  const database = await createDatabase({
    root,
    inventory: [],
    connectionString,
    binaries: { psql: binary, supabase: binary },
  });
  t.after(() => database.close());
  return { root, database };
}

test("subprocess credentials stay out of argv and temporary credentials are removed", async (t) => {
  const secret = "synthetic:p@ss\\word%with spaces";
  const record = join(await mkdtemp(join(tmpdir(), "minted-process-record-")), "record.jsonl");
  t.after(() => rm(join(record, ".."), { recursive: true, force: true }));
  const { database } = await probeDatabase(
    t,
    `import { appendFileSync, readFileSync, statSync } from "node:fs";
     let sql = "";
     for await (const chunk of process.stdin) sql += chunk;
     const passfile = process.env.PGPASSFILE;
     appendFileSync(${JSON.stringify(record)}, JSON.stringify({
       args: process.argv.slice(2), env: process.env,
       passfile: passfile ? readFileSync(passfile, "utf8") : null,
       mode: passfile ? statSync(passfile).mode & 0o777 : null,
       directoryMode: statSync(process.cwd()).mode & 0o777,
       sqlReceived: sql.endsWith("ROLLBACK;\\n")
     }) + "\\n");
     process.stdout.write(sql ? '1234567890123456789\\n[]\\n{}\\n' : '2.117.0\\n');`,
    `postgresql://postgres:${encodeURIComponent(secret)}@127.0.0.1:5432/postgres?sslmode=disable`,
  );
  await database.version();
  await database.snapshot();
  await database.push({ dryRun: true });
  await database.push({ dryRun: false });
  const calls = (await readFile(record, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.ok(!JSON.stringify(call.args).includes(secret));
    assert.ok(!JSON.stringify(call.args).includes(encodeURIComponent(secret)));
    assert.equal(call.env.PGPASSWORD, undefined);
    assert.equal(call.env.SUPABASE_DB_PASSWORD, undefined);
    assert.equal(call.env.HOME, undefined);
    assert.equal(call.env.SUPABASE_ACCESS_TOKEN, undefined);
    assert.equal(call.directoryMode, 0o700);
  }
  assert.equal(calls[0].env.SUPABASE_DB_PASSWORD, undefined);
  assert.equal(calls[0].env.PGPASSFILE, undefined);
  const snapshot = calls[1];
  assert.equal(snapshot.env.SUPABASE_DB_PASSWORD, undefined);
  assert.equal(snapshot.mode, 0o600);
  assert.equal(
    snapshot.passfile,
    "127.0.0.1:5432:postgres:postgres:synthetic\\:p@ss\\\\word%with spaces\n",
  );
  assert.equal(snapshot.sqlReceived, true);
  for (const push of calls.slice(2)) {
    assert.equal(push.env.PGPASSFILE, snapshot.env.PGPASSFILE);
    assert.equal(push.mode, 0o600);
    assert.equal(push.passfile, snapshot.passfile);
    assert.equal(
      push.args[push.args.indexOf("--db-url") + 1],
      "postgresql://postgres@127.0.0.1:5432/postgres?sslmode=disable",
    );
  }
  await database.close();
  await assert.rejects(readFile(snapshot.env.PGPASSFILE), { code: "ENOENT" });
});

test("child exit before reading SQL yields a sanitized error instead of uncaught EPIPE", async (t) => {
  const { database } = await probeDatabase(
    t,
    'process.stdin.destroy(); process.stderr.write("synthetic-secret-error"); process.exit(7);',
    "postgresql://postgres:synthetic-secret@127.0.0.1:5432/postgres",
  );
  await assert.rejects(database.snapshot(), (error) => {
    assert.equal(error.code, "MIGRATION_COMMAND_FAILED");
    assert.equal(error.message, "MIGRATION_COMMAND_FAILED");
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("unusable password bytes fail before a credential file or command is created", async () => {
  for (const password of ["bad%0Aline", "bad%0Dline", "bad%00byte", "%invalid"]) {
    await assert.rejects(
      createDatabase({
        root: "/unused",
        inventory: [],
        connectionString: `postgresql://postgres:${password}@127.0.0.1:5432/postgres`,
      }),
      { code: "DATABASE_URL_REJECTED" },
    );
  }
});
