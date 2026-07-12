// License primary-source-verification rules (E1.3 F1.3.3 / TE-5) as pure,
// unit-tested logic. The service applies these when writing state_licenses:
// - Marking verified/failed REQUIRES the state-board lookup URL; the
//   verifier and timestamp are stamped server-side, never client-supplied.
// - Renewal reset: editing a license's expiration date resets the row to
//   unverified (feeds the R9 Expiration Radar re-verify workflow).
// - An unchanged row keeps its stored PSV trail untouched.

export type PsvStatus = "unverified" | "verified" | "failed";

export interface PsvIncoming {
  /** The status the form submits (stored status when untouched). */
  verifiedStatus: PsvStatus;
  verificationSourceUrl: string | null;
  expirationDate: string | null;
}

export interface PsvStored {
  verifiedStatus: PsvStatus;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationSourceUrl: string | null;
  expirationDate: string | null;
}

export interface PsvColumns {
  verified_status: PsvStatus;
  verified_at: string | null;
  verified_by: string | null;
  verification_source_url: string | null;
}

/** Thrown message for a verify attempt without the lookup URL. */
export const PSV_URL_REQUIRED_MESSAGE =
  "Recording a verification requires the state-board lookup URL";

/**
 * Resolve the PSV columns to write for one license row.
 * `stored` is null for a brand-new row. `nowIso`/`userId` stamp NEW
 * verification transitions only.
 */
export function resolvePsvColumns(
  incoming: PsvIncoming,
  stored: PsvStored | null,
  nowIso: string,
  userId: string | null,
): PsvColumns {
  const url = incoming.verificationSourceUrl?.trim() || null;

  // Renewal reset wins: an expiration change on an existing row returns the
  // license to unverified regardless of the submitted status (TE-5).
  const expirationChanged = stored !== null && incoming.expirationDate !== stored.expirationDate;
  if (expirationChanged) {
    return {
      verified_status: "unverified",
      verified_at: null,
      verified_by: null,
      verification_source_url: url,
    };
  }

  const statusChanged = stored === null || incoming.verifiedStatus !== stored.verifiedStatus;

  if (incoming.verifiedStatus === "unverified") {
    return {
      verified_status: "unverified",
      verified_at: null,
      verified_by: null,
      verification_source_url: url,
    };
  }

  // verified | failed — a recorded verification attempt.
  if (statusChanged) {
    if (!url) throw new Error(PSV_URL_REQUIRED_MESSAGE);
    return {
      verified_status: incoming.verifiedStatus,
      verified_at: nowIso,
      verified_by: userId,
      verification_source_url: url,
    };
  }

  // Unchanged verification: keep the stored trail verbatim.
  return {
    verified_status: stored.verifiedStatus,
    verified_at: stored.verifiedAt,
    verified_by: stored.verifiedBy,
    verification_source_url: stored.verificationSourceUrl,
  };
}
