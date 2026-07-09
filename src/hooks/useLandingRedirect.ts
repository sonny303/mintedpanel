// Applies the E0.4 landing resolver (src/lib/landing.ts) at authenticated entry.
//
// Returns an async fn that: ensures memberships are loaded, reads the cross-org
// portfolio (the SAME listPortfolioOrgs source E0.0 uses — TE-1), resolves the
// deterministic landing decision, sets the active org, and navigates. The two
// authenticated entry points call it (post-login; the "/" root redirect uses the
// pure resolver directly in beforeLoad). Reloading a specific workspace URL
// preserves context via the persisted store and never routes through here.
import { useNavigate } from "@tanstack/react-router";
import { useAuthStore } from "@/lib/auth-store";
import { listPortfolioOrgs } from "@/services/portfolio";
import { resolveLanding } from "@/lib/landing";

export function useLandingRedirect() {
  const navigate = useNavigate();
  const loadMemberships = useAuthStore((s) => s.loadMemberships);
  const setActiveOrg = useAuthStore((s) => s.setActiveOrg);

  return async function goToLanding(): Promise<void> {
    // Make sure the store reflects the caller's memberships before we may switch
    // the active org (setActiveOrg only accepts a current membership).
    await loadMemberships();
    let orgs;
    try {
      orgs = await listPortfolioOrgs();
    } catch {
      // Portfolio unreachable — land on the Reporting Center's Portfolio report,
      // which owns its own load-error state, rather than dead-ending the entry.
      navigate({ to: "/reporting/portfolio" });
      return;
    }
    const decision = resolveLanding(orgs, useAuthStore.getState().activeOrgId);
    if (decision.kind === "workspace") {
      setActiveOrg(decision.orgId);
      navigate({ to: "/get-started" });
      return;
    }
    // first-run (memberships === 0 → NoOrgScreen renders from __root) and the
    // all-inactive fallback both land on the Reporting Center's Portfolio report
    // (E0.6 TE-3 retargets the E0.4 fallback from the old top-level /portfolio).
    navigate({ to: "/reporting/portfolio" });
  };
}
