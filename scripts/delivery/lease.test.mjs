// SIMULATOR ONLY: transport outcomes are controlled; no GitHub refs are changed.
import assert from "node:assert/strict";
import test from "node:test";
import { acquireLease, fastForwardStaging, gitCompareDelete } from "./lease.mjs";

function refSimulator() {
  const refs = new Map();
  const tags = new Map();
  const calls = [];
  let count = 0;
  const github = {
    async request(method, path, body) {
      calls.push({ method, path, body });
      if (method === "POST" && path === "/git/tags") {
        const sha = (++count).toString(16).padStart(40, "0");
        tags.set(sha, { sha, ...body });
        return { sha };
      }
      if (method === "POST" && path === "/git/refs") {
        if (refs.has(body.ref)) throw new Error("simulated create conflict");
        refs.set(body.ref, body.sha);
        return { ref: body.ref, object: { sha: body.sha } };
      }
      if (method === "GET" && path.startsWith("/git/ref/")) {
        const ref = `refs/${path.slice("/git/ref/".length)}`;
        return { ref, object: { sha: refs.get(ref) } };
      }
      if (method === "GET" && path.startsWith("/git/tags/")) {
        const sha = path.slice("/git/tags/".length);
        const tag = tags.get(sha);
        if (!tag) throw new Error("simulated missing tag");
        return tag;
      }
      throw new Error("unexpected simulated operation");
    },
  };
  const compareDelete = async ({ ref, sha }) => {
    if (refs.get(ref) !== sha) throw new Error("simulated compare failure");
    refs.delete(ref);
  };
  const acquire = (target, owner) =>
    acquireLease({
      github,
      target,
      owner,
      workflowSha: "a".repeat(40),
      releaseDigest: "b".repeat(64),
      compareDelete,
    });
  return { refs, tags, calls, github, acquire, compareDelete };
}

test("simulator: concurrent CI/local owners yield one lease; no force acquire or takeover", async () => {
  const s = refSimulator();
  const results = await Promise.allSettled([
    s.acquire("production", "ci:42:1"),
    s.acquire("production", "local:operator"),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  assert.equal(s.refs.size, 1);
  assert.equal(
    s.calls.some(({ method }) => method === "PATCH" || method === "DELETE"),
    false,
  );
});

test("simulator: staging and production use independent fixed lease namespaces", async () => {
  const s = refSimulator();
  const stage = await s.acquire("staging", "ci:41:1");
  const production = await s.acquire("production", "ci:42:1");
  assert.notEqual(stage.ref, production.ref);
  await stage.release();
  await production.assertOwned();
});

test("simulator: ownership loss prevents mutation guard and compare-delete preserves replacement", async () => {
  const s = refSimulator();
  const lease = await s.acquire("production", "ci:42:1");
  const replacement = "e".repeat(40);
  s.refs.set(lease.ref, replacement);
  await assert.rejects(lease.assertOwned, { code: "LEASE_OWNERSHIP_LOST" });
  await assert.rejects(lease.release);
  assert.equal(s.refs.get(lease.ref), replacement);
});

test("simulator: a race immediately before compare-delete cannot remove a new owner", async () => {
  const s = refSimulator();
  const replacement = "f".repeat(40);
  const lease = await acquireLease({
    github: s.github,
    target: "staging",
    owner: "ci:1:1",
    workflowSha: "a".repeat(40),
    releaseDigest: "b".repeat(64),
    compareDelete: async (value) => {
      s.refs.set(value.ref, replacement);
      await s.compareDelete(value);
    },
  });
  await lease.assertOwned();
  await assert.rejects(lease.release);
  assert.equal(s.refs.get(lease.ref), replacement);
});

test("simulator: repeated release cannot delete a subsequent owner's lease", async () => {
  const s = refSimulator();
  const first = await s.acquire("staging", "ci:1:1");
  await first.release();
  const second = await s.acquire("staging", "ci:2:1");
  await assert.rejects(first.release, { code: "LEASE_RELEASED" });
  await second.assertOwned();
});

test("simulator: assertOwned rejects a tag whose sealed releaseDigest was rewritten", async () => {
  const s = refSimulator();
  const lease = await s.acquire("production", "ci:42:1");
  const tag = s.tags.get(lease.sha);
  s.tags.set(lease.sha, {
    ...tag,
    message: JSON.stringify({
      version: 1,
      owner: "ci:42:1",
      target: "production",
      releaseDigest: "c".repeat(64),
    }),
  });
  await assert.rejects(lease.assertOwned, { code: "LEASE_BINDING" });
});

test("git transport constructs an exact expected-object delete and suppresses secret-bearing errors", async () => {
  const calls = [];
  const ref = "refs/tags/minted-delivery-lock-production";
  const sha = "a".repeat(40);
  const remove = gitCompareDelete({
    token: "simulated-secret",
    cwd: "/tmp/simulated-repo",
    run: async (...args) => calls.push(args),
  });
  await remove({ ref, sha });
  assert.deepEqual(calls[0][1], [
    "push",
    `--force-with-lease=${ref}:${sha}`,
    "https://github.com/sonny303/mintedpanel.git",
    `:${ref}`,
  ]);
  assert.equal(calls[0][1].join(" ").includes("simulated-secret"), false);
  const fail = gitCompareDelete({
    token: "simulated-secret",
    cwd: "/tmp/simulated-repo",
    run: async () => {
      throw new Error("simulated-secret provider output");
    },
  });
  await assert.rejects(fail({ ref, sha }), { message: "LEASE_COMPARE_DELETE_FAILED" });
});

test("simulator: explicit targets required before lease transport", async () => {
  const s = refSimulator();
  await assert.rejects(s.acquire(undefined, "ci:1"), { code: "EXPLICIT_TARGET_REQUIRED" });
  assert.equal(s.calls.length, 0);
});

for (const status of ["diverged", "behind"]) {
  test(`simulator: staging ${status} refuses update without force`, async () => {
    const calls = [];
    const github = {
      async request(method, path) {
        calls.push({ method, path });
        if (path === "/git/ref/heads/main") return { object: { sha: "a".repeat(40) } };
        if (path === "/git/ref/heads/staging") return { object: { sha: "b".repeat(40) } };
        return { status };
      },
    };
    await assert.rejects(
      fastForwardStaging({ github, lease: { async assertOwned() {} }, sha: "a".repeat(40) }),
      { code: "STAGING_DIVERGED" },
    );
    assert.equal(
      calls.some(({ method }) => method !== "GET"),
      false,
    );
  });
}

test("simulator: staging fast-forward uses exact successful SHA, server ancestry guard and readback", async () => {
  const calls = [];
  let stage = "b".repeat(40);
  const github = {
    async request(method, path, body) {
      calls.push({ method, path, body });
      if (path === "/git/ref/heads/main") return { object: { sha: "a".repeat(40) } };
      if (path === "/git/ref/heads/staging") return { object: { sha: stage } };
      if (method === "PATCH") {
        stage = body.sha;
        return {};
      }
      return { status: "ahead" };
    },
  };
  await fastForwardStaging({ github, lease: { async assertOwned() {} }, sha: "a".repeat(40) });
  assert.deepEqual(calls.find(({ method }) => method === "PATCH").body, {
    sha: "a".repeat(40),
    force: false,
  });
  assert.equal(calls.at(-1).path, "/git/ref/heads/staging");
});
