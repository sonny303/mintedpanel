import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { validateRelease } from "./contract.mjs";

const failure = (code, path) => ({ ok: false, errors: [{ code, path }] });
const flags = new Set(["--record", "--policy", "--observed", "--target", "--expected-digest"]);
const options = {};
let result;
let exitCode = 2;

// Local bounded regular files only. Never print file paths, data, or exceptions.
async function readJson(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1048576) throw new Error("INPUT_FILE");
    const buffer = Buffer.alloc(1048577);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > 1048576) throw new Error("INPUT_FILE");
    return JSON.parse(buffer.subarray(0, length).toString("utf8"));
  } finally {
    await handle.close();
  }
}

try {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flags.has(flag) || Object.hasOwn(options, flag) || !value || value.startsWith("--"))
      throw new Error("ARGUMENTS");
    options[flag] = value;
  }
  if (
    !["--record", "--policy", "--observed", "--target"].every((flag) =>
      Object.hasOwn(options, flag),
    )
  )
    throw new Error("ARGUMENTS");
} catch {
  result = failure("ARGUMENTS", "arguments");
}

if (!result) {
  const inputs = {};
  for (const field of ["record", "policy", "observed"]) {
    try {
      inputs[field] = await readJson(options[`--${field}`]);
    } catch {
      result = failure("INPUT_FILE", field);
      break;
    }
  }
  if (!result) {
    try {
      result = validateRelease({
        ...inputs,
        expectedTarget: options["--target"],
        expectedDigest: options["--expected-digest"],
        now: new Date().toISOString(),
      });
      exitCode = result.ok ? 0 : 1;
    } catch {
      result = failure("INVALID_INPUT", "input");
    }
  }
}
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = exitCode;
