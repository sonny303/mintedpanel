// Reporting Center — cross-org area (redesign E0.6 F0.6.1 / TE-1; grouped by
// E6.6 F6.6.1). Renders the registry's four question-type groups; the Intake
// card carries a live new-leads badge only when leads await. Does NOT require
// an active org (renders from the cross-org registry; org-scoped reports gate
// themselves inside their content).
import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { useInboundLeads } from "@/hooks/useInboundLeads";
import { REPORT_GROUPS, reportsInGroup, type ReportDef } from "@/lib/reports";

export const Route = createFileRoute("/reporting/")({
  component: ReportingCenterPage,
});

function ReportCard({ report, badge }: { report: ReportDef; badge?: number }) {
  return (
    <Link to={report.path} className="block">
      <Card className="transition-colors hover:bg-muted">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-foreground">{report.title}</span>
              {badge ? (
                <span
                  data-testid={`report-badge-${report.key}`}
                  className="rounded-full bg-[var(--mp-warn-tint)] px-2 py-0.5 text-[11px] font-medium text-[var(--mp-warn-ink)]"
                >
                  {badge}
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">{report.description}</div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}

function ReportingCenterPage() {
  // The Intake badge: new (untriaged) leads, rendered only when > 0 (F6.6.1).
  const leadsQ = useInboundLeads();
  const newLeadCount = (leadsQ.data ?? []).filter((l) => l.status === "new").length;

  return (
    <div>
      <PageHeader
        title="Reporting Center"
        description="Cross-organization reports for your book of business."
      />
      <div className="space-y-6">
        {REPORT_GROUPS.map((group) => {
          const reports = reportsInGroup(group.key);
          if (reports.length === 0) return null;
          return (
            <section key={group.key} aria-labelledby={`report-group-${group.key}`}>
              <h2
                id={`report-group-${group.key}`}
                className="mb-2 text-[13px] font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {group.title}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {reports.map((r) => (
                  <ReportCard
                    key={r.key}
                    report={r}
                    badge={r.key === "leads" && newLeadCount > 0 ? newLeadCount : undefined}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
