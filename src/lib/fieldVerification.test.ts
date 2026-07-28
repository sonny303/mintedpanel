import { describe, it, expect } from "vitest";
import {
  FIELD_VERIFICATION_FRESH_DAYS,
  fieldVerificationState,
  indexVerifications,
  verificationLabel,
  type FieldVerification,
} from "./fieldVerification";
import { CAQH_CURRENT_DAYS } from "./enrollmentReadiness";

const TODAY = "2026-07-28";
const stamp = (over: Partial<FieldVerification> = {}): FieldVerification => ({
  fieldKey: "provider.npi",
  verifiedAt: "2026-07-20T00:00:00Z",
  source: "caqh",
  ...over,
});

describe("freshness window", () => {
  it("is the SAME window CAQH attestation uses — one fact, one answer", () => {
    // Two competing windows would let the Details card and the readiness
    // matrix disagree about the same field.
    expect(FIELD_VERIFICATION_FRESH_DAYS).toBe(CAQH_CURRENT_DAYS);
  });
});

describe("fieldVerificationState", () => {
  it("returns null for a never-verified field — NOT stale", () => {
    // Unverified and stale are different states; showing one as the other
    // would tell the coordinator a field decayed when it was never checked.
    expect(fieldVerificationState(undefined, TODAY)).toBeNull();
  });

  it("reports a recent stamp as fresh with its age", () => {
    const state = fieldVerificationState(stamp(), TODAY);
    expect(state?.freshness).toBe("fresh");
    expect(state?.ageDays).toBe(8);
  });

  it("flips to stale only PAST the window (boundary-exact)", () => {
    const atWindow = fieldVerificationState(
      stamp({ verifiedAt: "2026-03-30T00:00:00Z" }), // exactly 120 days
      TODAY,
    );
    expect(atWindow?.ageDays).toBe(FIELD_VERIFICATION_FRESH_DAYS);
    expect(atWindow?.freshness).toBe("fresh");

    const pastWindow = fieldVerificationState(stamp({ verifiedAt: "2026-03-29T00:00:00Z" }), TODAY);
    expect(pastWindow?.ageDays).toBe(FIELD_VERIFICATION_FRESH_DAYS + 1);
    expect(pastWindow?.freshness).toBe("stale");
  });

  it("treats a future or unparseable stamp as fresh, not rotten", () => {
    // Clock skew must not make good data look stale.
    expect(fieldVerificationState(stamp({ verifiedAt: "2027-01-01" }), TODAY)?.freshness).toBe(
      "fresh",
    );
    expect(fieldVerificationState(stamp({ verifiedAt: "garbage" }), TODAY)?.freshness).toBe(
      "fresh",
    );
  });
});

describe("indexVerifications", () => {
  it("keeps the newest stamp per field", () => {
    const index = indexVerifications([
      stamp({ verifiedAt: "2026-07-01T00:00:00Z", source: "manual" }),
      stamp({ verifiedAt: "2026-07-20T00:00:00Z", source: "caqh" }),
    ]);
    expect(index.get("provider.npi")?.source).toBe("caqh");
  });
});

describe("verificationLabel", () => {
  it("names the age and the source", () => {
    const caqh = fieldVerificationState(stamp(), TODAY);
    expect(verificationLabel(caqh!)).toBe("Verified 8 days ago via CAQH");
    const manual = fieldVerificationState(stamp({ source: "manual" }), TODAY);
    expect(verificationLabel(manual!)).toBe("Verified 8 days ago");
  });

  it("says 'today' rather than '0 days ago'", () => {
    const today = fieldVerificationState(stamp({ verifiedAt: TODAY }), TODAY);
    expect(verificationLabel(today!)).toBe("Verified today via CAQH");
  });
});
