import { canonicalDigest } from "../release/contract.mjs";
import { DeliveryError, requireCondition, requireSha } from "./boundary.mjs";

// Independent of G0 records, caller input, local .vercel files and process.env.
const TARGET = Object.freeze({
  environment: "production",
  vercelTeamId: "team_230fpJ9MgCj9ssW3LiIckfyA",
  vercelProjectId: "prj_ILhPJbkyaiptdVA8DtsmNyw3tiub",
  supabaseRef: "fkvuhfsqcmujywzgczmc",
  vercelEnvironment: "production",
  gitBranch: "main",
});
const REPO_ID = "1285319396";
// Established production routing, independently pinned rather than caller-configurable.
// The alias API observes redirect targets; HTTP status remains a runtime check.
const ALIAS_ROUTING = Object.freeze({
  "mintedpanel.com": "www.mintedpanel.com",
  "www.mintedpanel.com": null,
  "mintedpanel.vercel.app": null,
});
const ALIASES = Object.keys(ALIAS_ROUTING);
const API = "https://api.vercel.com";
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PAGES = 20;
const REQUEST_MS = 30000;
const COLLECTION_MS = 60000;
const terminalStates = ["READY", "ERROR", "CANCELED", "DELETED"];
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const equal = (a, b) => canonicalDigest(a) === canonicalDigest(b);
const timestamp = (value) => Number.isSafeInteger(value) && value > 0;
const text = (value, max = 256) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f]/.test(value);
const id = (value) => typeof value === "string" && /^dpl_[A-Za-z0-9_]{1,100}$/.test(value);

function optionsOnly(value, keys) {
  requireCondition(
    object(value) && Object.keys(value).every((key) => keys.includes(key)),
    "VERCEL_OPTIONS_REJECTED",
  );
}

function selection(value) {
  requireCondition(value === "production" || value === "staging", "EXPLICIT_TARGET_REQUIRED");
  requireCondition(value === "production", "STAGING_TARGET_UNAVAILABLE");
}

function pathFor(path, query = {}) {
  const params = new URLSearchParams({ ...query, teamId: TARGET.vercelTeamId });
  return `${path}?${params}`;
}

/** Never logs/returns a provider body. GET only, no redirects or env fallback. */
async function httpsRead({ credential, path, signal }) {
  requireCondition(
    typeof credential === "string" && credential.length > 0,
    "VERCEL_CREDENTIAL_MISSING",
  );
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${credential}`, Accept: "application/json" },
      redirect: "error",
      signal,
    });
  } catch {
    throw new DeliveryError("VERCEL_READ_FAILED");
  }
  requireCondition(response.ok, "VERCEL_READ_REJECTED");
  requireCondition(
    /^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? ""),
    "VERCEL_RESPONSE_INVALID",
  );
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      requireCondition(size <= MAX_BYTES, "VERCEL_RESPONSE_TOO_LARGE");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError("VERCEL_RESPONSE_INVALID");
  }
}

function normalizeProject(project) {
  requireCondition(
    project?.id === TARGET.vercelProjectId && project.accountId === TARGET.vercelTeamId,
    "VERCEL_PROJECT_IDENTITY",
  );
  requireCondition(project.link == null, "VERCEL_GIT_LINK_PRESENT");
  requireCondition(project.autoAssignCustomDomains === false, "VERCEL_AUTOMATIC_DOMAINS_ENABLED");
  requireCondition(
    text(project.nodeVersion) && /^(?:20|22|24)\.x$/.test(project.nodeVersion),
    "VERCEL_RUNTIME_UNVERIFIED",
  );
  const settings = {};
  for (const key of [
    "framework",
    "nodeVersion",
    "buildCommand",
    "devCommand",
    "installCommand",
    "outputDirectory",
    "rootDirectory",
    "commandForIgnoringBuildStep",
    "sourceFilesOutsideRootDirectory",
    "autoExposeSystemEnvs",
    "serverlessFunctionRegion",
    "resourceConfig",
    "ssoProtection",
    "autoAssignCustomDomains",
  ]) {
    settings[key] = project[key] ?? null;
  }
  // Commands/settings can contain sensitive inline text. Return their combined
  // identity, not their contents. No env/value/bypass blob enters this selection.
  return {
    id: TARGET.vercelProjectId,
    accountId: TARGET.vercelTeamId,
    gitDisconnected: true,
    autoAssignCustomDomains: false,
    nodeVersion: project.nodeVersion,
    settingsDigest: canonicalDigest(settings),
  };
}

function environmentMetadata(response) {
  requireCondition(
    object(response) &&
      Array.isArray(response.envs) &&
      response.envs.length > 0 &&
      response.envs.length <= 2000,
    "VERCEL_ENV_METADATA_INCOMPLETE",
  );
  requireCondition(
    response.hiddenProductionEnvCount === undefined || response.hiddenProductionEnvCount === 0,
    "VERCEL_ENV_METADATA_HIDDEN",
  );
  // v10 exposes a pagination response variant, but its documented query does not
  // define a continuation parameter. Refuse truncation instead of guessing one.
  requireCondition(
    !response.pagination || response.pagination.next === null,
    "VERCEL_ENV_PAGINATION_UNSUPPORTED",
  );
  const result = response.envs
    .map((entry) => {
      requireCondition(object(entry), "VERCEL_ENV_METADATA_INVALID");
      const targets = typeof entry.target === "string" ? [entry.target] : entry.target;
      const custom = entry.customEnvironmentIds ?? [];
      requireCondition(
        text(entry.id) &&
          typeof entry.key === "string" &&
          /^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(entry.key) &&
          ["plain", "encrypted", "sensitive", "system", "secret"].includes(entry.type),
        "VERCEL_ENV_METADATA_INVALID",
      );
      requireCondition(
        Array.isArray(targets) &&
          targets.every((target) => ["production", "preview", "development"].includes(target)) &&
          new Set(targets).size === targets.length,
        "VERCEL_ENV_TARGET_INVALID",
      );
      requireCondition(
        Array.isArray(custom) &&
          custom.every((value) => text(value)) &&
          new Set(custom).size === custom.length &&
          targets.length + custom.length > 0,
        "VERCEL_ENV_TARGET_INVALID",
      );
      requireCondition(
        timestamp(entry.createdAt) &&
          timestamp(entry.updatedAt) &&
          entry.updatedAt >= entry.createdAt,
        "VERCEL_ENV_VERSION_MISSING",
      );
      requireCondition(
        entry.gitBranch == null || text(entry.gitBranch, 250),
        "VERCEL_ENV_BRANCH_INVALID",
      );
      requireCondition(
        entry.gitBranch == null || (targets.length === 1 && targets[0] === "preview"),
        "VERCEL_ENV_BRANCH_TARGET_INVALID",
      );
      requireCondition(
        entry.visibility == null || ["config", "secret"].includes(entry.visibility),
        "VERCEL_ENV_METADATA_INVALID",
      );
      requireCondition(
        entry.configurationId == null || text(entry.configurationId),
        "VERCEL_ENV_METADATA_INVALID",
      );
      return {
        id: entry.id,
        key: entry.key,
        type: entry.type,
        target: [...targets].sort(),
        gitBranch: entry.gitBranch ?? null,
        customEnvironmentIds: [...custom].sort(),
        configurationId: entry.configurationId ?? null,
        visibility: entry.visibility ?? null,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  requireCondition(
    new Set(result.map((entry) => entry.id)).size === result.length &&
      result.some((entry) => entry.target.includes("production")),
    "VERCEL_ENV_METADATA_INCOMPLETE",
  );
  return result;
}

function normalizeAlias(value, alias) {
  requireCondition(
    value?.alias === alias && value.projectId === TARGET.vercelProjectId && id(value.deploymentId),
    "VERCEL_ALIAS_IDENTITY",
  );
  requireCondition(
    value.deletedAt == null &&
      (value.redirect ?? null) === ALIAS_ROUTING[alias] &&
      value.microfrontends == null,
    "VERCEL_ALIAS_ROUTING_UNSUPPORTED",
  );
  requireCondition(
    !value.deployment || value.deployment.id === value.deploymentId,
    "VERCEL_ALIAS_DEPLOYMENT_MISMATCH",
  );
  return [alias, value.deploymentId];
}

function normalizeDeployment(value, deploymentId, expectedSourceSha) {
  requireCondition(
    value?.id === deploymentId &&
      value.ownerId === TARGET.vercelTeamId &&
      value.projectId === TARGET.vercelProjectId,
    "VERCEL_DEPLOYMENT_IDENTITY",
  );
  requireCondition(
    (!value.team || value.team.id === TARGET.vercelTeamId) &&
      (!value.project || value.project.id === TARGET.vercelProjectId),
    "VERCEL_DEPLOYMENT_IDENTITY",
  );
  requireCondition(
    value.target === "production" &&
      value.readyState === "READY" &&
      value.deletedAt == null &&
      value.softDeletedByRetention !== true &&
      value.readySubstate !== "ROLLING",
    "VERCEL_DEPLOYMENT_NOT_READY_PRODUCTION",
  );
  requireCondition(
    value.readySubstate == null || ["STAGED", "PROMOTED"].includes(value.readySubstate),
    "VERCEL_DEPLOYMENT_NOT_READY_PRODUCTION",
  );
  const source = value.gitSource;
  requireCondition(
    source?.type === "github" &&
      typeof source.sha === "string" &&
      /^[a-f0-9]{40}$/.test(source.sha),
    "VERCEL_SOURCE_UNVERIFIED",
  );
  requireCondition(["main", "refs/heads/main"].includes(source.ref), "VERCEL_SOURCE_REF_MISMATCH");
  requireCondition(
    (String(source.repoId) === REPO_ID ||
      (source.org === "sonny303" && source.repo === "mintedpanel")) &&
      (source.repoId === undefined || String(source.repoId) === REPO_ID) &&
      (source.org === undefined || source.org === "sonny303") &&
      (source.repo === undefined || source.repo === "mintedpanel"),
    "VERCEL_SOURCE_REPOSITORY_MISMATCH",
  );
  if (expectedSourceSha !== undefined)
    requireCondition(source.sha === expectedSourceSha, "VERCEL_SOURCE_SHA_MISMATCH");
  if (value.meta?.githubCommitSha !== undefined)
    requireCondition(value.meta.githubCommitSha === source.sha, "VERCEL_SOURCE_METADATA_CONFLICT");
  if (value.meta?.githubCommitRef !== undefined)
    requireCondition(
      ["main", "refs/heads/main"].includes(value.meta.githubCommitRef),
      "VERCEL_SOURCE_METADATA_CONFLICT",
    );
  const nodeVersion = value.nodeVersion ?? value.projectSettings?.nodeVersion;
  requireCondition(
    typeof nodeVersion === "string" && /^(?:20|22|24)\.x$/.test(nodeVersion),
    "VERCEL_RUNTIME_UNVERIFIED",
  );
  requireCondition(
    Array.isArray(value.regions) &&
      value.regions.length > 0 &&
      value.regions.length <= 32 &&
      value.regions.every((region) => /^[a-z]{3}[0-9]$/.test(region)),
    "VERCEL_RUNTIME_UNVERIFIED",
  );
  requireCondition(
    timestamp(value.createdAt) && timestamp(value.ready) && value.ready >= value.createdAt,
    "VERCEL_DEPLOYMENT_TIMESTAMPS",
  );
  return {
    deploymentId,
    projectId: TARGET.vercelProjectId,
    teamId: TARGET.vercelTeamId,
    environment: "production",
    readyState: "READY",
    readySubstate: value.readySubstate ?? null,
    source: {
      provider: "github",
      repository: "sonny303/mintedpanel",
      repositoryId: REPO_ID,
      ref: "main",
      sha: source.sha,
    },
    createdAt: value.createdAt,
    readyAt: value.ready,
    runtime: {
      nodeVersion,
      regions: [...value.regions].sort(),
      evidence: "provider-configuration-only",
      databaseBinding: "UNVERIFIED",
      health: "UNVERIFIED",
    },
  };
}

/**
 * Real read-only collector. A trusted integration may inject an existing-session
 * CLI transport ({path, signal}) -> JSON; no credential copying is necessary.
 * No arbitrary URL, env lookup, project override, mutation or CLI entrypoint.
 */
export function createVercelRead(options = {}) {
  optionsOnly(options, ["credential", "transport"]);
  requireCondition(
    options.transport === undefined || typeof options.transport === "function",
    "VERCEL_TRANSPORT_INVALID",
  );
  requireCondition(!(options.transport && options.credential), "VERCEL_TRANSPORT_AMBIGUOUS");
  const transport =
    options.transport ??
    (({ path, signal }) => httpsRead({ credential: options.credential, path, signal }));
  const session = () => {
    const started = Date.now();
    const read = async (path) => {
      const remaining = COLLECTION_MS - (Date.now() - started);
      requireCondition(remaining > 0, "VERCEL_COLLECTION_TIMEOUT");
      const controller = new AbortController();
      let timer;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(
            () => {
              controller.abort();
              reject(new DeliveryError("VERCEL_COLLECTION_TIMEOUT"));
            },
            Math.min(REQUEST_MS, remaining),
          );
        });
        const value = await Promise.race([transport({ path, signal: controller.signal }), timeout]);
        requireCondition(object(value), "VERCEL_RESPONSE_INVALID");
        requireCondition(
          Buffer.byteLength(JSON.stringify(value)) <= MAX_BYTES,
          "VERCEL_RESPONSE_TOO_LARGE",
        );
        return value;
      } catch (error) {
        if (
          error instanceof DeliveryError &&
          [
            "VERCEL_CREDENTIAL_MISSING",
            "VERCEL_READ_FAILED",
            "VERCEL_READ_REJECTED",
            "VERCEL_RESPONSE_INVALID",
            "VERCEL_RESPONSE_TOO_LARGE",
            "VERCEL_COLLECTION_TIMEOUT",
          ].includes(error.code)
        )
          throw error;
        throw new DeliveryError("VERCEL_READ_FAILED");
      } finally {
        clearTimeout(timer);
      }
    };
    const project = async () =>
      normalizeProject(await read(pathFor(`/v9/projects/${TARGET.vercelProjectId}`)));
    const environment = async () =>
      environmentMetadata(
        await read(pathFor(`/v10/projects/${TARGET.vercelProjectId}/env`, { decrypt: "false" })),
      );
    const aliases = async () => {
      const pairs = [];
      for (const alias of ALIASES)
        pairs.push(
          normalizeAlias(
            await read(pathFor(`/v4/aliases/${alias}`, { projectId: TARGET.vercelProjectId })),
            alias,
          ),
        );
      requireCondition(
        new Set(pairs.map(([, deploymentId]) => deploymentId)).size === 1,
        "VERCEL_ALIAS_DRIFT",
      );
      return Object.fromEntries(pairs);
    };
    const noActiveDeployments = async () => {
      let until;
      const seen = new Set();
      const cursors = new Set();
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await read(
          pathFor("/v7/deployments", {
            projectId: TARGET.vercelProjectId,
            limit: "100",
            ...(until === undefined ? {} : { until: String(until) }),
          }),
        );
        requireCondition(
          Array.isArray(result.deployments) &&
            result.deployments.length <= 100 &&
            object(result.pagination) &&
            result.pagination.count === result.deployments.length,
          "VERCEL_DEPLOYMENT_INVENTORY_INVALID",
        );
        for (const deployment of result.deployments) {
          requireCondition(
            object(deployment) &&
              id(deployment.uid) &&
              deployment.projectId === TARGET.vercelProjectId &&
              !seen.has(deployment.uid),
            "VERCEL_DEPLOYMENT_INVENTORY_INVALID",
          );
          seen.add(deployment.uid);
          requireCondition(
            terminalStates.includes(deployment.state) &&
              (deployment.readyState === undefined || deployment.readyState === deployment.state) &&
              deployment.readySubstate !== "ROLLING" &&
              deployment.checks?.["deployment-alias"]?.state !== "pending",
            "VERCEL_COMPETING_DEPLOYMENT_ACTIVE",
          );
        }
        if (result.pagination.next === null) return;
        const next = result.pagination.next;
        requireCondition(
          timestamp(next) && !cursors.has(next) && (until === undefined || next < until),
          "VERCEL_PAGINATION_INVALID",
        );
        cursors.add(next);
        until = next;
      }
      throw new DeliveryError("VERCEL_PAGINATION_LIMIT");
    };
    const deployment = async (deploymentId, expectedSourceSha) =>
      normalizeDeployment(
        await read(pathFor(`/v13/deployments/${deploymentId}`, { withGitRepoInfo: "true" })),
        deploymentId,
        expectedSourceSha,
      );
    return { project, environment, aliases, noActiveDeployments, deployment, started };
  };
  return Object.freeze({
    async readDeployment(input = {}) {
      optionsOnly(input, ["target", "deploymentId", "expectedSourceSha"]);
      selection(input.target);
      requireCondition(id(input.deploymentId), "VERCEL_DEPLOYMENT_ID_REQUIRED");
      if (input.expectedSourceSha !== undefined) requireSha(input.expectedSourceSha);
      const reads = session();
      await reads.project();
      return reads.deployment(input.deploymentId, input.expectedSourceSha);
    },
    async collect(input = {}) {
      optionsOnly(input, ["target", "expectedSourceSha", "expectedDeploymentId"]);
      selection(input.target);
      if (input.expectedSourceSha !== undefined) requireSha(input.expectedSourceSha);
      if (input.expectedDeploymentId !== undefined)
        requireCondition(id(input.expectedDeploymentId), "VERCEL_DEPLOYMENT_ID_REQUIRED");
      const reads = session();
      const project = await reads.project();
      const environment = await reads.environment();
      const aliases = await reads.aliases();
      const deploymentId = aliases[ALIASES[0]];
      requireCondition(
        input.expectedDeploymentId === undefined || input.expectedDeploymentId === deploymentId,
        "VERCEL_SERVED_DEPLOYMENT_MISMATCH",
      );
      const servedDeployment = await reads.deployment(deploymentId, input.expectedSourceSha);
      await reads.noActiveDeployments();
      // Bookend independently observed resources. This detects drift during the
      // bounded collection window; it is not an atomic provider transaction.
      requireCondition(
        equal(project, await reads.project()) &&
          equal(environment, await reads.environment()) &&
          equal(aliases, await reads.aliases()) &&
          equal(servedDeployment, await reads.deployment(deploymentId, input.expectedSourceSha)),
        "VERCEL_COLLECTION_DRIFT",
      );
      await reads.noActiveDeployments();
      return {
        version: 1,
        collectionStartedAt: new Date(reads.started).toISOString(),
        observedAt: new Date().toISOString(),
        target: { ...TARGET },
        project,
        aliases,
        aliasRouting: { ...ALIAS_ROUTING },
        servedDeployment,
        environmentMetadata: environment,
        configurationDigest: canonicalDigest({
          target: TARGET,
          project,
          aliasRouting: ALIAS_ROUTING,
          environmentMetadata: environment,
        }),
        configurationIdentityKind: "provider-settings-and-env-update-metadata",
        activeDeployments: [],
        runtimeDatabaseBinding: "UNVERIFIED",
      };
    },
  });
}
