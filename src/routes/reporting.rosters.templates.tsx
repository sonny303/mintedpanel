import { createFileRoute } from "@tanstack/react-router";
import { TemplateCatalog } from "@/components/rosters/TemplateCatalog";
import { RosterPageFrame } from "@/components/rosters/shared";
import { useActiveOrgId } from "@/lib/auth-store";

export const Route = createFileRoute("/reporting/rosters/templates")({
  component: RosterTemplateCatalogPage,
});

function RosterTemplateCatalogPage() {
  const orgId = useActiveOrgId();
  return (
    <RosterPageFrame
      title="Provider Roster Engine"
      description="Choose a payer roster schema, map your organization’s records, validate each row, and save a traceable export."
    >
      <TemplateCatalog key={orgId ?? "no-org"} />
    </RosterPageFrame>
  );
}
