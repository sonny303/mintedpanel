// Mission Control › Users. Milestone 4 replaces this body (users and access).
// The layout route (mission-control.tsx) owns the guard, breadcrumb and
// section navigation.
import { createFileRoute } from "@tanstack/react-router";
import { SectionNotReady } from "@/components/mission-control/SectionNotReady";

export const Route = createFileRoute("/mission-control/users")({
  component: MissionControlUsersPage,
});

function MissionControlUsersPage() {
  return (
    <SectionNotReady title="Users" milestone={4}>
      Invite users, change their role in an organization, remove access, and manage platform admins.
    </SectionNotReady>
  );
}
