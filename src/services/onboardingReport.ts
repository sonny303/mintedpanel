
// 2026-10-20 — Provider Onboarding report consumer. Owner+coordinator only.
import { supabase } from "@/integrations/supabase/externalClient";
import type { ProviderOnboardingReport } from "@/types";

function boundRpc() {
  return supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

export async function getProviderOnboardingReport(
  orgId: string,
  filters: { groupId?: string; locationId?: string } = {},
): Promise<ProviderOnboardingReport> {
  const { data, error } = await boundRpc()("provider_onboarding_report", {
    p_org_id: orgId,
    p_group_id: filters.groupId ?? null,
    p_location_id: filters.locationId ?? null,
    p_target_business_days: 2,
  });
  if (error) throw new Error(error.message);
  return data as ProviderOnboardingReport;
}
