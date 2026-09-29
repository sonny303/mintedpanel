import { pathToFileURL } from "node:url";
import { cleanupExpiredStagingLoginRole, loadSupabaseAccessToken } from "./provider.mjs";

const SHA = /^[a-f0-9]{64}$/;

export async function runCleanup(args) {
  if (
    args.length !== 3 ||
    args[0] !== "cleanup" ||
    args[1] !== "--expected-inventory-digest" ||
    !SHA.test(args[2])
  )
    throw new Error("STAGING_ROLE_CLEANUP_REJECTED");
  const token = await loadSupabaseAccessToken();
  return cleanupExpiredStagingLoginRole({ token, expectedInventoryDigest: args[2] });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runCleanup(process.argv.slice(2)))}\n`);
  } catch {
    process.stderr.write('{"status":"BLOCKED","code":"STAGING_ROLE_CLEANUP_REJECTED"}\n');
    process.exitCode = 2;
  }
}
