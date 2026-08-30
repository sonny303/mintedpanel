#!/usr/bin/env node
// Idempotent staging-branch bootstrap for mintedpanel.
//
// 1. Checks whether refs/heads/staging already exists — exits early if it does
//    (unless --mirror-protection is passed).
// 2. Creates staging from the current main tip when missing.
// 3. Mirrors main's branch-protection rules onto staging.
//
// Usage:
//   node scripts/ensure-staging-branch.mjs
//   node scripts/ensure-staging-branch.mjs --mirror-protection
//
// Env:
//   GITHUB_TOKEN or GH_TOKEN — required (repo admin for branch protection)
//   GITHUB_REPOSITORY      — owner/repo (Actions sets this automatically)
//
// Plain JS + node builtins only, like the other scripts/*.mjs gate tooling.

const STAGING = "staging";
const MAIN = "main";
const API = "https://api.github.com";

const mirrorProtectionOnly = process.argv.includes("--mirror-protection");

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN or GH_TOKEN is required");
  process.exit(1);
}

const repository = process.env.GITHUB_REPOSITORY;
if (!repository) {
  console.error("GITHUB_REPOSITORY (owner/repo) is required");
  process.exit(1);
}

const [owner, repo] = repository.split("/");
if (!owner || !repo) {
  console.error(`Invalid GITHUB_REPOSITORY: ${repository}`);
  process.exit(1);
}

/** @param {string} path */
function apiUrl(path) {
  return `${API}/repos/${owner}/${repo}${path}`;
}

/**
 * @param {string} path
 * @param {RequestInit & { allow404?: boolean }} [init]
 */
async function gh(path, init = {}) {
  const { allow404 = false, ...requestInit } = init;
  const res = await fetch(apiUrl(path), {
    ...requestInit,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(requestInit.body ? { "Content-Type": "application/json" } : {}),
      ...requestInit.headers,
    },
  });

  if (allow404 && res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${requestInit.method ?? "GET"} ${path} → ${res.status}: ${body}`);
  }

  if (res.status === 204) {
    return null;
  }

  return res.json();
}

/** @param {Record<string, unknown>} protection */
function protectionPutPayload(protection) {
  /** @type {Record<string, unknown>} */
  const payload = {};

  if (protection.required_status_checks) {
    const checks = /** @type {{ strict?: boolean; contexts?: string[] }} */ (
      protection.required_status_checks
    );
    payload.required_status_checks = {
      strict: checks.strict ?? false,
      contexts: checks.contexts ?? [],
    };
  }

  if (typeof protection.enforce_admins === "object" && protection.enforce_admins !== null) {
    const admins = /** @type {{ enabled?: boolean }} */ (protection.enforce_admins);
    payload.enforce_admins = admins.enabled ?? false;
  }

  if (protection.required_pull_request_reviews) {
    const reviews = /** @type {{
      dismiss_stale_reviews?: boolean;
      require_code_owner_reviews?: boolean;
      required_approving_review_count?: number;
      require_last_push_approval?: boolean;
      bypass_pull_request_allowances?: { users?: unknown[]; teams?: unknown[]; apps?: unknown[] };
    }} */ (protection.required_pull_request_reviews);
    payload.required_pull_request_reviews = {
      dismiss_stale_reviews: reviews.dismiss_stale_reviews ?? false,
      require_code_owner_reviews: reviews.require_code_owner_reviews ?? false,
      required_approving_review_count: reviews.required_approving_review_count ?? 1,
      ...(typeof reviews.require_last_push_approval === "boolean"
        ? { require_last_push_approval: reviews.require_last_push_approval }
        : {}),
      ...(reviews.bypass_pull_request_allowances
        ? { bypass_pull_request_allowances: reviews.bypass_pull_request_allowances }
        : {}),
    };
  }

  if (protection.restrictions) {
    const restrictions = /** @type {{
      users?: Array<{ login: string }>;
      teams?: Array<{ slug: string }>;
      apps?: Array<{ slug: string }>;
    }} */ (protection.restrictions);
    payload.restrictions = {
      users: (restrictions.users ?? []).map((u) => u.login),
      teams: (restrictions.teams ?? []).map((t) => t.slug),
      apps: (restrictions.apps ?? []).map((a) => a.slug),
    };
  }

  if (
    typeof protection.required_linear_history === "object" &&
    protection.required_linear_history !== null
  ) {
    const linear = /** @type {{ enabled?: boolean }} */ (protection.required_linear_history);
    payload.required_linear_history = linear.enabled ?? false;
  }

  if (typeof protection.allow_force_pushes === "object" && protection.allow_force_pushes !== null) {
    const force = /** @type {{ enabled?: boolean }} */ (protection.allow_force_pushes);
    payload.allow_force_pushes = force.enabled ?? false;
  }

  if (typeof protection.allow_deletions === "object" && protection.allow_deletions !== null) {
    const deletions = /** @type {{ enabled?: boolean }} */ (protection.allow_deletions);
    payload.allow_deletions = deletions.enabled ?? false;
  }

  if (
    typeof protection.required_conversation_resolution === "object" &&
    protection.required_conversation_resolution !== null
  ) {
    const resolution = /** @type {{ enabled?: boolean }} */ (
      protection.required_conversation_resolution
    );
    payload.required_conversation_resolution = resolution.enabled ?? false;
  }

  if (typeof protection.lock_branch === "object" && protection.lock_branch !== null) {
    const lock = /** @type {{ enabled?: boolean }} */ (protection.lock_branch);
    payload.lock_branch = lock.enabled ?? false;
  }

  if (typeof protection.allow_fork_syncing === "object" && protection.allow_fork_syncing !== null) {
    const fork = /** @type {{ enabled?: boolean }} */ (protection.allow_fork_syncing);
    payload.allow_fork_syncing = fork.enabled ?? false;
  }

  return payload;
}

async function main() {
  console.log(`Repository: ${owner}/${repo}`);

  const existingStaging = await gh(`/branches/${STAGING}`, { allow404: true });
  if (existingStaging && !mirrorProtectionOnly) {
    console.log(
      `Branch ${STAGING} already exists at ${existingStaging.commit.sha.slice(0, 7)} — skipping create`,
    );
  } else if (!existingStaging) {
    const mainRef = await gh(`/git/ref/heads/${MAIN}`);
    const mainSha = /** @type {{ object: { sha: string } }} */ (mainRef).object.sha;
    console.log(`Creating ${STAGING} from ${MAIN} @ ${mainSha.slice(0, 7)}`);

    await gh("/git/refs", {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${STAGING}`,
        sha: mainSha,
      }),
    });

    console.log(`Created branch ${STAGING}`);
  }

  const mainProtection = await gh(`/branches/${MAIN}/protection`, { allow404: true });
  if (!mainProtection) {
    console.log(`No branch protection on ${MAIN} — nothing to mirror onto ${STAGING}`);
    return;
  }

  const payload = protectionPutPayload(mainProtection);
  console.log(`Mirroring ${MAIN} branch protection onto ${STAGING}`);

  await gh(`/branches/${STAGING}/protection`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  console.log(`Branch protection mirrored onto ${STAGING}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
