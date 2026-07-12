// E1.3 TE-10 — PSV rule truth table: URL required to verify, server-side
// stamping, renewal reset, and stored-trail preservation.
import { describe, expect, it } from "vitest";
import { PSV_URL_REQUIRED_MESSAGE, resolvePsvColumns, type PsvStored } from "./licensePsv";

const NOW = "2026-07-12T12:00:00Z";
const P1 = "user-p1";

const storedVerified: PsvStored = {
  verifiedStatus: "verified",
  verifiedAt: "2026-07-01T09:00:00Z",
  verifiedBy: "user-earlier",
  verificationSourceUrl: "https://www.ncbpte.org/verify",
  expirationDate: "2027-01-31",
};

const storedUnverified: PsvStored = {
  verifiedStatus: "unverified",
  verifiedAt: null,
  verifiedBy: null,
  verificationSourceUrl: null,
  expirationDate: "2027-01-31",
};

describe("resolvePsvColumns", () => {
  it("marking verified requires the lookup URL", () => {
    expect(() =>
      resolvePsvColumns(
        { verifiedStatus: "verified", verificationSourceUrl: "  ", expirationDate: "2027-01-31" },
        storedUnverified,
        NOW,
        P1,
      ),
    ).toThrow(PSV_URL_REQUIRED_MESSAGE);
  });

  it("stamps verifier and timestamp server-side on a new verification", () => {
    const cols = resolvePsvColumns(
      {
        verifiedStatus: "verified",
        verificationSourceUrl: "https://www.ncbpte.org/verify",
        expirationDate: "2027-01-31",
      },
      storedUnverified,
      NOW,
      P1,
    );
    expect(cols).toEqual({
      verified_status: "verified",
      verified_at: NOW,
      verified_by: P1,
      verification_source_url: "https://www.ncbpte.org/verify",
    });
  });

  it("records a failed verification the same way", () => {
    const cols = resolvePsvColumns(
      {
        verifiedStatus: "failed",
        verificationSourceUrl: "https://www.ksbha.org/verification",
        expirationDate: "2027-01-31",
      },
      storedUnverified,
      NOW,
      P1,
    );
    expect(cols.verified_status).toBe("failed");
    expect(cols.verified_at).toBe(NOW);
    expect(cols.verified_by).toBe(P1);
  });

  it("renewal reset: an expiration change returns the row to unverified", () => {
    const cols = resolvePsvColumns(
      {
        verifiedStatus: "verified",
        verificationSourceUrl: storedVerified.verificationSourceUrl,
        expirationDate: "2028-01-31",
      },
      storedVerified,
      NOW,
      P1,
    );
    expect(cols.verified_status).toBe("unverified");
    expect(cols.verified_at).toBeNull();
    expect(cols.verified_by).toBeNull();
  });

  it("keeps the stored trail verbatim when nothing PSV-relevant changed", () => {
    const cols = resolvePsvColumns(
      {
        verifiedStatus: "verified",
        verificationSourceUrl: storedVerified.verificationSourceUrl,
        expirationDate: storedVerified.expirationDate,
      },
      storedVerified,
      NOW,
      P1,
    );
    expect(cols).toEqual({
      verified_status: "verified",
      verified_at: storedVerified.verifiedAt,
      verified_by: storedVerified.verifiedBy,
      verification_source_url: storedVerified.verificationSourceUrl,
    });
  });

  it("new rows verify with stamping and default to unverified otherwise", () => {
    const verifiedNew = resolvePsvColumns(
      {
        verifiedStatus: "verified",
        verificationSourceUrl: "https://www.ksbha.org/verification",
        expirationDate: "2027-06-30",
      },
      null,
      NOW,
      P1,
    );
    expect(verifiedNew.verified_at).toBe(NOW);
    const unverifiedNew = resolvePsvColumns(
      { verifiedStatus: "unverified", verificationSourceUrl: null, expirationDate: "2027-06-30" },
      null,
      NOW,
      P1,
    );
    expect(unverifiedNew).toEqual({
      verified_status: "unverified",
      verified_at: null,
      verified_by: null,
      verification_source_url: null,
    });
  });

  it("explicitly clearing back to unverified drops the stamp", () => {
    const cols = resolvePsvColumns(
      {
        verifiedStatus: "unverified",
        verificationSourceUrl: null,
        expirationDate: storedVerified.expirationDate,
      },
      storedVerified,
      NOW,
      P1,
    );
    expect(cols.verified_status).toBe("unverified");
    expect(cols.verified_at).toBeNull();
    expect(cols.verified_by).toBeNull();
  });
});
