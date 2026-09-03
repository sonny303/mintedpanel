// DYN-TOKEN-05 — the one rule deciding which group insurance policy
// `groupInsurance.*` means. Shared by the web profile (server) and the
// payer-PDF fill (browser), so a divergence here is a divergence between two
// surfaces filling the same form.
import { describe, expect, it } from "vitest";

import { MALPRACTICE_INSURANCE_TYPE, pickGroupInsurancePolicy } from "@/lib/groupInsurancePick";

const sole = {
  id: "p1",
  insurance_type: "general_liability",
  policy_number: "GL-ONLY",
  policy_end_date: "2030-01-01",
};

const gl = {
  id: "gp-gl",
  insurance_type: "general_liability",
  coverage_level: "primary",
  policy_number: "GL-1",
  policy_end_date: "2030-01-01",
};
const malOld = {
  id: "gp-old",
  insurance_type: MALPRACTICE_INSURANCE_TYPE,
  coverage_level: "primary",
  policy_number: "MAL-OLD",
  policy_end_date: "2026-01-01",
};
const malNew = {
  id: "gp-new",
  insurance_type: MALPRACTICE_INSURANCE_TYPE,
  coverage_level: "primary",
  policy_number: "MAL-NEW",
  policy_end_date: "2027-06-01",
};
const malSecondary = {
  id: "gp-sec",
  insurance_type: MALPRACTICE_INSURANCE_TYPE,
  coverage_level: "secondary",
  policy_number: "MAL-SEC",
  policy_end_date: "2028-01-01",
};

describe("pickGroupInsurancePolicy", () => {
  it("refuses when there is no group — even if policies were somehow passed", () => {
    const picked = pickGroupInsurancePolicy([sole], false);
    expect(picked.row).toBeNull();
    expect(picked.reason).toBe("provider has no group");
  });

  it("says so when the group has no policies", () => {
    const picked = pickGroupInsurancePolicy([], true);
    expect(picked.row).toBeNull();
    expect(picked.reason).toBe("group has no insurance policies");
  });

  it("takes a sole policy regardless of insurance_type", () => {
    expect(pickGroupInsurancePolicy([sole], true).row).toBe(sole);
  });

  it("among several, picks the malpractice policy with the newest end date", () => {
    expect(pickGroupInsurancePolicy([gl, malOld, malNew], true).row).toBe(malNew);
  });

  it("never picks general liability just because its end date is later", () => {
    const picked = pickGroupInsurancePolicy([gl, malOld], true);
    expect(picked.row).toBe(malOld);
  });

  it("primary coverage wins over a secondary with a later end date", () => {
    expect(pickGroupInsurancePolicy([malSecondary, malOld], true).row).toBe(malOld);
  });

  it("treats a missing coverage_level as primary", () => {
    const undatedPrimary = {
      id: "gp-null-level",
      insurance_type: MALPRACTICE_INSURANCE_TYPE,
      policy_number: "MAL-NULL-LEVEL",
      policy_end_date: "2025-01-01",
    };
    expect(pickGroupInsurancePolicy([malSecondary, undatedPrimary], true).row).toBe(undatedPrimary);
  });

  it("a date-less policy never beats a dated one at the same coverage level", () => {
    const dateless = {
      id: "gp-dateless",
      insurance_type: MALPRACTICE_INSURANCE_TYPE,
      coverage_level: "primary",
      policy_number: "MAL-DATELESS",
    };
    expect(pickGroupInsurancePolicy([dateless, malOld], true).row).toBe(malOld);
  });

  it("breaks same-date ties by id so the pick is stable", () => {
    const a = {
      id: "a",
      insurance_type: MALPRACTICE_INSURANCE_TYPE,
      coverage_level: "primary",
      policy_end_date: "2027-01-01",
    };
    const b = {
      id: "b",
      insurance_type: MALPRACTICE_INSURANCE_TYPE,
      coverage_level: "primary",
      policy_end_date: "2027-01-01",
    };
    expect(pickGroupInsurancePolicy([b, a], true).row).toBe(a);
    expect(pickGroupInsurancePolicy([a, b], true).row).toBe(a);
  });

  it("multi-policy with no malpractice is honestly unresolved", () => {
    const picked = pickGroupInsurancePolicy(
      [
        { id: "g1", insurance_type: "general_liability" },
        { id: "g2", insurance_type: "general_liability" },
      ],
      true,
    );
    expect(picked.row).toBeNull();
    expect(picked.reason).toContain("none is malpractice");
    expect(picked.reason).toContain(MALPRACTICE_INSURANCE_TYPE);
  });

  it("reads camelCase browser entities the same as snake_case server rows", () => {
    const camel = {
      id: "gp-camel",
      insuranceType: MALPRACTICE_INSURANCE_TYPE,
      coverageLevel: "primary" as const,
      policyNumber: "MAL-CAMEL",
      policyEndDate: "2027-06-01",
    };
    const snake = {
      id: "gp-snake",
      insurance_type: MALPRACTICE_INSURANCE_TYPE,
      coverage_level: "secondary",
      policy_number: "MAL-SNAKE",
      policy_end_date: "2028-01-01",
    };
    expect(pickGroupInsurancePolicy([snake, camel], true).row).toBe(camel);
  });

  it("reports a reason on every refusal", () => {
    for (const picked of [
      pickGroupInsurancePolicy([], false),
      pickGroupInsurancePolicy([], true),
      pickGroupInsurancePolicy(
        [
          { id: "g1", insurance_type: "general_liability" },
          { id: "g2", insurance_type: "general_liability" },
        ],
        true,
      ),
    ]) {
      expect(picked.row).toBeNull();
      expect(picked.reason).toBeTruthy();
    }
  });
});
