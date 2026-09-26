import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EnrollmentFilterBar, type EnrollmentFiltersState } from "./EnrollmentFilterBar";
import type {
  EnrollmentCatalogFacility,
  EnrollmentCatalogGroup,
  EnrollmentMatrixStats,
} from "@/types";

const mockStats: EnrollmentMatrixStats = {
  totalClinicians: 45,
  activeEnrollments: 85,
  pendingPayerAction: 23,
  actionableClientBlockers: 12,
};

const mockGroups: EnrollmentCatalogGroup[] = [
  { id: "grp-1", name: "Peak Physical Therapy" },
  { id: "grp-2", name: "Front Range Rehab" },
];

const mockFacilities: EnrollmentCatalogFacility[] = [
  { id: "fac-1", name: "Boulder Main Clinic" },
  { id: "fac-2", name: "Denver South Clinic" },
];

const defaultFilters: EnrollmentFiltersState = {
  search: "",
  groupId: "all",
  facilityId: "all",
  discipline: "all",
  statusBucket: "all",
};

describe("EnrollmentFilterBar Component", () => {
  it("renders all four KPI summary cards with correct counts and metrics", () => {
    const html = renderToStaticMarkup(
      <EnrollmentFilterBar
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        groups={mockGroups}
        facilities={mockFacilities}
        stats={mockStats}
        isClient={false}
        onExportCsv={vi.fn()}
      />,
    );

    // KPI 1: Total Clinicians
    expect(html).toContain("Total Clinicians");
    expect(html).toContain("45");

    // KPI 2: Active In-Network
    expect(html).toContain("Active In-Network");
    expect(html).toContain("85");

    // KPI 3: Pending Payer
    expect(html).toContain("Pending Payer");
    expect(html).toContain("23");

    // KPI 4: Action Required
    expect(html).toContain("Action Required");
    expect(html).toContain("12");
  });

  it("renders search input, filter selectors, and export button", () => {
    const html = renderToStaticMarkup(
      <EnrollmentFilterBar
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        groups={mockGroups}
        facilities={mockFacilities}
        stats={mockStats}
        isClient={false}
        onExportCsv={vi.fn()}
      />,
    );

    expect(html).toContain('placeholder="Search clinician or NPI…"');
    expect(html).toContain("Export CSV");
    expect(html).toContain('data-testid="filter-group-select"');
    expect(html).toContain('data-testid="filter-facility-select"');
    expect(html).toContain('data-testid="filter-discipline-select"');
    expect(html).toContain('data-testid="filter-status-select"');
  });

  it("indicates active filter count and clear button when filters are applied", () => {
    const activeFilters: EnrollmentFiltersState = {
      search: "Alice",
      groupId: "grp-1",
      facilityId: "all",
      discipline: "PT",
      statusBucket: "approved",
    };

    const html = renderToStaticMarkup(
      <EnrollmentFilterBar
        filters={activeFilters}
        onFiltersChange={vi.fn()}
        groups={mockGroups}
        facilities={mockFacilities}
        stats={mockStats}
        isClient={false}
        onExportCsv={vi.fn()}
      />,
    );

    expect(html).toContain("Clear all (4)");
    expect(html).toContain('data-testid="filter-clear-all"');
  });

  it("renders single-group client state with disabled group selector", () => {
    const clientSingleGroupFilters: EnrollmentFiltersState = {
      search: "",
      groupId: "grp-1",
      facilityId: "all",
      discipline: "all",
      statusBucket: "all",
    };

    const html = renderToStaticMarkup(
      <EnrollmentFilterBar
        filters={clientSingleGroupFilters}
        onFiltersChange={vi.fn()}
        groups={[{ id: "grp-1", name: "Single Granted Client Group" }]}
        facilities={mockFacilities}
        stats={mockStats}
        isClient={true}
        onExportCsv={vi.fn()}
      />,
    );

    // Group select should be disabled for client with single group
    expect(html).toContain('data-testid="filter-group-select"');
    expect(html).toContain('disabled=""');
  });

  it("renders exporting indicator when exporting is true", () => {
    const html = renderToStaticMarkup(
      <EnrollmentFilterBar
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        groups={mockGroups}
        facilities={mockFacilities}
        stats={mockStats}
        isClient={false}
        onExportCsv={vi.fn()}
        exporting={true}
      />,
    );

    expect(html).toContain("Exporting…");
  });
});
