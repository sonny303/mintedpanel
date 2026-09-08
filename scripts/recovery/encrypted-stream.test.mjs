import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  chmod,
  writeFile,
  readFile,
  rm,
  readdir,
  stat,
  symlink,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { sealStream, verifySealed } from "./encrypted-stream.mjs";

const binDirectory = process.platform === "darwin" ? "/opt/homebrew/bin" : "/usr/bin";
const ageBinary = join(binDirectory, "age");
const keygen = join(binDirectory, "age-keygen");
assert.equal(spawnSync(ageBinary, ["--version"]).status, 0, "Install age before recovery tests");
assert.equal(
  spawnSync(keygen, ["--version"]).status,
  0,
  "Install age-keygen before recovery tests",
);
async function setup(t) {
  const workspace = await mkdtemp(join(realpathSync(tmpdir()), "minted-recovery-synthetic-"));
  await chmod(workspace, 0o700);
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const key = spawnSync(keygen, [], { encoding: "utf8" });
  assert.equal(key.status, 0);
  const identityPath = join(workspace, "synthetic-identity.txt");
  await writeFile(identityPath, key.stdout, { mode: 0o600 });
  const recipient = spawnSync(keygen, ["-y", identityPath], { encoding: "utf8" }).stdout.trim();
  return { workspace, identityPath, recipient, ageBinary, name: "synthetic" };
}
test("real age stream round-trip creates only encrypted bytes and digest metadata", async (t) => {
  const options = await setup(t);
  const secret = "synthetic-sensitive-canary-".repeat(10000);
  const result = await sealStream({ ...options, input: Readable.from([secret]) });
  const bytes = await readFile(join(options.workspace, "synthetic.age"));
  assert.ok(!bytes.includes(Buffer.from("synthetic-sensitive-canary")));
  assert.equal((await stat(join(options.workspace, "synthetic.age"))).mode & 0o777, 0o600);
  assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(await verifySealed(options), result);
  assert.deepEqual((await readdir(options.workspace)).sort(), [
    "synthetic-identity.txt",
    "synthetic.age",
  ]);
});
test("corrupt ciphertext cannot verify", async (t) => {
  const options = await setup(t);
  await sealStream({ ...options, input: Readable.from(["synthetic-value"]) });
  const path = join(options.workspace, "synthetic.age");
  const bytes = await readFile(path);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(path, bytes);
  await assert.rejects(verifySealed(options), /AGE_FAILED/);
});
test("upstream failure never publishes an artifact", async (t) => {
  const options = await setup(t);
  const input = Readable.from(
    (async function* () {
      yield "synthetic-partial";
      throw new Error("private-source-error");
    })(),
  );
  await assert.rejects(
    sealStream({ ...options, input }),
    (error) => !error.message.includes("private-source-error"),
  );
  assert.deepEqual(await readdir(options.workspace), ["synthetic-identity.txt"]);
});
test("late exporter failure never publishes an artifact", async (t) => {
  const options = await setup(t);
  const producerCompletion = new Promise((resolve, reject) =>
    setTimeout(() => reject(new Error("private-upstream-error")), 100),
  );
  await assert.rejects(
    sealStream({ ...options, input: Readable.from(["synthetic-partial"]), producerCompletion }),
  );
  assert.deepEqual(await readdir(options.workspace), ["synthetic-identity.txt"]);
});

test("immediate exporter failure is handled before filesystem setup", async (t) => {
  const options = await setup(t);
  await assert.rejects(
    sealStream({
      ...options,
      input: Readable.from(["synthetic"]),
      producerCompletion: Promise.reject(new Error("private-source-error")),
    }),
  );
  assert.deepEqual(await readdir(options.workspace), ["synthetic-identity.txt"]);
});
test("empty stream never publishes an artifact", async (t) => {
  const options = await setup(t);
  await assert.rejects(sealStream({ ...options, input: Readable.from([]) }), /EMPTY_STREAM/);
  assert.deepEqual(await readdir(options.workspace), ["synthetic-identity.txt"]);
});
test("existing artifact is preserved", async (t) => {
  const options = await setup(t);
  await sealStream({ ...options, input: Readable.from(["first"]) });
  const before = await readFile(join(options.workspace, "synthetic.age"));
  await assert.rejects(sealStream({ ...options, input: Readable.from(["second"]) }));
  assert.deepEqual(await readFile(join(options.workspace, "synthetic.age")), before);
});
test("private path and identity constraints fail closed", async (t) => {
  const options = await setup(t);
  await chmod(options.workspace, 0o755);
  await assert.rejects(
    sealStream({ ...options, input: Readable.from(["private"]) }),
    /PRIVATE_PATH_REQUIRED/,
  );
  await chmod(options.workspace, 0o700);
  await mkdir(join(options.workspace, ".git"));
  await assert.rejects(
    sealStream({ ...options, input: Readable.from(["private"]) }),
    /OUTSIDE_GIT_REQUIRED/,
  );
});
test("symlink ciphertext is never followed", async (t) => {
  const options = await setup(t);
  await symlink(options.identityPath, join(options.workspace, "synthetic.age"));
  await assert.rejects(verifySealed(options), /PRIVATE_PATH_REQUIRED/);
});
test("CLI failure output never reflects supplied paths, arguments or source bytes", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/recovery/seal.mjs", "restore", "--secret", "private-canary"],
    {
      input: "source-content-canary",
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, '{"ok":false,"code":"RECOVERY_STREAM_REJECTED"}\n');
});
