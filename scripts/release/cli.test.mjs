import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { canonicalDigest } from "./contract.mjs";
import { fixture, rebind, NOW } from "./test-fixtures.mjs";

const cli = fileURLToPath(new URL("./validate.mjs", import.meta.url));
const sentinel = "private-sentinel-do-not-log";

async function inputs(t) {
  const directory = await mkdtemp(join(tmpdir(), "minted-release-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const delta = Date.now() - Date.parse(NOW) - 1000;
  const value = JSON.parse(JSON.stringify(fixture()), (_key, item) =>
    typeof item === "string" && /^2026-09-08T/.test(item)
      ? new Date(Date.parse(item) + delta).toISOString()
      : item,
  );
  // Updating the staging verification time changes the context's digest.
  rebind(value);
  for (const field of ["record", "policy", "observed"])
    await writeFile(join(directory, `${field}.json`), JSON.stringify(value[field]), {
      mode: 0o600,
    });
  const args = [
    "--record",
    join(directory, "record.json"),
    "--policy",
    join(directory, "policy.json"),
    "--observed",
    join(directory, "observed.json"),
    "--target",
    "production",
  ];
  return { directory, args, value };
}

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 16384,
  });
  assert.equal(result.signal, null);
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, "");
  assert.ok(!result.stdout.includes(sentinel));
  return { status: result.status, result: JSON.parse(result.stdout) };
}

test("CLI validates and pins a record without writing input files", async (t) => {
  const { args, value } = await inputs(t);
  const expected = canonicalDigest(value.record);
  const output = run([...args, "--expected-digest", expected]);
  assert.equal(output.status, 0);
  assert.deepEqual(output.result, { ok: true, digest: expected });
});

test("CLI fails an altered approved digest with status 1", async (t) => {
  const { args } = await inputs(t);
  const output = run([...args, "--expected-digest", "0".repeat(64)]);
  assert.equal(output.status, 1);
  assert.deepEqual(output.result, {
    ok: false,
    errors: [{ code: "DIGEST_MISMATCH", path: "record" }],
  });
});

test("CLI enforces an explicit target with no Preview default", async (t) => {
  const { args } = await inputs(t);
  assert.equal(run(args.slice(0, -2)).status, 2);
  const output = run([...args.slice(0, -1), "preview"]);
  assert.equal(output.status, 1);
  assert.deepEqual(output.result.errors, [{ code: "EXPECTED_TARGET", path: "expectedTarget" }]);
});

test("CLI rejects unknown/duplicate flags and malformed arguments without echoing them", async (t) => {
  const { args } = await inputs(t);
  for (const extra of [
    [`--${sentinel}`, sentinel],
    ["--target", sentinel],
    ["--expected-digest"],
  ]) {
    const output = run([...args, ...extra]);
    assert.equal(output.status, 2);
    assert.deepEqual(output.result.errors, [{ code: "ARGUMENTS", path: "arguments" }]);
  }
});

test("CLI handles malformed/missing/oversized/nonregular JSON as static safe failures", async (t) => {
  const { directory, args } = await inputs(t);
  const badFile = join(directory, `${sentinel}.json`);
  for (const contents of [`{ "${sentinel}":`, " ".repeat(1048577)]) {
    await writeFile(badFile, contents, { mode: 0o600 });
    const output = run(["--record", badFile, ...args.slice(2)]);
    assert.equal(output.status, 2);
    assert.deepEqual(output.result.errors, [{ code: "INPUT_FILE", path: "record" }]);
  }
  const link = join(directory, "link.json");
  await symlink(join(directory, "record.json"), link);
  for (const path of [join(directory, "missing.json"), directory, link]) {
    const output = run(["--record", path, ...args.slice(2)]);
    assert.equal(output.status, 2);
    assert.deepEqual(output.result.errors, [{ code: "INPUT_FILE", path: "record" }]);
  }
});

test("CLI bounds schema errors and does not echo unknown keys or values", async (t) => {
  const { args, directory } = await inputs(t);
  const value = { [sentinel]: sentinel };
  await writeFile(join(directory, "record.json"), JSON.stringify(value));
  const output = run(args);
  assert.equal(output.status, 1);
  assert.ok(output.result.errors.length <= 32);
  assert.ok(output.result.errors.every((item) => item.code === "SCHEMA"));
});
