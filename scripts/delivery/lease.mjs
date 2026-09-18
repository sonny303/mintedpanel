import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  DeliveryError,
  REPOSITORY,
  requireCondition,
  requireSha,
  requireTarget,
} from "./boundary.mjs";

const execute = promisify(execFile);

/** Shared by CI and local operators. No expiry, takeover or unconditional delete. */
export async function acquireLease({
  github,
  target,
  workflowSha,
  owner,
  releaseDigest,
  compareDelete,
}) {
  requireTarget(target);
  requireSha(workflowSha);
  requireCondition(
    typeof owner === "string" && owner.length > 0 && owner.length < 200,
    "LEASE_OWNER",
  );
  requireCondition(/^[a-f0-9]{64}$/.test(releaseDigest), "LEASE_DIGEST");
  const ref = `refs/tags/minted-delivery-lock-${target}`;
  const message = JSON.stringify({ version: 1, owner, target, releaseDigest });
  const object = await github.request("POST", "/git/tags", {
    tag: `minted-delivery-owner-${randomUUID()}`,
    message,
    object: workflowSha,
    type: "commit",
  });
  const sha = requireSha(object.sha);
  // POST is create-only. A conflict fails; PATCH/force acquisition is forbidden.
  await github.request("POST", "/git/refs", { ref, sha });
  let released = false;
  return Object.freeze({
    ref,
    sha,
    async assertOwned() {
      requireCondition(!released, "LEASE_RELEASED");
      const current = await github.request("GET", `/git/ref/${ref.slice(5)}`);
      requireCondition(current.ref === ref && current.object?.sha === sha, "LEASE_OWNERSHIP_LOST");
      // Ref→object alone is not enough: the tag message seals owner/target/digest.
      const tag = await github.request("GET", `/git/tags/${sha}`);
      requireCondition(
        tag?.sha === sha &&
          tag.message === message &&
          (tag.object === workflowSha || tag.object?.sha === workflowSha),
        "LEASE_BINDING",
      );
    },
    async release() {
      requireCondition(!released, "LEASE_RELEASED");
      // Read-check-delete REST is racy. Git's expected object comparison is atomic.
      await compareDelete({ ref, sha });
      released = true;
    },
  });
}

/** No shell; fixed repository/ref; errors never include git output or credentials. */
export function gitCompareDelete({ token, cwd, run = execute }) {
  requireCondition(typeof token === "string" && token.length > 0, "GITHUB_CREDENTIAL_MISSING");
  return async ({ ref, sha }) => {
    requireCondition(
      /^refs\/tags\/minted-delivery-lock-(staging|production)$/.test(ref),
      "LEASE_REF",
    );
    requireSha(sha);
    const authorization = Buffer.from(`x-access-token:${token}`).toString("base64");
    try {
      await run(
        "git",
        [
          "push",
          `--force-with-lease=${ref}:${sha}`,
          `https://github.com/${REPOSITORY}.git`,
          `:${ref}`,
        ],
        {
          cwd,
          env: {
            PATH: process.env.PATH,
            GIT_TERMINAL_PROMPT: "0",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_COUNT: "2",
            GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
            GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authorization}`,
            GIT_CONFIG_KEY_1: "credential.helper",
            GIT_CONFIG_VALUE_1: "",
          },
          maxBuffer: 65536,
        },
      );
    } catch {
      throw new DeliveryError("LEASE_COMPARE_DELETE_FAILED");
    }
  };
}

export async function fastForwardStaging({ github, lease, sha }) {
  requireSha(sha);
  await lease.assertOwned();
  const main = await github.request("GET", "/git/ref/heads/main");
  requireCondition(main.object?.sha === sha, "MAIN_MOVED");
  const current = await github.request("GET", "/git/ref/heads/staging");
  const baseline = requireSha(current.object?.sha);
  if (baseline === sha) return;
  const comparison = await github.request("GET", `/compare/${baseline}...${sha}`);
  requireCondition(comparison.status === "ahead", "STAGING_DIVERGED");
  await lease.assertOwned();
  const latestMain = await github.request("GET", "/git/ref/heads/main");
  requireCondition(latestMain.object?.sha === sha, "MAIN_MOVED");
  // The server repeats the ancestry check; a diverging concurrent write is denied.
  await github.request("PATCH", "/git/refs/heads/staging", { sha, force: false });
  const updated = await github.request("GET", "/git/ref/heads/staging");
  requireCondition(updated.object?.sha === sha, "STAGING_REF_READBACK_FAILED");
}
