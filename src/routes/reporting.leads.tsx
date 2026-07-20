// E6.6 F6.6.1 — the Intake group's Inbound Leads report: the operator triage
// queue re-homed off Org Detail entirely (the E0.5 InboundLeadsPanel, mounted
// with an honest empty state). Cross-org — a lead has no org until converted,
// so there is no org gate here.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { InboundLeadsPanel } from "@/components/org/InboundLeadsPanel";

export const Route = createFileRoute("/reporting/leads")({
  component: LeadsReportPage,
});

function LeadsReportPage() {
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
        title="Inbound Leads"
        description="Website inquiries awaiting triage — convert to a prospect organization or dismiss."
      />
      <InboundLeadsPanel alwaysRender />
    </div>
  );
}
