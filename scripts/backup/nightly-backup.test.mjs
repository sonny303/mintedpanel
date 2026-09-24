import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  backupRepository,
  backupDatabase,
  runNightlyBackup,
  resolveBinary,
  safeBackupError,
  validateDatabaseUrl,
  TARGET_CONFIGS,
} from "./nightly-backup.mjs";

const workflowPath = new URL("../../.github/workflows/scheduled-backup.yml", import.meta.url);
const execFileAsync = promisify(execFile);

test("scheduled backup workflow is production-only and uses the environment credential", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /- cron: "0 4 \* \* \*"/);
  assert.match(workflow, /jobs:\n  backup:\n[\s\S]*?environment: Production Backup/);
  assert.match(
    workflow,
    /SUPABASE_PRODUCTION_BACKUP_DATABASE_URL: \$\{\{ secrets\.SUPABASE_PRODUCTION_BACKUP_DATABASE_URL \}\}/,
  );
  assert.match(workflow, /--target-env production/);
  assert.match(workflow, /group: minted-scheduled-backup/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /uses: actions\/checkout@v4/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(
    workflow,
    /inputs\.environment|SUPABASE_ACCESS_TOKEN|SUPABASE_PRODUCTION_BACKUP_ACCESS_TOKEN|SUPABASE_NIGHTLYBACKUP_ACCESS_TOKEN/,
  );
  assert.doesNotMatch(workflow, /(?:^|[^A-Z_])DATABASE_URL(?:[^A-Z_]|$)/);
  assert.doesNotMatch(workflow, /- staging/);
});

test("nightly-backup: target configurations have required keys", () => {
  assert.ok(TARGET_CONFIGS.production);
  assert.ok(TARGET_CONFIGS.staging);

  assert.equal(TARGET_CONFIGS.production.ref, "fkvuhfsqcmujywzgczmc");
  assert.equal(TARGET_CONFIGS.staging.ref, "vmznysvietfaddakkegt");

  for (const env of ["production", "staging"]) {
    const config = TARGET_CONFIGS[env];
    assert.ok(config.host.endsWith(".pooler.supabase.com"));
    assert.equal(config.port, 5432);
    assert.equal(config.database, "postgres");
  }
});

test("nightly-backup: production accepts only the fixed direct and session pooler URLs", () => {
  const urls = [
    {
      databaseUrl:
        "postgresql://postgres:direct-password@db.fkvuhfsqcmujywzgczmc.supabase.co:5432/postgres",
      password: "direct-password",
    },
    {
      databaseUrl:
        "postgres://postgres.fkvuhfsqcmujywzgczmc:pooler-password@aws-0-us-east-2.pooler.supabase.com/postgres",
      password: "pooler-password",
    },
  ];

  for (const { databaseUrl, password } of urls) {
    assert.deepEqual(validateDatabaseUrl(databaseUrl, "production"), {
      host: new URL(databaseUrl).hostname,
      port: 5432,
      user: new URL(databaseUrl).hostname.includes("pooler")
        ? "postgres.fkvuhfsqcmujywzgczmc"
        : "postgres",
      expectedRole: "postgres",
      password,
      database: "postgres",
    });
  }

  const stagingUrl =
    "postgresql://postgres:staging-password@db.vmznysvietfaddakkegt.supabase.co/postgres";
  assert.deepEqual(validateDatabaseUrl(stagingUrl, "staging"), {
    host: "db.vmznysvietfaddakkegt.supabase.co",
    port: 5432,
    user: "postgres",
    expectedRole: "postgres",
    password: "staging-password",
    database: "postgres",
  });
  assert.throws(
    () => validateDatabaseUrl(urls[0].databaseUrl, "staging"),
    /Invalid backup database URL/,
  );
});

test("nightly-backup: URL component failures are rejected before psql or pg_dump", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "test-minted-invalid-database-url-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const invalidUrls = [
    "postgresql://postgres:password@db.other-project.supabase.co:5432/postgres",
    "postgresql://wrong-user:password@db.fkvuhfsqcmujywzgczmc.supabase.co:5432/postgres",
    "postgresql://postgres:password@aws-0-us-east-2.pooler.supabase.com:5432/postgres",
    "postgresql://postgres:password@db.fkvuhfsqcmujywzgczmc.supabase.co:6543/postgres",
    "postgresql://postgres:password@db.fkvuhfsqcmujywzgczmc.supabase.co:5432/wrong",
    "postgresql://postgres:password@db.fkvuhfsqcmujywzgczmc.supabase.co:5432/postgres#fragment",
    "not-a-database-url",
  ];

  for (const databaseUrl of invalidUrls) {
    let psqlCalls = 0;
    let processCalls = 0;
    await assert.rejects(
      () =>
        backupDatabase({
          workspace,
          targetEnv: "production",
          recipient: "age1testrecipient",
          databaseUrl,
          execFileImpl: async () => {
            psqlCalls += 1;
            return { stdout: "", stderr: "" };
          },
          spawnImpl: () => {
            processCalls += 1;
            throw new Error("process should not start");
          },
          resolveBinaryImpl: async () => "unused",
        }),
      (error) => {
        assert.match(error.message, /Invalid backup database URL/);
        assert.doesNotMatch(error.message, /password/);
        return true;
      },
    );
    assert.equal(psqlCalls, 0, databaseUrl);
    assert.equal(processCalls, 0, databaseUrl);
  }
});

test("nightly-backup: explicit database URL wins over a manual token", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "test-minted-database-url-priority-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const databaseUrl =
    "postgresql://postgres:priority-password@db.fkvuhfsqcmujywzgczmc.supabase.co:5432/postgres";
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("manual token path was used");
  };
  try {
    await assert.rejects(
      () =>
        backupDatabase({
          workspace,
          targetEnv: "production",
          recipient: "age1testrecipient",
          databaseUrl,
          supabaseToken: "manual-token",
          execFileImpl: async () => ({
            stdout: "postgres|wrong-role|wrong-role|f\n",
            stderr: "",
          }),
          spawnImpl: () => {
            throw new Error("pg_dump should not start");
          },
          resolveBinaryImpl: async () => "unused",
        }),
      /identity verification failed/,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("nightly-backup: identity mismatch fails before pg_dump and does not expose the password", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "test-minted-identity-mismatch-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const password = "identity-password";
  let psqlArgs;
  let psqlEnv;
  let processCalls = 0;
  const resolvedBinaries = [];
  await assert.rejects(
    () =>
      backupDatabase({
        workspace,
        targetEnv: "production",
        recipient: "age1testrecipient",
        databaseUrl: `postgresql://postgres:${password}@db.fkvuhfsqcmujywzgczmc.supabase.co:5432/postgres`,
        execFileImpl: async (file, args, options) => {
          assert.equal(file, "psql");
          psqlArgs = args;
          psqlEnv = options.env;
          return { stdout: "postgres|wrong-role|wrong-role|t\n", stderr: "" };
        },
        spawnImpl: () => {
          processCalls += 1;
          throw new Error("pg_dump should not start");
        },
        resolveBinaryImpl: async (name) => {
          resolvedBinaries.push(name);
          return name;
        },
      }),
    (error) => {
      assert.match(error.message, /identity verification failed/);
      assert.doesNotMatch(error.message, new RegExp(password));
      return true;
    },
  );
  assert.deepEqual(psqlArgs.slice(0, 3), ["-X", "-A", "-t"]);
  assert.match(
    psqlArgs.at(-1),
    /current_database\(\).*current_user.*session_user.*pg_is_in_recovery/,
  );
  assert.equal(psqlArgs.includes(password), false);
  assert.equal(psqlEnv.PGPASSWORD, password);
  assert.equal(processCalls, 0);
  assert.deepEqual(resolvedBinaries, ["psql"]);
});

test("nightly-backup: manual PAT flow creates the mapped role and launches pg_dump", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "test-minted-manual-pat-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const previousFetch = globalThis.fetch;
  const fetchCalls = [];
  const spawnCalls = [];
  let dumpStdout;
  const psqlPassword = "manual-role-password";
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    if (url.endsWith("/cli/login-role")) {
      return {
        ok: true,
        json: async () => ({ role: "manual-role", password: psqlPassword }),
      };
    }
    return { ok: true, json: async () => ({}) };
  };

  try {
    const result = await backupDatabase({
      workspace,
      targetEnv: "staging",
      recipient: "age1testrecipient",
      supabaseToken: "manual-token",
      execFileImpl: async (file, args, options) => {
        assert.equal(file, "psql");
        assert.equal(args[args.indexOf("-U") + 1], "manual-role.vmznysvietfaddakkegt");
        assert.equal(options.env.PGPASSWORD, psqlPassword);
        return { stdout: "postgres|manual-role|manual-role|f\n", stderr: "" };
      },
      resolveBinaryImpl: async (name) => name,
      spawnImpl: (file, args, options) => {
        spawnCalls.push({ file, args, options });
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        if (file === "pg_dump") dumpStdout = child.stdout;
        if (file === "age") {
          writeFileSync(args[args.indexOf("-o") + 1], "encrypted-test-output");
        }
        queueMicrotask(() => child.emit("close", 0));
        return child;
      },
    });

    assert.equal(result.status, "CAPTURED_AND_ENCRYPTED");
    assert.equal(fetchCalls.length, 2);
    assert.match(fetchCalls[0].url, /\/cli\/login-role$/);
    assert.match(fetchCalls[1].url, /\/database\/query$/);
    assert.equal(spawnCalls[0].file, "pg_dump");
    assert.equal(
      spawnCalls[0].args[spawnCalls[0].args.indexOf("-U") + 1],
      "manual-role.vmznysvietfaddakkegt",
    );
    assert.equal(spawnCalls[0].args.includes(psqlPassword), false);
    assert.equal(spawnCalls[0].options.env.PGPASSWORD, psqlPassword);
    assert.deepEqual(spawnCalls[0].options.stdio, ["ignore", "pipe", "ignore"]);
    assert.deepEqual(spawnCalls[1].options.stdio, [dumpStdout, "ignore", "ignore"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("nightly-backup: unexpected secret-bearing errors are sanitized at the function boundary", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "test-minted-backup-error-sanitization-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  assert.equal(safeBackupError(new Error("provider secret password=do-not-leak")), "Backup failed");
  await assert.rejects(
    () =>
      backupDatabase({
        workspace,
        targetEnv: "production",
        recipient: "age1testrecipient",
        databaseUrl:
          "postgresql://postgres:sanitized-password@db.fkvuhfsqcmujywzgczmc.supabase.co/postgres",
        execFileImpl: async () => ({ stdout: "postgres|postgres|postgres|f\n", stderr: "" }),
        resolveBinaryImpl: async (name) => {
          if (name === "psql") return name;
          throw new Error("injected provider secret=sanitized-password");
        },
        spawnImpl: () => {
          throw new Error("pg_dump should not start");
        },
      }),
    (error) => {
      assert.equal(error.message, "Backup failed");
      assert.doesNotMatch(error.message, /sanitized-password|provider secret/);
      return true;
    },
  );
});

test("nightly-backup: CLI boundary does not echo secret-bearing target input", async () => {
  const scriptPath = fileURLToPath(new URL("./nightly-backup.mjs", import.meta.url));
  await assert.rejects(
    () =>
      execFileAsync(process.execPath, [scriptPath, "--target-env", "secret-password"], {
        env: { ...process.env, SUPABASE_PRODUCTION_BACKUP_DATABASE_URL: undefined },
      }),
    (error) => {
      assert.match(error.stderr, /Unknown backup target environment/);
      assert.doesNotMatch(error.stderr, /secret-password/);
      return true;
    },
  );
});

test("nightly-backup: staging does not consume the production URL environment value", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "test-minted-staging-url-isolation-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const previousProductionUrl = process.env.SUPABASE_PRODUCTION_BACKUP_DATABASE_URL;
  process.env.SUPABASE_PRODUCTION_BACKUP_DATABASE_URL =
    "postgresql://postgres:production-password@db.fkvuhfsqcmujywzgczmc.supabase.co:5432/postgres";
  try {
    await assert.rejects(
      () => backupDatabase({ workspace, targetEnv: "staging" }),
      /Missing backup credential/,
    );
  } finally {
    if (previousProductionUrl === undefined) {
      delete process.env.SUPABASE_PRODUCTION_BACKUP_DATABASE_URL;
    } else {
      process.env.SUPABASE_PRODUCTION_BACKUP_DATABASE_URL = previousProductionUrl;
    }
  }
});

test("nightly-backup: resolveBinary finds standard binaries", async () => {
  const gitPath = await resolveBinary("git");
  assert.ok(gitPath.includes("git"));
});

test("nightly-backup: rejects unknown targets instead of defaulting to production", async () => {
  await assert.rejects(
    () => runNightlyBackup({ targetEnv: "unknown", dryRun: true }),
    /Unknown backup target environment/,
  );
});

test("nightly-backup: staging never consumes the production default credential", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "test-minted-staging-credential-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const previousProductionToken = process.env.SUPABASE_PRODUCTION_BACKUP_ACCESS_TOKEN;
  process.env.SUPABASE_PRODUCTION_BACKUP_ACCESS_TOKEN = "production-only-token";
  try {
    await assert.rejects(
      () => backupDatabase({ workspace, targetEnv: "staging" }),
      /Missing backup credential/,
    );
  } finally {
    if (previousProductionToken === undefined) {
      delete process.env.SUPABASE_PRODUCTION_BACKUP_ACCESS_TOKEN;
    } else {
      process.env.SUPABASE_PRODUCTION_BACKUP_ACCESS_TOKEN = previousProductionToken;
    }
  }
});

test("nightly-backup: non-dry database backup fails without a credential", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "test-minted-db-missing-credential-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const previousProductionToken = process.env.SUPABASE_PRODUCTION_BACKUP_ACCESS_TOKEN;
  delete process.env.SUPABASE_PRODUCTION_BACKUP_ACCESS_TOKEN;
  try {
    await assert.rejects(
      () => backupDatabase({ workspace, targetEnv: "production" }),
      /Missing backup credential/,
    );
  } finally {
    if (previousProductionToken !== undefined) {
      process.env.SUPABASE_PRODUCTION_BACKUP_ACCESS_TOKEN = previousProductionToken;
    }
  }
});

test("nightly-backup: backupRepository creates valid bundle and manifest", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "test-minted-repo-backup-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const result = await backupRepository({ workspace, targetEnv: "production" });

  assert.ok(result.bundlePath);
  assert.ok(result.checksumPath);
  assert.ok(result.manifestPath);

  // Check bundle file exists and is non-empty
  const bundleStat = await stat(result.bundlePath);
  assert.ok(bundleStat.isFile());
  assert.ok(bundleStat.size > 0);

  // Check manifest contents
  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.targetEnv, "production");
  assert.equal(manifest.artifactType, "git-bundle");
  assert.equal(typeof manifest.sha256, "string");
  assert.equal(manifest.sha256.length, 64);
  assert.equal(manifest.byteSize, bundleStat.size);
  assert.ok(manifest.git.headSha);

  // Check checksum file matches
  const checksumFileContent = await readFile(result.checksumPath, "utf8");
  assert.ok(checksumFileContent.startsWith(manifest.sha256));
});

test("nightly-backup: backupDatabase dry-run mode emits SKIPPED_DRY_RUN", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "test-minted-db-dryrun-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const result = await backupDatabase({
    workspace,
    targetEnv: "production",
    dryRun: true,
  });

  assert.equal(result.status, "SKIPPED_DRY_RUN");
  assert.ok(result.captureManifestPath);

  const manifest = JSON.parse(await readFile(result.captureManifestPath, "utf8"));
  assert.equal(manifest.status, "SKIPPED_DRY_RUN");
  assert.equal(manifest.target.ref, "fkvuhfsqcmujywzgczmc");
});

test("nightly-backup: runNightlyBackup executes full dry-run workflow", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "test-minted-nightly-run-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const results = await runNightlyBackup({
    workspace,
    targetEnv: "production",
    dryRun: true,
  });

  assert.equal(results.targetEnv, "production");
  assert.ok(results.repo);
  assert.ok(results.database);
  assert.equal(results.database.status, "SKIPPED_DRY_RUN");
  assert.ok(results.summaryPath);

  const summary = JSON.parse(await readFile(results.summaryPath, "utf8"));
  assert.equal(summary.targetEnv, "production");
  assert.equal(summary.repo.manifest.targetEnv, "production");
  assert.equal(summary.database.status, "SKIPPED_DRY_RUN");
});
