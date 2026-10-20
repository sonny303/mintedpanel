// Provider self-onboarding — the SESSION-bound SSN ingress path. The provider has
// already proven identity via verify_intake_code (which minted a
// provider_intake_sessions row and returned its session_token), so they submit
// their SSN against that session instead of a one-time intake link (that link path
// lives in ssnVault.ts and is untouched).
//
// The full SSN is write-only ingress: it goes to the RPC once, encrypts into the
// E4.4 vault, and only the mask comes back. Never logged, never cached, never
// returned.
import { supabase } from "@/integrations/supabase/externalClient";
import type { ProviderIntakeSessionView, ProviderSsnSubmitResult } from "@/types";

// `supabase.rpc` must be called bound (CLAUDE.md gotcha). One loose signature
// reused for every RPC in this file.
function boundRpc() {
  return supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

// Provider (session-bound, anon-capable): submit the full SSN. The server
// validates the session, encrypts into the vault, flips the session to 'used',
// and echoes back the mask + resulting state only.
export async function submitProviderSsn(
  sessionToken: string,
  ssn: string,
): Promise<ProviderSsnSubmitResult> {
  const { data, error } = await boundRpc()("submit_provider_ssn", {
    p_session_token: sessionToken,
    p_ssn: ssn,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ok: Boolean(row.ok),
    state: (row.state as ProviderSsnSubmitResult["state"]) ?? "invalid",
    mask: (row.mask as string) ?? undefined,
  };
}

// Provider: what the session handle resolves to. Never leaks any org beyond the
// single authorized one, and never the SSN (there is nothing to prefill).
export async function validateIntakeSession(
  sessionToken: string,
): Promise<ProviderIntakeSessionView> {
  const { data, error } = await boundRpc()("validate_intake_session", {
    p_session_token: sessionToken,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    state: (row.state as ProviderIntakeSessionView["state"]) ?? "invalid",
    orgName: (row.org_name as string) ?? undefined,
    providerName: (row.provider_name as string) ?? undefined,
    expiresAt: (row.expires_at as string) ?? undefined,
  };
}
