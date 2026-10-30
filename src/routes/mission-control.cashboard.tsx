// Mission Control › Cashboard. Milestone 5 replaces this body (support shortcuts).
// The layout route (mission-control.tsx) owns the guard, breadcrumb and
// section navigation.
import { createFileRoute } from "@tanstack/react-router";
import { SectionNotReady } from "@/components/mission-control/SectionNotReady";

export const Route = createFileRoute("/mission-control/cashboard")({
  component: MissionControlCashboardPage,
});

function MissionControlCashboardPage() {
  return (
    <SectionNotReady title="Cashboard" milestone={5}>
      Look up a provider by NPI or an organization by name, then resend an invite, send a password
      reset, or open its audit trail.
    </SectionNotReady>
  );
}
