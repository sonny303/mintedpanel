import { sealStream, verifySealed } from "./encrypted-stream.mjs";

// No DB connection, credential acquisition, shell, plaintext output or restore path.
try {
  const [operation, ...arguments_] = process.argv.slice(2);
  const allowed =
    operation === "seal"
      ? ["workspace", "name", "recipient", "age"]
      : operation === "verify"
        ? ["workspace", "name", "identity", "age"]
        : [];
  if (!allowed.length || arguments_.length !== allowed.length * 2) throw new Error();
  const options = {};
  for (let i = 0; i < arguments_.length; i += 2) {
    const key = arguments_[i].slice(2);
    if (arguments_[i] !== `--${key}` || !allowed.includes(key) || Object.hasOwn(options, key))
      throw new Error();
    options[key] = arguments_[i + 1];
  }
  const shared = { workspace: options.workspace, name: options.name, ageBinary: options.age };
  const artifact =
    operation === "seal"
      ? await sealStream({ ...shared, input: process.stdin, recipient: options.recipient })
      : await verifySealed({ ...shared, identityPath: options.identity });
  process.stdout.write(
    `${JSON.stringify({ ok: true, status: operation === "seal" ? "ENCRYPTED_ONLY" : "DECRYPTION_VERIFIED_ONLY", artifact })}\n`,
  );
} catch {
  process.stderr.write('{"ok":false,"code":"RECOVERY_STREAM_REJECTED"}\n');
  process.exitCode = 2;
}
