import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backupRepository,
  backupDatabase,
  runNightlyBackup,
  resolveBinary,
  TARGET_CONFIGS,
} from "./nightly-backup.mjs";

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

test("nightly-backup: resolveBinary finds standard binaries", async () => {
  const gitPath = await resolveBinary("git");
  assert.ok(gitPath.includes("git"));
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
