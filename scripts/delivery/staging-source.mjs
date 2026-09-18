import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { admitSuccessfulMain } from "./github.mjs";
import { DeliveryError, REPOSITORY, requireCondition, requireId, requireSha } from "./boundary.mjs";

const execute = promisify(execFile);
const REF = "refs/heads/staging";
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const SAFE_CODES = new Set([
  "STAGING_SOURCE_OPTIONS",
  "INVALID_ID",
  "INVALID_SHA",
  "RUN_REPOSITORY",
  "RUN_PROVENANCE",
  "RUN_SHA",
  "RUN_NOT_SUCCESSFUL",
  "MAIN_MOVED",
  "GITHUB_REQUEST_FAILED",
  "GITHUB_REQUEST_REJECTED",
  "GITHUB_RESPONSE_INVALID",
  "STAGING_SOURCE_CI_ID",
  "STAGING_SOURCE_REF_MISMATCH",
  "STAGING_CHECKOUT_ISOLATION",
  "STAGING_CHECKOUT_READ_FAILED",
  "STAGING_CHECKOUT_OBJECTS",
  "STAGING_CHECKOUT_REF",
  "STAGING_CHECKOUT_SHA",
  "STAGING_CHECKOUT_REPOSITORY",
  "STAGING_CHECKOUT_DIRTY",
  "STAGING_CHECKOUT_FILES",
  "STAGING_CHECKOUT_CONTENT",
]);

// Fixed local reads only. No shell, caller command/runner, ambient Git overrides,
// credential environment, hooks, fsmonitor, fetch or checkout operation.
async function git(cwd, args, code = "STAGING_CHECKOUT_READ_FAILED") {
  try {
    const { stdout } = await execute(
      "/usr/bin/git",
      ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args],
      {
        cwd,
        env: {
          PATH: "/usr/bin:/bin",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_NO_REPLACE_OBJECTS: "1",
          GIT_NO_LAZY_FETCH: "1",
          GIT_ALLOW_PROTOCOL: "",
        },
        timeout: 10000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    return stdout;
  } catch {
    throw new DeliveryError(code);
  }
}

async function inspectCheckout(root, sha) {
  requireCondition(
    (await realpath(root)) === root && (await lstat(root)).isDirectory(),
    "STAGING_CHECKOUT_ISOLATION",
  );
  const gitDirectory = join(root, ".git");
  const gitStat = await lstat(gitDirectory);
  requireCondition(
    gitStat.isDirectory() && !gitStat.isSymbolicLink(),
    "STAGING_CHECKOUT_ISOLATION",
  );
  try {
    await lstat(join(gitDirectory, "objects", "info", "alternates"));
    throw new DeliveryError("STAGING_CHECKOUT_ISOLATION");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  requireCondition(
    (await git(root, ["rev-parse", "--show-toplevel"])).trim() === root &&
      (await git(root, ["rev-parse", "--absolute-git-dir"])).trim() === gitDirectory &&
      resolve(root, (await git(root, ["rev-parse", "--git-common-dir"])).trim()) === gitDirectory &&
      (await git(root, ["rev-parse", "--show-object-format"])).trim() === "sha1",
    "STAGING_CHECKOUT_ISOLATION",
  );
  requireCondition(
    (await git(root, ["for-each-ref", "--format=%(refname)", "refs/replace/"])) === "",
    "STAGING_CHECKOUT_ISOLATION",
  );
  requireCondition(
    (await git(root, ["symbolic-ref", "--quiet", "HEAD"], "STAGING_CHECKOUT_REF")).trim() === REF,
    "STAGING_CHECKOUT_REF",
  );
  requireCondition((await git(root, ["rev-parse", "HEAD"])).trim() === sha, "STAGING_CHECKOUT_SHA");
  const origin = (await git(root, ["config", "--local", "--get-all", "remote.origin.url"])).trim();
  requireCondition(
    [`https://github.com/${REPOSITORY}.git`, `git@github.com:${REPOSITORY}.git`].includes(origin),
    "STAGING_CHECKOUT_REPOSITORY",
  );
  // Recursive ls-tree does not establish nested object integrity. Verify actual
  // loose/packed objects before treating their tree entries as the admitted SHA.
  await git(
    root,
    [
      "-c",
      "fsck.skipList=/dev/null",
      "fsck",
      "--full",
      "--strict",
      "--no-reflogs",
      "--no-dangling",
      "--no-progress",
      sha,
    ],
    "STAGING_CHECKOUT_OBJECTS",
  );
  const treeSha = requireSha((await git(root, ["rev-parse", "HEAD^{tree}"])).trim());
  const entries = (await git(root, ["ls-tree", "-rz", "HEAD"])).split("\0").filter(Boolean);
  requireCondition(entries.length > 0 && entries.length <= MAX_FILES, "STAGING_CHECKOUT_FILES");
  const tracked = new Map();
  const directories = new Set();
  for (const entry of entries) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\u0000-\u001f]+)$/.exec(entry);
    requireCondition(Boolean(match), "STAGING_CHECKOUT_FILES");
    const [, mode, blob, name] = match;
    requireCondition(
      !isAbsolute(name) &&
        name.split("/").every((part) => part && ![".", "..", ".git"].includes(part)) &&
        !tracked.has(name),
      "STAGING_CHECKOUT_FILES",
    );
    tracked.set(name, { mode, blob });
    for (let parent = dirname(name); parent !== "."; parent = dirname(parent))
      directories.add(parent);
  }
  // Compare index entries only. git status/diff may execute repository clean or
  // process filters; working bytes are independently verified below instead.
  const index = (await git(root, ["ls-files", "--stage", "-z"])).split("\0").filter(Boolean).sort();
  const expectedIndex = [...tracked]
    .map(([name, { mode, blob }]) => `${mode} ${blob} 0\t${name}`)
    .sort();
  requireCondition(
    index.length === expectedIndex.length && index.every((entry, i) => entry === expectedIndex[i]),
    "STAGING_CHECKOUT_DIRTY",
  );
  let totalBytes = 0;
  let files = 0;
  const walk = async (relative = "") => {
    for (const entry of await readdir(join(root, relative))) {
      if (!relative && entry === ".git") continue;
      const name = relative ? `${relative}/${entry}` : entry;
      const file = join(root, name);
      const stat = await lstat(file);
      requireCondition(!stat.isSymbolicLink(), "STAGING_CHECKOUT_FILES");
      if (stat.isDirectory()) {
        requireCondition(directories.has(name), "STAGING_CHECKOUT_FILES");
        await walk(name);
        continue;
      }
      const expected = tracked.get(name);
      requireCondition(
        expected && stat.isFile() && stat.nlink === 1 && stat.size <= MAX_FILE_BYTES,
        "STAGING_CHECKOUT_FILES",
      );
      totalBytes += stat.size;
      requireCondition(totalBytes <= MAX_TOTAL_BYTES, "STAGING_CHECKOUT_FILES");
      const hash = createHash("sha1").update(`blob ${stat.size}\0`);
      let bytesRead = 0;
      for await (const chunk of createReadStream(file)) {
        bytesRead += chunk.length;
        requireCondition(bytesRead <= stat.size, "STAGING_CHECKOUT_CONTENT");
        hash.update(chunk);
      }
      const blob = hash.digest("hex");
      requireCondition(
        bytesRead === stat.size &&
          blob === expected.blob &&
          ((stat.mode & 0o111) !== 0) === (expected.mode === "100755"),
        "STAGING_CHECKOUT_CONTENT",
      );
      files++;
    }
  };
  await walk();
  requireCondition(files === tracked.size, "STAGING_CHECKOUT_FILES");
  requireCondition(
    (await git(root, ["symbolic-ref", "--quiet", "HEAD"], "STAGING_CHECKOUT_REF")).trim() === REF &&
      (await git(root, ["rev-parse", "HEAD"])).trim() === sha,
    "STAGING_CHECKOUT_SHA",
  );
  return { treeSha, trackedFiles: files };
}

/**
 * Source-only prerequisite for fixed future composition, not a deployment entrypoint.
 * `github` must be the trusted createGitHub adapter; tests simulate its HTTP boundary.
 * No caller clean flag, file manifest, local metadata or saved PASS is accepted.
 */
export async function admitStagingSource(options) {
  try {
    requireCondition(
      options &&
        typeof options === "object" &&
        !Array.isArray(options) &&
        Object.keys(options).length === 4 &&
        Object.keys(options).every((key) =>
          ["github", "checkoutRoot", "ciRunId", "sourceSha"].includes(key),
        ),
      "STAGING_SOURCE_OPTIONS",
    );
    const { github, checkoutRoot, ciRunId, sourceSha } = options;
    requireCondition(
      typeof github?.request === "function" &&
        typeof checkoutRoot === "string" &&
        checkoutRoot.length < 4096 &&
        !/[\u0000-\u001f]/.test(checkoutRoot) &&
        isAbsolute(checkoutRoot) &&
        resolve(checkoutRoot) === checkoutRoot,
      "STAGING_SOURCE_OPTIONS",
    );
    requireId(ciRunId);
    requireCondition(Number.isSafeInteger(Number(ciRunId)), "INVALID_ID");
    requireSha(sourceSha);
    const authority = async () => {
      const run = await admitSuccessfulMain({ github, runId: ciRunId, sha: sourceSha });
      requireCondition(run.id === Number(ciRunId), "STAGING_SOURCE_CI_ID");
      const stage = await github.request("GET", "/git/ref/heads/staging");
      requireCondition(
        stage?.ref === REF && stage.object?.type === "commit" && stage.object.sha === sourceSha,
        "STAGING_SOURCE_REF_MISMATCH",
      );
    };
    await authority();
    const first = await inspectCheckout(checkoutRoot, sourceSha);
    await authority();
    const final = await inspectCheckout(checkoutRoot, sourceSha);
    requireCondition(first.treeSha === final.treeSha, "STAGING_CHECKOUT_SHA");
    return {
      status: "STAGING_SOURCE_PREFLIGHT_PASSED",
      repository: REPOSITORY,
      sourceSha,
      ciRunId,
      gitRef: REF,
      ...final,
      hostedDeploymentVerified: false,
      deploymentEligibility: "NOT_EVALUATED",
    };
  } catch (error) {
    throw new DeliveryError(
      error instanceof DeliveryError && SAFE_CODES.has(error.code)
        ? error.code
        : "STAGING_SOURCE_PREFLIGHT_FAILED",
    );
  }
}
