// E6.6 F6.6.4 — the Audit Log read surface relocated from /admin/audit (which now redirects here). Admin-gated inside the content.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AuditLogReport } from "@/components/reporting/AuditLogReport";

export const Route = createFileRoute("/reporting/audit-log")({
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
        title="Audit Log"
        description="Read-only history of organization activity. Entries can never be edited or deleted."
      />
      <AuditLogReport />
    </div>
  );
}
