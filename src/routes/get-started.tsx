// Account Detail page (redesign E0.8, formerly "Get started"). Shows a read-only
// summary of the org intake data (org name, owner, customer contact, address) plus
// the inbound leads triage queue and the full party/role management surface.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountDetailSummary } from "@/components/org/AccountDetailSummary";
import { InboundLeadsPanel } from "@/components/org/InboundLeadsPanel";
import { PartiesManager } from "@/components/org/PartiesManager";

export const Route = createFileRoute("/get-started")({
  component: AccountDetailPage,
});

function AccountDetailPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Account Detail" />
      {/* Read-only summary of org intake outputs */}
      <AccountDetailSummary />
      {/* E0.5 F0.5.5 / TE-7: shared inbound "contact us" triage queue (renders
          only when leads await triage). */}
      <InboundLeadsPanel />
      {/* E0.3: the org's people and their roles — customer/sales contacts stay
          visible and labelled here (E0.2 FR-3), plus full party/role management. */}
      <PartiesManager />
    </div>
  );
}
