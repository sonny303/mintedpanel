// Mission Control › Audit. Milestone 5 replaces this body (the change ledger).
// The layout route (mission-control.tsx) owns the guard, breadcrumb and
// section navigation.
import { createFileRoute } from "@tanstack/react-router";
import { SectionNotReady } from "@/components/mission-control/SectionNotReady";

export const Route = createFileRoute("/mission-control/audit")({
  component: MissionControlAuditPage,
});

function MissionControlAuditPage() {
  return (
    <SectionNotReady title="Audit" milestone={5}>
      Review every change made from Mission Control, filtered by who made it and what they did.
    </SectionNotReady>
  );
}
