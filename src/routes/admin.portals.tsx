// Admin → Portals (Surface 3). The registry body is the shared PortalsRegistry
// (E4.2 unified payer setup, TE-19 — also composed by the Payer Setup
// workspace's "Forms & portals" tab). `?payerId=` is the payer-context deep
// link the setup funnel's "Register portal" action uses: it opens the Add
// dialog with that payer preselected (admins only — the dialog control never
// renders for other roles). The portal registry URL stays semantically
// separate from the payer catalog.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { PortalsRegistry } from "@/components/portals/PortalsRegistry";

interface PortalsSearch {
  payerId?: string;
}

export const Route = createFileRoute("/admin/portals")({
  validateSearch: (search: Record<string, unknown>): PortalsSearch => ({
    payerId: typeof search.payerId === "string" ? search.payerId : undefined,
  }),
  component: AdminPortalsPage,
});

function AdminPortalsPage() {
  const { payerId } = Route.useSearch();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Portals"
        description="Payer portals the extension can fill — URLs, field maps, and verification."
      />
      <PortalsRegistry initialAddPayerId={payerId ?? null} />
    </div>
  );
}
