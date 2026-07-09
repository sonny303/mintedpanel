// Pure Portfolio bucketing (redesign E0.0, enabler TE-2 / feature F0.0.5).
//
// Given the caller's member orgs, split them into the two business metrics the
// Portfolio surfaces and EXCLUDE archived/inactive orgs from both:
//   lifecycle_state 'active'   -> "In motion"
//   lifecycle_state 'prospect' -> "Prospects"
//   lifecycle_state 'inactive' -> excluded entirely
// Kept pure and tested so the counts are verifiable without a live DB. The raw
// lifecycle words are internal and are never rendered as a status label
// (F0.0.2); the UI shows only the business framing ("Prospects" / "In motion").
import type { PortfolioOrg } from "@/types";

export interface PortfolioBuckets {
  /** Orgs with active work (lifecycle_state 'active'). */
  inMotion: PortfolioOrg[];
  /** Orgs captured but not yet in motion (lifecycle_state 'prospect'). */
  prospects: PortfolioOrg[];
  /** Suppressed orgs (lifecycle_state 'inactive'). Surfaced ONLY in the E0.4
   *  all-inactive fallback (see `allInactive`); excluded from both metrics and
   *  never rendered anywhere else, exactly as E0.0 shipped. */
  inactive: PortfolioOrg[];
  inMotionCount: number;
  prospectCount: number;
  inactiveCount: number;
  /** True when the caller has no orgs in either metric bucket (no active/prospect). */
  isEmpty: boolean;
  /** E0.4 F0.4.2 / TE-3: the metrics are empty AND at least one inactive org
   *  exists — the Portfolio shows the "Inactive" group + create-org CTA instead
   *  of the zero-org "No organizations yet" state. */
  allInactive: boolean;
}

export function splitPortfolio(orgs: PortfolioOrg[]): PortfolioBuckets {
  const inMotion = orgs.filter((o) => o.lifecycleState === "active");
  const prospects = orgs.filter((o) => o.lifecycleState === "prospect");
  const inactive = orgs.filter((o) => o.lifecycleState === "inactive");
  const isEmpty = inMotion.length === 0 && prospects.length === 0;
  return {
    inMotion,
    prospects,
    inactive,
    inMotionCount: inMotion.length,
    prospectCount: prospects.length,
    inactiveCount: inactive.length,
    isEmpty,
    allInactive: isEmpty && inactive.length > 0,
  };
}
