// E4.5 F4.5.2 — the Expiring Credentials report inside the Reporting Center
// (the E0.6 add-a-report pattern: one REPORTS entry + this route). The
// Reporting Center is cross-org; this report is org-scoped, so the content
// renders a select-an-organization state when no org is active.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/layout/PageHeader";
import { ExpiringCredentialsTable } from "@/components/documents/ExpiringCredentialsTable";

export const Route = createFileRoute("/reporting/expiring-credentials")({
  component: ExpiringCredentialsReportPage,
});

function ExpiringCredentialsReportPage() {
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
        title="Expiring Credentials"
        description="Documents by soonest expiration — spot what blocks a submission before it does."
      />
      <TooltipProvider delayDuration={200}>
        <ExpiringCredentialsTable />
      </TooltipProvider>
    </div>
  );
}
