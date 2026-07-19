// E6.2 F6.2.5 — the live-fact filter is the ONE place expiry semantics live:
// everything downstream (board Active, candidate suppression) derives through
// it, so expiring a fact reverses both immediately with no other writes.
import { describe, expect, it } from "vitest";
import {
  enrollmentFactKey,
  factRollupRows,
  isLiveFact,
  liveEnrollmentFacts,
} from "@/lib/enrollmentFacts";
import type { EnrollmentFact } from "@/types";

function fact(overrides: Partial<EnrollmentFact>): EnrollmentFact {
  return {
    id: "f1",
    orgId: "org1",
    providerId: "prov1",
    groupId: "g1",
    payerId: "pay1",
    state: "NC",
    effectiveDate: "2025-01-01",
    source: "migration",
    expiredAt: null,
    expiredBy: null,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("enrollment fact liveness", () => {
  it("a fact is live while expiredAt is null; expiry flips it out", () => {
    expect(isLiveFact(fact({}))).toBe(true);
    expect(isLiveFact(fact({ expiredAt: "2026-07-01T00:00:00Z" }))).toBe(false);
  });

  it("liveEnrollmentFacts keeps only live rows", () => {
    const rows = [fact({ id: "a" }), fact({ id: "b", expiredAt: "2026-07-01T00:00:00Z" })];
    expect(liveEnrollmentFacts(rows).map((f) => f.id)).toEqual(["a"]);
  });

  it("factRollupRows maps live facts to the caseRollups input shape only", () => {
    const rows = factRollupRows([
      fact({}),
      fact({ id: "expired", expiredAt: "2026-07-01T00:00:00Z" }),
    ]);
    expect(rows).toEqual([{ groupId: "g1", payerId: "pay1", state: "NC" }]);
  });

  it("enrollmentFactKey matches the 4-part case-key grain", () => {
    expect(enrollmentFactKey(fact({}))).toBe("prov1|g1|pay1|NC");
  });
});
