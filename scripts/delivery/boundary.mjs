export const REPOSITORY = "sonny303/mintedpanel";
export const APPROVER_ID = 261707544;
export const WORKFLOWS = Object.freeze({
  ci: ".github/workflows/ci.yml",
  staging: ".github/workflows/staging-delivery.yml",
  production: ".github/workflows/production-release.yml",
});
export const STAGING_ALIASES = Object.freeze([
  "mintedpanel-staging.vercel.app",
  "staging.mintedpanel.com",
]);
export const PRODUCTION_ALIASES = Object.freeze([
  "mintedpanel.com",
  "www.mintedpanel.com",
  "mintedpanel.vercel.app",
]);

// These are missing capabilities, not flags an operator may override with JSON/env.
// Removing one requires its reviewed implementation and authenticated evidence.
export const ACTIVATION_BLOCKERS = Object.freeze([
  "FIXED_STAGING_PROVIDER_HOSTED_EXECUTION_PENDING",
  "SCOPED_CREDENTIAL_DESTINATIONS_AND_DENIAL_PROOF_PENDING",
  "GIT_DISCONNECT_AND_COMPETING_DEPLOYMENT_READBACK_PENDING",
  "AUTHENTICATED_SCHEMA_LINEAGE_AND_BACKUP_COLLECTORS_MISSING",
  "MATCHING_BASELINE_REHEARSAL_AND_MIGRATION_EXECUTOR_MISSING",
  "CANDIDATE_RUNTIME_AND_INSTALLED_EXTENSION_COMPATIBILITY_PROOFS_MISSING",
]);

export class DeliveryError extends Error {
  constructor(code) {
    super(code);
    this.name = "DeliveryError";
    this.code = code;
  }
}

export function requireCondition(condition, code) {
  if (!condition) throw new DeliveryError(code);
}

export function requireId(value) {
  requireCondition(typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value), "INVALID_ID");
  return value;
}

export function requireSha(value) {
  requireCondition(typeof value === "string" && /^[a-f0-9]{40}$/.test(value), "INVALID_SHA");
  return value;
}

export function requireTarget(value) {
  requireCondition(value === "staging" || value === "production", "EXPLICIT_TARGET_REQUIRED");
  return value;
}

export function assertHostedReady() {
  throw new DeliveryError("HOSTED_ACTIVATION_BLOCKED");
}
