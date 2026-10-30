// Mission Control — the internal, cross-tenant platform administration
// surface, for platform admins only (is_platform_admin()). It mounts at
// /mission-control because /admin/* is the per-organization payer admin
// namespace. This layout owns the guard and the page chrome; each section is
// its own child file so later milestones replace a body without touching it.
//
// Two guards, deliberately:
//   - beforeLoad redirects to / on CLIENT navigation once the store knows the
//     user is not a platform admin. On a hard load the store is still empty
//     here (the documented beforeLoad wart), so it does nothing then.
//   - RequirePlatformAdmin is the render-time backstop that holds on a hard
//     load: a skeleton until the flag is known, then the page or the generic
//     not-found view.
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { MissionControlHeader } from "@/components/mission-control/MissionControlHeader";
import { RequirePlatformAdmin } from "@/components/mission-control/RequirePlatformAdmin";
import { useAuthStore } from "@/lib/auth-store";
import { canEnterMissionControl } from "@/lib/permissions";

export const Route = createFileRoute("/mission-control")({
  beforeLoad: () => {
    const { isPlatformAdmin, initialized } = useAuthStore.getState();
    if (canEnterMissionControl(isPlatformAdmin, initialized) === "deny") {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: MissionControlLayout,
});

function MissionControlLayout() {
  return (
    <RequirePlatformAdmin>
      <div className="space-y-4">
        <MissionControlHeader />
        <Outlet />
      </div>
    </RequirePlatformAdmin>
  );
}
