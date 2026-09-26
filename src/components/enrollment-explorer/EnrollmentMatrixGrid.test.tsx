import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EnrollmentMatrixGrid } from "./EnrollmentMatrixGrid";
import type {
  EnrollmentMatrixCell,
  EnrollmentMatrixClinician,
  EnrollmentMatrixProductColumn,
} from "@/types";

const mockProducts: EnrollmentMatrixProductColumn[] = [
  {
    productId: "prod-1",
    productKey: "bcbs_ppo",
    displayName: "BCBS PPO",
    payerId: "payer-1",
    payerName: "Blue Cross Blue Shield",
  },
  {
    productId: "prod-2",
    productKey: "bcbs_hmo",
    displayName: "BCBS HMO",
    payerId: "payer-1",
    payerName: "Blue Cross Blue Shield",
  },
  {
    productId: "prod-3",
    productKey: "aetna_choice",
    displayName: "Aetna Choice POS",
    payerId: "payer-2",
    payerName: "Aetna",
  },
];

const mockClinicians: EnrollmentMatrixClinician[] = [
  {
    providerId: "prov-1",
    firstName: "Sarah",
    lastName: "Connor",
    npi: "1098765432",
    taxonomyCode: "225100000X",
    discipline: "PT",
    groupIds: ["grp-1"],
    facilityIds: ["fac-1", "fac-2"],
  },
  {
    providerId: "prov-2",
    firstName: "John",
    lastName: "Doe",
    npi: "1234567890",
    taxonomyCode: "225X00000X",
    discipline: "OT",
    groupIds: ["grp-1"],
    facilityIds: ["fac-1"],
  },
];

const mockCells: Record<string, EnrollmentMatrixCell> = {
  "prov-1:prod-1": {
    scopeId: "scope-1",
    providerId: "prov-1",
    payerProductId: "prod-1",
    facilityId: "fac-1",
    status: "approved",
    effectiveDate: "2026-01-01",
    actionOwner: "Complete",
    clientSafeBlocker: null,
    payerReference: "REF-1234",
    facilityCount: 2,
    proofCount: 1,
  },
  "prov-1:prod-3": {
    scopeId: "scope-2",
    providerId: "prov-1",
    payerProductId: "prod-3",
    facilityId: "fac-1",
    status: "in_review",
    effectiveDate: null,
    actionOwner: "Payer",
    clientSafeBlocker: "Payer credentialing committee queue",
    payerReference: null,
    facilityCount: 1,
    proofCount: 0,
  },
};

describe("EnrollmentMatrixGrid Component", () => {
  it("renders loading state when isLoading is true", () => {
    const html = renderToStaticMarkup(
      <EnrollmentMatrixGrid
        clinicians={[]}
        products={[]}
        cells={{}}
        onCellClick={vi.fn()}
        isLoading={true}
      />,
    );
    expect(html).toContain("Loading clinician enrollment matrix…");
  });

  it("renders empty state when clinicians array is empty", () => {
    const html = renderToStaticMarkup(
      <EnrollmentMatrixGrid
        clinicians={[]}
        products={mockProducts}
        cells={{}}
        onCellClick={vi.fn()}
        isLoading={false}
      />,
    );
    expect(html).toContain("No clinicians match the selected filter criteria.");
  });

  it("renders double-tier headers with grouped payers and product columns", () => {
    const html = renderToStaticMarkup(
      <EnrollmentMatrixGrid
        clinicians={mockClinicians}
        products={mockProducts}
        cells={mockCells}
        onCellClick={vi.fn()}
      />,
    );

    // Grouped Payer headers
    expect(html).toContain("Blue Cross Blue Shield");
    expect(html).toContain("Aetna");

    // Product headers
    expect(html).toContain("BCBS PPO");
    expect(html).toContain("BCBS HMO");
    expect(html).toContain("Aetna Choice POS");

    // Left rail header
    expect(html).toContain("Clinician / NPI");
    expect(html).toContain("(2)");
  });

  it("renders clinician info in left rail and status cells", () => {
    const html = renderToStaticMarkup(
      <EnrollmentMatrixGrid
        clinicians={mockClinicians}
        products={mockProducts}
        cells={mockCells}
        onCellClick={vi.fn()}
      />,
    );

    // Clinicians
    expect(html).toContain("Connor, Sarah");
    expect(html).toContain("1098765432");
    expect(html).toContain("PT");

    // Approved cell
    expect(html).toContain("Approved");
    expect(html).toContain("Eff: 2026-01-01");
    expect(html).toContain("2 locs");

    // In review cell with action owner
    expect(html).toContain("in review");
    expect(html).toContain("Action Owner: Payer");

    // Empty cell indicator
    expect(html).toContain("—");
  });

  it("benchmarks 3,000 clinicians fixture virtualization latency < 100ms", () => {
    const largeClinicians: EnrollmentMatrixClinician[] = Array.from({ length: 3000 }, (_, i) => ({
      providerId: `prov-${i}`,
      firstName: `Clinician${i}`,
      lastName: `Test${i}`,
      npi: `1000000000` + String(i).padStart(4, "0"),
      taxonomyCode: null,
      discipline: i % 2 === 0 ? "PT" : "OT",
      groupIds: ["grp-1"],
      facilityIds: ["fac-1"],
    }));

    const startTime = performance.now();
    const html = renderToStaticMarkup(
      <EnrollmentMatrixGrid
        clinicians={largeClinicians}
        products={mockProducts}
        cells={mockCells}
        onCellClick={vi.fn()}
      />,
    );
    const duration = performance.now() - startTime;

    expect(html).toContain("Clinician / NPI");
    expect(html).toContain("(3000)");
    expect(duration).toBeLessThan(100);
  });
});
