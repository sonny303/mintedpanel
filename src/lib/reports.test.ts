import { describe, expect, it } from "vitest";
import { findReport, reportsInGroup, REPORTS, REPORT_GROUPS } from "./reports";

describe("Reporting Center registry", () => {
  it("includes contracts-matrix under the credentialing group", () => {
    const report = findReport("contracts-matrix");
    expect(report).toBeDefined();
    expect(report?.title).toBe("Group Contracts Matrix");
    expect(report?.path).toBe("/reporting/contracts-matrix");
    expect(report?.group).toBe("credentialing");
  });

  it("returns all reports registered in the credentialing group", () => {
    const credentialingReports = reportsInGroup("credentialing");
    const keys = credentialingReports.map((r) => r.key);
    expect(keys).toContain("contracts-matrix");
    expect(keys).toContain("denials");
    expect(keys).toContain("billing-readiness");
    expect(keys).toContain("expiring-credentials");
    expect(keys).toContain("roster-engine");
  });

  it("preserves unique paths across all registered reports", () => {
    const paths = REPORTS.map((r) => r.path);
    const uniquePaths = new Set(paths);
    expect(uniquePaths.size).toBe(paths.length);
  });
});
