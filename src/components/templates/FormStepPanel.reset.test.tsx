import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps, PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Portal } from "@/types";
import type { PortalStepReference } from "@/lib/portalRetirement";

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: PropsWithChildren<{ open: boolean }>) => <div>{children}</div>,
  DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));

import { PortalMappingResetDialog } from "./PortalMappingResetDialog";

const portal: Portal = {
  id: "portal-shared-a",
  orgId: null,
  portalKey: "payer-enrollment-a",
  name: "Payer enrollment A",
  payerId: "payer-a",
  formUrl: "https://payer.example.test/enroll",
  caseType: "enrollment",
  requiresExplicitSelection: true,
  mappingGeneration: 3,
  isVerified: true,
  lastVerifiedAt: "2026-01-01T00:00:00Z",
  provenAt: "2026-01-01T00:00:00Z",
  urlChangedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const reference: PortalStepReference = {
  templateId: "sop-a",
  templateName: "Enrollment SOP",
  templateTier: "org",
  taskLabel: "Submit application",
  stepLabel: "Member details",
  taskIndex: 0,
  stepIndex: 0,
};

function renderDialog(overrides: Partial<ComponentProps<typeof PortalMappingResetDialog>> = {}) {
  return renderToStaticMarkup(
    <PortalMappingResetDialog
      open
      portal={portal}
      fieldCount={137}
      fieldCountLoading={false}
      fieldCountError={false}
      references={[reference]}
      referencesLoading={false}
      referencesError={false}
      pending={false}
      error={null}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      onOpenChange={vi.fn()}
      {...overrides}
    />,
  );
}

describe("PortalMappingResetDialog", () => {
  it("shows exact config, current field count, visible SOP reference, and shared impact", () => {
    const html = renderDialog();

    expect(html).toContain("Payer enrollment A · enrollment");
    expect(html).toContain("Global/shared configuration");
    expect(html).toContain("137 saved field rows in this generation");
    expect(html).toContain("Enrollment SOP");
    expect(html).toContain("Submit application / Member details");
    expect(html).toContain("organization overrides remain stored");
    expect(html).toContain("same-URL siblings");
    expect(html).toContain("does not change values on a payer page or submit its form");
    expect(html).not.toContain("payer.example.test");
  });

  it("blocks confirmation until field count and authorized SOP references load", () => {
    const html = renderDialog({
      fieldCountLoading: true,
      referencesLoading: true,
    });
    expect(html).toContain("Counting saved fields");
    expect(html).toContain("Loading authorized SOP references");
    expect(html).toContain('disabled=""');
  });

  it("shows an organization-scoped warning for org-only configuration reset", () => {
    const html = renderDialog({
      portal: { ...portal, id: "portal-org-a", orgId: "org-a" },
    });
    expect(html).toContain("Organization configuration · affects only this organization");
    expect(html).toContain("Only this organization configuration is reset");
    expect(html).toContain("Shared configurations and same-URL sibling keys are untouched");
  });
});
