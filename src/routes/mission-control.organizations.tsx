// Mission Control › Organizations. Milestone 3 replaces this body (list, create, detail).
// The layout route (mission-control.tsx) owns the guard, breadcrumb and
// section navigation.
import { createFileRoute } from "@tanstack/react-router";
import { SectionNotReady } from "@/components/mission-control/SectionNotReady";

export const Route = createFileRoute("/mission-control/organizations")({
  component: MissionControlOrganizationsPage,
});

function MissionControlOrganizationsPage() {
  return (
    <SectionNotReady title="Organizations" milestone={3}>
      Create organizations, see their members and provider groups, and grant yourself access to one.
    </SectionNotReady>
  );
}
