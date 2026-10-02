// Source-bound identity for the disposable E6.12 Nitro build.
// This helper never reads environment values or credentials.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = join(root, ".output", "server", ".e612-build-manifest.json");
const roots = [
  "src",
  "scripts/security/e612-fixtures.mjs",
  "scripts/security/e612-http-driver.mjs",
  "scripts/security/e612-m66-legacy-post-probes.mjs",
  "scripts/security/e613-http-probes.mjs",
  "scripts/security/e614-http-stream-fixtures.mjs",
  "scripts/security/e614-http-stream-probes.mjs",
  "scripts/security/e612-profile-http-fixtures.mjs",
  "scripts/security/e612-profile-http-probes.mjs",
  "scripts/security/e612-m64-fixtures.mjs",
  "scripts/security/e614-enrollment-report-native.mjs",
  "scripts/security/e614-report-fixtures.mjs",
  "scripts/security/verify-e612-client-access.mjs",
  "scripts/security/verify-e612-client-access-http.mjs",
  "scripts/security/verify-m64-workflow-browser.mjs",
  "scripts/security/e612-build-manifest.mjs",
  "supabase/migrations",
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "nitro.config.ts",
];

function filesUnder(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return [];
  try {
    const entries = readdirSync(absolute, { withFileTypes: true });
    return entries.flatMap((entry) => {
      const child = join(absolute, entry.name);
      return entry.isDirectory() ? filesUnder(relative(root, child)) : [relative(root, child)];
    });
  } catch {
    return [path];
  }
  return [path];
}

function sourceFiles() {
  return [...new Set(roots.flatMap(filesUnder))].sort();
}

function runtimeFiles() {
  return filesUnder(".output/server")
    .filter((file) => statSync(join(root, file)).isFile())
    .filter((file) => file !== ".output/server/.e612-build-manifest.json")
    .sort();
}

function clientFiles() {
  return filesUnder(".output/public")
    .filter((file) => statSync(join(root, file)).isFile())
    .sort();
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function hashFiles(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash
      .update(file)
      .update("\0")
      .update(readFileSync(join(root, file)))
      .update("\0");
  }
  return hash.digest("hex");
}

export function buildManifest() {
  const files = sourceFiles();
  const bundleFiles = runtimeFiles();
  const publicFiles = clientFiles();
  if (!bundleFiles.includes(".output/server/index.mjs"))
    throw new Error("E612_BUILD_BUNDLE_MISSING");
  // TanStack Start serves route HTML through Nitro SSR; builds need not emit
  // a public index.html. Bind the actual client bundle/static assets instead.
  if (!publicFiles.some((file) => file.endsWith(".js")))
    throw new Error("E612_BUILD_CLIENT_BUNDLE_MISSING");
  return {
    format: 3,
    gitHead: gitHead(),
    sourceFiles: files,
    sourceSha256: hashFiles(files),
    bundleFiles,
    bundleSha256: hashFiles(bundleFiles),
    clientFiles: publicFiles,
    clientSha256: hashFiles(publicFiles),
  };
}

export function writeManifest() {
  const manifest = buildManifest();
  mkdirSync(join(root, ".output", "server"), { recursive: true });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(
    `E612|BUILD|PASS|git=${manifest.gitHead}|source=${manifest.sourceSha256}|server=${manifest.bundleSha256}|client=${manifest.clientSha256}\n`,
  );
  return manifest;
}

if (process.argv.includes("--write")) writeManifest();
