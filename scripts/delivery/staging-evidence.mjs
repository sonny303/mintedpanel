import { canonicalDigest } from "../release/contract.mjs";
import { DeliveryError, requireCondition } from "./boundary.mjs";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HASH = /^[a-f0-9]{64}$/;

export const NATIVE_EXTENSION_PROOF = "UNVERIFIED";
export const RUNTIME_DATABASE_BINDING = "UNVERIFIED";

export function exactTimestamp(value, code = "STAGING_EVIDENCE_CLOCK") {
  requireCondition(
    typeof value === "string" &&
      ISO.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    code,
  );
  return value;
}

export function evidenceDigest(value) {
  const digest = canonicalDigest(value);
  requireCondition(HASH.test(digest), "STAGING_EVIDENCE_DIGEST");
  return digest;
}

/**
 * Freshness is evaluated by the trusted composition clock, never by provider
 * timestamps or a caller supplied PASS. The collector's readback is facts;
 * this check is the small seam the controller can use before binding G0.
 */
export function assertFreshStagingEvidence(value, { now, maxAgeSeconds }) {
  requireCondition(value && typeof value === "object", "STAGING_EVIDENCE_SHAPE");
  exactTimestamp(value.observedAt);
  exactTimestamp(now);
  requireCondition(
    Number.isSafeInteger(maxAgeSeconds) && maxAgeSeconds > 0,
    "STAGING_EVIDENCE_AGE",
  );
  const age = Date.parse(now) - Date.parse(value.observedAt);
  requireCondition(age >= 0 && age <= maxAgeSeconds * 1000, "STAGING_EVIDENCE_STALE");
  return true;
}

export function blockedQualification(reasons) {
  requireCondition(
    Array.isArray(reasons) &&
      reasons.length > 0 &&
      reasons.every((reason) => typeof reason === "string" && /^[A-Z0-9_]{1,80}$/.test(reason)),
    "STAGING_EVIDENCE_BLOCK_REASON",
  );
  return Object.freeze({ status: "BLOCKED", reasons: [...new Set(reasons)].sort() });
}

/** Convert arbitrary provider failures to one static, non-sensitive error. */
export function redactedError(code, error) {
  if (
    error instanceof DeliveryError &&
    typeof error.code === "string" &&
    /^STAGING_[A-Z0-9_]{1,80}$/.test(error.code)
  )
    return error;
  return new DeliveryError(code);
}
