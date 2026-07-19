// E6.6 F6.6.2 — the Launches report (the E0.6 add-a-report pattern: one REPORTS entry + this route). Org-scoped; the content gates itself.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { LaunchesReport } from "@/components/reporting/LaunchesReport";

export const Route = createFileRoute("/reporting/launches")({
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
      <PageHeader title="Launches" description="What's opening when — go-live dates, providers, open cases, and at-risk flags." />
      <LaunchesReport />
    </div>
  );
}
