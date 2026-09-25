import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { BillingReadinessReport } from "@/components/reporting/BillingReadinessReport";

export const Route = createFileRoute("/reporting/billing-readiness")({
  component: BillingReadinessPage,
});

function BillingReadinessPage() {
  return (
    <div>
      <Link
        to="/reporting"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Reporting Center
      </Link>
      <PageHeader
        title="Billing Readiness"
        description="Review current enrollment prerequisites and recorded credentialing changes before releasing held claims."
      />
      <BillingReadinessReport />
    </div>
  );
}
