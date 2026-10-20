
// 2026-10-20 — Provider onboarding service: Admit & assign + helpers.
import { supabase } from "@/integrations/supabase/externalClient";
import type { OnboardingSubmitResult } from "@/types";

function boundRpc() {
  return supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

export async function submitOnboarding(
  providerId: string,
): Promise<OnboardingSubmitResult> {
  const { data, error } = await boundRpc()("submit_onboarding", {
    p_provider_id: providerId,
  });
  if (error) throw new Error(error.message);
  return data as OnboardingSubmitResult;
}
