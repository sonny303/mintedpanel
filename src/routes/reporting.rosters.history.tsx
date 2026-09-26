import { createFileRoute } from "@tanstack/react-router";
import { RosterExportHistory } from "@/components/rosters/RosterExportHistory";
import { RosterPageFrame } from "@/components/rosters/shared";
import { useActiveOrgId } from "@/lib/auth-store";

export const Route = createFileRoute("/reporting/rosters/history")({
  component: RosterExportHistoryPage,
});

function RosterExportHistoryPage() {
  const orgId = useActiveOrgId();
  return (
    <RosterPageFrame
      title="Roster export history"
      description="Download the original files and review the immutable snapshot details for every roster export."
    >
      <RosterExportHistory key={orgId ?? "no-org"} />
    </RosterPageFrame>
  );
}
