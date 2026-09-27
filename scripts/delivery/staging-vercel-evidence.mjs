import { canonicalDigest, releaseTarget } from "../release/contract.mjs";
import { DeliveryError, requireCondition, requireSha } from "./boundary.mjs";
import {
  NATIVE_EXTENSION_PROOF,
  RUNTIME_DATABASE_BINDING,
  blockedQualification,
  exactTimestamp,
  evidenceDigest,
  redactedError,
} from "./staging-evidence.mjs";

const TARGET = Object.freeze(releaseTarget("staging"));
const API = "https://api.vercel.com";
const REPOSITORY = "sonny303/mintedpanel";
const PROJECT_NAME = "mintedpanel-staging-web";
const STAGING_ALIASES = Object.freeze([
  "mintedpanel-staging.vercel.app",
  "staging.mintedpanel.com",
]);
const GENERATED_DOMAIN = "mintedpanel-staging-web.vercel.app";
const SUPABASE_URL = `https://${TARGET.supabaseRef}.supabase.co`;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PAGES = 20;
const REQUEST_MS = 30_000;
const COLLECTION_MS = 60_000;
const terminalStates = new Set(["READY", "ERROR", "CANCELED", "DELETED"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 512) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f]/.test(value);
const deploymentId = (value) =>
  typeof value === "string" && /^dpl_[A-Za-z0-9_]{1,100}$/.test(value);
const extensionId = (value) => typeof value === "string" && /^[a-p]{32}$/.test(value);
const timestamp = (value) => Number.isSafeInteger(value) && value > 0;
const equal = (left, right) => canonicalDigest(left) === canonicalDigest(right);

function optionsOnly(value, keys) {
  requireCondition(
    object(value) && Object.keys(value).every((key) => keys.includes(key)),
    "STAGING_VERCEL_EVIDENCE_OPTIONS_REJECTED",
  );
}

function pathFor(path, query = {}) {
  return `${path}?${new URLSearchParams({ ...query, teamId: TARGET.vercelTeamId })}`;
}

async function httpsRead({ credential, path, signal }) {
  requireCondition(
    typeof credential === "string" && credential.length > 0,
    "STAGING_VERCEL_EVIDENCE_CREDENTIAL_MISSING",
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
    throw new DeliveryError("STAGING_VERCEL_EVIDENCE_READ_FAILED");
  }
  requireCondition(response.ok, "STAGING_VERCEL_EVIDENCE_READ_REJECTED");
  requireCondition(
    /^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? ""),
    "STAGING_VERCEL_EVIDENCE_RESPONSE_INVALID",
  );
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      requireCondition(size <= MAX_BYTES, "STAGING_VERCEL_EVIDENCE_RESPONSE_TOO_LARGE");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError("STAGING_VERCEL_EVIDENCE_RESPONSE_INVALID");
  }
}

function normalizeProject(value) {
  requireCondition(
    value?.id === TARGET.vercelProjectId &&
      value.name === PROJECT_NAME &&
      value.accountId === TARGET.vercelTeamId &&
      value.link == null &&
      value.autoAssignCustomDomains === false &&
      value.rootDirectory == null &&
      typeof value.nodeVersion === "string" &&
      /^(?:20|22|24)\.x$/.test(value.nodeVersion),
    "STAGING_VERCEL_EVIDENCE_PROJECT_IDENTITY",
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
    settings[key] = value[key] ?? null;
  requireCondition(
    equal(value.ssoProtection, { deploymentType: "all_except_custom_domains" }),
    "STAGING_VERCEL_EVIDENCE_PROTECTION_DRIFT",
  );
  requireCondition(
    value.protectionBypass === undefined ||
      (object(value.protectionBypass) && Object.keys(value.protectionBypass).length === 0),
    "STAGING_VERCEL_EVIDENCE_PROTECTION_DRIFT",
  );
  return {
    id: TARGET.vercelProjectId,
    name: PROJECT_NAME,
    teamId: TARGET.vercelTeamId,
    gitDisconnected: true,
    autoAssignCustomDomains: false,
    nodeVersion: value.nodeVersion,
    settingsDigest: evidenceDigest(settings),
  };
}

function anonRef(value) {
  try {
    const parts = value.split(".");
    requireCondition(parts.length === 3, "STAGING_VERCEL_EVIDENCE_ENV_BINDING");
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    requireCondition(
      claims.ref === TARGET.supabaseRef &&
        claims.role === "anon" &&
        Number.isFinite(claims.exp) &&
        claims.exp > Math.floor(Date.now() / 1000),
      "STAGING_VERCEL_EVIDENCE_ENV_BINDING",
    );
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    throw new DeliveryError("STAGING_VERCEL_EVIDENCE_ENV_BINDING");
  }
}

function normalizeEnvironment(response) {
  requireCondition(
    object(response) &&
      Array.isArray(response.envs) &&
      response.envs.length > 0 &&
      response.envs.length <= 8,
    "STAGING_VERCEL_EVIDENCE_ENV_INVENTORY",
  );
  requireCondition(
    response.hiddenProductionEnvCount === undefined || response.hiddenProductionEnvCount === 0,
    "STAGING_VERCEL_EVIDENCE_ENV_INVENTORY",
  );
  requireCondition(
    !response.pagination || response.pagination.next == null,
    "STAGING_VERCEL_EVIDENCE_ENV_PAGINATION",
  );
  const expected = new Set([
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
    "API_CORS_ORIGINS",
    "VITE_MINTED_EXTENSION_ID",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);
  const mandatory = new Set([
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
    "API_CORS_ORIGINS",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);
  const seen = new Set();
  let actualExtensionId = null;
  let anon = [];
  const result = response.envs.map((entry) => {
    requireCondition(
      object(entry) && expected.has(entry.key) && !seen.has(entry.key),
      "STAGING_VERCEL_EVIDENCE_ENV_INVENTORY",
    );
    seen.add(entry.key);
    const targets = typeof entry.target === "string" ? [entry.target] : entry.target;
    const customEnvironmentIds = entry.customEnvironmentIds ?? [];
    requireCondition(
      text(entry.id) &&
        ["plain", "encrypted", "sensitive", "secret"].includes(entry.type) &&
        Array.isArray(targets) &&
        targets.length === 1 &&
        targets[0] === "preview" &&
        entry.gitBranch == null &&
        Array.isArray(customEnvironmentIds) &&
        customEnvironmentIds.length === 0 &&
        timestamp(entry.createdAt) &&
        timestamp(entry.updatedAt) &&
        entry.updatedAt >= entry.createdAt,
      "STAGING_VERCEL_EVIDENCE_ENV_METADATA",
    );
    requireCondition(
      entry.configurationId == null ||
        (text(entry.configurationId) && !/[\u0000-\u001f]/.test(entry.configurationId)),
      "STAGING_VERCEL_EVIDENCE_ENV_METADATA",
    );
    requireCondition(
      entry.visibility == null || ["config", "secret"].includes(entry.visibility),
      "STAGING_VERCEL_EVIDENCE_ENV_METADATA",
    );
    if (entry.key === "VITE_MINTED_EXTENSION_ID") {
      requireCondition(extensionId(entry.value), "STAGING_VERCEL_EVIDENCE_EXTENSION_IDENTITY");
      actualExtensionId = entry.value;
    }
    if (
      ["VITE_SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"].includes(
        entry.key,
      )
    ) {
      requireCondition(typeof entry.value === "string", "STAGING_VERCEL_EVIDENCE_ENV_BINDING");
      anon.push(entry.value);
      anonRef(entry.value);
    }
    if (["VITE_SUPABASE_URL", "SUPABASE_URL"].includes(entry.key))
      requireCondition(entry.value === SUPABASE_URL, "STAGING_VERCEL_EVIDENCE_ENV_BINDING");
    if (entry.key === "SUPABASE_SERVICE_ROLE_KEY")
      requireCondition(
        ["sensitive", "encrypted", "secret"].includes(entry.type),
        "STAGING_VERCEL_EVIDENCE_ENV_METADATA",
      );
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
  requireCondition(seen.size === 7 || seen.size === 8, "STAGING_VERCEL_EVIDENCE_ENV_INVENTORY");
  for (const key of mandatory)
    requireCondition(seen.has(key), "STAGING_VERCEL_EVIDENCE_ENV_INVENTORY");
  requireCondition(
    anon.length === 3 && new Set(anon).size === 1,
    "STAGING_VERCEL_EVIDENCE_ENV_INVENTORY",
  );
  const cors = response.envs.find((entry) => entry.key === "API_CORS_ORIGINS");
  requireCondition(cors, "STAGING_VERCEL_EVIDENCE_ENV_INVENTORY");
  const expectedOrigins = [
    ...STAGING_ALIASES.map((alias) => `https://${alias}`),
    ...(actualExtensionId === null ? [] : [`chrome-extension://${actualExtensionId}`]),
  ];
  const actualOrigins =
    typeof cors.value === "string" &&
    cors.value.length > 0 &&
    cors.value.length <= 2048 &&
    !/[\u0000-\u001f]/.test(cors.value)
      ? cors.value.split(",")
      : null;
  const corsOriginsMatch =
    actualOrigins !== null &&
    actualOrigins.every((origin) => text(origin, 512)) &&
    actualOrigins.length === expectedOrigins.length &&
    actualOrigins
      .slice()
      .sort()
      .every((origin, index) => origin === expectedOrigins.slice().sort()[index]);
  return {
    entries: result.sort((left, right) => left.key.localeCompare(right.key)),
    extensionIdentity:
      actualExtensionId === null
        ? { configured: false }
        : { configured: true, extensionId: actualExtensionId },
    corsOriginsDigest: evidenceDigest(
      actualOrigins === null
        ? { invalid: true, type: typeof cors.value }
        : actualOrigins.slice().sort(),
    ),
    corsOriginsMatch,
  };
}

function normalizeAlias(value, alias) {
  requireCondition(
    value?.alias === alias &&
      value.projectId === TARGET.vercelProjectId &&
      deploymentId(value.deploymentId) &&
      value.deletedAt == null &&
      value.redirect == null &&
      value.microfrontends == null &&
      (!value.deployment || value.deployment.id === value.deploymentId),
    "STAGING_VERCEL_EVIDENCE_ALIAS_IDENTITY",
  );
  return [alias, value.deploymentId];
}

function observeAlias(value, alias) {
  requireCondition(
    value?.alias === alias &&
      text(value.projectId) &&
      deploymentId(value.deploymentId) &&
      (value.redirect == null || text(value.redirect, 512)),
    "STAGING_VERCEL_EVIDENCE_ALIAS_RESPONSE",
  );
  return {
    alias,
    projectId: value.projectId,
    deploymentId: value.deploymentId,
    redirect: value.redirect ?? null,
    deleted: value.deletedAt != null,
    microfrontends: value.microfrontends != null,
    deploymentMatches: !value.deployment || value.deployment.id === value.deploymentId,
  };
}

function normalizeDeployment(value, expectedDeploymentId, sourceSha) {
  requireCondition(
    value?.id === expectedDeploymentId &&
      value.projectId === TARGET.vercelProjectId &&
      value.ownerId === TARGET.vercelTeamId &&
      (!value.team || value.team.id === TARGET.vercelTeamId) &&
      (!value.project || value.project.id === TARGET.vercelProjectId) &&
      value.target == null &&
      value.readyState === "READY" &&
      value.deletedAt == null &&
      value.softDeletedByRetention !== true &&
      value.readySubstate !== "ROLLING",
    "STAGING_VERCEL_EVIDENCE_DEPLOYMENT_IDENTITY",
  );
  requireCondition(
    value.meta?.githubCommitSha === sourceSha &&
      value.meta?.githubCommitRef === "staging" &&
      value.meta?.mintedRepository === REPOSITORY &&
      value.meta?.mintedVercelEnvironment === "preview",
    "STAGING_VERCEL_EVIDENCE_SOURCE_SHA",
  );
  const nodeVersion = value.nodeVersion ?? value.projectSettings?.nodeVersion;
  requireCondition(
    typeof nodeVersion === "string" && /^(?:20|22|24)\.x$/.test(nodeVersion),
    "STAGING_VERCEL_EVIDENCE_RUNTIME",
  );
  requireCondition(
    Array.isArray(value.regions) &&
      value.regions.length > 0 &&
      value.regions.length <= 32 &&
      value.regions.every((region) => /^[a-z]{3}[0-9]$/.test(region)),
    "STAGING_VERCEL_EVIDENCE_RUNTIME",
  );
  requireCondition(
    timestamp(value.createdAt) && timestamp(value.ready) && value.ready >= value.createdAt,
    "STAGING_VERCEL_EVIDENCE_RUNTIME",
  );
  return {
    deploymentId: expectedDeploymentId,
    source: { provider: "vercel", repository: REPOSITORY, ref: "staging", sha: sourceSha },
    readyState: "READY",
    readySubstate: value.readySubstate ?? null,
    createdAt: value.createdAt,
    readyAt: value.ready,
    runtime: {
      nodeVersion,
      regions: [...value.regions].sort(),
      identityEndpoint: "UNAVAILABLE",
      databaseBinding: RUNTIME_DATABASE_BINDING,
      health: "UNVERIFIED",
      nativeExtensionProof: NATIVE_EXTENSION_PROOF,
    },
  };
}

function observeDeployment(value, expectedDeploymentId, expectedSourceSha) {
  requireCondition(
    value?.id === expectedDeploymentId &&
      deploymentId(value.id) &&
      text(value.projectId, 128) &&
      text(value.ownerId, 128),
    "STAGING_VERCEL_EVIDENCE_DEPLOYMENT_RESPONSE",
  );
  const source = value.meta?.githubCommitSha;
  const sourceRef = text(value.meta?.githubCommitRef, 128) ? value.meta.githubCommitRef : null;
  const repository = text(value.meta?.mintedRepository, 256) ? value.meta.mintedRepository : null;
  const sourceSha = typeof source === "string" && /^[a-f0-9]{40}$/.test(source) ? source : null;
  const nodeVersion = value.nodeVersion ?? value.projectSettings?.nodeVersion;
  const runtime = {
    nodeVersion:
      typeof nodeVersion === "string" && /^(?:20|22|24)\.x$/.test(nodeVersion) ? nodeVersion : null,
    regions: Array.isArray(value.regions)
      ? value.regions.filter((region) => /^[a-z]{3}[0-9]$/.test(region)).sort()
      : [],
    identityEndpoint: "UNAVAILABLE",
    databaseBinding: RUNTIME_DATABASE_BINDING,
    health: "UNVERIFIED",
    nativeExtensionProof: NATIVE_EXTENSION_PROOF,
  };
  return {
    deploymentId: expectedDeploymentId,
    projectId: value.projectId,
    ownerId: value.ownerId,
    source: {
      provider: "vercel",
      repository: typeof repository === "string" ? repository : null,
      ref: typeof sourceRef === "string" ? sourceRef : null,
      sha: sourceSha,
    },
    readyState: text(value.readyState, 64) ? value.readyState : null,
    readySubstate: text(value.readySubstate, 64) ? value.readySubstate : null,
    createdAt: timestamp(value.createdAt) ? value.createdAt : null,
    readyAt: timestamp(value.ready) ? value.ready : null,
    runtime,
    binding: {
      projectMatches: value.projectId === TARGET.vercelProjectId,
      teamMatches: value.ownerId === TARGET.vercelTeamId,
      previewTarget: value.target == null,
      ready:
        value.readyState === "READY" &&
        value.deletedAt == null &&
        value.readySubstate !== "ROLLING",
      repositoryMatches: repository === REPOSITORY,
      sourceRefMatches: sourceRef === "staging",
      sourceShaMatches: sourceSha === expectedSourceSha,
      runtimeMetadataComplete:
        runtime.nodeVersion !== null &&
        runtime.regions.length > 0 &&
        runtime.regions.length === (Array.isArray(value.regions) ? value.regions.length : 0),
    },
  };
}

function normalizeSharedEnvironment(response) {
  requireCondition(
    object(response) && Array.isArray(response.data) && response.data.length <= 200,
    "STAGING_VERCEL_EVIDENCE_SHARED_ENV",
  );
  requireCondition(
    !response.pagination || response.pagination.next == null,
    "STAGING_VERCEL_EVIDENCE_SHARED_ENV",
  );
  return response.data
    .map((entry) => {
      requireCondition(
        object(entry) && text(entry.id) && text(entry.key, 256),
        "STAGING_VERCEL_EVIDENCE_SHARED_ENV",
      );
      return { id: entry.id, key: entry.key };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

function normalizeDomains(response) {
  requireCondition(
    object(response) &&
      Array.isArray(response.domains) &&
      response.domains.length <= 1 + STAGING_ALIASES.length,
    "STAGING_VERCEL_EVIDENCE_DOMAINS",
  );
  requireCondition(
    !response.pagination || response.pagination.next == null,
    "STAGING_VERCEL_EVIDENCE_DOMAINS",
  );
  return response.domains
    .map((entry) => {
      requireCondition(
        object(entry) &&
          text(entry.name, 253) &&
          entry.gitBranch == null &&
          entry.redirect == null &&
          entry.customEnvironmentId == null,
        "STAGING_VERCEL_EVIDENCE_DOMAINS",
      );
      return entry.name;
    })
    .sort();
}

async function collectDeployments(request, deadline) {
  let until;
  const seen = new Set();
  const cursors = new Set();
  for (let page = 0; page < MAX_PAGES; page++) {
    const value = await request({
      path: pathFor("/v7/deployments", {
        projectId: TARGET.vercelProjectId,
        limit: "100",
        ...(until === undefined ? {} : { until: String(until) }),
      }),
      deadline,
    });
    requireCondition(
      Array.isArray(value.deployments) &&
        value.deployments.length <= 100 &&
        object(value.pagination) &&
        Number(value.pagination.count) === value.deployments.length,
      "STAGING_VERCEL_EVIDENCE_DEPLOYMENT_INVENTORY",
    );
    for (const deployment of value.deployments) {
      requireCondition(
        object(deployment) &&
          deploymentId(deployment.uid) &&
          deployment.projectId === TARGET.vercelProjectId &&
          !seen.has(deployment.uid),
        "STAGING_VERCEL_EVIDENCE_DEPLOYMENT_INVENTORY",
      );
      seen.add(deployment.uid);
      requireCondition(
        terminalStates.has(deployment.state) &&
          (deployment.readyState === undefined || deployment.readyState === deployment.state) &&
          deployment.readySubstate !== "ROLLING" &&
          deployment.checks?.["deployment-alias"]?.state !== "pending",
        "STAGING_VERCEL_EVIDENCE_COMPETING_DEPLOYMENT",
      );
    }
    if (value.pagination.next == null) return [...seen].sort();
    const next = Number(value.pagination.next);
    requireCondition(
      Number.isSafeInteger(next) &&
        next > 0 &&
        !cursors.has(next) &&
        (until === undefined || next < until),
      "STAGING_VERCEL_EVIDENCE_DEPLOYMENT_PAGINATION",
    );
    cursors.add(next);
    until = next;
  }
  throw new DeliveryError("STAGING_VERCEL_EVIDENCE_DEPLOYMENT_PAGINATION");
}

export function createStagingVercelEvidence(options = {}) {
  optionsOnly(options, ["credential", "transport", "clock"]);
  requireCondition(
    options.transport === undefined || typeof options.transport === "function",
    "STAGING_VERCEL_EVIDENCE_TRANSPORT_INVALID",
  );
  requireCondition(
    !(options.transport && options.credential),
    "STAGING_VERCEL_EVIDENCE_TRANSPORT_AMBIGUOUS",
  );
  const transport =
    options.transport ?? ((input) => httpsRead({ credential: options.credential, ...input }));
  const clock = options.clock ?? (() => new Date().toISOString());
  requireCondition(typeof clock === "function", "STAGING_VERCEL_EVIDENCE_CLOCK_INVALID");

  return Object.freeze({
    async collect(input = {}) {
      optionsOnly(input, ["sourceSha", "expectedDeploymentId"]);
      requireSha(input.sourceSha);
      if (input.expectedDeploymentId !== undefined)
        requireCondition(
          deploymentId(input.expectedDeploymentId),
          "STAGING_VERCEL_EVIDENCE_DEPLOYMENT_ID",
        );
      const collectionStartedAt = exactTimestamp(clock());
      const started = Date.now();
      const request = async ({ path, deadline }) => {
        const remaining = COLLECTION_MS - (Date.now() - started);
        requireCondition(
          remaining > 0 && (deadline === undefined || deadline - Date.now() > 0),
          "STAGING_VERCEL_EVIDENCE_COLLECTION_TIMEOUT",
        );
        const controller = new AbortController();
        let timer;
        let deadlineTimer;
        try {
          const budget = Math.min(
            REQUEST_MS,
            remaining,
            deadline === undefined ? REQUEST_MS : deadline - Date.now(),
          );
          timer = setTimeout(() => controller.abort(), budget);
          const value = await Promise.race([
            transport({ path, signal: controller.signal }),
            new Promise((_, reject) => {
              deadlineTimer = setTimeout(
                () => reject(new DeliveryError("STAGING_VERCEL_EVIDENCE_COLLECTION_TIMEOUT")),
                budget,
              );
            }),
          ]);
          requireCondition(object(value), "STAGING_VERCEL_EVIDENCE_RESPONSE_INVALID");
          requireCondition(
            Buffer.byteLength(JSON.stringify(value)) <= MAX_BYTES,
            "STAGING_VERCEL_EVIDENCE_RESPONSE_TOO_LARGE",
          );
          return value;
        } catch (error) {
          throw redactedError("STAGING_VERCEL_EVIDENCE_READ_FAILED", error);
        } finally {
          clearTimeout(timer);
          clearTimeout(deadlineTimer);
        }
      };
      const collectOnce = async () => {
        const deadline = started + COLLECTION_MS;
        const project = normalizeProject(
          await request({ path: pathFor(`/v9/projects/${TARGET.vercelProjectId}`), deadline }),
        );
        const environment = normalizeEnvironment(
          await request({
            path: pathFor(`/v10/projects/${TARGET.vercelProjectId}/env`, { decrypt: "false" }),
            deadline,
          }),
        );
        const shared = normalizeSharedEnvironment(
          await request({
            path: pathFor("/v1/env", { projectId: TARGET.vercelProjectId }),
            deadline,
          }),
        );
        const domains = normalizeDomains(
          await request({
            path: pathFor(`/v9/projects/${TARGET.vercelProjectId}/domains`),
            deadline,
          }),
        );
        const aliasPairs = [];
        for (const alias of STAGING_ALIASES)
          // Resolve the alias account-wide so an alias currently attached to a
          // competing project becomes a sanitized BLOCKED observation instead
          // of a provider 404 caused by filtering it to the target project.
          aliasPairs.push(
            observeAlias(await request({ path: pathFor(`/v4/aliases/${alias}`), deadline }), alias),
          );
        const aliasObservations = Object.fromEntries(
          aliasPairs.map((entry) => [entry.alias, entry]),
        );
        const aliases = Object.fromEntries(
          aliasPairs.map((entry) => [entry.alias, entry.deploymentId]),
        );
        const deploymentIds = new Set(Object.values(aliases));
        const servedId = aliasPairs[0].deploymentId;
        const servedDeployment = observeDeployment(
          await request({
            path: pathFor(`/v13/deployments/${servedId}`, { withGitRepoInfo: "true" }),
            deadline,
          }),
          servedId,
          input.sourceSha,
        );
        let candidateDeployment = null;
        if (input.expectedDeploymentId !== undefined && input.expectedDeploymentId !== servedId) {
          candidateDeployment = normalizeDeployment(
            await request({
              path: pathFor(`/v13/deployments/${input.expectedDeploymentId}`, {
                withGitRepoInfo: "true",
              }),
              deadline,
            }),
            input.expectedDeploymentId,
            input.sourceSha,
          );
        }
        const deploymentInventory = await collectDeployments(request, deadline);
        return {
          project,
          environment,
          shared,
          domains,
          aliasObservations,
          aliases,
          deploymentIds: [...deploymentIds].sort(),
          servedDeployment,
          candidateDeployment,
          deploymentInventory,
        };
      };
      const first = await collectOnce();
      const second = await collectOnce();
      requireCondition(equal(first, second), "STAGING_VERCEL_EVIDENCE_COLLECTION_DRIFT");
      const observedAt = exactTimestamp(clock());
      const reasons = [];
      for (const observation of Object.values(first.aliasObservations)) {
        if (observation.projectId !== TARGET.vercelProjectId)
          reasons.push("STAGING_ALIAS_PROJECT_MISMATCH");
        if (
          observation.redirect !== null ||
          observation.deleted ||
          observation.microfrontends ||
          !observation.deploymentMatches
        )
          reasons.push("STAGING_ALIAS_METADATA_MISMATCH");
      }
      if (first.deploymentIds.length !== 1) reasons.push("STAGING_ALIAS_DRIFT");
      for (const [name, value] of Object.entries(first.servedDeployment.binding))
        if (value !== true)
          reasons.push(
            `STAGING_DEPLOYMENT_${name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}_MISMATCH`,
          );
      if (first.shared.length > 0) reasons.push("STAGING_SHARED_ENV_INHERITANCE_PRESENT");
      if (!first.domains.includes(GENERATED_DOMAIN))
        reasons.push("STAGING_GENERATED_DOMAIN_MISSING");
      if (first.domains.some((domain) => ![GENERATED_DOMAIN, ...STAGING_ALIASES].includes(domain)))
        reasons.push("STAGING_DOMAIN_INVENTORY_MISMATCH");
      if (!first.environment.extensionIdentity.configured)
        reasons.push("STAGING_EXTENSION_IDENTITY_UNCONFIGURED");
      if (!first.environment.corsOriginsMatch) reasons.push("STAGING_CORS_ORIGINS_MISMATCH");
      if (first.environment.entries.length !== 8)
        reasons.push("STAGING_EXTENSION_IDENTITY_UNCONFIGURED");
      const configurationDigest = evidenceDigest({
        target: TARGET,
        project: first.project,
        environment: first.environment,
        shared: first.shared,
        domains: first.domains,
        aliases: first.aliases,
      });
      return {
        version: 1,
        collectionStartedAt,
        observedAt,
        target: { ...TARGET },
        project: first.project,
        aliases: first.aliases,
        aliasObservations: first.aliasObservations,
        sharedEnvironment: first.shared,
        domains: first.domains,
        servedDeployment: first.servedDeployment,
        candidateDeployment: first.candidateDeployment,
        environmentMetadata: first.environment.entries,
        extensionIdentity: first.environment.extensionIdentity,
        corsOriginsDigest: first.environment.corsOriginsDigest,
        corsOriginsMatch: first.environment.corsOriginsMatch,
        deploymentInventory: first.deploymentInventory,
        configurationDigest,
        configurationIdentityKind: "fixed-project-preview-env-source-and-alias-readback",
        runtimeDatabaseBinding: RUNTIME_DATABASE_BINDING,
        nativeExtensionProof: NATIVE_EXTENSION_PROOF,
        qualification: blockedQualification([
          ...reasons,
          "RUNTIME_DATABASE_IDENTITY_ENDPOINT_UNAVAILABLE",
          "NATIVE_EXTENSION_PROOF_UNAVAILABLE",
        ]),
      };
    },
  });
}
