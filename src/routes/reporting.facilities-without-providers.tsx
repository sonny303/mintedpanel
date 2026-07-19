// E6.6 F6.6.4 — counts-as-reports: unstaffed facilities. Org-scoped; the content gates itself.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { FacilitiesWithoutProvidersReport } from "@/components/reporting/FacilitiesWithoutProvidersReport";

export const Route = createFileRoute("/reporting/facilities-without-providers")({
  component: ReportPage,
});

function ReportPage() {
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
        title="Facilities Without Providers"
        description="Active locations with no providers assigned."
      />
      <FacilitiesWithoutProvidersReport />
    </div>
  );
}
