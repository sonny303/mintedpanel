// E1.6 F1.6.1 — the standalone Payer Directory page: the browsable global
// catalog with the E4.2 self-service Add/Reactivate/Remove controls. Since the
// E4.2 unified-payer-setup consolidation (TE-19) the implementation lives in
// the shared PayerCatalogBrowser, which the admin Payer Setup workspace's
// Catalog tab composes too — this URL deliberately keeps its NON-ADMIN browse
// behavior (read-only catalog access is not gated by the admin workspace).
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { PayerCatalogBrowser } from "@/components/payers/PayerCatalogBrowser";

export const Route = createFileRoute("/payer-directory")({
  component: PayerDirectoryPage,
});

function PayerDirectoryPage() {
  return (
    <div>
      <PageHeader
        title="Payer Directory"
        description="The global payer catalog — one canonical identity per payer, with the operational credentialing facts attached. Add the payers your organization works with to build its Payer Network."
      />
      <PayerCatalogBrowser />
    </div>
  );
}
