// SIMULATED PROVIDER RESPONSES ONLY: these tests make no hosted requests.
import assert from "node:assert/strict";
import test from "node:test";
import { DeliveryError } from "./boundary.mjs";
import { createVercelRead } from "./vercel.mjs";

const PROJECT = "prj_ILhPJbkyaiptdVA8DtsmNyw3tiub";
const TEAM = "team_230fpJ9MgCj9ssW3LiIckfyA";
const DEPLOYMENT = "dpl_simulatedProduction";
const SHA = "a".repeat(40);
const SECRET = "SIMULATED_SECRET_VALUE_DO_NOT_RETURN";
const TIME = 1788800000000;

function provider() {
  const project = {
    id: PROJECT,
    accountId: TEAM,
    link: null,
    autoAssignCustomDomains: false,
    nodeVersion: "22.x",
    framework: "tanstack-start",
    buildCommand: "npm run build",
    env: [{ key: "PRIVATE", value: SECRET }],
    protectionBypass: { secret: SECRET },
  };
  const env = {
    hiddenProductionEnvCount: 0,
    envs: [
      {
        id: "env_simulated",
        key: "SUPABASE_SERVICE_ROLE_KEY",
        type: "sensitive",
        target: ["production"],
        createdAt: TIME,
        updatedAt: TIME,
        value: SECRET,
        legacyValue: SECRET,
        vsmValue: SECRET,
        internalContentHint: { encryptedValue: SECRET },
        comment: SECRET,
      },
    ],
  };
  const deployment = {
    id: DEPLOYMENT,
    projectId: PROJECT,
    ownerId: TEAM,
    team: { id: TEAM },
    project: { id: PROJECT },
    target: "production",
    readyState: "READY",
    readySubstate: "PROMOTED",
    createdAt: TIME,
    ready: TIME + 1000,
    nodeVersion: "22.x",
    regions: ["iad1"],
    gitSource: { type: "github", repoId: 1285319396, ref: "main", sha: SHA },
    meta: { githubCommitSha: SHA, githubCommitRef: "main", arbitrary: SECRET },
    env: [SECRET],
    build: { env: [SECRET] },
    oidcTokenClaims: { secret: SECRET },
  };
  const aliases = Object.fromEntries(
    ["mintedpanel.com", "www.mintedpanel.com", "mintedpanel.vercel.app"].map((alias) => [
      alias,
      {
        alias,
        projectId: PROJECT,
        deploymentId: DEPLOYMENT,
        deployment: { id: DEPLOYMENT },
        redirect: alias === "mintedpanel.com" ? "www.mintedpanel.com" : null,
        protectionBypass: { secret: SECRET },
      },
    ]),
  );
  const pages = {
    first: {
      deployments: [{ uid: DEPLOYMENT, projectId: PROJECT, state: "READY", readyState: "READY" }],
      pagination: { count: 1, next: null, prev: null },
    },
  };
  const calls = [];
  const respond = (path) => {
    const url = new URL(path, "https://api.vercel.com");
    assert.equal(url.searchParams.get("teamId"), TEAM);
    if (url.pathname === `/v9/projects/${PROJECT}`) return project;
    if (url.pathname === `/v10/projects/${PROJECT}/env`) {
      assert.equal(url.searchParams.get("decrypt"), "false");
      return env;
    }
    if (url.pathname.startsWith("/v4/aliases/")) {
      assert.equal(url.searchParams.get("projectId"), PROJECT);
      return aliases[url.pathname.slice("/v4/aliases/".length)];
    }
    if (url.pathname === `/v13/deployments/${DEPLOYMENT}`) {
      assert.equal(url.searchParams.get("withGitRepoInfo"), "true");
      return deployment;
    }
    if (url.pathname === "/v7/deployments") {
      assert.equal(url.searchParams.get("projectId"), PROJECT);
      return pages[url.searchParams.get("until") ?? "first"];
    }
    throw new Error("unexpected simulated read");
  };
  const transport = async ({ path, signal }) => {
    assert.equal(signal.aborted, false);
    calls.push(path);
    return structuredClone(respond(path));
  };
  const reader = createVercelRead({ transport });
  return {
    project,
    env,
    deployment,
    aliases,
    pages,
    calls,
    transport,
    respond,
    reader,
    collect: () =>
      reader.collect({
        target: "production",
        expectedSourceSha: SHA,
        expectedDeploymentId: DEPLOYMENT,
      }),
  };
}

test("real collector normalizes fixed production identity and leaves runtime DB/health unverified", async () => {
  const s = provider();
  const result = await s.collect();
  assert.equal(result.target.vercelProjectId, PROJECT);
  assert.equal(result.target.vercelTeamId, TEAM);
  assert.equal(result.target.supabaseRef, "fkvuhfsqcmujywzgczmc");
  assert.equal(result.project.gitDisconnected, true);
  assert.equal(result.servedDeployment.source.sha, SHA);
  assert.equal(result.servedDeployment.runtime.nodeVersion, "22.x");
  assert.equal(result.runtimeDatabaseBinding, "UNVERIFIED");
  assert.equal(result.servedDeployment.runtime.health, "UNVERIFIED");
  assert.deepEqual(result.activeDeployments, []);
  assert.match(result.configurationDigest, /^[a-f0-9]{64}$/);
  assert.ok(s.calls.filter((path) => path.includes("/v9/projects/")).length >= 2);
});

test("established apex-to-www routing is accepted and explicit in collected evidence", async () => {
  const s = provider();
  const result = await s.collect();
  assert.deepEqual(result.aliasRouting, {
    "mintedpanel.com": "www.mintedpanel.com",
    "www.mintedpanel.com": null,
    "mintedpanel.vercel.app": null,
  });
  assert.equal(result.aliases["mintedpanel.com"], DEPLOYMENT);
  assert.equal(result.aliases["www.mintedpanel.com"], DEPLOYMENT);
  assert.equal(result.aliases["mintedpanel.vercel.app"], DEPLOYMENT);
});

for (const redirect of [
  null,
  undefined,
  "elsewhere.example",
  "https://www.mintedpanel.com",
  "www.mintedpanel.com/",
]) {
  test(`apex redirect drift is rejected: ${String(redirect)}`, async () => {
    const s = provider();
    s.aliases["mintedpanel.com"].redirect = redirect;
    await assert.rejects(s.collect, { code: "VERCEL_ALIAS_ROUTING_UNSUPPORTED" });
  });
}

test("the legacy alias cannot redirect even to the otherwise accepted www host", async () => {
  const s = provider();
  s.aliases["mintedpanel.vercel.app"].redirect = "www.mintedpanel.com";
  await assert.rejects(s.collect, { code: "VERCEL_ALIAS_ROUTING_UNSUPPORTED" });
});

for (const [field, value] of [
  ["deletedAt", TIME],
  ["microfrontends", {}],
]) {
  test(`pinned apex redirect does not exempt ${field} routing restrictions`, async () => {
    const s = provider();
    s.aliases["mintedpanel.com"][field] = value;
    await assert.rejects(s.collect, { code: "VERCEL_ALIAS_ROUTING_UNSUPPORTED" });
  });
}

test("apex redirect drift during bookend reads cannot produce evidence", async () => {
  const s = provider();
  let apexReads = 0;
  const reader = createVercelRead({
    transport: async (input) => {
      if (input.path.startsWith("/v4/aliases/mintedpanel.com?") && ++apexReads === 2)
        s.aliases["mintedpanel.com"].redirect = null;
      return s.transport(input);
    },
  });
  await assert.rejects(reader.collect({ target: "production" }), {
    code: "VERCEL_ALIAS_ROUTING_UNSUPPORTED",
  });
});

test("secret values and provider private blobs never enter normalized results or value fingerprints", async () => {
  const s = provider();
  const first = await s.collect();
  assert.equal(JSON.stringify(first).includes(SECRET), false);
  assert.deepEqual(
    Object.keys(first.environmentMetadata[0]).sort(),
    [
      "id",
      "key",
      "type",
      "target",
      "gitBranch",
      "customEnvironmentIds",
      "configurationId",
      "visibility",
      "createdAt",
      "updatedAt",
    ].sort(),
  );
  s.env.envs[0].value = "DIFFERENT_SIMULATED_SECRET";
  assert.equal(
    (await s.collect()).configurationDigest,
    first.configurationDigest,
    "value bytes are discarded; identity is explicitly provider update metadata",
  );
  s.env.envs[0].updatedAt += 1;
  assert.notEqual((await s.collect()).configurationDigest, first.configurationDigest);
});

for (const [name, change] of [
  [
    "key",
    (s) => {
      s.env.envs[0].key = "CHANGED_KEY";
    },
  ],
  [
    "target",
    (s) => {
      s.env.envs[0].target = ["production", "preview"];
    },
  ],
  [
    "custom environment",
    (s) => {
      s.env.envs[0].customEnvironmentIds = ["env_custom"];
    },
  ],
  [
    "type",
    (s) => {
      s.env.envs[0].type = "encrypted";
    },
  ],
  [
    "project settings",
    (s) => {
      s.project.buildCommand = "npm run changed-build";
    },
  ],
]) {
  test(`configuration identity detects ${name} drift without disclosing secrets`, async () => {
    const s = provider();
    const before = (await s.collect()).configurationDigest;
    change(s);
    assert.notEqual((await s.collect()).configurationDigest, before);
  });
}

test("configuration identity detects preview branch drift within the same project's complete inventory", async () => {
  const s = provider();
  s.env.envs.push({
    ...s.env.envs[0],
    id: "env_preview",
    target: ["preview"],
    gitBranch: "staging",
  });
  const before = (await s.collect()).configurationDigest;
  s.env.envs[1].gitBranch = "different-branch";
  assert.notEqual((await s.collect()).configurationDigest, before);
});

for (const [name, change, code] of [
  [
    "wrong team",
    (s) => {
      s.project.accountId = "team_wrong";
    },
    "VERCEL_PROJECT_IDENTITY",
  ],
  [
    "wrong project",
    (s) => {
      s.project.id = "prj_wrong";
    },
    "VERCEL_PROJECT_IDENTITY",
  ],
  [
    "connected Git provider",
    (s) => {
      s.project.link = { type: "github", repo: "mintedpanel" };
    },
    "VERCEL_GIT_LINK_PRESENT",
  ],
  [
    "automatic domains",
    (s) => {
      s.project.autoAssignCustomDomains = true;
    },
    "VERCEL_AUTOMATIC_DOMAINS_ENABLED",
  ],
  [
    "deployment owner mismatch",
    (s) => {
      s.deployment.ownerId = "team_wrong";
    },
    "VERCEL_DEPLOYMENT_IDENTITY",
  ],
  [
    "deployment project mismatch",
    (s) => {
      s.deployment.project.id = "prj_wrong";
    },
    "VERCEL_DEPLOYMENT_IDENTITY",
  ],
  [
    "wrong production branch",
    (s) => {
      s.deployment.gitSource.ref = "staging";
    },
    "VERCEL_SOURCE_REF_MISMATCH",
  ],
  [
    "wrong source SHA",
    (s) => {
      s.deployment.gitSource.sha = "b".repeat(40);
    },
    "VERCEL_SOURCE_SHA_MISMATCH",
  ],
  [
    "wrong source repository",
    (s) => {
      s.deployment.gitSource.repoId = 1;
    },
    "VERCEL_SOURCE_REPOSITORY_MISMATCH",
  ],
  [
    "missing provider git source",
    (s) => {
      delete s.deployment.gitSource;
    },
    "VERCEL_SOURCE_UNVERIFIED",
  ],
  [
    "conflicting caller metadata",
    (s) => {
      s.deployment.meta.githubCommitSha = "b".repeat(40);
    },
    "VERCEL_SOURCE_METADATA_CONFLICT",
  ],
  [
    "Preview target",
    (s) => {
      s.deployment.target = null;
    },
    "VERCEL_DEPLOYMENT_NOT_READY_PRODUCTION",
  ],
  [
    "alias mismatch",
    (s) => {
      s.aliases["www.mintedpanel.com"].deploymentId = "dpl_other";
      delete s.aliases["www.mintedpanel.com"].deployment;
    },
    "VERCEL_ALIAS_DRIFT",
  ],
  [
    "redirecting alias",
    (s) => {
      s.aliases["www.mintedpanel.com"].redirect = "elsewhere.example";
    },
    "VERCEL_ALIAS_ROUTING_UNSUPPORTED",
  ],
  [
    "hidden production env rows",
    (s) => {
      s.env.hiddenProductionEnvCount = 1;
    },
    "VERCEL_ENV_METADATA_HIDDEN",
  ],
  [
    "unversioned env row",
    (s) => {
      delete s.env.envs[0].updatedAt;
    },
    "VERCEL_ENV_VERSION_MISSING",
  ],
  [
    "truncated env listing",
    (s) => {
      s.env.pagination = { count: 1, next: TIME, prev: null };
    },
    "VERCEL_ENV_PAGINATION_UNSUPPORTED",
  ],
]) {
  test(`collector rejects ${name}`, async () => {
    const s = provider();
    change(s);
    await assert.rejects(s.collect, { code });
  });
}

for (const state of ["BUILDING", "INITIALIZING", "QUEUED", "BLOCKED"]) {
  test(`collector rejects a competing ${state} deployment`, async () => {
    const s = provider();
    Object.assign(s.pages.first.deployments[0], { state, readyState: state });
    await assert.rejects(s.collect, { code: "VERCEL_COMPETING_DEPLOYMENT_ACTIVE" });
  });
}

test("collector follows bounded deployment pagination and rejects an active older page", async () => {
  const s = provider();
  s.pages.first.pagination.next = TIME;
  s.pages[TIME] = {
    deployments: [{ uid: "dpl_older", projectId: PROJECT, state: "READY" }],
    pagination: { count: 1, next: null, prev: null },
  };
  await s.collect();
  assert.ok(s.calls.some((path) => path.includes(`until=${TIME}`)));
  s.pages[TIME].deployments[0].state = "QUEUED";
  await assert.rejects(s.collect, { code: "VERCEL_COMPETING_DEPLOYMENT_ACTIVE" });
});

test("collector fails on non-progressing pages and duplicate deployment entries", async () => {
  const s = provider();
  s.pages.first.pagination.next = TIME;
  s.pages[TIME] = {
    deployments: [{ uid: "dpl_older", projectId: PROJECT, state: "READY" }],
    pagination: { count: 1, next: TIME, prev: null },
  };
  await assert.rejects(s.collect, { code: "VERCEL_PAGINATION_INVALID" });
  s.pages[TIME].pagination.next = null;
  s.pages[TIME].deployments[0].uid = DEPLOYMENT;
  await assert.rejects(s.collect, { code: "VERCEL_DEPLOYMENT_INVENTORY_INVALID" });
});

test("collector detects actual configuration drift during its bookend reads", async () => {
  const s = provider();
  let envReads = 0;
  const reader = createVercelRead({
    transport: async (input) => {
      if (input.path.includes("/env?") && ++envReads === 2) s.env.envs[0].updatedAt += 1;
      return s.transport(input);
    },
  });
  await assert.rejects(reader.collect({ target: "production" }), {
    code: "VERCEL_COLLECTION_DRIFT",
  });
});

test("staging and arbitrary target/URL/CLI overrides are rejected before transport", async () => {
  const s = provider();
  await assert.rejects(s.reader.collect({ target: "staging" }), {
    code: "STAGING_TARGET_UNAVAILABLE",
  });
  await assert.rejects(s.reader.collect({ target: "preview" }), {
    code: "EXPLICIT_TARGET_REQUIRED",
  });
  await assert.rejects(
    s.reader.readDeployment({ target: "production", deploymentId: "https://other.invalid" }),
    { code: "VERCEL_DEPLOYMENT_ID_REQUIRED" },
  );
  await assert.rejects(s.reader.collect({ target: "production", projectId: "prj_other" }), {
    code: "VERCEL_OPTIONS_REJECTED",
  });
  assert.throws(() => createVercelRead({ baseUrl: "https://other.invalid" }), {
    code: "VERCEL_OPTIONS_REJECTED",
  });
  assert.equal(s.calls.length, 0);
});

test("trusted CLI transports cannot leak thrown provider bodies or credentials", async () => {
  for (const error of [new Error(SECRET), new DeliveryError(SECRET)]) {
    const reader = createVercelRead({
      transport: async () => {
        throw error;
      },
    });
    await assert.rejects(reader.collect({ target: "production" }), {
      message: "VERCEL_READ_FAILED",
    });
  }
});

test("default HTTPS transport is real GET-only, fixed-host, bearer authenticated and denies redirects", async (t) => {
  const s = provider();
  const calls = [];
  t.mock.method(globalThis, "fetch", async (address, options) => {
    const url = new URL(address);
    calls.push({ url, options });
    assert.equal(url.origin, "https://api.vercel.com");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer simulated-ci-token");
    assert.equal(options.signal.aborted, false);
    return new Response(JSON.stringify(s.respond(`${url.pathname}${url.search}`)), {
      headers: { "content-type": "application/json" },
    });
  });
  const result = await createVercelRead({ credential: "simulated-ci-token" }).collect({
    target: "production",
  });
  assert.equal(JSON.stringify(result).includes("simulated-ci-token"), false);
  assert.ok(calls.length > 5);
});

test("default HTTP provider rejection is redacted before its error body is consumed", async (t) => {
  let consumed = false;
  t.mock.method(globalThis, "fetch", async () => ({
    ok: false,
    status: 403,
    get body() {
      consumed = true;
      throw new Error(SECRET);
    },
  }));
  await assert.rejects(
    createVercelRead({ credential: "simulated-ci-token" }).collect({ target: "production" }),
    { message: "VERCEL_READ_REJECTED" },
  );
  assert.equal(consumed, false);
});

test("default HTTP network failure and malformed body never expose credentials", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error(SECRET);
  });
  const reader = createVercelRead({ credential: "simulated-ci-token" });
  await assert.rejects(reader.collect({ target: "production" }), { message: "VERCEL_READ_FAILED" });
  fetch.mock.mockImplementation(
    async () => new Response(SECRET, { headers: { "content-type": "application/json" } }),
  );
  await assert.rejects(reader.collect({ target: "production" }), {
    message: "VERCEL_RESPONSE_INVALID",
  });
});

test("default HTTPS read has no implicit environment credential fallback", async () => {
  await assert.rejects(createVercelRead().collect({ target: "production" }), {
    code: "VERCEL_CREDENTIAL_MISSING",
  });
});

test("request timeout aborts even a trusted transport that never resolves", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: TIME });
  let signal;
  const reader = createVercelRead({
    transport: (input) => {
      signal = input.signal;
      return new Promise(() => {});
    },
  });
  const rejected = assert.rejects(reader.collect({ target: "production" }), {
    code: "VERCEL_COLLECTION_TIMEOUT",
  });
  t.mock.timers.tick(30000);
  await rejected;
  assert.equal(signal.aborted, true);
});

test("collection budget prevents later requests after sixty seconds", async (t) => {
  const s = provider();
  t.mock.timers.enable({ apis: ["Date"], now: TIME });
  let calls = 0;
  const reader = createVercelRead({
    transport: async (input) => {
      calls += 1;
      t.mock.timers.setTime(TIME + calls * 20000);
      return s.transport(input);
    },
  });
  await assert.rejects(reader.collect({ target: "production" }), {
    code: "VERCEL_COLLECTION_TIMEOUT",
  });
  assert.equal(calls, 3);
});

test("an incomplete inventory beyond the fixed twenty-page budget cannot pass", async () => {
  const s = provider();
  let pages = 0;
  const reader = createVercelRead({
    transport: async (input) => {
      if (input.path.startsWith("/v7/deployments?")) {
        pages += 1;
        return { deployments: [], pagination: { count: 0, next: TIME - pages, prev: null } };
      }
      return s.transport(input);
    },
  });
  await assert.rejects(reader.collect({ target: "production" }), {
    code: "VERCEL_PAGINATION_LIMIT",
  });
  assert.equal(pages, 20);
});

test("HTTP reads and injected responses both enforce their body size bound", async (t) => {
  const oversized = JSON.stringify({ private: SECRET.repeat(130000) });
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(oversized, { headers: { "content-type": "application/json" } }),
  );
  await assert.rejects(
    createVercelRead({ credential: "simulated-ci-token" }).collect({ target: "production" }),
    { code: "VERCEL_RESPONSE_TOO_LARGE" },
  );
  await assert.rejects(
    createVercelRead({ transport: async () => JSON.parse(oversized) }).collect({
      target: "production",
    }),
    { code: "VERCEL_RESPONSE_TOO_LARGE" },
  );
});

test("malformed nested provider records fail with static errors", async () => {
  const s = provider();
  s.env.envs = [null];
  await assert.rejects(s.collect, { code: "VERCEL_ENV_METADATA_INVALID" });
  const other = provider();
  other.pages.first.deployments = [null];
  await assert.rejects(other.collect, { code: "VERCEL_DEPLOYMENT_INVENTORY_INVALID" });
});
