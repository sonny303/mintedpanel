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
  inMotionCount: number;
  prospectCount: number;
  /** True when the caller has no orgs in either bucket (all excluded/none). */
  isEmpty: boolean;
}

export function splitPortfolio(orgs: PortfolioOrg[]): PortfolioBuckets {
  const inMotion = orgs.filter((o) => o.lifecycleState === "active");
  const prospects = orgs.filter((o) => o.lifecycleState === "prospect");
  return {
    inMotion,
    prospects,
    inMotionCount: inMotion.length,
    prospectCount: prospects.length,
    isEmpty: inMotion.length === 0 && prospects.length === 0,
  };
}
