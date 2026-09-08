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
import { spawn, spawnSync } from "node:child_process";
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

test("abort after the producer has succeeded stops real suspended age and removes partial output", async (t) => {
  const options = await setup(t);
  const controller = new AbortController();
  let child,
    closed = false,
    forcedCleanup = false;
  const producerCompletion = Promise.resolve();
  const result = sealStream(
    {
      ...options,
      input: Readable.from(["synthetic"]),
      producerCompletion,
      signal: controller.signal,
    },
    {
      spawn(path, args, configuration) {
        child = spawn(path, args, configuration);
        child.kill("SIGSTOP");
        child.once("close", () => {
          closed = true;
        });
        setTimeout(() => controller.abort(), 25);
        return child;
      },
    },
  );
  const timer = setTimeout(() => {
    forcedCleanup = true;
    child?.kill("SIGKILL");
  }, 1500);
  t.after(() => {
    clearTimeout(timer);
    child?.kill("SIGKILL");
  });
  await assert.rejects(result, (error) => !error.message.includes("synthetic"));
  assert.equal(forcedCleanup, false, "abort must stop age without fallback cleanup");
  assert.equal(closed, true, "age must be reaped before rejection");
  assert.deepEqual(await readdir(options.workspace), ["synthetic-identity.txt"]);
});

test("abort waits for delayed age close and pipelines before cleaning the partial file", async (t) => {
  const options = await setup(t);
  const controller = new AbortController();
  let child,
    notifyStarted,
    settled = false,
    closeDelivered = false;
  const started = new Promise((resolve) => {
    notifyStarted = resolve;
  });
  const result = sealStream(
    {
      ...options,
      input: Readable.from(["synthetic"]),
      producerCompletion: Promise.resolve(),
      signal: controller.signal,
    },
    {
      spawn(path, args, configuration) {
        child = spawn(path, args, configuration);
        child.kill("SIGSTOP");
        const emit = child.emit;
        child.emit = function (event, ...args) {
          if (event === "close") {
            setTimeout(() => {
              closeDelivered = true;
              emit.call(this, event, ...args);
            }, 200);
            return true;
          }
          return emit.call(this, event, ...args);
        };
        notifyStarted();
        return child;
      },
    },
  );
  result.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  t.after(() => child?.kill("SIGKILL"));
  await started;
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(settled, false);
  assert.equal(closeDelivered, false);
  assert.ok((await readdir(options.workspace)).some((name) => name.endsWith(".partial")));
  await assert.rejects(result, /STREAM_ABORTED/);
  assert.equal(closeDelivered, true);
  assert.deepEqual(await readdir(options.workspace), ["synthetic-identity.txt"]);
});

test("pre-aborted or invalid signals launch no encryption process", async (t) => {
  const options = await setup(t);
  const controller = new AbortController();
  controller.abort();
  for (const signal of [controller.signal, {}]) {
    let launches = 0;
    await assert.rejects(
      sealStream(
        { ...options, input: Readable.from(["synthetic"]), signal },
        {
          spawn() {
            launches += 1;
            throw new Error("private-canary");
          },
        },
      ),
    );
    assert.equal(launches, 0);
  }
});

test("abort does not wait forever for an external producer promise owned by the caller", async (t) => {
  const options = await setup(t);
  const controller = new AbortController();
  const result = sealStream({
    ...options,
    input: Readable.from(["synthetic"]),
    producerCompletion: new Promise(() => {}),
    signal: controller.signal,
  });
  const timer = setTimeout(() => controller.abort(), 50);
  t.after(() => clearTimeout(timer));
  await assert.rejects(result, /STREAM_ABORTED/);
  assert.deepEqual(await readdir(options.workspace), ["synthetic-identity.txt"]);
});
