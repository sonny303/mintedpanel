import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  realpath,
  writeFile,
  mkdir,
  rm,
  symlink,
  link,
  chmod,
  access,
  copyFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitHub } from "./github.mjs";
import { assertHostedReady, REPOSITORY, WORKFLOWS } from "./boundary.mjs";

const execute = promisify(execFile);
const git = async (cwd, ...args) =>
  (
    await execute("/usr/bin/git", args, {
      cwd,
      env: {
        PATH: "/usr/bin:/bin",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_AUTHOR_NAME: "Synthetic fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "Synthetic fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
    })
  ).stdout.trim();

// Real local repositories; only GitHub HTTP responses are simulated. No hosted writes.
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "minted-stage-source-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkoutRoot = join(root, "checkout");
  await mkdir(checkoutRoot);
  await git(checkoutRoot, "init", "--initial-branch=staging");
  await git(checkoutRoot, "remote", "add", "origin", `https://github.com/${REPOSITORY}.git`);
  await writeFile(join(checkoutRoot, ".gitignore"), ".env\nnode_modules/\noutput/\n");
  await writeFile(join(checkoutRoot, "app.js"), "export const fixture = true;\n");
  await git(checkoutRoot, "add", ".");
  await git(checkoutRoot, "commit", "-m", "Synthetic source");
  const sha = await git(checkoutRoot, "rev-parse", "HEAD");
  const treeSha = await git(checkoutRoot, "rev-parse", "HEAD^{tree}");
  const state = {
    root,
    checkoutRoot,
    sha,
    treeSha,
    mainSha: sha,
    stageSha: sha,
    calls: [],
    run: {
      id: 23,
      repository: { full_name: REPOSITORY },
      head_repository: { full_name: REPOSITORY },
      path: WORKFLOWS.ci,
      event: "push",
      head_branch: "main",
      head_sha: sha,
      status: "completed",
      conclusion: "success",
    },
  };
  state.github = createGitHub({
    token: "synthetic-token",
    fetcher: async (url, options) => {
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.ok(url.startsWith(`https://api.github.com/repos/${REPOSITORY}/`));
      const path = new URL(url).pathname.slice(`/repos/${REPOSITORY}`.length);
      state.calls.push(path);
      await state.beforeRead?.(path);
      let value;
      if (path === "/actions/runs/23") value = state.run;
      else if (path === "/git/ref/heads/main") value = { object: { sha: state.mainSha } };
      else if (path === "/git/ref/heads/staging")
        value = {
          ref: state.refName ?? "refs/heads/staging",
          object: { type: "commit", sha: state.stageSha },
        };
      else assert.fail("Unexpected GitHub request");
      return new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  state.admit = async (extra = {}) => {
    const { admitStagingSource } = await import("./staging-source.mjs");
    return admitStagingSource({
      github: state.github,
      checkoutRoot: state.checkoutRoot,
      ciRunId: "23",
      sourceSha: state.sha,
      ...extra,
    });
  };
  return state;
}

test("real staging checkout and authenticated current main source produce bounded prerequisite only", async (t) => {
  const s = await fixture(t);
  const result = await s.admit();
  assert.deepEqual(result, {
    status: "STAGING_SOURCE_PREFLIGHT_PASSED",
    repository: REPOSITORY,
    sourceSha: s.sha,
    ciRunId: "23",
    gitRef: "refs/heads/staging",
    treeSha: s.treeSha,
    trackedFiles: 2,
    hostedDeploymentVerified: false,
    deploymentEligibility: "NOT_EVALUATED",
  });
  assert.equal(JSON.stringify(result).includes(s.root), false);
  assert.equal(JSON.stringify(result).includes("synthetic-token"), false);
  assert.equal(s.calls.filter((path) => path === "/actions/runs/23").length, 3);
  assert.equal(s.calls.filter((path) => path === "/git/ref/heads/main").length, 3);
  assert.equal(s.calls.filter((path) => path === "/git/ref/heads/staging").length, 3);
  assert.throws(assertHostedReady, { code: "HOSTED_ACTIVATION_BLOCKED" });
});

for (const [name, mutate, code] of [
  [
    "failed CI",
    (s) => {
      s.run.conclusion = "failure";
    },
    "RUN_NOT_SUCCESSFUL",
  ],
  [
    "fork CI",
    (s) => {
      s.run.head_repository.full_name = "other/repo";
    },
    "RUN_REPOSITORY",
  ],
  [
    "non-main CI",
    (s) => {
      s.run.head_branch = "staging";
    },
    "RUN_PROVENANCE",
  ],
  [
    "different workflow",
    (s) => {
      s.run.path = ".github/workflows/other.yml";
    },
    "RUN_PROVENANCE",
  ],
  [
    "stale main",
    (s) => {
      s.mainSha = "a".repeat(40);
    },
    "MAIN_MOVED",
  ],
  [
    "remote staging differs",
    (s) => {
      s.stageSha = "a".repeat(40);
    },
    "STAGING_SOURCE_REF_MISMATCH",
  ],
  [
    "forged remote ref label",
    (s) => {
      s.refName = "refs/heads/main";
    },
    "STAGING_SOURCE_REF_MISMATCH",
  ],
]) {
  test(`source admission rejects ${name}`, async (t) => {
    const s = await fixture(t);
    await mutate(s);
    await assert.rejects(s.admit(), { code });
  });
}

for (const [name, mutate, code] of [
  [
    "non-staging branch",
    (s) => git(s.checkoutRoot, "checkout", "-b", "main"),
    "STAGING_CHECKOUT_REF",
  ],
  ["detached checkout", (s) => git(s.checkoutRoot, "checkout", "--detach"), "STAGING_CHECKOUT_REF"],
  [
    "tracked content changed",
    (s) => writeFile(join(s.checkoutRoot, "app.js"), "changed\n"),
    "STAGING_CHECKOUT_CONTENT",
  ],
  [
    "ordinary untracked file",
    (s) => writeFile(join(s.checkoutRoot, "extra.txt"), "untracked\n"),
    "STAGING_CHECKOUT_FILES",
  ],
  [
    "ignored secret file",
    (s) => writeFile(join(s.checkoutRoot, ".env"), "SYNTHETIC_SECRET=never-return-this\n"),
    "STAGING_CHECKOUT_FILES",
  ],
  [
    "ignored directory secret",
    async (s) => {
      await mkdir(join(s.checkoutRoot, "output"));
      await writeFile(join(s.checkoutRoot, "output", "secret.txt"), "never-return-this");
    },
    "STAGING_CHECKOUT_FILES",
  ],
  [
    "tracked bytes hidden by assume-unchanged",
    async (s) => {
      await git(s.checkoutRoot, "update-index", "--assume-unchanged", "app.js");
      await writeFile(join(s.checkoutRoot, "app.js"), "hidden-change\n");
    },
    "STAGING_CHECKOUT_CONTENT",
  ],
  [
    "tracked bytes hidden by skip-worktree",
    async (s) => {
      await git(s.checkoutRoot, "update-index", "--skip-worktree", "app.js");
      await writeFile(join(s.checkoutRoot, "app.js"), "hidden-change\n");
    },
    "STAGING_CHECKOUT_CONTENT",
  ],
  [
    "forged local metadata",
    async (s) => {
      await mkdir(join(s.checkoutRoot, ".vercel"));
      await writeFile(
        join(s.checkoutRoot, ".vercel", "project.json"),
        '{"gitBranch":"staging","clean":true}\n',
      );
    },
    "STAGING_CHECKOUT_FILES",
  ],
  [
    "local divergent commit",
    async (s) => {
      await writeFile(join(s.checkoutRoot, "app.js"), "diverged\n");
      await git(s.checkoutRoot, "commit", "-am", "Divergent source");
    },
    "STAGING_CHECKOUT_SHA",
  ],
  [
    "noncanonical repository origin",
    (s) => git(s.checkoutRoot, "remote", "set-url", "origin", "https://github.com/other/repo.git"),
    "STAGING_CHECKOUT_REPOSITORY",
  ],
]) {
  test(`real Git inspection rejects ${name}`, async (t) => {
    const s = await fixture(t);
    await mutate(s);
    await assert.rejects(s.admit(), { code });
  });
}

test("source admission rechecks authority and local files after inspection", async (t) => {
  const s = await fixture(t);
  let stages = 0;
  s.beforeRead = async (path) => {
    if (path === "/git/ref/heads/staging" && ++stages === 2)
      await writeFile(join(s.checkoutRoot, ".env"), "never-return-this");
  };
  await assert.rejects(s.admit(), { code: "STAGING_CHECKOUT_FILES" });
});

test("main moving during inspection rejects the previously admitted source", async (t) => {
  const s = await fixture(t);
  let reads = 0;
  s.beforeRead = (path) => {
    if (path === "/git/ref/heads/main" && ++reads === 2) s.mainSha = "b".repeat(40);
  };
  await assert.rejects(s.admit(), { code: "MAIN_MOVED" });
});

test("repeating a previously passing preflight discovers a later ignored secret", async (t) => {
  const s = await fixture(t);
  await s.admit();
  await writeFile(join(s.checkoutRoot, ".env"), "never-return-this");
  await assert.rejects(s.admit(), { code: "STAGING_CHECKOUT_FILES" });
});

test("caller clean booleans, metadata, target and execution seams are not admission options", async (t) => {
  const s = await fixture(t);
  for (const extra of [
    { clean: true },
    { gitBranch: "staging" },
    { target: "preview" },
    { run() {} },
    { metadata: { clean: true } },
  ])
    await assert.rejects(s.admit(extra), { code: "STAGING_SOURCE_OPTIONS" });
  assert.equal(s.calls.length, 0);
});

test("linked worktrees and symlinked checkout roots are not isolated clones", async (t) => {
  const s = await fixture(t);
  const linked = join(s.root, "linked");
  await git(s.checkoutRoot, "worktree", "add", "--detach", linked);
  await assert.rejects(s.admit({ checkoutRoot: linked }), { code: "STAGING_CHECKOUT_ISOLATION" });
  const symbolic = join(s.root, "symbolic");
  await symlink(s.checkoutRoot, symbolic);
  await assert.rejects(s.admit({ checkoutRoot: symbolic }), { code: "STAGING_CHECKOUT_ISOLATION" });
});

test("unexpected provider errors expose only a fixed code", async (t) => {
  const s = await fixture(t);
  await assert.rejects(
    s.admit({
      github: {
        request() {
          throw new Error("never-return-this");
        },
      },
    }),
    {
      code: "STAGING_SOURCE_PREFLIGHT_FAILED",
      message: "STAGING_SOURCE_PREFLIGHT_FAILED",
    },
  );
});

test("matching remote SHA cannot substitute a different CI run identity", async (t) => {
  const s = await fixture(t);
  s.run.id = 24;
  await assert.rejects(s.admit(), { code: "STAGING_SOURCE_CI_ID" });
});

test("staging moving during inspection rejects the earlier ref", async (t) => {
  const s = await fixture(t);
  let stages = 0;
  s.beforeRead = (path) => {
    if (path === "/git/ref/heads/staging" && ++stages === 2) s.stageSha = "b".repeat(40);
  };
  await assert.rejects(s.admit(), { code: "STAGING_SOURCE_REF_MISMATCH" });
});

test("main tip moving after it was read in the last pre-inspect authority round must reject", async (t) => {
  const s = await fixture(t);
  let stages = 0;
  s.beforeRead = (path) => {
    // Corrupt main after that round already accepted it (main is read before
    // staging). queueMicrotask runs before the awaited staging payload bind.
    if (path === "/git/ref/heads/staging" && ++stages === 2) {
      queueMicrotask(() => {
        s.mainSha = "b".repeat(40);
      });
    }
  };
  await assert.rejects(s.admit(), { code: "MAIN_MOVED" });
});

test("staging tip moving after the final local inspect must reject", async (t) => {
  const s = await fixture(t);
  let stages = 0;
  s.beforeRead = (path) => {
    if (path === "/git/ref/heads/staging" && ++stages === 2) {
      setImmediate(() => {
        s.stageSha = "b".repeat(40);
      });
    }
  };
  await assert.rejects(s.admit(), { code: "STAGING_SOURCE_REF_MISMATCH" });
});

test("matching tracked bytes through a symlink or hardlink still fail isolation", async (t) => {
  const s = await fixture(t);
  const outside = join(s.root, "external.js");
  await writeFile(outside, "export const fixture = true;\n");
  await rm(join(s.checkoutRoot, "app.js"));
  await symlink(outside, join(s.checkoutRoot, "app.js"));
  await assert.rejects(s.admit(), { code: "STAGING_CHECKOUT_FILES" });
  await rm(join(s.checkoutRoot, "app.js"));
  await link(outside, join(s.checkoutRoot, "app.js"));
  await assert.rejects(s.admit(), { code: "STAGING_CHECKOUT_FILES" });
});

test("file mode drift hidden from Git status is independently rejected", async (t) => {
  const s = await fixture(t);
  await git(s.checkoutRoot, "config", "core.fileMode", "false");
  await chmod(join(s.checkoutRoot, "app.js"), 0o755);
  await assert.rejects(s.admit(), { code: "STAGING_CHECKOUT_CONTENT" });
});

test("external object stores and replacement commits are unsupported isolated inputs", async (t) => {
  const s = await fixture(t);
  const alternates = join(s.checkoutRoot, ".git", "objects", "info", "alternates");
  await writeFile(alternates, join(s.root, "external-objects") + "\n");
  await assert.rejects(s.admit(), { code: "STAGING_CHECKOUT_ISOLATION" });
  await rm(alternates);
  await git(s.checkoutRoot, "commit", "--allow-empty", "-m", "Replacement fixture");
  const replacement = await git(s.checkoutRoot, "rev-parse", "HEAD");
  await git(s.checkoutRoot, "reset", "--hard", s.sha);
  await git(s.checkoutRoot, "replace", s.sha, replacement);
  await assert.rejects(s.admit(), { code: "STAGING_CHECKOUT_ISOLATION" });
});

test("a committed symlink is not an accepted regular-file source tree", async (t) => {
  const s = await fixture(t);
  await symlink("app.js", join(s.checkoutRoot, "alias.js"));
  await git(s.checkoutRoot, "add", "alias.js");
  await git(s.checkoutRoot, "commit", "-m", "Symlink fixture");
  s.sha = await git(s.checkoutRoot, "rev-parse", "HEAD");
  s.mainSha = s.stageSha = s.run.head_sha = s.sha;
  await assert.rejects(s.admit(), { code: "STAGING_CHECKOUT_FILES" });
});

test("staged index changes cannot hide behind restored working bytes", async (t) => {
  const s = await fixture(t);
  await writeFile(join(s.checkoutRoot, "app.js"), "changed\n");
  await git(s.checkoutRoot, "add", "app.js");
  await writeFile(join(s.checkoutRoot, "app.js"), "export const fixture = true;\n");
  await assert.rejects(s.admit(), { code: "STAGING_CHECKOUT_DIRTY" });
});

test("repository clean filters never execute while changed working bytes are inspected", async (t) => {
  const s = await fixture(t);
  const marker = join(s.root, "filter-invoked");
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(join(s.checkoutRoot, ".git", "info", "attributes"), "app.js filter=fixture\n");
  await git(s.checkoutRoot, "config", "filter.fixture.clean", `/usr/bin/touch ${quote(marker)}`);
  await git(s.checkoutRoot, "config", "filter.fixture.required", "true");
  await writeFile(join(s.checkoutRoot, "app.js"), "hidden-by-local-filter\n");
  await assert.rejects(s.admit(), { code: "STAGING_CHECKOUT_CONTENT" });
  await assert.rejects(access(marker), { code: "ENOENT" });
});

test("corrupted nested tree cannot substitute unapproved bytes under an admitted source SHA", async (t) => {
  const s = await fixture(t);
  await mkdir(join(s.checkoutRoot, "src"));
  await writeFile(join(s.checkoutRoot, "src", "app.js"), "approved-nested-source\n");
  await git(s.checkoutRoot, "add", "src");
  await git(s.checkoutRoot, "commit", "-m", "Nested source fixture");
  s.sha = await git(s.checkoutRoot, "rev-parse", "HEAD");
  s.mainSha = s.stageSha = s.run.head_sha = s.sha;
  const originalSubtree = await git(s.checkoutRoot, "rev-parse", "HEAD:src");
  await writeFile(join(s.checkoutRoot, "src", "app.js"), "unapproved-nested-source\n");
  await git(s.checkoutRoot, "add", "src");
  const differentTree = await git(s.checkoutRoot, "write-tree");
  const differentSubtree = await git(s.checkoutRoot, "rev-parse", `${differentTree}:src`);
  const objectFile = (sha) =>
    join(s.checkoutRoot, ".git", "objects", sha.slice(0, 2), sha.slice(2));
  await chmod(objectFile(originalSubtree), 0o600);
  await copyFile(objectFile(differentSubtree), objectFile(originalSubtree));
  // The top commit/root tree retain their admitted hashes; recursive ls-tree
  // alone accepts the forged nested object, matching the malicious index/files.
  await assert.rejects(s.admit(), { code: "STAGING_CHECKOUT_OBJECTS" });
  const skip = join(s.root, "ignored-object-list");
  await writeFile(skip, originalSubtree + "\n");
  await git(s.checkoutRoot, "config", "fsck.skipList", skip);
  await git(s.checkoutRoot, "config", "fsck.missingTree", "ignore");
  await assert.rejects(s.admit(), { code: "STAGING_CHECKOUT_OBJECTS" });
});

test("missing promisor tree rejects without fetching from even a local fixture remote", async (t) => {
  const s = await fixture(t);
  await mkdir(join(s.checkoutRoot, "src"));
  await writeFile(join(s.checkoutRoot, "src", "app.js"), "promised-nested-source\n");
  await git(s.checkoutRoot, "add", "src");
  await git(s.checkoutRoot, "commit", "-m", "Missing tree fixture");
  s.sha = await git(s.checkoutRoot, "rev-parse", "HEAD");
  s.mainSha = s.stageSha = s.run.head_sha = s.sha;
  const subtree = await git(s.checkoutRoot, "rev-parse", "HEAD:src");
  const remote = join(s.root, "empty-local-remote.git");
  await git(s.root, "init", "--bare", remote);
  await git(s.checkoutRoot, "remote", "add", "fixture", remote);
  await git(s.checkoutRoot, "config", "remote.fixture.promisor", "true");
  await git(s.checkoutRoot, "config", "remote.fixture.partialCloneFilter", "blob:none");
  await git(s.checkoutRoot, "config", "extensions.partialClone", "fixture");
  await rm(join(s.checkoutRoot, ".git", "objects", subtree.slice(0, 2), subtree.slice(2)));
  await assert.rejects(s.admit(), (error) => {
    assert.ok(["STAGING_CHECKOUT_OBJECTS", "STAGING_CHECKOUT_READ_FAILED"].includes(error.code));
    assert.equal(error.message, error.code);
    return true;
  });
  await assert.rejects(access(join(s.checkoutRoot, ".git", "FETCH_HEAD")), { code: "ENOENT" });
  assert.equal(await git(remote, "for-each-ref"), "");
});
