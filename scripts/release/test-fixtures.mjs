// Synthetic evidence only. No fixture represents a deployed or eligible release.
import { createHash } from "node:crypto";

export const NOW = "2026-09-08T18:00:00.000Z";
export const RECENT = "2026-09-08T17:59:00.000Z";
export const hash = (value) => createHash("sha256").update(value).digest("hex");
const digest = (value) => {
  const sort = (item) =>
    Array.isArray(item)
      ? item.map(sort)
      : item !== null && typeof item === "object"
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, sort(item[key])]),
          )
        : item;
  return hash(JSON.stringify(sort(value)));
};

export function fixture(environment = "production", additive = false) {
  const target = {
    environment,
    vercelTeamId: "team_230fpJ9MgCj9ssW3LiIckfyA",
    vercelProjectId: "prj_ILhPJbkyaiptdVA8DtsmNyw3tiub",
    supabaseRef: environment === "production" ? "fkvuhfsqcmujywzgczmc" : "vmznysvietfaddakkegt",
    vercelEnvironment: environment === "production" ? "production" : "preview",
    gitBranch: environment === "production" ? "main" : "staging",
  };
  const baseline = {
    deploymentId: "dpl_synthetic_previous",
    appSha: "b".repeat(40),
    configurationDigest: hash("previous configuration identity"),
    schemaDigest: hash("baseline schema"),
    migrations: [
      {
        id: "20260901000000",
        path: "supabase/migrations/20260901000000_initial.sql",
        sha256: hash("historical migration"),
      },
    ],
  };
  const migrationPlan = {
    mode: additive ? "additive" : "none",
    baselineSchemaDigest: baseline.schemaDigest,
    resultSchemaDigest: additive ? hash("additive schema") : baseline.schemaDigest,
    inventory: [
      ...baseline.migrations,
      ...(additive
        ? [
            {
              id: "20260902000000",
              path: "supabase/migrations/20260902000000_add.sql",
              sha256: hash("additive migration"),
            },
          ]
        : []),
    ],
  };
  const source = { repository: "sonny303/mintedpanel", sha: "a".repeat(40) };
  const workflow = {
    path: ".github/workflows/release.yml",
    sha: "c".repeat(40),
    runId: "12345",
    runAttempt: 1,
  };
  const staging = {
    sourceSha: source.sha,
    workflowSha: workflow.sha,
    runId: workflow.runId,
    runAttempt: workflow.runAttempt,
    deploymentId: "dpl_synthetic_staging",
    configurationDigest: hash("staging configuration identity"),
    schemaDigest: migrationPlan.resultSchemaDigest,
    migrationPlanDigest: digest(migrationPlan),
    verifiedAt: RECENT,
    supabaseRef: "vmznysvietfaddakkegt",
    gitBranch: "staging",
    vercelEnvironment: "preview",
  };
  if (environment === "staging") {
    Object.assign(staging, {
      sourceSha: baseline.appSha,
      workflowSha: "e".repeat(40),
      runId: "12344",
      deploymentId: baseline.deploymentId,
      configurationDigest: baseline.configurationDigest,
      schemaDigest: baseline.schemaDigest,
      migrationPlanDigest: hash("previous staging plan"),
    });
  }
  const context = {
    phase: environment === "staging" ? "staging-preflight" : "production-eligibility",
    target,
    source,
    workflow,
    staging,
    baseline,
    migrationPlan,
    targetConfigurationDigest: hash("target configuration identity"),
    supportedExtensionVersions: ["0.1.0"],
  };
  const proof = () => ({
    status: "PASS",
    finishedAt: RECENT,
    contextDigest: digest(context),
    artifactDigest: hash("synthetic proof artifact"),
  });
  const backup = {
    provider: "supabase",
    supabaseRef: target.supabaseRef,
    schemaDigest: baseline.schemaDigest,
    lineageDigest: digest(baseline.migrations),
    createdAt: "2026-09-08T16:00:00.000Z",
    verifiedAt: RECENT,
    available: true,
    artifactDigest: hash("synthetic backup identity"),
  };
  const requiredChecks = ["build", "org-isolation", "runtime-target"];
  const record = {
    version: 1,
    createdAt: NOW,
    context,
    checks: requiredChecks.map((name) => ({ name, ...proof() })),
    rehearsal: proof(),
    compatibility: { candidate: proof(), previous: proof() },
    backup: {
      ...backup,
      restore: {
        ...proof(),
        backupArtifactDigest: backup.artifactDigest,
        detectedAt: "2026-09-08T17:00:00.000Z",
        startedAt: "2026-09-08T17:01:00.000Z",
        scopes: ["database", "auth", "configuration"],
      },
    },
    rollback: {
      ...proof(),
      mode: "compatible-app-only",
      detectedAt: "2026-09-08T17:55:00.000Z",
      startedAt: "2026-09-08T17:56:00.000Z",
    },
  };
  const policy = {
    version: 1,
    source,
    workflow,
    migrationPlanDigest: digest(migrationPlan),
    requiredChecks,
    supportedExtensionVersions: context.supportedExtensionVersions,
    requiredRecoveryScopes: ["database", "auth", "configuration"],
    evidenceMaxAgeSeconds: 3600,
    snapshotMaxAgeSeconds: 120,
  };
  const observed = {
    version: 1,
    observedAt: NOW,
    target,
    baseline,
    staging,
    targetConfigurationDigest: context.targetConfigurationDigest,
    supportedExtensionVersions: context.supportedExtensionVersions,
    backup,
  };
  return JSON.parse(
    JSON.stringify({ record, policy, observed, expectedTarget: environment, now: NOW }),
  );
}

export function rebind(value) {
  const contextDigest = digest(value.record.context);
  const proofs = [
    ...value.record.checks,
    value.record.rehearsal,
    value.record.compatibility.candidate,
    value.record.compatibility.previous,
    value.record.backup.restore,
    value.record.rollback,
  ];
  for (const proof of proofs) proof.contextDigest = contextDigest;
  return value;
}
