
// 2026-10-20 — Provider self-onboarding intake service. Anon-callable RPCs
// (request_intake_code, verify_intake_code) + the session-bound submit_intake.
// All use the boundRpc pattern from src/services/ssnVault.ts to keep the service
// single-shape and to avoid the `supabase.rpc` gotcha.
import { supabase } from "@/integrations/supabase/externalClient";
import type {
  IntakeCodeRequest,
  IntakeTokenView,
  IntakeVerifyResult,
  IntakeSubmitResult,
} from "@/types";

// One shape reused for every RPC in this file.
function boundRpc() {
  return supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

// Validate a token without revealing anything. Uniform 'invalid' on any failure.
export async function validateProviderIntakeToken(token: string): Promise<IntakeTokenView> {
  const { data, error } = await boundRpc()("validate_provider_intake_token", { p_token: token });
  if (error) throw new Error(error.message);
  return (data ?? { state: "invalid" }) as IntakeTokenView;
}

// Request a 6-digit code. The email service delivers the returned `code` value
// to the recipient. Rate-limited: 10/15min/IP.
export async function requestIntakeCode(token: string): Promise<IntakeCodeRequest> {
  const { data, error } = await boundRpc()("request_intake_code", { p_token: token });
  if (error) throw new Error(error.message);
  return (data ?? { state: "invalid" }) as IntakeCodeRequest;
}

// Verify the code. On ok=true, the caller stores session_token and uses it for
// submit_provider_ssn (Swarm 1) + submit_intake + save_profile_draft.
export async function verifyIntakeCode(
  token: string,
  code: string,
): Promise<IntakeVerifyResult> {
  const { data, error } = await boundRpc()("verify_intake_code", {
    p_token: token,
    p_code: code,
  });
  if (error) throw new Error(error.message);
  return (data ?? { ok: false, state: "invalid" }) as IntakeVerifyResult;
}

// Final profile submit (non-SSN, non-portal-credential fields).
export async function submitIntake(
  sessionToken: string,
  payload: Record<string, unknown>,
): Promise<IntakeSubmitResult> {
  const { data, error } = await boundRpc()("submit_intake", {
    p_session_token: sessionToken,
    p_payload: payload,
  });
  if (error) throw new Error(error.message);
  return (data ?? { ok: false, state: "invalid" }) as IntakeSubmitResult;
}
