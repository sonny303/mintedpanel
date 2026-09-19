import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RecoveryError } from "./contract.mjs";
import { captureStagingSnapshot } from "./export.mjs";
import {
  loadSupabaseAccessToken,
  observeStagingProvider,
  withStagingLoginRole,
} from "./provider.mjs";

const fail = () => new RecoveryError("RECOVERY_BACKUP_REJECTED");
const check = (condition) => {
  if (!condition) throw fail();
};

export async function captureLiveStagingBackup(
  { workspace, recipient, signal } = {},
  dependencies = {},
) {
  const loadToken = dependencies.loadToken ?? loadSupabaseAccessToken;
  const observe = dependencies.observe ?? observeStagingProvider;
  const withLogin = dependencies.withLogin ?? withStagingLoginRole;
  const capture = dependencies.capture ?? captureStagingSnapshot;
  const save = dependencies.save ?? writeFile;
  try {
    check(
      typeof workspace === "string" &&
        workspace.startsWith("/") &&
        typeof recipient === "string" &&
        /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(recipient) &&
        (signal === undefined || signal instanceof AbortSignal),
    );
    const token = await loadToken();
    const observation = await observe({ token });
    const sourceObserved = {
      capturedAt: observation.capturedAt,
      source: observation.source,
    };
    const { output: captured, lifecycle } = await withLogin({
      token,
      operation: (credentials) =>
        capture({
          ...credentials,
          sourceObserved,
          workspace,
          recipient,
          ...(signal ? { signal } : {}),
        }),
    });
    const result = {
      version: 1,
      status: "CAPTURED_ONLY",
      providerDigest: observation.providerDigest,
      loginRoleLifecycle: lifecycle,
      captured,
    };
    await save(`${workspace}/capture.json`, `${JSON.stringify(result, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return result;
  } catch {
    throw fail();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [operation, workspaceFlag, workspace, recipientFlag, recipient, ...extra] =
      process.argv.slice(2);
    check(
      operation === "capture" &&
        workspaceFlag === "--workspace" &&
        recipientFlag === "--recipient" &&
        extra.length === 0,
    );
    const result = await captureLiveStagingBackup({ workspace, recipient });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stdout.write('{"ok":false,"code":"RECOVERY_BACKUP_REJECTED"}\n');
    process.exitCode = 2;
  }
}
