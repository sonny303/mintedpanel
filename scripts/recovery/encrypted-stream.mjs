import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, realpath, open, link, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, parse } from "node:path";
import { spawn } from "node:child_process";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ARTIFACT_NAMES, RecoveryError, requireCondition } from "./contract.mjs";

const MAX_BYTES = 1024 * 1024 * 1024;
const MAX_DURATION_MS = 15 * 60 * 1000;
const fileFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const artifactName = (name) => ARTIFACT_NAMES.includes(name);

// Reject symlinks throughout private paths and any location inside a Git checkout.
async function privatePath(path, isDirectory) {
  requireCondition(isAbsolute(path), "PRIVATE_PATH_REQUIRED");
  requireCondition((await realpath(path)) === path, "PRIVATE_PATH_REQUIRED");
  let current = path;
  while (current !== parse(current).root) {
    requireCondition(!(await lstat(current)).isSymbolicLink(), "PRIVATE_PATH_REQUIRED");
    let git;
    try {
      git = await lstat(join(current, ".git"));
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    requireCondition(!git, "OUTSIDE_GIT_REQUIRED");
    current = dirname(current);
  }
  const stat = await lstat(path);
  requireCondition(
    stat.uid === process.getuid() &&
      (stat.mode & 0o077) === 0 &&
      (isDirectory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1),
    "PRIVATE_PATH_REQUIRED",
  );
}

async function binary(path) {
  requireCondition(isAbsolute(path), "TRUSTED_AGE_REQUIRED");
  const resolved = await realpath(path);
  const stat = await lstat(resolved);
  requireCondition(
    stat.isFile() &&
      (stat.mode & 0o022) === 0 &&
      (stat.mode & 0o111) !== 0 &&
      (stat.uid === 0 || stat.uid === process.getuid()),
    "TRUSTED_AGE_REQUIRED",
  );
  // The operator must pin/verify the binary separately; a path is not attestation.
  return resolved;
}

function counter() {
  const hash = createHash("sha256");
  let bytes = 0;
  const stream = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) return callback(new RecoveryError("STREAM_LIMIT"));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  return { stream, result: () => ({ sha256: hash.digest("hex"), bytes }) };
}

function launch(age, args) {
  const child = spawn(age, args, {
    stdio: ["pipe", "pipe", "ignore"],
    env: { PATH: "/usr/bin:/bin", LANG: "C" },
  });
  const completion = new Promise((resolve, reject) => {
    child.once("error", () => reject(new RecoveryError("AGE_FAILED")));
    child.once("close", (code, signal) => {
      if (code === 0 && !signal) resolve();
      else reject(new RecoveryError("AGE_FAILED"));
    });
  });
  // Attach a handler immediately: the process can fail before streams are ready.
  completion.catch(() => {});
  return { child, completion };
}

function fileWriter(handle) {
  return new Writable({
    write(chunk, encoding, callback) {
      (async () => {
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
          requireCondition(bytesWritten > 0, "SEAL_FAILED");
          offset += bytesWritten;
        }
      })().then(() => callback(), callback);
    },
  });
}

function fileReader(handle) {
  return Readable.from(
    (async function* () {
      while (true) {
        const buffer = Buffer.alloc(64 * 1024);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length);
        if (bytesRead === 0) return;
        yield buffer.subarray(0, bytesRead);
      }
    })(),
  );
}

async function transfer({ child, completion, input, output, producerCompletion }) {
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      input.destroy();
      output.destroy();
      reject(new RecoveryError("STREAM_TIMEOUT"));
    }, MAX_DURATION_MS);
  });
  try {
    const jobs = [pipeline(input, child.stdin), pipeline(child.stdout, output), completion];
    if (producerCompletion) jobs.push(producerCompletion);
    await Promise.race([
      deadline,
      Promise.all(
        jobs.map((job) =>
          Promise.resolve(job).catch((error) => {
            child.kill("SIGKILL");
            throw error;
          }),
        ),
      ),
    ]);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

// This seals bytes only. A complete backup still requires an independent successful
// exporter, all scope evidence, and a fresh decryption/restore check.
// A coordinator with a subprocess exporter MUST pass its exit-status promise.
export async function sealStream({
  input,
  workspace,
  name,
  recipient,
  ageBinary,
  producerCompletion,
}) {
  const producer = producerCompletion ? Promise.resolve(producerCompletion) : undefined;
  producer?.catch(() => {});
  let partial;
  let handle;
  try {
    requireCondition(
      input && typeof input.pipe === "function" && typeof input.destroy === "function",
      "INVALID_INPUT_STREAM",
    );
    requireCondition(artifactName(name), "INVALID_NAME");
    requireCondition(
      typeof recipient === "string" &&
        /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(recipient),
      "INVALID_RECIPIENT",
    );
    await privatePath(workspace, true);
    const age = await binary(ageBinary);
    partial = join(workspace, `.${name}-${randomBytes(8).toString("hex")}.partial`);
    handle = await open(
      partial,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    const plain = counter();
    const encrypted = counter();
    const process = launch(age, ["--encrypt", "--recipient", recipient]);
    const inputDone = pipeline(input, plain.stream);
    const outputDone = pipeline(encrypted.stream, fileWriter(handle));
    inputDone.catch(() => {});
    outputDone.catch(() => {});
    await transfer({
      ...process,
      input: plain.stream,
      output: encrypted.stream,
      producerCompletion: Promise.all([inputDone, outputDone, producer]),
    });
    requireCondition(plain.result().bytes > 0, "EMPTY_STREAM");
    const result = encrypted.result();
    await handle.sync();
    await handle.close();
    handle = undefined;
    // link is atomic and refuses to overwrite any existing artifact/symlink.
    await link(partial, join(workspace, `${name}.age`));
    await unlink(partial);
    partial = undefined;
    return { name, ...result };
  } catch (error) {
    throw error instanceof RecoveryError ? error : new RecoveryError("SEAL_FAILED");
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (partial) await unlink(partial).catch(() => {});
  }
}

export async function verifySealed({ workspace, name, identityPath, ageBinary }) {
  let artifact;
  let identity;
  try {
    requireCondition(artifactName(name), "INVALID_NAME");
    await privatePath(workspace, true);
    await privatePath(identityPath, false);
    await privatePath(dirname(identityPath), true);
    const age = await binary(ageBinary);
    identity = await open(identityPath, fileFlags);
    const identityStat = await identity.stat();
    requireCondition(identityStat.size <= 2048, "INVALID_IDENTITY");
    const identityText = await identity.readFile("utf8");
    // Native age identity only; no plugins, SSH agents or identities in argv.
    requireCondition(
      /^(?:#[^\r\n]*\r?\n)*AGE-SECRET-KEY-1[023456789ACDEFGHJKLMNPQRSTUVWXYZ]{58}\r?\n?$/.test(
        identityText,
      ),
      "INVALID_IDENTITY",
    );
    await identity.close();
    identity = undefined;
    const path = join(workspace, `${name}.age`);
    await privatePath(path, false);
    artifact = await open(path, fileFlags);
    requireCondition((await artifact.stat()).size <= MAX_BYTES, "STREAM_LIMIT");
    const encrypted = counter();
    const plaintext = counter();
    const sink = new Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    });
    const process = launch(age, ["--decrypt", "--identity", identityPath]);
    const inputDone = pipeline(fileReader(artifact), encrypted.stream);
    const outputDone = pipeline(plaintext.stream, sink);
    inputDone.catch(() => {});
    outputDone.catch(() => {});
    await transfer({
      ...process,
      input: encrypted.stream,
      output: plaintext.stream,
      producerCompletion: Promise.all([inputDone, outputDone]),
    });
    requireCondition(plaintext.result().bytes > 0, "EMPTY_STREAM");
    return { name, ...encrypted.result() };
  } catch (error) {
    throw error instanceof RecoveryError ? error : new RecoveryError("VERIFY_FAILED");
  } finally {
    if (artifact) await artifact.close().catch(() => {});
    if (identity) await identity.close().catch(() => {});
  }
}
