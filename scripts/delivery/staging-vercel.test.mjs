// REAL LOCAL GIT SOURCE, SIMULATED GITHUB AND VERCEL RESPONSES ONLY.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { canonicalDigest, releaseTarget } from "../release/contract.mjs";
import { REPOSITORY, STAGING_ALIASES, PRODUCTION_ALIASES, WORKFLOWS } from "./boundary.mjs";
import { createStagingVercel, createStagingVercelServices } from "./staging-vercel.mjs";

const execute = promisify(execFile);
const TARGET = releaseTarget("staging");
const PROJECT = TARGET.vercelProjectId;
const TEAM = TARGET.vercelTeamId;
const TIME = 1788900000000;
const RELEASE = "d".repeat(64);
const SECRET = "SIMULATED_PRIVATE_PROVIDER_BODY";
const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

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

function anonKey() {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ ref: TARGET.supabaseRef, role: "anon", exp: 4102444800 }),
  ).toString("base64url");
  return `${header}.${payload}.synthetic-signature`;
}

function fileTree(files) {
  // Match Vercel's deployment file tree: a top-level array of root entries.
  const root = [];
  for (const file of files) {
    const parts = file.file.split("/");
    let siblings = root;
    for (const part of parts.slice(0, -1)) {
      let directory = siblings.find((entry) => entry.type === "directory" && entry.name === part);
      if (!directory) {
        directory = { name: part, type: "directory", mode: 16749, children: [] };
        siblings.push(directory);
      }
      siblings = directory.children;
    }
    siblings.push({
      name: parts.at(-1),
      type: "file",
      mode: 33152,
      uid: file.sha,
    });
  }
  return root;
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "minted-staging-vercel-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkoutRoot = join(root, "checkout");
  await mkdir(checkoutRoot);
  await git(checkoutRoot, "init", "--initial-branch=staging");
  await git(checkoutRoot, "remote", "add", "origin", `https://github.com/${REPOSITORY}.git`);
  await writeFile(join(checkoutRoot, ".gitignore"), ".env\nnode_modules/\n");
  await writeFile(join(checkoutRoot, "app.js"), "export const stagingFixture = true;\n");
  await git(checkoutRoot, "add", ".");
  await git(checkoutRoot, "commit", "-m", "Synthetic staging source");
  const sha = await git(checkoutRoot, "rev-parse", "HEAD");
  const state = {
    root,
    checkoutRoot,
    sha,
    calls: [],
    uploads: new Map(),
    createBodies: [],
    environmentWrites: [],
    candidate: null,
    aliasReads: {},
    githubCalls: [],
    project: {
      id: PROJECT,
      name: "mintedpanel-staging-web",
      accountId: TEAM,
      link: null,
      autoAssignCustomDomains: false,
      sharedEnvVariableIds: [],
      ssoProtection: { deploymentType: "all_except_custom_domains" },
      protectionBypass: {},
      rootDirectory: null,
      framework: "tanstack-start",
      nodeVersion: "24.x",
      buildCommand: null,
      installCommand: null,
    },
    domains: {
      domains: [
        {
          name: "mintedpanel-staging-web.vercel.app",
          gitBranch: null,
          redirect: null,
          customEnvironmentId: null,
        },
      ],
      pagination: { next: null },
    },
    deployments: [
      {
        uid: "dpl_staticBootstrap",
        projectId: PROJECT,
        state: "READY",
        readyState: "READY",
      },
    ],
  };
  const anon = anonKey();
  const values = {
    VITE_SUPABASE_URL: `https://${TARGET.supabaseRef}.supabase.co`,
    VITE_SUPABASE_ANON_KEY: anon,
    SUPABASE_URL: `https://${TARGET.supabaseRef}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY: anon,
    SUPABASE_ANON_KEY: anon,
    API_CORS_ORIGINS: `https://staging.mintedpanel.com,https://mintedpanel-staging.vercel.app,${EXTENSION_ORIGIN}`,
    VITE_MINTED_EXTENSION_ID: EXTENSION_ID,
  };
  state.environment = {
    envs: [
      ...Object.entries(values).map(([key, value], index) => ({
        id: `env_plain_${index}`,
        key,
        value,
        type: "plain",
        target: ["preview"],
        gitBranch: null,
        customEnvironmentIds: [],
        createdAt: TIME,
        updatedAt: TIME,
        privateProviderField: SECRET,
      })),
      {
        id: "env_sensitive",
        key: "SUPABASE_SERVICE_ROLE_KEY",
        value: SECRET,
        type: "sensitive",
        target: ["preview"],
        gitBranch: null,
        customEnvironmentIds: [],
        createdAt: TIME,
        updatedAt: TIME,
      },
    ],
    pagination: { next: null },
  };
  state.github = {
    async request(method, path) {
      assert.equal(method, "GET");
      state.githubCalls.push(path);
      if (path === "/actions/runs/23")
        return {
          id: 23,
          repository: { full_name: REPOSITORY },
          head_repository: { full_name: REPOSITORY },
          path: WORKFLOWS.ci,
          event: "push",
          head_branch: "main",
          head_sha: state.sha,
          status: "completed",
          conclusion: "success",
        };
      if (path === "/git/ref/heads/main") return { object: { sha: state.sha } };
      if (path === "/git/ref/heads/staging")
        return { ref: "refs/heads/staging", object: { type: "commit", sha: state.sha } };
      assert.fail(`Unexpected GitHub request ${path}`);
    },
  };
  state.transport = async ({ method, path, body, raw, signal }) => {
    assert.equal(signal.aborted, false);
    const url = new URL(path, "https://api.vercel.com");
    assert.equal(url.searchParams.get("teamId"), TEAM);
    state.calls.push({ method, path: `${url.pathname}${url.search}`, raw });
    if (method === "GET" && url.pathname === `/v9/projects/${PROJECT}`)
      return structuredClone(state.project);
    if (method === "GET" && url.pathname === `/v10/projects/${PROJECT}/env`) {
      assert.equal(url.searchParams.get("decrypt"), "false");
      return structuredClone(state.environment);
    }
    if (method === "POST" && url.pathname === `/v10/projects/${PROJECT}/env`) {
      assert.equal(url.searchParams.get("upsert"), "true");
      state.environmentWrites.push(structuredClone(body));
      for (const update of body) {
        const current = state.environment.envs.find((entry) => entry.key === update.key);
        const entry = {
          id: current?.id ?? `env_plain_${state.environment.envs.length}`,
          ...update,
          gitBranch: null,
          customEnvironmentIds: [],
          createdAt: current?.createdAt ?? TIME,
          updatedAt: TIME + 1,
        };
        if (current) Object.assign(current, entry);
        else state.environment.envs.push(entry);
      }
      return { created: structuredClone(body) };
    }
    if (method === "GET" && url.pathname === "/v1/env") {
      assert.equal(url.searchParams.get("projectId"), PROJECT);
      return { data: [], pagination: { next: null } };
    }
    if (method === "GET" && url.pathname === `/v9/projects/${PROJECT}/domains`)
      return structuredClone(state.domains);
    if (method === "GET" && url.pathname === "/v7/deployments") {
      assert.equal(url.searchParams.get("projectId"), PROJECT);
      return {
        deployments: structuredClone(state.deployments),
        pagination: { count: state.deployments.length, next: null },
      };
    }
    if (method === "POST" && url.pathname === "/v2/files") {
      assert.equal(raw, true);
      const digest = await import("node:crypto").then(({ createHash }) =>
        createHash("sha1").update(body).digest("hex"),
      );
      state.uploads.set(digest, Buffer.from(body));
      return {};
    }
    if (method === "POST" && url.pathname === "/v13/deployments") {
      assert.equal(Object.hasOwn(body, "target"), false);
      assert.equal(body.project, PROJECT);
      assert.equal(body.name, "mintedpanel-staging-web");
      assert.ok(body.files.every((file) => state.uploads.has(file.sha)));
      state.createBodies.push(structuredClone(body));
      state.candidate = {
        id: "dpl_stagingCandidate",
        projectId: PROJECT,
        ownerId: TEAM,
        team: { id: TEAM },
        project: { id: PROJECT },
        target: null,
        readyState: "READY",
        readySubstate: "STAGED",
        createdAt: TIME,
        ready: TIME + 1000,
        nodeVersion: "22.x",
        regions: ["iad1"],
        gitSource: null,
        meta: structuredClone(body.meta),
        alias: [],
        aliasAssigned: false,
        url: "mintedpanel-staging-web-synthetic-mintedpanel.vercel.app",
      };
      state.deployments.push({
        uid: state.candidate.id,
        projectId: PROJECT,
        state: "READY",
        readyState: "READY",
      });
      return { id: state.candidate.id, readyState: "QUEUED", target: null };
    }
    if (method === "GET" && url.pathname === "/v13/deployments/dpl_stagingCandidate")
      return structuredClone(state.candidate);
    if (method === "GET" && url.pathname === "/v6/deployments/dpl_stagingCandidate/files")
      return fileTree(state.createBodies[0].files);
    if (method === "POST" && url.pathname === "/v2/deployments/dpl_stagingCandidate/aliases") {
      state.candidate.alias.push(body.alias);
      state.aliasReads[body.alias] = {
        alias: body.alias,
        projectId: PROJECT,
        deploymentId: "dpl_stagingCandidate",
        deployment: { id: "dpl_stagingCandidate" },
        redirect: null,
        deletedAt: null,
      };
      return { uid: `alias_${body.alias}`, alias: body.alias, oldDeploymentId: "dpl_previous" };
    }
    if (method === "GET" && url.pathname.startsWith("/v4/aliases/"))
      return structuredClone(state.aliasReads[url.pathname.slice("/v4/aliases/".length)]);
    assert.fail(`Unexpected Vercel request ${method} ${path}`);
  };
  state.provider = () =>
    createStagingVercel({
      transport: state.transport,
      github: state.github,
      checkoutRoot,
      ciRunId: "23",
      extensionId: EXTENSION_ID,
    });
  state.build = (extra = {}) =>
    state.provider().build({
      target: TARGET,
      sourceSha: state.sha,
      releaseDigest: RELEASE,
      withholdDomains: true,
      gitBranch: "staging",
      vercelEnvironment: "preview",
      ...extra,
    });
  return state;
}

test("fixed readiness collector proves the dedicated project and strips every value", async (t) => {
  const s = await fixture(t);
  const result = await s.provider().collectReadiness();
  assert.equal(result.target.vercelProjectId, PROJECT);
  assert.equal(result.target.supabaseRef, TARGET.supabaseRef);
  assert.equal(result.project.gitDisconnected, true);
  assert.equal(result.project.automationBypassConfigured, false);
  assert.equal(result.environment.length, 8);
  assert.equal(result.shared.length, 0);
  assert.deepEqual(result.activeDeployments, []);
  assert.equal(result.runtimeDatabaseBinding, "UNVERIFIED");
  assert.match(result.configurationDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal(JSON.stringify(result).includes(anonKey()), false);
});

test("one validated Chrome ID atomically configures the web sender and matching CORS origin", async (t) => {
  const s = await fixture(t);
  s.environment.envs = s.environment.envs.filter(
    (entry) => entry.key !== "VITE_MINTED_EXTENSION_ID",
  );
  s.environment.envs.find((entry) => entry.key === "API_CORS_ORIGINS").value =
    "https://staging.mintedpanel.com,https://mintedpanel-staging.vercel.app";

  const result = await s.provider().configureExtensionIdentity();

  assert.equal(s.environmentWrites.length, 1);
  assert.deepEqual(s.environmentWrites[0], [
    {
      key: "API_CORS_ORIGINS",
      value: `https://staging.mintedpanel.com,https://mintedpanel-staging.vercel.app,${EXTENSION_ORIGIN}`,
      type: "plain",
      target: ["preview"],
    },
    {
      key: "VITE_MINTED_EXTENSION_ID",
      value: EXTENSION_ID,
      type: "plain",
      target: ["preview"],
    },
  ]);
  assert.equal(result.extensionId, EXTENSION_ID);
  assert.equal(result.extensionOrigin, EXTENSION_ORIGIN);
  assert.deepEqual(result.before.extensionIdentity, { configured: false });
  assert.equal(result.after.extensionIdentity.extensionId, EXTENSION_ID);
  assert.match(result.before.configurationDigest, /^[a-f0-9]{64}$/);
  assert.match(result.after.configurationDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(result.after.configurationDigest, result.before.configurationDigest);
  assert.equal((await s.provider().collectReadiness()).environment.length, 8);
});

test("already configured extension identity is idempotent and performs no write", async (t) => {
  const s = await fixture(t);
  const result = await s.provider().configureExtensionIdentity();
  assert.equal(result.changed, false);
  assert.equal(s.environmentWrites.length, 0);
  assert.equal(result.before.configurationDigest, result.after.configurationDigest);
  assert.equal(result.after.extensionIdentity.extensionId, EXTENSION_ID);
});

test("invalid or split Chrome identity is rejected before a provider write", async (t) => {
  const s = await fixture(t);
  for (const extensionId of ["a".repeat(31), "q".repeat(32), EXTENSION_ID.toUpperCase()]) {
    assert.throws(
      () =>
        createStagingVercel({
          transport: s.transport,
          github: s.github,
          checkoutRoot: s.checkoutRoot,
          ciRunId: "23",
          extensionId,
        }),
      { code: "STAGING_EXTENSION_ID_INVALID" },
    );
  }
  s.environment.envs.find((entry) => entry.key === "API_CORS_ORIGINS").value =
    "https://staging.mintedpanel.com,https://mintedpanel-staging.vercel.app,chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await assert.rejects(s.provider().configureExtensionIdentity(), {
    code: "STAGING_VERCEL_EXTENSION_IDENTITY_DRIFT",
  });
  assert.equal(s.environmentWrites.length, 0);
});

test("readiness accepts provider responses that omit empty optional inheritance arrays", async (t) => {
  const s = await fixture(t);
  delete s.project.sharedEnvVariableIds;
  for (const entry of s.environment.envs) delete entry.customEnvironmentIds;
  const result = await s.provider().collectReadiness();
  assert.equal(result.shared.length, 0);
  assert.ok(result.environment.every((entry) => entry.customEnvironmentIds.length === 0));
});

test("fixed Preview build uploads only the twice-admitted source and verifies provider files", async (t) => {
  const s = await fixture(t);
  const candidate = await s.build();
  assert.deepEqual(candidate.target, TARGET);
  assert.equal(candidate.sourceSha, s.sha);
  assert.equal(candidate.releaseDigest, RELEASE);
  assert.equal(candidate.readyState, "READY");
  assert.equal(candidate.domainsWithheld, true);
  assert.equal(s.createBodies.length, 1);
  assert.equal(s.uploads.size, 2);
  assert.deepEqual(s.createBodies[0].files.map((file) => file.file).sort(), [
    ".gitignore",
    "app.js",
  ]);
  assert.equal(s.createBodies[0].gitMetadata.commitRef, "staging");
  assert.equal(s.createBodies[0].gitMetadata.commitSha, s.sha);
  assert.equal(s.createBodies[0].gitMetadata.dirty, false);
  assert.equal(Object.hasOwn(s.createBodies[0], "target"), false);
  assert.ok(s.githubCalls.filter((path) => path === "/actions/runs/23").length >= 4);
});

test("trusted staging service seam configures identity before build and exposes real readbacks", async (t) => {
  const s = await fixture(t);
  s.environment.envs = s.environment.envs.filter(
    (entry) => entry.key !== "VITE_MINTED_EXTENSION_ID",
  );
  s.environment.envs.find((entry) => entry.key === "API_CORS_ORIGINS").value =
    "https://staging.mintedpanel.com,https://mintedpanel-staging.vercel.app";
  const services = createStagingVercelServices({
    transport: s.transport,
    github: s.github,
    checkoutRoot: s.checkoutRoot,
    ciRunId: "23",
    extensionId: EXTENSION_ID,
  });
  const before = await services.snapshotVercel();
  assert.deepEqual(before.extensionIdentity, { configured: false });
  assert.equal(s.environmentWrites.length, 0);
  await assert.rejects(
    services.build({
      target: TARGET,
      sourceSha: s.sha,
      releaseDigest: RELEASE,
      withholdDomains: true,
      gitBranch: "staging",
      vercelEnvironment: "preview",
    }),
    { code: "STAGING_VERCEL_EXTENSION_IDENTITY_DRIFT" },
  );
  assert.equal(s.environmentWrites.length, 0);
  assert.equal(s.uploads.size, 0);
  const transition = await services.configureExtensionIdentity();
  assert.deepEqual(transition.before.extensionIdentity, { configured: false });
  assert.equal(transition.after.extensionIdentity.extensionId, EXTENSION_ID);
  assert.notEqual(transition.before.configurationDigest, transition.after.configurationDigest);
  const candidate = await services.build({
    target: TARGET,
    sourceSha: s.sha,
    releaseDigest: RELEASE,
    withholdDomains: true,
    gitBranch: "staging",
    vercelEnvironment: "preview",
  });
  const firstWrite = s.calls.findIndex((call) => call.method === "POST");
  const firstUpload = s.calls.findIndex(
    (call) => call.method === "POST" && call.path.startsWith("/v2/files?"),
  );
  assert.ok(firstWrite >= 0 && firstWrite < firstUpload);
  assert.equal(s.environmentWrites.length, 1);
  const checked = await services.checkCandidate({
    deploymentId: candidate.deploymentId,
    releaseDigest: RELEASE,
  });
  assert.equal(checked.candidate.deploymentId, candidate.deploymentId);
  assert.equal(checked.extensionIdentity.extensionId, EXTENSION_ID);
  assert.equal(checked.previewProtection, "VERCEL_AUTHENTICATION_EXCEPT_CUSTOM_DOMAINS");
  assert.deepEqual(Object.keys(services).sort(), [
    "assertReady",
    "assignAlias",
    "build",
    "checkCandidate",
    "configureExtensionIdentity",
    "snapshotVercel",
  ]);
});

test("wrong project, scope and arbitrary adapter options reject before a provider write", async (t) => {
  const s = await fixture(t);
  await assert.rejects(s.build({ target: { ...TARGET, vercelProjectId: "prj_other" } }), {
    code: "STAGING_VERCEL_BUILD_BINDING",
  });
  await assert.rejects(s.build({ vercelEnvironment: "production" }), {
    code: "STAGING_VERCEL_BUILD_BINDING",
  });
  assert.throws(
    () =>
      createStagingVercel({
        transport: s.transport,
        github: s.github,
        checkoutRoot: s.checkoutRoot,
        ciRunId: "23",
        extensionId: EXTENSION_ID,
        baseUrl: "https://other.invalid",
      }),
    { code: "STAGING_VERCEL_OPTIONS_REJECTED" },
  );
  assert.equal(
    s.calls.some((call) => call.method === "POST"),
    false,
  );
});

for (const [name, mutate, code] of [
  [
    "automation protection bypass",
    (s) => {
      s.project.protectionBypass = {
        "synthetic-secret-id": {
          createdAt: TIME,
          scope: "automation-bypass",
        },
      };
    },
    "STAGING_VERCEL_PROTECTION_BYPASS_PRESENT",
  ],
  [
    "connected Git repository",
    (s) => {
      s.project.link = { type: "github" };
    },
    "STAGING_VERCEL_GIT_LINK_PRESENT",
  ],
  [
    "wrong environment target",
    (s) => {
      s.environment.envs[0].target = ["production"];
    },
    "STAGING_VERCEL_ENV_METADATA",
  ],
  [
    "wrong Supabase URL",
    (s) => {
      s.environment.envs.find((entry) => entry.key === "SUPABASE_URL").value =
        "https://wrong.supabase.co";
    },
    "STAGING_VERCEL_ENV_VALUE",
  ],
  [
    "shared environment inheritance",
    (s) => {
      s.project.sharedEnvVariableIds = ["env_shared"];
    },
    "STAGING_VERCEL_SHARED_ENV_PRESENT",
  ],
  [
    "active deployment",
    (s) => {
      s.deployments[0].state = s.deployments[0].readyState = "BUILDING";
    },
    "STAGING_VERCEL_COMPETING_DEPLOYMENT",
  ],
]) {
  test(`provider readiness rejects ${name} without writes`, async (t) => {
    const s = await fixture(t);
    mutate(s);
    await assert.rejects(s.build(), { code });
    assert.equal(
      s.calls.some((call) => call.method === "POST"),
      false,
    );
  });
}

test("dirty or extra source rejects before any file upload", async (t) => {
  const s = await fixture(t);
  await writeFile(join(s.checkoutRoot, ".env"), "SYNTHETIC_SECRET=never-upload\n");
  await assert.rejects(s.build(), { code: "STAGING_CHECKOUT_FILES" });
  assert.equal(s.uploads.size, 0);
  assert.equal(s.createBodies.length, 0);
});

test("candidate source and file-tree drift cannot produce a bound candidate", async (t) => {
  const s = await fixture(t);
  const transport = s.transport;
  s.transport = async (input) => {
    const value = await transport(input);
    if (input.method === "GET" && input.path.startsWith("/v13/deployments/dpl_stagingCandidate?"))
      value.meta.githubCommitRef = "main";
    return value;
  };
  await assert.rejects(s.build(), { code: "STAGING_VERCEL_SOURCE_BINDING" });
  assert.equal(s.createBodies.length, 1);
});

test("only a candidate built by this fixed adapter can receive either staging alias", async (t) => {
  const s = await fixture(t);
  const provider = s.provider();
  const candidate = await provider.build({
    target: TARGET,
    sourceSha: s.sha,
    releaseDigest: RELEASE,
    withholdDomains: true,
    gitBranch: "staging",
    vercelEnvironment: "preview",
  });
  for (const alias of STAGING_ALIASES) {
    const result = await provider.assignAlias({
      alias,
      deploymentId: candidate.deploymentId,
      releaseDigest: RELEASE,
    });
    assert.equal(result.alias, alias);
    assert.equal(result.deploymentId, candidate.deploymentId);
    assert.equal(result.oldDeploymentId, "dpl_previous");
  }
  await assert.rejects(
    provider.assignAlias({
      alias: "www.mintedpanel.com",
      deploymentId: candidate.deploymentId,
      releaseDigest: RELEASE,
    }),
    { code: "STAGING_VERCEL_ALIAS_BINDING" },
  );
  await assert.rejects(
    provider.assignAlias({
      alias: STAGING_ALIASES[0],
      deploymentId: candidate.deploymentId,
      releaseDigest: RELEASE,
    }),
    { code: "STAGING_VERCEL_ALIAS_BINDING" },
  );
  await assert.rejects(
    s.provider().assignAlias({
      alias: STAGING_ALIASES[0],
      deploymentId: candidate.deploymentId,
      releaseDigest: RELEASE,
    }),
    { code: "STAGING_VERCEL_ALIAS_BINDING" },
  );
});

test("an externally attached staging alias blocks the adapter before alias mutation", async (t) => {
  const s = await fixture(t);
  const provider = s.provider();
  const candidate = await provider.build({
    target: TARGET,
    sourceSha: s.sha,
    releaseDigest: RELEASE,
    withholdDomains: true,
    gitBranch: "staging",
    vercelEnvironment: "preview",
  });
  s.candidate.alias.push(STAGING_ALIASES[1]);
  const writesBefore = s.calls.filter((call) => call.method === "POST").length;
  await assert.rejects(
    provider.assignAlias({
      alias: STAGING_ALIASES[0],
      deploymentId: candidate.deploymentId,
      releaseDigest: RELEASE,
    }),
    { code: "STAGING_VERCEL_DOMAINS_NOT_WITHHELD" },
  );
  assert.equal(s.calls.filter((call) => call.method === "POST").length, writesBefore);
});

test("nested source paths verify against a root-level Vercel file tree", async (t) => {
  const s = await fixture(t);
  await mkdir(join(s.checkoutRoot, "src"));
  await writeFile(join(s.checkoutRoot, "src", "index.js"), "export default 1;\n");
  await git(s.checkoutRoot, "add", ".");
  await git(s.checkoutRoot, "commit", "-m", "Nested source");
  s.sha = await git(s.checkoutRoot, "rev-parse", "HEAD");
  const candidate = await s.build();
  assert.equal(candidate.readyState, "READY");
  assert.deepEqual(s.createBodies[0].files.map((file) => file.file).sort(), [
    ".gitignore",
    "app.js",
    "src/index.js",
  ]);
});

test("a production alias on a withheld staging candidate cannot bind", async (t) => {
  const s = await fixture(t);
  const transport = s.transport;
  s.transport = async (input) => {
    const value = await transport(input);
    if (
      input.method === "GET" &&
      new URL(input.path, "https://api.vercel.com").pathname ===
        "/v13/deployments/dpl_stagingCandidate"
    )
      value.alias = [PRODUCTION_ALIASES[1]];
    return value;
  };
  await assert.rejects(s.build(), { code: "STAGING_VERCEL_DOMAINS_NOT_WITHHELD" });
});

test("unknown provider failures are reduced to static read/write codes", async (t) => {
  const s = await fixture(t);
  const provider = createStagingVercel({
    transport: async ({ method }) => {
      throw new Error(`${method}:${SECRET}`);
    },
    github: s.github,
    checkoutRoot: s.checkoutRoot,
    ciRunId: "23",
    extensionId: EXTENSION_ID,
  });
  await assert.rejects(provider.collectReadiness(), {
    code: "STAGING_VERCEL_READ_FAILED",
    message: "STAGING_VERCEL_READ_FAILED",
  });
  assert.throws(
    () =>
      createStagingVercel({
        github: s.github,
        checkoutRoot: s.checkoutRoot,
        ciRunId: "23",
        extensionId: EXTENSION_ID,
      }),
    { code: "STAGING_VERCEL_CREDENTIAL_MISSING" },
  );
});

test("readiness timeout aborts a trusted transport that never resolves", async (t) => {
  const s = await fixture(t);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: TIME });
  let signal;
  const provider = createStagingVercel({
    transport: (input) => {
      signal = input.signal;
      return new Promise(() => {});
    },
    github: s.github,
    checkoutRoot: s.checkoutRoot,
    ciRunId: "23",
    extensionId: EXTENSION_ID,
  });
  const rejected = assert.rejects(provider.collectReadiness(), {
    code: "STAGING_VERCEL_COLLECTION_TIMEOUT",
  });
  t.mock.timers.tick(30000);
  await rejected;
  assert.equal(signal.aborted, true);
});

test("readiness collection budget prevents later provider reads", async (t) => {
  const s = await fixture(t);
  t.mock.timers.enable({ apis: ["Date"], now: TIME });
  let calls = 0;
  const transport = s.transport;
  s.transport = async (input) => {
    calls += 1;
    t.mock.timers.setTime(TIME + calls * 20000);
    return transport(input);
  };
  await assert.rejects(s.provider().collectReadiness(), {
    code: "STAGING_VERCEL_COLLECTION_TIMEOUT",
  });
  assert.equal(calls, 3);
});

test("configuration identity changes when project or environment metadata changes", async (t) => {
  const s = await fixture(t);
  const before = await s.provider().collectReadiness();
  s.environment.envs[0].updatedAt += 1;
  const after = await s.provider().collectReadiness();
  assert.notEqual(after.configurationDigest, before.configurationDigest);
  assert.notEqual(canonicalDigest(after.environment), canonicalDigest(before.environment));
});

test("configuration digest binds the actual Chrome identity even when metadata is unchanged", async (t) => {
  const s = await fixture(t);
  const before = await s.provider().collectReadiness();
  const otherId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  s.environment.envs.find((entry) => entry.key === "VITE_MINTED_EXTENSION_ID").value = otherId;
  s.environment.envs.find((entry) => entry.key === "API_CORS_ORIGINS").value =
    `https://staging.mintedpanel.com,https://mintedpanel-staging.vercel.app,chrome-extension://${otherId}`;
  const after = await createStagingVercel({
    transport: s.transport,
    github: s.github,
    checkoutRoot: s.checkoutRoot,
    ciRunId: "23",
    extensionId: otherId,
  }).collectReadiness();
  assert.notEqual(after.configurationDigest, before.configurationDigest);
  assert.equal(after.extensionIdentity.extensionId, otherId);
});
