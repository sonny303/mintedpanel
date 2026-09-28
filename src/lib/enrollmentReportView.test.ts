import { describe, expect, it } from "vitest";
import type { EnrollmentReportPage, EnrollmentReportProvider } from "@/types";
import { deriveEnrollmentReportProviders } from "@/lib/enrollmentReportView";

function provider(providerId: string, name: string): EnrollmentReportProvider {
  return {
    providerId,
    name,
    npi: null,
    discipline: "Unknown",
    status: "active",
    referenceOnly: false,
    verificationState: "verified",
    sectionKeys: [],
    cells: [],
  };
}

function page(providers: EnrollmentReportProvider[]): Pick<EnrollmentReportPage, "providers"> {
  return { providers };
}

describe("deriveEnrollmentReportProviders", () => {
  it("preserves first-seen order and removes providers repeated across keyset pages", () => {
    const result = deriveEnrollmentReportProviders([
      page([provider("a", "First"), provider("b", "Second")]),
      page([provider("b", "Replacement"), provider("c", "Third")]),
    ]);

    expect(result.map((item) => [item.providerId, item.name])).toEqual([
      ["a", "First"],
      ["b", "Second"],
      ["c", "Third"],
    ]);
  });
});
