// S6.1 — per-field verification freshness. Pure: the caller supplies the
// stamps and `today`, never a clock read here (the E1.8 evaluator's rule).
//
// The freshness window is deliberately the SAME 120 days CAQH attestation
// uses (CAQH_CURRENT_DAYS): a field verified against CAQH can't be fresher
// than the attestation it was read from, and two competing windows would let
// the Details card and the readiness matrix disagree about the same fact.
import { CAQH_CURRENT_DAYS } from "@/lib/enrollmentReadiness";

export type VerificationSource = "manual" | "caqh" | "extension";

export interface FieldVerification {
  fieldKey: string;
  /** ISO timestamp. */
  verifiedAt: string;
  source: VerificationSource;
}

export const FIELD_VERIFICATION_FRESH_DAYS = CAQH_CURRENT_DAYS;

export type FieldFreshness = "fresh" | "stale";

export interface FieldVerificationState {
  verifiedAt: string;
  source: VerificationSource;
  freshness: FieldFreshness;
  ageDays: number;
}

/** Whole days between two date-only ISO strings. Date-only math, so a
 * timezone can never move a field across the window boundary. */
function daysBetween(fromIso: string, toIso: string): number | null {
  const from = fromIso.slice(0, 10);
  const to = toIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const ms =
    Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) -
    Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  return Math.floor(ms / 86_400_000);
}

/** Index the stamps by field key, keeping the NEWEST when a caller hands us
 * duplicates (the unique constraint prevents them in the DB, but a merged
 * read shouldn't depend on that). */
export function indexVerifications(
  stamps: readonly FieldVerification[],
): Map<string, FieldVerification> {
  const byKey = new Map<string, FieldVerification>();
  for (const stamp of stamps) {
    const existing = byKey.get(stamp.fieldKey);
    if (!existing || stamp.verifiedAt > existing.verifiedAt) byKey.set(stamp.fieldKey, stamp);
  }
  return byKey;
}

/** The render state for one field, or null when it was never verified —
 * which is NOT the same as stale, and must not be shown as though it were.
 * An unverified field simply carries no verification treatment. */
export function fieldVerificationState(
  stamp: FieldVerification | undefined,
  today: string,
): FieldVerificationState | null {
  if (!stamp) return null;
  const ageDays = daysBetween(stamp.verifiedAt, today);
  // An unparseable or future stamp is treated as fresh-with-zero-age rather
  // than stale: a clock skew must not make good data look rotten.
  const age = ageDays == null || ageDays < 0 ? 0 : ageDays;
  return {
    verifiedAt: stamp.verifiedAt,
    source: stamp.source,
    freshness: age > FIELD_VERIFICATION_FRESH_DAYS ? "stale" : "fresh",
    ageDays: age,
  };
}

/** One line for the Details card: "Verified 12 days ago via CAQH". */
export function verificationLabel(state: FieldVerificationState): string {
  const via =
    state.source === "caqh" ? " via CAQH" : state.source === "extension" ? " in the portal" : "";
  if (state.ageDays === 0) return `Verified today${via}`;
  const unit = state.ageDays === 1 ? "day" : "days";
  return `Verified ${state.ageDays} ${unit} ago${via}`;
}
