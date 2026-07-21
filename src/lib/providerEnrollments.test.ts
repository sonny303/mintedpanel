// The unified provider-enrollment reducer: manual facts + APPROVED cases,
// derived, deliberately un-deduped (a live fact keeps its own row so Expire
// stays reachable even when a case covers the same combination).
import { describe, expect, it } from "vitest";
import { buildProviderEnrollmentRows, type EnrollmentCaseSlice } from "./providerEnrollments";
import type { EnrollmentFact } from "@/types";

const PROVIDER = "pr-1";

function fact(over: Partial<EnrollmentFact> = {}): EnrollmentFact {
  return {
    id: "f-1",
    orgId: "org-1",
    providerId: PROVIDER,
    groupId: "g-1",
    payerId: "p-1",
    state: "NC",
    effectiveDate: "2026-01-01",
    payerIssuedId: "PIN-1",
    source: "migration",
    expiredAt: null,
    expiredBy: null,
    createdBy: null,
    createdAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

function caseSlice(over: Partial<EnrollmentCaseSlice> = {}): EnrollmentCaseSlice {
  return {
    id: "c-1",
    providerId: PROVIDER,
    groupId: "g-1",
    payerId: "p-2",
    state: "NC",
    caseStatus: "approved",
    confirmedEffectiveDate: "2026-06-15",
    payerIndividualProviderId: "ANTHEM-777",
    ...over,
  };
}

describe("buildProviderEnrollmentRows", () => {
  it("folds live facts and approved cases into one list, carrying each source's own data", () => {
    const rows = buildProviderEnrollmentRows(PROVIDER, [fact()], [caseSlice()]);
    expect(rows).toHaveLength(2);
    const factRow = rows.find((r) => r.source === "fact");
    expect(factRow).toMatchObject({
      key: "fact:f-1",
      factId: "f-1",
      payerIssuedId: "PIN-1",
      live: true,
    });
    const caseRow = rows.find((r) => r.source === "case");
    expect(caseRow).toMatchObject({
      key: "case:c-1",
      caseId: "c-1",
      effectiveDate: "2026-06-15",
      payerIssuedId: "ANTHEM-777",
      live: true,
      expiredAt: null,
    });
  });

  it("only APPROVED cases derive rows — in-flight casework belongs to the Cases panel", () => {
    const rows = buildProviderEnrollmentRows(
      PROVIDER,
      [],
      [
        caseSlice({ id: "c-open", caseStatus: "in_review" }),
        caseSlice({ id: "c-denied", caseStatus: "denied" }),
        caseSlice({ id: "c-ok" }),
      ],
    );
    expect(rows.map((r) => r.caseId)).toEqual(["c-ok"]);
  });

  it("excludes other providers' facts and cases", () => {
    const rows = buildProviderEnrollmentRows(
      PROVIDER,
      [fact({ id: "f-other", providerId: "pr-2" })],
      [caseSlice({ id: "c-other", providerId: "pr-2" })],
    );
    expect(rows).toHaveLength(0);
  });

  it("keeps expired facts as history rows (live=false, expiry stamp carried)", () => {
    const rows = buildProviderEnrollmentRows(
      PROVIDER,
      [fact({ expiredAt: "2026-07-10T00:00:00Z" })],
      [],
    );
    expect(rows[0]).toMatchObject({ live: false, expiredAt: "2026-07-10T00:00:00Z" });
  });

  it("never dedupes a live fact against an approved case on the same combination", () => {
    const rows = buildProviderEnrollmentRows(
      PROVIDER,
      [fact({ payerId: "p-2" })],
      [caseSlice({ payerId: "p-2" })],
    );
    expect(rows).toHaveLength(2);
  });

  it("tolerates narrow case projections without the payer-issued ID column", () => {
    const slice = caseSlice();
    delete (slice as Record<string, unknown>).payerIndividualProviderId;
    const rows = buildProviderEnrollmentRows(PROVIDER, [], [slice]);
    expect(rows[0].payerIssuedId).toBeNull();
  });
});
