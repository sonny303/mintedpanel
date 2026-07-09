// Deterministic landing + active-org selection (redesign E0.4, enablers TE-1/TE-2).
//
// PURE functions so the authenticated-entry routing decision AND the store's
// boot-time active-org validation are unit-testable without a live DB or router,
// and can never drift apart — both build on `selectActiveOrgId`. Lifecycle comes
// from the E0.0 portfolio projection (listPortfolioOrgs), so it has ONE source.
// Applied at the two authenticated entry points (post-login; the "/" root
// redirect); reloading a specific workspace URL preserves context via the
// persisted store and never routes through the resolver.
import type { LifecycleState, PortfolioOrg } from "@/types";

export type LandingDecision =
  { kind: "first-run" } | { kind: "workspace"; orgId: string } | { kind: "portfolio" };

// Given orgs (with lifecycle + createdAt) and the persisted last-active id, pick
// the org that should be ACTIVE: the valid non-inactive last-active, else the
// most recently created live (non-inactive) org, else null (no orgs, or every org
// inactive). Shared by the landing resolver (TE-1) and the store's boot-time
// validation (TE-2) so the route and the active org never disagree.
export function selectActiveOrgId(
  orgs: Array<{ id: string; lifecycleState: LifecycleState; createdAt: string }>,
  activeOrgId: string | null,
): string | null {
  const lastActive = activeOrgId ? orgs.find((o) => o.id === activeOrgId) : undefined;
  if (lastActive && lastActive.lifecycleState !== "inactive") return lastActive.id; // TE-1 rule 2
  const live = orgs.filter((o) => o.lifecycleState !== "inactive");
  if (live.length === 0) return null; // no orgs / every org inactive
  return live.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).id; // TE-1 rule 4
}

export function resolveLanding(orgs: PortfolioOrg[], activeOrgId: string | null): LandingDecision {
  // (1) Brand-new user with no orgs — the shell bootstraps the first org.
  if (orgs.length === 0) return { kind: "first-run" };
  // (2)/(4) A usable workspace org (valid last-active, or the most recent live one).
  const picked = selectActiveOrgId(orgs, activeOrgId);
  if (picked) return { kind: "workspace", orgId: picked };
  // (3) Orgs exist but every one is inactive — never a dead end: the Portfolio
  // renders its "Inactive" group + create CTA (F0.4.2 / TE-3).
  return { kind: "portfolio" };
}
