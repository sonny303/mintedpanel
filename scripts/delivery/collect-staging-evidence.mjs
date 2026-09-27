import { pathToFileURL } from "node:url";
import { DeliveryError, requireCondition } from "./boundary.mjs";
import { blockedQualification, evidenceDigest } from "./staging-evidence.mjs";
import { createStagingSupabaseEvidence } from "./staging-supabase-evidence.mjs";
import { createStagingVercelEvidence } from "./staging-vercel-evidence.mjs";

const SHA = /^[a-f0-9]{40}$/;
const DEPLOYMENT = /^dpl_[A-Za-z0-9_]{1,100}$/;
const STATIC_CODE = /^STAGING_[A-Z0-9_]{1,80}$/;

function safeCode(error) {
  return error instanceof DeliveryError && STATIC_CODE.test(error.code)
    ? error.code
    : "STAGING_EVIDENCE_COLLECTION_FAILED";
}

const SUPABASE_OBSERVATION_KEYS = Object.freeze([
  "version",
  "observedAt",
  "target",
  "project",
  "catalog",
  "schemaDigest",
  "appliedMigrations",
  "lineageDigest",
  "migrationLedgerDigest",
  "queryDigests",
  "runtimeIdentity",
]);
const VERCEL_OBSERVATION_KEYS = Object.freeze([
  "version",
  "collectionStartedAt",
  "observedAt",
  "target",
  "project",
  "aliases",
  "aliasObservations",
  "sharedEnvironment",
  "domains",
  "servedDeployment",
  "candidateDeployment",
  "environmentMetadata",
  "extensionIdentity",
  "corsOriginsDigest",
  "corsOriginsMatch",
  "deploymentInventory",
  "configurationDigest",
  "configurationIdentityKind",
  "runtimeDatabaseBinding",
  "nativeExtensionProof",
]);

function withoutQualification(value, allowedKeys) {
  requireCondition(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "STAGING_EVIDENCE_OUTPUT_SHAPE",
  );
  const observations = {};
  for (const key of allowedKeys) if (Object.hasOwn(value, key)) observations[key] = value[key];
  return observations;
}

function qualificationReasons(value) {
  requireCondition(
    value?.qualification?.status === "BLOCKED" && Array.isArray(value.qualification.reasons),
    "STAGING_EVIDENCE_OUTPUT_SHAPE",
  );
  return blockedQualification(value.qualification.reasons).reasons;
}

export function parseArgs(args) {
  requireCondition(Array.isArray(args), "STAGING_EVIDENCE_CLI_ARGUMENTS");
  let sourceSha;
  let candidateDeploymentId;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    requireCondition(
      flag === "--source-sha" || flag === "--candidate-deployment-id",
      "STAGING_EVIDENCE_CLI_ARGUMENTS",
    );
    const value = args[++index];
    requireCondition(
      typeof value === "string" && !value.startsWith("-"),
      "STAGING_EVIDENCE_CLI_ARGUMENTS",
    );
    if (flag === "--source-sha") {
      requireCondition(
        sourceSha === undefined && SHA.test(value),
        "STAGING_EVIDENCE_CLI_SOURCE_SHA",
      );
      sourceSha = value;
    } else {
      requireCondition(
        candidateDeploymentId === undefined && DEPLOYMENT.test(value),
        "STAGING_EVIDENCE_CLI_DEPLOYMENT_ID",
      );
      candidateDeploymentId = value;
    }
  }
  requireCondition(sourceSha !== undefined, "STAGING_EVIDENCE_CLI_SOURCE_SHA");
  return Object.freeze({
    sourceSha,
    ...(candidateDeploymentId === undefined ? {} : { candidateDeploymentId }),
  });
}

export async function collectStagingEvidence({ args, env, output, dependencies = {} }) {
  const input = parseArgs(args);
  requireCondition(env && typeof env === "object", "STAGING_EVIDENCE_CLI_ENVIRONMENT");
  requireCondition(typeof output === "function", "STAGING_EVIDENCE_CLI_OUTPUT");
  const supabaseFactory = dependencies.supabaseFactory ?? createStagingSupabaseEvidence;
  const vercelFactory = dependencies.vercelFactory ?? createStagingVercelEvidence;
  requireCondition(
    typeof supabaseFactory === "function" && typeof vercelFactory === "function",
    "STAGING_EVIDENCE_CLI_DEPENDENCIES",
  );
  try {
    const supabase = await supabaseFactory({ credential: env.SUPABASE_ACCESS_TOKEN }).collect();
    const vercel = await vercelFactory({ credential: env.VERCEL_TOKEN }).collect({
      sourceSha: input.sourceSha,
      ...(input.candidateDeploymentId === undefined
        ? {}
        : { expectedDeploymentId: input.candidateDeploymentId }),
    });
    const artifact = {
      version: 1,
      status: "BLOCKED",
      sourceSha: input.sourceSha,
      evidence: {
        supabase: withoutQualification(supabase, SUPABASE_OBSERVATION_KEYS),
        vercel: withoutQualification(vercel, VERCEL_OBSERVATION_KEYS),
      },
      blockers: blockedQualification([
        ...qualificationReasons(supabase),
        ...qualificationReasons(vercel),
        "RUNTIME_DATABASE_IDENTITY_ENDPOINT_UNAVAILABLE",
        "NATIVE_EXTENSION_PROOF_UNAVAILABLE",
      ]).reasons,
    };
    output({ ...artifact, artifactDigest: evidenceDigest(artifact) });
    return 0;
  } catch (error) {
    output({ version: 1, status: "BLOCKED", code: safeCode(error) });
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await collectStagingEvidence({
    args: process.argv.slice(2),
    env: process.env,
    output: (value) => process.stdout.write(`${JSON.stringify(value)}\n`),
  }).catch((error) => {
    process.stdout.write(
      `${JSON.stringify({ version: 1, status: "BLOCKED", code: safeCode(error) })}\n`,
    );
    return 2;
  });
}
