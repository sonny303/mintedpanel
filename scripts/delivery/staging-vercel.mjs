import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalDigest, releaseTarget } from "../release/contract.mjs";
import {
  DeliveryError,
  PRODUCTION_ALIASES,
  REPOSITORY,
  STAGING_ALIASES,
  requireCondition,
  requireId,
  requireSha,
} from "./boundary.mjs";
import { prepareStagingSourceUpload } from "./staging-source.mjs";

const TARGET = Object.freeze(releaseTarget("staging"));
const PROJECT_NAME = "mintedpanel-staging-web";
const GENERATED_DOMAIN = "mintedpanel-staging-web.vercel.app";
const SUPABASE_URL = `https://${TARGET.supabaseRef}.supabase.co`;
const WEB_ORIGINS = Object.freeze([
  "https://staging.mintedpanel.com",
  "https://mintedpanel-staging.vercel.app",
]);
const BASE_CORS = WEB_ORIGINS.join(",");
const API = "https://api.vercel.com";
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_PAGES = 20;
const MAX_POLLS = 450;
const REQUEST_MS = 30000;
const COLLECTION_MS = 60000;
const POLL_MS = 2000;
const UPLOAD_CONCURRENCY = 4;
const TERMINAL = new Set(["READY", "ERROR", "CANCELED", "DELETED"]);
const BUILDING = new Set(["QUEUED", "INITIALIZING", "BUILDING"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const deploymentId = (value) =>
  typeof value === "string" && /^dpl_[A-Za-z0-9_]{1,100}$/.test(value);
const text = (value, max = 512) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f]/.test(value);
const timestamp = (value) => Number.isSafeInteger(value) && value > 0;
const extensionId = (value) => typeof value === "string" && /^[a-p]{32}$/.test(value);

function environmentFor(actualExtensionId = null) {
  return Object.freeze({
    VITE_SUPABASE_URL: { type: "plain", value: SUPABASE_URL },
    VITE_SUPABASE_ANON_KEY: { type: "plain", family: "anon" },
    SUPABASE_URL: { type: "plain", value: SUPABASE_URL },
    SUPABASE_PUBLISHABLE_KEY: { type: "plain", family: "anon" },
    SUPABASE_ANON_KEY: { type: "plain", family: "anon" },
    API_CORS_ORIGINS: {
      type: "plain",
      value:
        actualExtensionId === null
          ? BASE_CORS
          : `${BASE_CORS},chrome-extension://${actualExtensionId}`,
    },
    ...(actualExtensionId === null
      ? {}
      : {
          VITE_MINTED_EXTENSION_ID: { type: "plain", value: actualExtensionId },
        }),
    SUPABASE_SERVICE_ROLE_KEY: { type: "sensitive" },
  });
}

function optionsOnly(value, keys, code = "STAGING_VERCEL_OPTIONS_REJECTED") {
  requireCondition(
    object(value) &&
      Object.keys(value).length === keys.length &&
      Object.keys(value).every((key) => keys.includes(key)),
    code,
  );
}

function pathFor(path, query = {}) {
  return `${path}?${new URLSearchParams({ ...query, teamId: TARGET.vercelTeamId })}`;
}

function decodeAnon(value) {
  try {
    const parts = value.split(".");
    requireCondition(parts.length === 3, "STAGING_VERCEL_ENV_VALUE");
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    requireCondition(
      claims.ref === TARGET.supabaseRef &&
        claims.role === "anon" &&
        Number.isFinite(claims.exp) &&
        claims.exp > Math.floor(Date.now() / 1000),
      "STAGING_VERCEL_ENV_VALUE",
    );
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError("STAGING_VERCEL_ENV_VALUE");
  }
}

function normalizeProject(project) {
  requireCondition(
    project?.id === TARGET.vercelProjectId &&
      project.name === PROJECT_NAME &&
      project.accountId === TARGET.vercelTeamId,
    "STAGING_VERCEL_PROJECT_IDENTITY",
  );
  requireCondition(project.link == null, "STAGING_VERCEL_GIT_LINK_PRESENT");
  requireCondition(
    project.autoAssignCustomDomains === false,
    "STAGING_VERCEL_AUTOMATIC_DOMAINS_ENABLED",
  );
  const sharedEnvVariableIds = project.sharedEnvVariableIds ?? [];
  requireCondition(
    Array.isArray(sharedEnvVariableIds) && sharedEnvVariableIds.length === 0,
    "STAGING_VERCEL_SHARED_ENV_PRESENT",
  );
  requireCondition(
    canonicalDigest(project.ssoProtection) ===
      canonicalDigest({ deploymentType: "all_except_custom_domains" }),
    "STAGING_VERCEL_PROTECTION_DRIFT",
  );
  requireCondition(
    object(project.protectionBypass) && Object.keys(project.protectionBypass).length === 0,
    "STAGING_VERCEL_PROTECTION_BYPASS_PRESENT",
  );
  requireCondition(
    project.rootDirectory == null &&
      project.framework === "tanstack-start" &&
      typeof project.nodeVersion === "string" &&
      /^(?:20|22|24)\.x$/.test(project.nodeVersion),
    "STAGING_VERCEL_PROJECT_SETTINGS",
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
    "protectionBypass",
    "autoAssignCustomDomains",
  ])
    settings[key] = project[key] ?? null;
  return {
    id: TARGET.vercelProjectId,
    name: PROJECT_NAME,
    accountId: TARGET.vercelTeamId,
    gitDisconnected: true,
    autoAssignCustomDomains: false,
    automationBypassConfigured: false,
    settingsDigest: canonicalDigest(settings),
  };
}

function environmentIdentity(response) {
  requireCondition(
    object(response) && Array.isArray(response.envs),
    "STAGING_VERCEL_ENV_INVENTORY",
  );
  const entries = response.envs.filter((entry) => entry?.key === "VITE_MINTED_EXTENSION_ID");
  requireCondition(entries.length <= 1, "STAGING_VERCEL_ENV_INVENTORY");
  const actualExtensionId = entries.length === 0 ? null : entries[0].value;
  requireCondition(
    actualExtensionId === null || extensionId(actualExtensionId),
    "STAGING_VERCEL_EXTENSION_IDENTITY_DRIFT",
  );
  const cors = response.envs.filter((entry) => entry?.key === "API_CORS_ORIGINS");
  requireCondition(
    cors.length === 1 && cors[0].value === environmentFor(actualExtensionId).API_CORS_ORIGINS.value,
    "STAGING_VERCEL_EXTENSION_IDENTITY_DRIFT",
  );
  return actualExtensionId;
}

function normalizeEnvironment(response, actualExtensionId) {
  const environment = environmentFor(actualExtensionId);
  requireCondition(
    object(response) &&
      Array.isArray(response.envs) &&
      response.envs.length === Object.keys(environment).length,
    "STAGING_VERCEL_ENV_INVENTORY",
  );
  requireCondition(
    !response.pagination || response.pagination.next === null,
    "STAGING_VERCEL_ENV_PAGINATION",
  );
  const seen = new Set();
  const anon = [];
  const result = response.envs.map((entry) => {
    requireCondition(object(entry), "STAGING_VERCEL_ENV_METADATA");
    const expected = environment[entry.key];
    const customEnvironmentIds = entry.customEnvironmentIds ?? [];
    requireCondition(
      expected &&
        !seen.has(entry.key) &&
        text(entry.id) &&
        entry.type === expected.type &&
        Array.isArray(entry.target) &&
        entry.target.length === 1 &&
        entry.target[0] === "preview" &&
        entry.gitBranch == null &&
        Array.isArray(customEnvironmentIds) &&
        customEnvironmentIds.length === 0 &&
        (entry.configurationId == null || text(entry.configurationId)) &&
        (entry.visibility == null || ["config", "secret"].includes(entry.visibility)) &&
        timestamp(entry.createdAt) &&
        timestamp(entry.updatedAt) &&
        entry.updatedAt >= entry.createdAt,
      "STAGING_VERCEL_ENV_METADATA",
    );
    seen.add(entry.key);
    if (expected.type === "plain") {
      requireCondition(typeof entry.value === "string", "STAGING_VERCEL_ENV_VALUE");
      if (expected.value !== undefined)
        requireCondition(entry.value === expected.value, "STAGING_VERCEL_ENV_VALUE");
      if (expected.family === "anon") anon.push(entry.value);
    }
    return {
      id: entry.id,
      key: entry.key,
      type: entry.type,
      target: ["preview"],
      gitBranch: null,
      customEnvironmentIds: [],
      configurationId: entry.configurationId ?? null,
      visibility: entry.visibility ?? null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  });
  requireCondition(
    seen.size === Object.keys(environment).length && anon.length === 3 && new Set(anon).size === 1,
    "STAGING_VERCEL_ENV_INVENTORY",
  );
  decodeAnon(anon[0]);
  return result.sort((a, b) => a.key.localeCompare(b.key));
}

function normalizeShared(response) {
  requireCondition(
    object(response) &&
      Array.isArray(response.data) &&
      response.data.length === 0 &&
      (!response.pagination || response.pagination.next == null),
    "STAGING_VERCEL_SHARED_ENV_PRESENT",
  );
  return [];
}

function normalizeDomains(response) {
  requireCondition(
    object(response) &&
      Array.isArray(response.domains) &&
      response.domains.length >= 1 &&
      response.domains.length <= 1 + STAGING_ALIASES.length &&
      (!response.pagination || response.pagination.next == null),
    "STAGING_VERCEL_DOMAIN_INVENTORY",
  );
  const allowed = new Set([GENERATED_DOMAIN, ...STAGING_ALIASES]);
  const names = new Set();
  for (const domain of response.domains) {
    requireCondition(
      object(domain) &&
        allowed.has(domain.name) &&
        !names.has(domain.name) &&
        domain.gitBranch == null &&
        domain.redirect == null &&
        domain.customEnvironmentId == null,
      "STAGING_VERCEL_DOMAIN_INVENTORY",
    );
    names.add(domain.name);
  }
  requireCondition(names.has(GENERATED_DOMAIN), "STAGING_VERCEL_DOMAIN_INVENTORY");
  return [...names].sort();
}

function normalizePage(result, seen) {
  requireCondition(
    object(result) &&
      Array.isArray(result.deployments) &&
      result.deployments.length <= 100 &&
      object(result.pagination) &&
      Number(result.pagination.count) === result.deployments.length,
    "STAGING_VERCEL_DEPLOYMENT_INVENTORY",
  );
  for (const deployment of result.deployments) {
    requireCondition(
      object(deployment) &&
        deploymentId(deployment.uid) &&
        deployment.projectId === TARGET.vercelProjectId &&
        !seen.has(deployment.uid),
      "STAGING_VERCEL_DEPLOYMENT_INVENTORY",
    );
    seen.add(deployment.uid);
    requireCondition(
      TERMINAL.has(deployment.state) &&
        (deployment.readyState === undefined || deployment.readyState === deployment.state) &&
        deployment.readySubstate !== "ROLLING" &&
        deployment.checks?.["deployment-alias"]?.state !== "pending",
      "STAGING_VERCEL_COMPETING_DEPLOYMENT",
    );
  }
}

function flattenFileTree(value) {
  // Vercel returns the deployment upload root as a top-level array of file and
  // directory entries, not a synthetic single `src` wrapper.
  requireCondition(Array.isArray(value) && value.length > 0, "STAGING_VERCEL_FILE_TREE");
  const files = [];
  const walk = (entries, prefix = "") => {
    requireCondition(Array.isArray(entries), "STAGING_VERCEL_FILE_TREE");
    for (const entry of entries) {
      requireCondition(
        object(entry) &&
          text(entry.name) &&
          !entry.name.includes("/") &&
          ![".", ".."].includes(entry.name),
        "STAGING_VERCEL_FILE_TREE",
      );
      const file = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.type === "directory") {
        requireCondition(Array.isArray(entry.children), "STAGING_VERCEL_FILE_TREE");
        walk(entry.children, file);
      } else {
        requireCondition(
          entry.type === "file" && /^[a-f0-9]{40}$/.test(entry.uid),
          "STAGING_VERCEL_FILE_TREE",
        );
        files.push({ file, sha: entry.uid });
      }
    }
  };
  walk(value);
  requireCondition(files.length > 0, "STAGING_VERCEL_FILE_TREE");
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

function normalizeCandidate(value, expected, { allowedStagingAliases = [] } = {}) {
  requireCondition(
    value?.id === expected.deploymentId &&
      value.projectId === TARGET.vercelProjectId &&
      value.ownerId === TARGET.vercelTeamId &&
      (!value.team || value.team.id === TARGET.vercelTeamId) &&
      (!value.project || value.project.id === TARGET.vercelProjectId),
    "STAGING_VERCEL_CANDIDATE_IDENTITY",
  );
  requireCondition(
    value.target == null &&
      value.readyState === "READY" &&
      value.deletedAt == null &&
      value.softDeletedByRetention !== true &&
      value.readySubstate !== "ROLLING",
    "STAGING_VERCEL_CANDIDATE_NOT_READY",
  );
  requireCondition(
    value.gitSource == null &&
      value.meta?.githubCommitSha === expected.sourceSha &&
      value.meta?.githubCommitRef === "staging" &&
      value.meta?.mintedRepository === REPOSITORY &&
      value.meta?.mintedReleaseDigest === expected.releaseDigest &&
      value.meta?.mintedSourceTreeSha === expected.treeSha &&
      value.meta?.mintedSourceFileCount === String(expected.files.length) &&
      value.meta?.mintedVercelEnvironment === "preview",
    "STAGING_VERCEL_SOURCE_BINDING",
  );
  const aliases = Array.isArray(value.alias) ? new Set(value.alias) : new Set();
  requireCondition(
    Array.isArray(value.alias) &&
      aliases.size === value.alias.length &&
      value.alias.every((alias) => {
        if (!text(alias)) return false;
        if (allowedStagingAliases.includes(alias)) return true;
        // Fixed staging aliases and any production alias are withheld until an
        // explicit assignAlias / production path. Preview hosts may remain.
        if (STAGING_ALIASES.includes(alias) || PRODUCTION_ALIASES.includes(alias)) return false;
        return alias.endsWith(".vercel.app");
      }) &&
      allowedStagingAliases.every((alias) => aliases.has(alias)) &&
      text(value.url) &&
      value.url.endsWith(".vercel.app"),
    "STAGING_VERCEL_DOMAINS_NOT_WITHHELD",
  );
  const nodeVersion = value.nodeVersion ?? value.projectSettings?.nodeVersion;
  requireCondition(
    typeof nodeVersion === "string" &&
      /^(?:20|22|24)\.x$/.test(nodeVersion) &&
      Array.isArray(value.regions) &&
      value.regions.length > 0 &&
      value.regions.length <= 32 &&
      value.regions.every((region) => /^[a-z]{3}[0-9]$/.test(region)) &&
      timestamp(value.createdAt) &&
      timestamp(value.ready) &&
      value.ready >= value.createdAt,
    "STAGING_VERCEL_RUNTIME_METADATA",
  );
  return {
    deploymentId: expected.deploymentId,
    sourceSha: expected.sourceSha,
    target: { ...TARGET },
    configurationDigest: expected.configurationDigest,
    releaseDigest: expected.releaseDigest,
    readyState: "READY",
    domainsWithheld: allowedStagingAliases.length === 0,
  };
}

async function verifiedFile(checkoutRoot, entry) {
  try {
    const path = join(checkoutRoot, entry.file);
    const stat = await lstat(path);
    requireCondition(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.nlink === 1 &&
        stat.size <= MAX_FILE_BYTES &&
        ((stat.mode & 0o111) !== 0) === (entry.mode === "100755"),
      "STAGING_VERCEL_SOURCE_CHANGED",
    );
    const bytes = await readFile(path);
    const gitBlob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    requireCondition(
      bytes.length === stat.size && gitBlob === entry.blob,
      "STAGING_VERCEL_SOURCE_CHANGED",
    );
    return {
      file: entry.file,
      sha: createHash("sha1").update(bytes).digest("hex"),
      size: bytes.length,
      bytes,
    };
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError("STAGING_VERCEL_SOURCE_CHANGED");
  }
}

async function mapUploads(entries, task) {
  const output = new Array(entries.length);
  let next = 0;
  let stopped = false;
  let failure;
  const worker = async () => {
    while (!stopped) {
      const index = next++;
      if (index >= entries.length) return;
      try {
        output[index] = await task(entries[index]);
      } catch (error) {
        stopped = true;
        failure ??= error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, entries.length) }, () => worker()),
  );
  if (failure) throw failure;
  return output;
}

function pause() {
  return new Promise((resolve) => setTimeout(resolve, POLL_MS));
}

function defaultTransport(credential) {
  requireCondition(
    typeof credential === "string" && credential.length > 0,
    "STAGING_VERCEL_CREDENTIAL_MISSING",
  );
  return async ({ method, path, body, raw, signal }) => {
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${credential}`,
          Accept: "application/json",
          ...(raw
            ? {
                "Content-Type": "application/octet-stream",
                "Content-Length": String(body.length),
                "x-vercel-digest": createHash("sha1").update(body).digest("hex"),
              }
            : body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
        redirect: "error",
        signal,
      });
    } catch {
      throw new DeliveryError(
        method === "GET" ? "STAGING_VERCEL_READ_FAILED" : "STAGING_VERCEL_WRITE_UNCERTAIN",
      );
    }
    requireCondition(
      response.ok,
      method === "GET" ? "STAGING_VERCEL_READ_REJECTED" : "STAGING_VERCEL_WRITE_REJECTED",
    );
    if (raw) return {};
    requireCondition(
      /^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? ""),
      "STAGING_VERCEL_RESPONSE_INVALID",
    );
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        requireCondition(size <= MAX_BYTES, "STAGING_VERCEL_RESPONSE_TOO_LARGE");
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      if (error instanceof DeliveryError) throw error;
      throw new DeliveryError("STAGING_VERCEL_RESPONSE_INVALID");
    }
  };
}

export function createStagingVercel(options) {
  requireCondition(object(options), "STAGING_VERCEL_OPTIONS_REJECTED");
  requireCondition(
    Object.keys(options).every((key) =>
      ["credential", "transport", "github", "checkoutRoot", "ciRunId", "extensionId"].includes(key),
    ),
    "STAGING_VERCEL_OPTIONS_REJECTED",
  );
  requireCondition(
    typeof options.github?.request === "function" &&
      typeof options.checkoutRoot === "string" &&
      options.checkoutRoot.startsWith("/") &&
      !(options.credential && options.transport) &&
      (options.transport === undefined || typeof options.transport === "function"),
    "STAGING_VERCEL_OPTIONS_REJECTED",
  );
  requireId(options.ciRunId);
  requireCondition(extensionId(options.extensionId), "STAGING_EXTENSION_ID_INVALID");
  const requiredExtensionId = options.extensionId;
  const requiredExtensionOrigin = `chrome-extension://${requiredExtensionId}`;
  const transport = options.transport ?? defaultTransport(options.credential);
  const request = async ({ method, path, body, raw = false, deadline }) => {
    const controller = new AbortController();
    let timer;
    try {
      if (!raw && body !== undefined) {
        requireCondition(
          Buffer.byteLength(JSON.stringify(body)) <= MAX_BYTES,
          "STAGING_VERCEL_REQUEST_TOO_LARGE",
        );
      }
      const remaining =
        deadline === undefined ? REQUEST_MS : Math.min(REQUEST_MS, deadline - Date.now());
      requireCondition(remaining > 0, "STAGING_VERCEL_COLLECTION_TIMEOUT");
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new DeliveryError(
              deadline === undefined
                ? "STAGING_VERCEL_REQUEST_TIMEOUT"
                : "STAGING_VERCEL_COLLECTION_TIMEOUT",
            ),
          );
        }, remaining);
      });
      const value = await Promise.race([
        transport({ method, path, body, raw, signal: controller.signal }),
        timeout,
      ]);
      requireCondition(object(value) || Array.isArray(value), "STAGING_VERCEL_RESPONSE_INVALID");
      requireCondition(
        Buffer.byteLength(JSON.stringify(value)) <= MAX_BYTES,
        "STAGING_VERCEL_RESPONSE_TOO_LARGE",
      );
      return value;
    } catch (error) {
      if (error instanceof DeliveryError && error.code.startsWith("STAGING_VERCEL_")) throw error;
      throw new DeliveryError(
        method === "GET" ? "STAGING_VERCEL_READ_FAILED" : "STAGING_VERCEL_WRITE_UNCERTAIN",
      );
    } finally {
      clearTimeout(timer);
    }
  };

  const noActiveDeployments = async (deadline) => {
    let until;
    const seen = new Set();
    const cursors = new Set();
    for (let page = 0; page < MAX_PAGES; page++) {
      const value = await request({
        method: "GET",
        deadline,
        path: pathFor("/v7/deployments", {
          projectId: TARGET.vercelProjectId,
          limit: "100",
          ...(until === undefined ? {} : { until: String(until) }),
        }),
      });
      normalizePage(value, seen);
      if (value.pagination.next == null) return seen.size;
      const next = Number(value.pagination.next);
      requireCondition(
        Number.isSafeInteger(next) &&
          next > 0 &&
          !cursors.has(next) &&
          (until === undefined || next < until),
        "STAGING_VERCEL_DEPLOYMENT_PAGINATION",
      );
      cursors.add(next);
      until = next;
    }
    throw new DeliveryError("STAGING_VERCEL_DEPLOYMENT_PAGINATION");
  };

  const collectReadiness = async ({ allowCurrentExtensionIdentity = false } = {}) => {
    const deadline = Date.now() + COLLECTION_MS;
    const read = (input) => request({ ...input, deadline });
    const collect = async () => {
      const project = normalizeProject(
        await read({
          method: "GET",
          path: pathFor(`/v9/projects/${TARGET.vercelProjectId}`),
        }),
      );
      const environmentResponse = await read({
        method: "GET",
        path: pathFor(`/v10/projects/${TARGET.vercelProjectId}/env`, { decrypt: "false" }),
      });
      const actualExtensionId = environmentIdentity(environmentResponse);
      requireCondition(
        allowCurrentExtensionIdentity || actualExtensionId === requiredExtensionId,
        "STAGING_VERCEL_EXTENSION_IDENTITY_DRIFT",
      );
      const environment = normalizeEnvironment(environmentResponse, actualExtensionId);
      const shared = normalizeShared(
        await read({
          method: "GET",
          path: pathFor("/v1/env", { projectId: TARGET.vercelProjectId }),
        }),
      );
      const domains = normalizeDomains(
        await read({
          method: "GET",
          path: pathFor(`/v9/projects/${TARGET.vercelProjectId}/domains`),
        }),
      );
      return { project, environment, shared, domains, actualExtensionId };
    };
    const first = await collect();
    const deploymentCount = await noActiveDeployments(deadline);
    const final = await collect();
    await noActiveDeployments(deadline);
    requireCondition(
      canonicalDigest(first) === canonicalDigest(final),
      "STAGING_VERCEL_COLLECTION_DRIFT",
    );
    const extensionIdentity =
      final.actualExtensionId === null
        ? { configured: false }
        : {
            configured: true,
            extensionId: final.actualExtensionId,
            extensionOrigin: `chrome-extension://${final.actualExtensionId}`,
          };
    return {
      version: 1,
      target: { ...TARGET },
      project: final.project,
      environment: final.environment,
      shared: final.shared,
      domains: final.domains,
      deploymentCount,
      activeDeployments: [],
      configurationDigest: canonicalDigest({
        target: TARGET,
        project: final.project,
        environment: final.environment,
        shared: final.shared,
        extensionIdentity,
      }),
      configurationIdentityKind: "fixed-project-settings-and-exact-preview-env-metadata",
      extensionIdentity,
      previewProtection: "VERCEL_AUTHENTICATION_EXCEPT_CUSTOM_DOMAINS",
      runtimeDatabaseBinding: "UNVERIFIED",
    };
  };

  const readDeployment = async (id) =>
    request({
      method: "GET",
      path: pathFor(`/v13/deployments/${id}`, { withGitRepoInfo: "true" }),
    });

  const waitForCandidate = async (expected) => {
    for (let poll = 0; poll < MAX_POLLS; poll++) {
      const value = await readDeployment(expected.deploymentId);
      if (value.readyState === "READY") return normalizeCandidate(value, expected);
      requireCondition(BUILDING.has(value.readyState), "STAGING_VERCEL_CANDIDATE_NOT_READY");
      await pause();
    }
    throw new DeliveryError("STAGING_VERCEL_CANDIDATE_TIMEOUT");
  };

  const built = new Map();
  return Object.freeze({
    async configureExtensionIdentity() {
      const before = await collectReadiness({ allowCurrentExtensionIdentity: true });
      if (before.extensionIdentity.extensionId === requiredExtensionId) {
        const after = await collectReadiness();
        return {
          changed: false,
          extensionId: requiredExtensionId,
          extensionOrigin: requiredExtensionOrigin,
          before,
          after,
        };
      }
      await request({
        method: "POST",
        path: pathFor(`/v10/projects/${TARGET.vercelProjectId}/env`, { upsert: "true" }),
        body: [
          {
            key: "API_CORS_ORIGINS",
            value: `${BASE_CORS},${requiredExtensionOrigin}`,
            type: "plain",
            target: ["preview"],
          },
          {
            key: "VITE_MINTED_EXTENSION_ID",
            value: requiredExtensionId,
            type: "plain",
            target: ["preview"],
          },
        ],
      });
      const after = await collectReadiness();
      return {
        changed: true,
        extensionId: requiredExtensionId,
        extensionOrigin: requiredExtensionOrigin,
        before,
        after,
      };
    },
    async assertReady(input) {
      optionsOnly(input, ["target"]);
      requireCondition(input.target === "staging", "EXPLICIT_TARGET_REQUIRED");
      return collectReadiness({ allowCurrentExtensionIdentity: true });
    },
    async collectReadiness() {
      return collectReadiness();
    },
    async build(input) {
      optionsOnly(input, [
        "target",
        "sourceSha",
        "releaseDigest",
        "withholdDomains",
        "gitBranch",
        "vercelEnvironment",
      ]);
      requireCondition(
        canonicalDigest(input.target) === canonicalDigest(TARGET) &&
          input.withholdDomains === true &&
          input.gitBranch === "staging" &&
          input.vercelEnvironment === "preview" &&
          /^[a-f0-9]{64}$/.test(input.releaseDigest),
        "STAGING_VERCEL_BUILD_BINDING",
      );
      requireSha(input.sourceSha);
      const readiness = await collectReadiness();
      const sourceOptions = {
        github: options.github,
        checkoutRoot: options.checkoutRoot,
        ciRunId: options.ciRunId,
        sourceSha: input.sourceSha,
      };
      const source = await prepareStagingSourceUpload(sourceOptions);
      const files = await mapUploads(source.files, async (entry) => {
        const file = await verifiedFile(options.checkoutRoot, entry);
        await request({
          method: "POST",
          path: pathFor("/v2/files"),
          body: file.bytes,
          raw: true,
        });
        return { file: file.file, sha: file.sha, size: file.size };
      });
      const finalSource = await prepareStagingSourceUpload(sourceOptions);
      requireCondition(
        canonicalDigest(source.preflight) === canonicalDigest(finalSource.preflight) &&
          canonicalDigest(source.files) === canonicalDigest(finalSource.files),
        "STAGING_VERCEL_SOURCE_CHANGED",
      );
      const response = await request({
        method: "POST",
        path: pathFor("/v13/deployments"),
        body: {
          name: PROJECT_NAME,
          project: TARGET.vercelProjectId,
          files,
          gitMetadata: {
            remoteUrl: `https://github.com/${REPOSITORY}.git`,
            commitRef: "staging",
            commitSha: input.sourceSha,
            dirty: false,
            ci: true,
            ciType: "github-actions",
            rootDirectory: "",
          },
          meta: {
            githubCommitSha: input.sourceSha,
            githubCommitRef: "staging",
            mintedRepository: REPOSITORY,
            mintedReleaseDigest: input.releaseDigest,
            mintedSourceTreeSha: source.preflight.treeSha,
            mintedSourceFileCount: String(files.length),
            mintedVercelEnvironment: "preview",
          },
        },
      });
      requireCondition(deploymentId(response.id), "STAGING_VERCEL_CREATE_RESPONSE");
      const expected = {
        deploymentId: response.id,
        sourceSha: input.sourceSha,
        releaseDigest: input.releaseDigest,
        treeSha: source.preflight.treeSha,
        files,
        configurationDigest: readiness.configurationDigest,
      };
      const candidate = await waitForCandidate(expected);
      const uploaded = flattenFileTree(
        await request({
          method: "GET",
          path: pathFor(`/v6/deployments/${candidate.deploymentId}/files`),
        }),
      );
      requireCondition(
        canonicalDigest(uploaded) ===
          canonicalDigest(
            files
              .map(({ file, sha }) => ({ file, sha }))
              .sort((a, b) => a.file.localeCompare(b.file)),
          ),
        "STAGING_VERCEL_FILE_TREE",
      );
      const finalReadiness = await collectReadiness();
      requireCondition(
        finalReadiness.configurationDigest === readiness.configurationDigest,
        "STAGING_VERCEL_CONFIGURATION_DRIFT",
      );
      built.set(candidate.deploymentId, {
        sourceSha: candidate.sourceSha,
        releaseDigest: candidate.releaseDigest,
        treeSha: source.preflight.treeSha,
        files,
        configurationDigest: candidate.configurationDigest,
        assignedAliases: new Set(),
      });
      return candidate;
    },
    async checkCandidate(input) {
      optionsOnly(input, ["deploymentId", "releaseDigest"]);
      requireCondition(
        deploymentId(input.deploymentId) && /^[a-f0-9]{64}$/.test(input.releaseDigest),
        "STAGING_VERCEL_CANDIDATE_BINDING",
      );
      const expected = built.get(input.deploymentId);
      requireCondition(
        expected?.releaseDigest === input.releaseDigest,
        "STAGING_VERCEL_CANDIDATE_BINDING",
      );
      const candidate = normalizeCandidate(
        await readDeployment(input.deploymentId),
        { ...expected, deploymentId: input.deploymentId },
        { allowedStagingAliases: [...expected.assignedAliases] },
      );
      const readiness = await collectReadiness();
      requireCondition(
        readiness.configurationDigest === expected.configurationDigest,
        "STAGING_VERCEL_CONFIGURATION_DRIFT",
      );
      return {
        candidate,
        configurationDigest: readiness.configurationDigest,
        extensionIdentity: readiness.extensionIdentity,
        previewProtection: readiness.previewProtection,
      };
    },
    async assignAlias(input) {
      optionsOnly(input, ["alias", "deploymentId", "releaseDigest"]);
      requireCondition(
        STAGING_ALIASES.includes(input.alias) &&
          deploymentId(input.deploymentId) &&
          /^[a-f0-9]{64}$/.test(input.releaseDigest),
        "STAGING_VERCEL_ALIAS_BINDING",
      );
      const expected = built.get(input.deploymentId);
      requireCondition(
        expected?.releaseDigest === input.releaseDigest &&
          !expected.assignedAliases.has(input.alias),
        "STAGING_VERCEL_ALIAS_BINDING",
      );
      normalizeCandidate(
        await readDeployment(input.deploymentId),
        {
          ...expected,
          deploymentId: input.deploymentId,
        },
        { allowedStagingAliases: [...expected.assignedAliases] },
      );
      const assigned = await request({
        method: "POST",
        path: pathFor(`/v2/deployments/${input.deploymentId}/aliases`),
        body: { alias: input.alias },
      });
      requireCondition(
        assigned.alias === input.alias &&
          text(assigned.uid) &&
          (assigned.oldDeploymentId == null || deploymentId(assigned.oldDeploymentId)),
        "STAGING_VERCEL_ALIAS_RESPONSE",
      );
      const readback = await request({
        method: "GET",
        path: pathFor(`/v4/aliases/${input.alias}`),
      });
      requireCondition(
        readback.alias === input.alias &&
          readback.projectId === TARGET.vercelProjectId &&
          readback.deploymentId === input.deploymentId &&
          readback.deployment?.id === input.deploymentId &&
          readback.redirect == null &&
          readback.deletedAt == null &&
          readback.microfrontends == null,
        "STAGING_VERCEL_ALIAS_READBACK",
      );
      expected.assignedAliases.add(input.alias);
      return {
        alias: input.alias,
        deploymentId: input.deploymentId,
        oldDeploymentId: assigned.oldDeploymentId ?? null,
      };
    },
  });
}

/**
 * Fixed Vercel half of the future hosted staging composition. The final
 * integration must provide authenticated recovery snapshot/check services;
 * these provider-only readbacks are deliberately not controller G0 evidence.
 */
export function createStagingVercelServices(options) {
  const provider = createStagingVercel(options);
  return Object.freeze({
    assertReady: (input) => provider.assertReady(input),
    // Pre-mutation snapshots must preserve the aligned current identity (or
    // its legacy absence) so the later integration can bind rollback evidence
    // before its explicit configuration transition under the shared lease.
    snapshotVercel: () => provider.assertReady({ target: "staging" }),
    configureExtensionIdentity: () => provider.configureExtensionIdentity(),
    build: (input) => provider.build(input),
    checkCandidate: (input) => provider.checkCandidate(input),
    assignAlias: (input) => provider.assignAlias(input),
  });
}
