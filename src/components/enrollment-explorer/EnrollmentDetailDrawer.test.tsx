import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EnrollmentDetailDrawer } from "./EnrollmentDetailDrawer";

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
  },
}));

vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  Portal: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog-portal">{children}</div>,
  Overlay: () => <div data-testid="dialog-overlay" />,
  Content: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  Close: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
  Title: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  Description: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
}));

const mockScopeDetailStaff = {
  scopeId: "scope-123",
  stale: false,
  status: "action_required",
  owner: "Client",
  revision: {
    status: "action_required",
    action_owner: "Client",
    effective_date: "2026-02-01",
    submitted_date: "2026-01-15",
    payer_acknowledged_date: "2026-01-20",
    payer_reference: "REF-998877",
    client_safe_blocker: "W9 form missing signature",
    staff_note: "CONFIDENTIAL INTERNAL NOTE: Contacted provider manager twice",
    retro_status: "eligible",
    retro_days: 90,
    retro_date: "2025-11-01",
  },
  proofs: [
    {
      publicationId: "pub-001",
      documentVersionId: "doc-ver-1",
      evidenceKind: "payer_approval_letter",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      publishedAt: "2026-02-01T12:00:00Z",
      revokedAt: null,
      supportedFields: ["enrollment_status", "effective_date"],
      downloadUrl: "/api/enrollment-explorer/proofs/pub-001/download",
    },
  ],
};

const mockScopeDetailClient = {
  scopeId: "scope-123",
  status: "action_required",
  owner: "Client",
  effectiveDate: "2026-02-01",
  submittedDate: "2026-01-15",
  payerAcknowledgedDate: "2026-01-20",
  payerReference: "REF-998877",
  clientSafeBlocker: "W9 form missing signature",
  retroStatus: "eligible",
  retroDays: 90,
  retroDate: "2025-11-01",
  proofs: [
    {
      publicationId: "pub-001",
      documentVersionId: "doc-ver-1",
      evidenceKind: "payer_approval_letter",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      publishedAt: "2026-02-01T12:00:00Z",
      revokedAt: null,
      supportedFields: ["enrollment_status", "effective_date"],
      downloadUrl: "/api/enrollment-explorer/proofs/pub-001/download",
    },
  ],
};

describe("EnrollmentDetailDrawer Component", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  });

  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <EnrollmentDetailDrawer
          scopeId="scope-123"
          clinicianName="Dr. Gregory House"
          npi="1987654321"
          payerName="Aetna"
          productName="Choice POS II"
          facilityName="Princeton Clinic"
          open={false}
          onOpenChange={vi.fn()}
          isClient={false}
        />
      </QueryClientProvider>,
    );

    expect(html).not.toContain("Dr. Gregory House");
    expect(html).not.toContain("Choice POS II");
  });

  it("renders drawer header, status, timeline, proofs, and internal staff notes for staff", () => {
    // Seed query cache with staff detail
    queryClient.setQueryData(
      ["enrollment-scope-detail", "scope-123", "rev-init", false],
      mockScopeDetailStaff,
    );

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <EnrollmentDetailDrawer
          scopeId="scope-123"
          clinicianName="Dr. Gregory House"
          npi="1987654321"
          payerName="Aetna"
          productName="Choice POS II"
          facilityName="Princeton Clinic"
          open={true}
          onOpenChange={vi.fn()}
          isClient={false}
        />
      </QueryClientProvider>,
    );

    // Header info
    expect(html).toContain("Dr. Gregory House");
    expect(html).toContain("1987654321");
    expect(html).toContain("Aetna");
    expect(html).toContain("Choice POS II");
    expect(html).toContain("Princeton Clinic");

    // Action Owner & Blocker
    expect(html).toContain("Action Owner");
    expect(html).toContain("Client");
    expect(html).toContain("W9 form missing signature");

    // Staff note present
    expect(html).toContain("CONFIDENTIAL INTERNAL NOTE: Contacted provider manager twice");

    // Proof engine verification & SHA256
    expect(html).toContain("Payer Approval Letter");
    expect(html).toContain("e3b0c442");
    expect(html).toContain("Download");
  });

  it("strips internal staff note and protects boundaries when viewed by client", () => {
    // Seed query cache with client projection
    queryClient.setQueryData(
      ["enrollment-scope-detail", "scope-123", "rev-init", true],
      mockScopeDetailClient,
    );

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <EnrollmentDetailDrawer
          scopeId="scope-123"
          clinicianName="Dr. Gregory House"
          npi="1987654321"
          payerName="Aetna"
          productName="Choice POS II"
          facilityName="Princeton Clinic"
          open={true}
          onOpenChange={vi.fn()}
          isClient={true}
        />
      </QueryClientProvider>,
    );

    // Client safe details present
    expect(html).toContain("Dr. Gregory House");
    expect(html).toContain("W9 form missing signature");
    expect(html).toContain("Payer Approval Letter");
    expect(html).toContain("e3b0c442");

    // INTERNAL STAFF NOTE MUST BE STRIPPED
    expect(html).not.toContain("CONFIDENTIAL INTERNAL NOTE");
    expect(html).not.toContain("Internal Staff Note");
  });
});
