// Group Contracts Matrix report inside the Reporting Center (REPORTS entry + route pattern).
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { GroupContractsMatrix } from "@/components/reports/GroupContractsMatrix";

export const Route = createFileRoute("/reporting/contracts-matrix")({
  validateSearch: (search: Record<string, unknown>) => ({
    groupId: typeof search.groupId === "string" ? search.groupId : undefined,
    payerId: typeof search.payerId === "string" ? search.payerId : undefined,
    state: typeof search.state === "string" ? search.state.toUpperCase() : undefined,
  }),
  component: GroupContractsMatrixPage,
});

function GroupContractsMatrixPage() {
  const search = Route.useSearch();
  return (
    <div className="space-y-4">
      <Link
        to="/reporting"
        className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Reporting Center
      </Link>
      <PageHeader
        title="Group Contracts Matrix"
        description="Payer × state contract execution, tentative/confirmed effective dates, and cross-payer dependencies per provider group."
      />
      <GroupContractsMatrix initialContext={search} />
    </div>
  );
}
