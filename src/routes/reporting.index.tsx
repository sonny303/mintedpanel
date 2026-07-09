// Reporting Center — cross-org area (redesign E0.6, F0.6.1 / TE-1). Lists the
// available reports from the registry; Stage 0 has exactly one (Portfolio).
// Does NOT require an active org (renders from the cross-org registry).
import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { REPORTS } from "@/lib/reports";

export const Route = createFileRoute("/reporting/")({
  component: ReportingCenterPage,
});

function ReportingCenterPage() {
  return (
    <div>
      <PageHeader
        title="Reporting Center"
        description="Cross-organization reports for your book of business."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {REPORTS.map((r) => (
          <Link key={r.key} to={r.path} className="block">
            <Card className="transition-colors hover:bg-muted">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-foreground">{r.title}</div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">{r.description}</div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
