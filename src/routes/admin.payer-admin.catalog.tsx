// E6.5 F6.5.1 — Payer Setup / Catalog: the module landing. The per-payer
// "Ready for business" funnel heads the page (F6.5.1) over the shared catalog
// browse (select payers, delegation facts ride the catalog rows — F6.5.5).
// Renders for ALL roles (E6.1 F6.1.1 interim posture); write affordances keep
// their own role gates and RLS/RPCs backstop every write.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { PayerAdminTabs } from "@/components/payer-admin/PayerAdminTabs";
import { PayerReadinessFunnel } from "@/components/payer-admin/PayerReadinessFunnel";
import { PayerCatalogBrowser } from "@/components/payers/PayerCatalogBrowser";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/admin/payer-admin/catalog")({
  component: CatalogTab,
});

function CatalogTab() {
  return (
    <div>
      <PageHeader
        title="Payer Setup"
        description="One home for payer readiness — pick payers from the catalog, author their global SOPs, and prove their forms."
      />
      <div className="mt-2 space-y-6">
        <PayerAdminTabs active="catalog" />
        <PayerReadinessFunnel />
        <Separator />
        <PayerCatalogBrowser />
      </div>
    </div>
  );
}
