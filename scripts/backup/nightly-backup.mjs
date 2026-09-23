import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

export const TARGET_CONFIGS = Object.freeze({
  production: Object.freeze({
    ref: "fkvuhfsqcmujywzgczmc",
    name: "mintedpanel-production",
    region: "us-east-2",
    host: "aws-0-us-east-2.pooler.supabase.com",
    port: 5432,
    database: "postgres",
  }),
  staging: Object.freeze({
    ref: "vmznysvietfaddakkegt",
    name: "mintedpanel-staging",
    region: "ca-central-1",
    host: "aws-0-ca-central-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
  }),
});

export function getTargetConfig(targetEnv) {
  if (!Object.hasOwn(TARGET_CONFIGS, targetEnv)) {
    throw new Error("Unknown backup target environment");
  }
  return TARGET_CONFIGS[targetEnv];
}

export const PRODUCTION_DATABASE_URL_ENV = "SUPABASE_PRODUCTION_BACKUP_DATABASE_URL";

const SAFE_ERROR_PATTERNS = [
  /^Unknown backup target environment$/,
  /^Invalid backup database URL$/,
  /^Missing backup credential: provide databaseUrl or supabaseToken explicitly; production requires SUPABASE_PRODUCTION_BACKUP_DATABASE_URL$/,
  /^Missing recipient public age key \(set BACKUP_AGE_RECIPIENT or pass --recipient\)$/,
  /^Backup database identity verification failed$/,
  /^Failed to create ephemeral backup role$/,
  /^Invalid ephemeral backup role response$/,
  /^Backup failed: pg_dump \(code (?:\d+|null)\); age \(code (?:\d+|null)\)$/,
  /^Backup failed$/,
];

function directDatabaseHost(target) {
  return `db.${target.ref}.supabase.co`;
}

export function validateDatabaseUrl(databaseUrl, targetEnv = "production") {
  const target = getTargetConfig(targetEnv);
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Invalid backup database URL");
  }

  let password;
  try {
    password = decodeURIComponent(parsed.password);
  } catch {
    throw new Error("Invalid backup database URL");
  }

  const isPooler = parsed.hostname === target.host;
  const expectedWireUser = isPooler ? `postgres.${target.ref}` : "postgres";
  const allowedHosts = new Set([directDatabaseHost(target), target.host]);
  const effectivePort = parsed.port || String(target.port);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !allowedHosts.has(parsed.hostname) ||
    parsed.username !== expectedWireUser ||
    effectivePort !== String(target.port) ||
    parsed.pathname !== `/${target.database}` ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    password.length === 0
  ) {
    throw new Error("Invalid backup database URL");
  }

  return Object.freeze({
    host: parsed.hostname,
    port: target.port,
    user: expectedWireUser,
    expectedRole: "postgres",
    password,
    database: target.database,
  });
}

export function safeBackupError(error) {
  const message = error instanceof Error ? error.message : "";
  return SAFE_ERROR_PATTERNS.some((pattern) => pattern.test(message)) ? message : "Backup failed";
}

async function verifyDatabaseIdentity({ connection, environment, psqlBin, execFileImpl }) {
  let result;
  try {
    result = await execFileImpl(
      psqlBin,
      [
        "-X",
        "-A",
        "-t",
        "-h",
        connection.host,
        "-p",
        String(connection.port),
        "-U",
        connection.user,
        "-d",
        connection.database,
        "-c",
        "SELECT current_database(), current_user, session_user, pg_is_in_recovery();",
      ],
      { env: environment, encoding: "utf8", maxBuffer: 64 * 1024 },
    );
  } catch {
    throw new Error("Backup database identity verification failed");
  }

  const identity = String(result.stdout ?? "")
    .trim()
    .split("|")
    .map((value) => value.trim());
  const [database, currentUser, sessionUser, recovery] = identity;
  if (
    identity.length !== 4 ||
    database !== connection.database ||
    currentUser !== connection.expectedRole ||
    sessionUser !== connection.expectedRole ||
    !["f", "false"].includes(recovery)
  ) {
    throw new Error("Backup database identity verification failed");
  }
}

/**
 * Locate executable binary looking in PATH, then standard fallbacks.
 */
export async function resolveBinary(name, searchPaths = []) {
  try {
    const { stdout } = await execFileAsync("which", [name]);
    const found = stdout.trim();
    if (found) return found;
  } catch {
    // search explicit paths
  }
  for (const candidate of searchPaths) {
    try {
      const s = await stat(candidate);
      if (s.isFile()) return candidate;
    } catch {
      // not found
    }
  }
  return name; // default to bare command
}

/**
 * Capture Git Repository state into an immutable git bundle.
 */
export async function backupRepository({
  workspace,
  repoDir = REPO_ROOT,
  targetEnv = "production",
}) {
  getTargetConfig(targetEnv);
  const repoOutputDir = join(workspace, "repo");
  await mkdir(repoOutputDir, { recursive: true, mode: 0o700 });

  // 1. Gather Git metadata
  const { stdout: headSha } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });
  const { stdout: headBranch } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoDir,
  });
  const { stdout: commitDate } = await execFileAsync("git", ["log", "-1", "--format=%cI"], {
    cwd: repoDir,
  });
  const { stdout: tags } = await execFileAsync("git", ["tag", "-l"], { cwd: repoDir });

  const sha = headSha.trim();
  const branch = headBranch.trim();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bundleFilename = `mintedpanel-repo-${targetEnv}-${timestamp}-${sha.slice(0, 10)}.bundle`;
  const bundlePath = join(repoOutputDir, bundleFilename);
  const checksumPath = `${bundlePath}.sha256`;
  const manifestPath = join(repoOutputDir, "manifest.json");

  // 2. Create bundle with all refs and tags
  await execFileAsync("git", ["bundle", "create", bundlePath, "--all"], { cwd: repoDir });

  // 3. Verify bundle
  await execFileAsync("git", ["bundle", "verify", bundlePath], { cwd: repoDir });

  // 4. Compute SHA-256 Checksum
  const bundleBuffer = await readFile(bundlePath);
  const sha256 = createHash("sha256").update(bundleBuffer).digest("hex");
  await writeFile(checksumPath, `${sha256}  ${bundleFilename}\n`, "utf8");

  const manifest = {
    version: 1,
    artifactType: "git-bundle",
    targetEnv,
    bundleFilename,
    sha256,
    byteSize: bundleBuffer.length,
    git: {
      headSha: sha,
      branch,
      commitDate: commitDate.trim(),
      tags: tags.trim().split("\n").filter(Boolean),
    },
    createdAt: new Date().toISOString(),
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    bundlePath,
    checksumPath,
    manifestPath,
    manifest,
  };
}

/**
 * Run pg_dump and stream stdout directly through age encryption.
 */
export async function backupDatabase({
  workspace,
  targetEnv = "production",
  recipient,
  dryRun = false,
  supabaseToken,
  databaseUrl,
  execFileImpl = execFileAsync,
  spawnImpl = spawn,
  resolveBinaryImpl = resolveBinary,
}) {
  const target = getTargetConfig(targetEnv);
  const resolvedDatabaseUrl =
    databaseUrl !== undefined
      ? databaseUrl
      : targetEnv === "production"
        ? process.env[PRODUCTION_DATABASE_URL_ENV]
        : undefined;
  const resolvedSupabaseToken = supabaseToken;
  const dbOutputDir = join(workspace, "database");
  await mkdir(dbOutputDir, { recursive: true, mode: 0o700 });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const captureManifestPath = join(dbOutputDir, "capture.json");

  if (dryRun) {
    const dryRunNotice = {
      version: 1,
      status: "SKIPPED_DRY_RUN",
      target,
      timestamp: new Date().toISOString(),
      reason: "Explicit --dry-run requested",
    };
    await writeFile(captureManifestPath, `${JSON.stringify(dryRunNotice, null, 2)}\n`, "utf8");
    return {
      status: "SKIPPED_DRY_RUN",
      target,
      captureManifestPath,
    };
  }

  if (resolvedDatabaseUrl === undefined && !resolvedSupabaseToken) {
    throw new Error(
      `Missing backup credential: provide databaseUrl or supabaseToken explicitly; production requires ${PRODUCTION_DATABASE_URL_ENV}`,
    );
  }

  if (!recipient) {
    throw new Error(
      "Missing recipient public age key (set BACKUP_AGE_RECIPIENT or pass --recipient)",
    );
  }

  const dumpFilename = `mintedpanel-db-${targetEnv}-${timestamp}-${target.ref}.dump.age`;
  const dumpPath = join(dbOutputDir, dumpFilename);

  let connectionParams = {};
  let ephemeralRole = null;

  try {
    // 1. Resolve connection parameters
    if (resolvedDatabaseUrl !== undefined) {
      connectionParams = validateDatabaseUrl(resolvedDatabaseUrl, targetEnv);
    } else if (resolvedSupabaseToken) {
      // Ephemeral login role via Supabase Management API
      // Request read_only: true since backups only perform pg_dump read operations
      let res = await fetch(`https://api.supabase.com/v1/projects/${target.ref}/cli/login-role`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resolvedSupabaseToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ read_only: true }),
      });

      if (!res.ok) {
        // Fallback to read_only: false in case project policy mandates it
        const fallbackRes = await fetch(
          `https://api.supabase.com/v1/projects/${target.ref}/cli/login-role`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resolvedSupabaseToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ read_only: false }),
          },
        );
        if (fallbackRes.ok) {
          res = fallbackRes;
        } else {
          throw new Error("Failed to create ephemeral backup role");
        }
      }

      const roleData = await res.json();
      if (
        !roleData ||
        typeof roleData.role !== "string" ||
        roleData.role.length === 0 ||
        typeof roleData.password !== "string" ||
        roleData.password.length === 0
      ) {
        throw new Error("Invalid ephemeral backup role response");
      }
      ephemeralRole = roleData.role;
      connectionParams = {
        host: target.host,
        port: target.port,
        user: `${roleData.role}.${target.ref}`,
        expectedRole: roleData.role,
        password: roleData.password,
        database: target.database,
      };
    }

    const connection = Object.freeze({ ...connectionParams });
    const databaseEnvironment = Object.freeze({
      ...process.env,
      PGPASSWORD: connection.password,
      PGSSLMODE: "require",
    });

    const psqlBin = await resolveBinaryImpl("psql", [
      "/opt/homebrew/opt/libpq/bin/psql",
      "/opt/homebrew/Cellar/libpq@17/17.10/bin/psql",
      "/usr/lib/postgresql/17/bin/psql",
      "/usr/bin/psql",
    ]);

    // Verify the immutable connection before resolving or launching pg_dump.
    await verifyDatabaseIdentity({
      connection,
      environment: databaseEnvironment,
      psqlBin,
      execFileImpl,
    });

    const ageBin = await resolveBinaryImpl("age", [
      "/opt/homebrew/bin/age",
      "/usr/bin/age",
      "/usr/local/bin/age",
    ]);

    const pgDumpBin = await resolveBinaryImpl("pg_dump", [
      "/opt/homebrew/Cellar/libpq@17/17.10/bin/pg_dump",
      "/usr/lib/postgresql/17/bin/pg_dump",
      "/usr/bin/pg_dump",
    ]);

    // 2. Stream pg_dump directly into age
    const pgDumpArgs = [
      "-h",
      connection.host,
      "-p",
      String(connection.port),
      "-U",
      connection.user,
      "-d",
      connection.database,
      "--format=custom",
      "--quote-all-identifiers",
      "--lock-wait-timeout=10s",
      "--no-password",
    ];

    const ageArgs = ["-r", recipient, "-o", dumpPath];

    const dumpProcess = spawnImpl(pgDumpBin, pgDumpArgs, {
      env: databaseEnvironment,
      stdio: ["ignore", "pipe", "ignore"],
    });

    const ageProcess = spawnImpl(ageBin, ageArgs, {
      stdio: [dumpProcess.stdout, "ignore", "ignore"],
    });

    const [dumpExit, ageExit] = await Promise.all([
      new Promise((res, rej) => {
        dumpProcess.on("close", res);
        dumpProcess.on("error", rej);
      }),
      new Promise((res, rej) => {
        ageProcess.on("close", res);
        ageProcess.on("error", rej);
      }),
    ]);

    if (dumpExit !== 0 || ageExit !== 0) {
      throw new Error(`Backup failed: pg_dump (code ${dumpExit}); age (code ${ageExit})`);
    }

    // 3. Compute ciphertext digest and stats
    const cipherBuffer = await readFile(dumpPath);
    const cipherSha256 = createHash("sha256").update(cipherBuffer).digest("hex");

    const captureManifest = {
      version: 1,
      status: "CAPTURED_AND_ENCRYPTED",
      target,
      dumpFilename,
      cipherSha256,
      cipherSizeBytes: cipherBuffer.length,
      createdAt: new Date().toISOString(),
    };

    await writeFile(captureManifestPath, `${JSON.stringify(captureManifest, null, 2)}\n`, "utf8");

    return {
      status: "CAPTURED_AND_ENCRYPTED",
      target,
      dumpPath,
      captureManifestPath,
      captureManifest,
    };
  } catch (error) {
    throw new Error(safeBackupError(error));
  } finally {
    // 4. Drop ephemeral role immediately if one was created
    if (ephemeralRole && resolvedSupabaseToken) {
      try {
        await fetch(`https://api.supabase.com/v1/projects/${target.ref}/database/query`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resolvedSupabaseToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '${ephemeralRole}'; DROP ROLE IF EXISTS "${ephemeralRole}";`,
          }),
        });
      } catch {
        // Expiry fallback
      }
    }
  }
}

/**
 * Main coordinator function.
 */
export async function runNightlyBackup(options = {}) {
  const targetEnv = options.targetEnv ?? process.env.BACKUP_TARGET_ENV ?? "production";
  getTargetConfig(targetEnv);
  const backupRepoFlag = options.backupRepo ?? true;
  const backupDbFlag = options.backupDb ?? true;
  const dryRun = options.dryRun ?? false;
  const recipient = options.recipient ?? process.env.BACKUP_AGE_RECIPIENT;
  const supabaseToken = options.supabaseToken;
  const databaseUrl = options.databaseUrl;

  const workspace = options.workspace ?? (await mkdtemp(join(tmpdir(), "minted-backup-")));
  await chmod(workspace, 0o700);

  const results = {
    version: 1,
    targetEnv,
    workspace,
    timestamp: new Date().toISOString(),
    repo: null,
    database: null,
  };

  try {
    if (backupRepoFlag) {
      results.repo = await backupRepository({ workspace, targetEnv });
    }

    if (backupDbFlag) {
      results.database = await backupDatabase({
        workspace,
        targetEnv,
        recipient,
        dryRun,
        supabaseToken,
        databaseUrl,
      });
    }

    const summaryPath = join(workspace, "summary.json");
    await writeFile(summaryPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
    results.summaryPath = summaryPath;

    // GitHub Step Summary output if running in Actions
    if (process.env.GITHUB_STEP_SUMMARY) {
      const summaryLines = [
        `## 🛡️ Minted Panel Nightly Backup Summary`,
        `**Target Environment**: \`${targetEnv}\``,
        `**Timestamp**: \`${results.timestamp}\``,
        "",
        "### Artifacts Generated",
        "| Category | File | Size | SHA-256 | Status |",
        "| :--- | :--- | :--- | :--- | :--- |",
      ];

      if (results.repo) {
        summaryLines.push(
          `| **Repository** | \`${results.repo.manifest.bundleFilename}\` | ${results.repo.manifest.byteSize} bytes | \`${results.repo.manifest.sha256.slice(0, 16)}...\` | ✅ Complete |`,
        );
      }

      if (results.database) {
        if (results.database.status === "CAPTURED_AND_ENCRYPTED") {
          summaryLines.push(
            `| **Database** | \`${results.database.captureManifest.dumpFilename}\` | ${results.database.captureManifest.cipherSizeBytes} bytes | \`${results.database.captureManifest.cipherSha256.slice(0, 16)}...\` | 🔒 Encrypted (age) |`,
          );
        } else {
          summaryLines.push(
            `| **Database** | \`capture.json\` | N/A | N/A | ℹ️ ${results.database.status} |`,
          );
        }
      }

      summaryLines.push("");
      await writeFile(process.env.GITHUB_STEP_SUMMARY, summaryLines.join("\n"), { flag: "a" });
    }

    return results;
  } catch (error) {
    const publicError = safeBackupError(error);
    results.error = publicError;
    throw new Error(publicError);
  }
}

// CLI entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const envIndex = args.indexOf("--target-env");
  const targetEnv = envIndex !== -1 ? args[envIndex + 1] : "production";
  const recipientIndex = args.indexOf("--recipient");
  const recipient =
    recipientIndex !== -1 ? args[recipientIndex + 1] : process.env.BACKUP_AGE_RECIPIENT;
  const workspaceIndex = args.indexOf("--workspace");
  const workspace = workspaceIndex !== -1 ? args[workspaceIndex + 1] : undefined;
  const backupRepo = args.includes("--no-repo") ? false : true;
  const backupDb = args.includes("--no-db") ? false : true;

  runNightlyBackup({ workspace, targetEnv, dryRun, recipient, backupRepo, backupDb })
    .then((results) => {
      process.stdout.write(`Backup completed successfully.\nWorkspace: ${results.workspace}\n`);
    })
    .catch((err) => {
      process.stderr.write(`Backup failed: ${safeBackupError(err)}\n`);
      process.exitCode = 1;
    });
}
