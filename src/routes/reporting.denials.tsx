// E6.6 F6.6.3 — the denials rollup report (the E0.6 add-a-report pattern). Org-scoped; the content gates itself.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DenialsReport } from "@/components/reporting/DenialsReport";

export const Route = createFileRoute("/reporting/denials")({
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
        title="Denials"
        description="Who has been denied, by whom, and why — provider-first, payer-pivotable, exportable."
      />
      <DenialsReport />
    </div>
  );
}
