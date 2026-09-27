import assert from "node:assert/strict";
import test from "node:test";
import { DeliveryError } from "./boundary.mjs";
import {
  assertFreshStagingEvidence,
  NATIVE_EXTENSION_PROOF,
  RUNTIME_DATABASE_BINDING,
} from "./staging-evidence.mjs";
import {
  CATALOG_SQL,
  MIGRATION_LEDGER_SQL,
  createStagingSupabaseEvidence,
} from "./staging-supabase-evidence.mjs";
import { createStagingVercelEvidence } from "./staging-vercel-evidence.mjs";

const STAGING_REF = "vmznysvietfaddakkegt";
const STAGING_PROJECT = "prj_1t7NkRJMkjTuFXEBEP4GjfN4B6Ch";
const TEAM = "team_230fpJ9MgCj9ssW3LiIckfyA";
const SOURCE_SHA = "a".repeat(40);
const DEPLOYMENT = "dpl_stagingEvidenceCandidate";
const TIME = "2026-09-23T18:00:00.000Z";
const SECRET = "SIMULATED_PROVIDER_SECRET_SHOULD_NEVER_ESCAPE";
const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";

const clone = (value) => structuredClone(value);

function anonKey() {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ ref: STAGING_REF, role: "anon", exp: 4102444800 }),
  ).toString("base64url");
  return `${header}.${payload}.synthetic-signature`;
}

function supabaseFixture() {
  const state = {
    project: {
      id: STAGING_REF,
      ref: STAGING_REF,
      name: "mintedpanel-staging",
      region: "ca-central-1",
      status: "ACTIVE_HEALTHY",
      database: {
        host: `db.${STAGING_REF}.supabase.co`,
        version: "17.6.1.147",
        postgres_engine: "17",
        release_channel: "ga",
      },
      privateProviderBlob: SECRET,
    },
    catalog: {
      database: { name: "postgres" },
      relations: [
        {
          schema: "public",
          name: "providers",
          kind: "r",
          rls: true,
          forceRls: false,
          owner: "postgres",
          aclDigest: "7".repeat(64),
        },
      ],
      columns: [
        {
          schema: "public",
          table: "providers",
          position: 1,
          name: "id",
          type: "uuid",
          notNull: true,
          identity: "",
          generated: "",
          collation: "",
          defaultDigest: "0".repeat(64),
        },
      ],
      constraints: [
        {
          schema: "public",
          table: "providers",
          name: "providers_pkey",
          type: "PRIMARY KEY",
          deferrable: "NO",
          initiallyDeferred: "NO",
          definitionDigest: "1".repeat(64),
          validated: true,
        },
      ],
      indexes: [],
      policies: [
        {
          schema: "public",
          table: "providers",
          name: "providers_select",
          command: "SELECT",
          permissive: "PERMISSIVE",
          rolesDigest: "2".repeat(64),
          usingDigest: "3".repeat(64),
          checkDigest: "4".repeat(64),
        },
      ],
      grants: [
        {
          schema: "public",
          table: "providers",
          grantee: "authenticated",
          grantor: "postgres",
          privilege: "SELECT",
          grantable: "NO",
        },
      ],
      defaultAcls: [],
      triggers: [],
      functions: [
        {
          schema: "public",
          name: "provider_summary",
          identity: "",
          kind: "f",
          owner: "postgres",
          bodyDigest: "5".repeat(64),
          aclDigest: "6".repeat(64),
          configDigest: "8".repeat(64),
        },
      ],
    },
    ledger: [
      { version: "20260713150000", name: "cases_unique_nulls_not_distinct" },
      { version: "20260714120000", name: "provider_ssn_vault" },
    ],
    calls: [],
  };
  const transport = async ({ method, path, body }) => {
    state.calls.push({ method, path, body });
    if (method === "GET" && path === `/v1/projects/${STAGING_REF}`) return clone(state.project);
    assert.equal(method, "POST");
    assert.equal(path, `/v1/projects/${STAGING_REF}/database/query/read-only`);
    const query = typeof body === "string" ? JSON.parse(body).query : body.query;
    if (query === CATALOG_SQL) return [{ catalog: clone(state.catalog) }];
    if (query === MIGRATION_LEDGER_SQL) return clone(state.ledger);
    assert.fail("unexpected Supabase query");
  };
  return {
    state,
    transport,
    reader: () => createStagingSupabaseEvidence({ transport, clock: () => TIME }),
  };
}

function vercelFixture() {
  const key = anonKey();
  const state = {
    project: {
      id: STAGING_PROJECT,
      name: "mintedpanel-staging-web",
      accountId: TEAM,
      link: null,
      autoAssignCustomDomains: false,
      rootDirectory: null,
      nodeVersion: "22.x",
      framework: "tanstack-start",
      buildCommand: null,
      devCommand: null,
      installCommand: null,
      ssoProtection: { deploymentType: "all_except_custom_domains" },
      protectionBypass: {},
      privateProviderBlob: SECRET,
    },
    env: {
      hiddenProductionEnvCount: 0,
      envs: [
        ["VITE_SUPABASE_URL", `https://${STAGING_REF}.supabase.co`, "plain"],
        ["VITE_SUPABASE_ANON_KEY", key, "plain"],
        ["SUPABASE_URL", `https://${STAGING_REF}.supabase.co`, "plain"],
        ["SUPABASE_PUBLISHABLE_KEY", key, "plain"],
        ["SUPABASE_ANON_KEY", key, "plain"],
        [
          "API_CORS_ORIGINS",
          `https://mintedpanel-staging.vercel.app,https://staging.mintedpanel.com,chrome-extension://${EXTENSION_ID}`,
          "plain",
        ],
        ["VITE_MINTED_EXTENSION_ID", EXTENSION_ID, "plain"],
        ["SUPABASE_SERVICE_ROLE_KEY", SECRET, "sensitive"],
      ].map(([keyName, value, type], index) => ({
        id: `env_${index}`,
        key: keyName,
        value,
        type,
        target: ["preview"],
        gitBranch: null,
        customEnvironmentIds: [],
        createdAt: 1780000000000,
        updatedAt: 1780000000000,
      })),
      privateProviderBlob: SECRET,
    },
    shared: { data: [], pagination: { next: null } },
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
    aliases: {
      "mintedpanel-staging.vercel.app": {
        alias: "mintedpanel-staging.vercel.app",
        projectId: STAGING_PROJECT,
        deploymentId: DEPLOYMENT,
        deployment: { id: DEPLOYMENT },
      },
      "staging.mintedpanel.com": {
        alias: "staging.mintedpanel.com",
        projectId: STAGING_PROJECT,
        deploymentId: DEPLOYMENT,
        deployment: { id: DEPLOYMENT },
      },
    },
    deployment: {
      id: DEPLOYMENT,
      projectId: STAGING_PROJECT,
      ownerId: TEAM,
      team: { id: TEAM },
      project: { id: STAGING_PROJECT },
      target: null,
      readyState: "READY",
      readySubstate: "STAGED",
      deletedAt: null,
      ready: 1780000001000,
      createdAt: 1780000000000,
      nodeVersion: "22.x",
      regions: ["iad1"],
      meta: {
        githubCommitSha: SOURCE_SHA,
        githubCommitRef: "staging",
        mintedRepository: "sonny303/mintedpanel",
        mintedVercelEnvironment: "preview",
        privateProviderBlob: SECRET,
      },
    },
    calls: [],
  };
  const transport = async ({ path }) => {
    state.calls.push(path);
    const url = new URL(path, "https://api.vercel.com");
    assert.equal(url.searchParams.get("teamId"), TEAM);
    if (url.pathname === `/v9/projects/${STAGING_PROJECT}`) return clone(state.project);
    if (url.pathname === `/v10/projects/${STAGING_PROJECT}/env`) return clone(state.env);
    if (url.pathname === "/v1/env") return clone(state.shared);
    if (url.pathname === `/v9/projects/${STAGING_PROJECT}/domains`) return clone(state.domains);
    if (url.pathname.startsWith("/v4/aliases/"))
      return clone(state.aliases[url.pathname.slice("/v4/aliases/".length)]);
    if (url.pathname === `/v13/deployments/${DEPLOYMENT}`) return clone(state.deployment);
    if (url.pathname === "/v13/deployments/dpl_drift")
      return { ...clone(state.deployment), id: "dpl_drift" };
    if (url.pathname === "/v7/deployments")
      return {
        deployments: [
          { uid: DEPLOYMENT, projectId: STAGING_PROJECT, state: "READY", readyState: "READY" },
        ],
        pagination: { count: 1, next: null },
      };
    assert.fail(`unexpected Vercel request ${path}`);
  };
  return {
    state,
    transport,
    reader: () => createStagingVercelEvidence({ transport, clock: () => TIME }),
  };
}

test("authenticated Supabase staging collector returns only catalog/ledger identity and fixed target", async () => {
  const s = supabaseFixture();
  const result = await s.reader().collect();
  assert.equal(result.target.supabaseRef, STAGING_REF);
  assert.equal(result.project.database.host, `db.${STAGING_REF}.supabase.co`);
  assert.equal(result.appliedMigrations.length, 2);
  assert.match(result.schemaDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.deepEqual(result.qualification.status, "BLOCKED");
});

test("schema digest changes when a policy definition hash changes", async () => {
  const s = supabaseFixture();
  const first = await s.reader().collect();
  s.state.catalog.policies[0].usingDigest = "f".repeat(64);
  const second = await s.reader().collect();
  assert.notEqual(second.schemaDigest, first.schemaDigest);
});

test("schema digest changes when function ACL state changes", async () => {
  const s = supabaseFixture();
  const first = await s.reader().collect();
  s.state.catalog.functions[0].aclDigest = "9".repeat(64);
  const second = await s.reader().collect();
  assert.notEqual(second.schemaDigest, first.schemaDigest);
});

test("Supabase collector rejects a wrong project identity before accepting catalog facts", async () => {
  const s = supabaseFixture();
  s.state.project.ref = "fkvuhfsqcmujywzgczmc";
  await assert.rejects(s.reader().collect(), { code: "STAGING_SUPABASE_PROJECT_IDENTITY" });
});

test("Supabase bookend reads reject catalog drift and provider errors stay redacted", async () => {
  const s = supabaseFixture();
  let catalogReads = 0;
  const reader = createStagingSupabaseEvidence({
    transport: async (input) => {
      if (input.body?.query === MIGRATION_LEDGER_SQL) s.state.catalog.relations[0].name = "changed";
      const result = await s.transport(input);
      if (input.body?.query === CATALOG_SQL) catalogReads += 1;
      return result;
    },
    clock: () => TIME,
  });
  await assert.rejects(reader.collect(), { code: "STAGING_SUPABASE_COLLECTION_DRIFT" });
  await assert.rejects(
    createStagingSupabaseEvidence({
      transport: async () => {
        throw new Error(SECRET);
      },
      clock: () => TIME,
    }).collect(),
    { code: "STAGING_SUPABASE_READ_FAILED" },
  );
  assert.equal(JSON.stringify(s.state).includes(SECRET), true);
});

test("Vercel collector binds both staging aliases to the exact SHA and withholds runtime proof", async () => {
  const s = vercelFixture();
  const result = await s
    .reader()
    .collect({ sourceSha: SOURCE_SHA, expectedDeploymentId: DEPLOYMENT });
  assert.equal(result.target.vercelProjectId, STAGING_PROJECT);
  assert.deepEqual(result.aliases, {
    "mintedpanel-staging.vercel.app": DEPLOYMENT,
    "staging.mintedpanel.com": DEPLOYMENT,
  });
  assert.equal(result.servedDeployment.source.sha, SOURCE_SHA);
  assert.equal(result.runtimeDatabaseBinding, RUNTIME_DATABASE_BINDING);
  assert.equal(result.nativeExtensionProof, NATIVE_EXTENSION_PROOF);
  assert.equal(result.qualification.status, "BLOCKED");
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.ok(
    s.state.calls
      .filter((path) => path.includes("/v4/aliases/"))
      .every((path) => !new URL(path, "https://api.vercel.com").searchParams.has("projectId")),
  );
});

test("Vercel collector accepts the provider's omitted empty protection bypass", async () => {
  const s = vercelFixture();
  delete s.state.project.protectionBypass;
  const result = await s.reader().collect({ sourceSha: SOURCE_SHA });
  assert.equal(result.project.id, STAGING_PROJECT);
});

test("Vercel alias observation stays team-scoped when a stale alias belongs to another project", async () => {
  const s = vercelFixture();
  const transport = async (input) => {
    if (
      input.path.includes("/v4/aliases/") &&
      new URL(input.path, "https://api.vercel.com").searchParams.has("projectId")
    )
      throw new DeliveryError("STAGING_VERCEL_EVIDENCE_READ_REJECTED"); // provider 404 regression guard
    return s.transport(input);
  };
  const result = await createStagingVercelEvidence({ transport, clock: () => TIME }).collect({
    sourceSha: SOURCE_SHA,
  });
  assert.equal(result.qualification.status, "BLOCKED");
  assert.deepEqual(result.aliases, {
    "mintedpanel-staging.vercel.app": DEPLOYMENT,
    "staging.mintedpanel.com": DEPLOYMENT,
  });
});

test("Vercel collector compares CORS origins as a set while preserving a digest of the observation", async () => {
  const s = vercelFixture();
  s.state.env.envs.find((entry) => entry.key === "API_CORS_ORIGINS").value =
    "chrome-extension://" +
    EXTENSION_ID +
    ",https://staging.mintedpanel.com,https://mintedpanel-staging.vercel.app";
  const result = await s.reader().collect({ sourceSha: SOURCE_SHA });
  assert.equal(result.corsOriginsMatch, true);
  assert.match(result.corsOriginsDigest, /^[a-f0-9]{64}$/);
});

test("Vercel collector records a missing extension identity as a blocker without mutating env", async () => {
  const s = vercelFixture();
  s.state.env.envs = s.state.env.envs.filter((entry) => entry.key !== "VITE_MINTED_EXTENSION_ID");
  s.state.env.envs.find((entry) => entry.key === "API_CORS_ORIGINS").value =
    "https://mintedpanel-staging.vercel.app,https://staging.mintedpanel.com";
  const result = await s.reader().collect({ sourceSha: SOURCE_SHA });
  assert.deepEqual(result.extensionIdentity, { configured: false });
  assert.ok(result.qualification.reasons.includes("STAGING_EXTENSION_IDENTITY_UNCONFIGURED"));
  assert.equal(s.state.env.envs.length, 7);
});

test("Vercel collector rejects an incomplete mandatory environment inventory", async () => {
  const s = vercelFixture();
  s.state.env.envs = s.state.env.envs.filter((entry) => entry.key !== "SUPABASE_URL");
  await assert.rejects(s.reader().collect({ sourceSha: SOURCE_SHA }), {
    code: "STAGING_VERCEL_EVIDENCE_ENV_INVENTORY",
  });
});

test("Vercel collector rejects wrong project and wrong source SHA", async () => {
  const wrongProject = vercelFixture();
  wrongProject.state.project.id = "prj_ILhPJbkyaiptdVA8DtsmNyw3tiub";
  await assert.rejects(wrongProject.reader().collect({ sourceSha: SOURCE_SHA }), {
    code: "STAGING_VERCEL_EVIDENCE_PROJECT_IDENTITY",
  });
  const wrongSha = vercelFixture();
  const result = await wrongSha.reader().collect({ sourceSha: "b".repeat(40) });
  assert.equal(result.qualification.status, "BLOCKED");
  assert.ok(
    result.qualification.reasons.includes("STAGING_DEPLOYMENT_SOURCE_SHA_MATCHES_MISMATCH"),
  );
});

test("Vercel bookend reads reject alias drift and provider failures never echo secrets", async () => {
  const s = vercelFixture();
  s.state.aliases["staging.mintedpanel.com"].deploymentId = "dpl_drift";
  s.state.aliases["staging.mintedpanel.com"].deployment.id = "dpl_drift";
  const reader = createStagingVercelEvidence({ transport: s.transport, clock: () => TIME });
  const drift = await reader.collect({ sourceSha: SOURCE_SHA });
  assert.equal(drift.qualification.status, "BLOCKED");
  assert.ok(drift.qualification.reasons.includes("STAGING_ALIAS_DRIFT"));
  await assert.rejects(
    createStagingVercelEvidence({
      transport: async () => {
        throw new DeliveryError(SECRET);
      },
      clock: () => TIME,
    }).collect({ sourceSha: SOURCE_SHA }),
    { code: "STAGING_VERCEL_EVIDENCE_READ_FAILED" },
  );
});

test("freshness helper rejects stale evidence without changing collector timestamps", async () => {
  const s = vercelFixture();
  const result = await s.reader().collect({ sourceSha: SOURCE_SHA });
  assert.throws(
    () =>
      assertFreshStagingEvidence(result, { now: "2026-09-23T18:06:00.000Z", maxAgeSeconds: 300 }),
    { code: "STAGING_EVIDENCE_STALE" },
  );
});
