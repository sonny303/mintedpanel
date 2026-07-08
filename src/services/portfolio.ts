// Portfolio data source (redesign E0.0, enabler TE-2).
//
// CROSS-ORG by design: unlike every other service this deliberately does NOT
// call requireActiveOrg() — the Portfolio is the cross-org home and renders
// without an active org (features F0.0.2 / F0.0.5). Tenant isolation is still
// enforced: the organizations SELECT policy is `id IN user_org_ids()`, so this
// returns exactly the caller's member orgs and nothing else. The pure bucketing
// (prospects / in-motion, inactive excluded) lives in src/lib/portfolio.ts.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import type { LifecycleState, PortfolioOrg } from "@/types";

const LIFECYCLE_STATES: readonly LifecycleState[] = ["prospect", "active", "inactive"];

// Defensive narrowing: the DB CHECK guarantees one of the three values, but the
// column is typed `string`, so coerce anything unexpected to 'active'.
function toLifecycleState(value: unknown): LifecycleState {
  return LIFECYCLE_STATES.includes(value as LifecycleState) ? (value as LifecycleState) : "active";
}

export async function listPortfolioOrgs(): Promise<PortfolioOrg[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, lifecycle_state")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => {
    const camel = camelizeRow<PortfolioOrg>(row);
    return { ...camel, lifecycleState: toLifecycleState(camel.lifecycleState) };
  });
}
