// Render-time backstop for every Mission Control page. The layout route's
// beforeLoad only guards client-side navigation: on a hard load it runs before
// the auth store has loaded anything (the documented beforeLoad wart), so this
// wrapper is what actually keeps a non-admin out. A non-admin gets the generic
// not-found view, never a "forbidden" page that would confirm the route exists.
import type { ReactNode } from "react";
import { NotFoundView } from "@/components/NotFoundView";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/auth-store";
import { canEnterMissionControl, usePlatformAdmin } from "@/lib/permissions";

export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const isPlatformAdmin = usePlatformAdmin();
  const initialized = useAuthStore((s) => s.initialized);
  const access = canEnterMissionControl(isPlatformAdmin, initialized);

  if (access === "deny") return <NotFoundView />;
  if (access === "pending") {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-9 w-full max-w-xl" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  return <>{children}</>;
}
