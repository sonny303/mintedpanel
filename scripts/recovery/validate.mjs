import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { validateRehearsal } from "./contract.mjs";

async function readMetadata(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error();
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > 1024 * 1024) throw new Error();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)));
  } finally {
    await handle.close();
  }
}

try {
  const required = ["backup", "observed", "restore", "target", "run-id", "socket"];
  const args = process.argv.slice(2);
  if (args.length !== required.length * 2) throw new Error();
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2);
    if (args[i] !== `--${key}` || !required.includes(key) || Object.hasOwn(options, key))
      throw new Error();
    options[key] = args[i + 1];
  }
  const [backup, observed, restore, target] = await Promise.all(
    ["backup", "observed", "restore", "target"].map((name) => readMetadata(options[name])),
  );
  const result = validateRehearsal({
    backup,
    observed,
    restore,
    target,
    expectedRunId: options["run-id"],
    expectedSocket: options.socket,
    now: new Date().toISOString(),
  });
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} catch {
  process.stderr.write('{"ok":false,"code":"RECOVERY_EVIDENCE_REJECTED"}\n');
  process.exitCode = 2;
}
