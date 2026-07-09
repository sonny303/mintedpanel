// Portfolio dashboard report inside the Reporting Center (redesign E0.6, TE-1/
// TE-3). The Portfolio relocated here from the E0.0 top-level /portfolio route
// (which now redirects here). Cross-org; no active org required.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PortfolioReport } from "@/components/reporting/PortfolioReport";

export const Route = createFileRoute("/reporting/portfolio")({
  component: PortfolioReportPage,
});

function PortfolioReportPage() {
  return (
    <div>
      <Link
        to="/reporting"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Reporting Center
      </Link>
      <PageHeader title="Portfolio" description="Your organizations across the business." />
      <PortfolioReport />
    </div>
  );
}
