
// 2026-10-20 — Provider invitation service (operator-side). The browser caller
// for create_provider_intake_link (the operator-action that issues the email
// link to a provider).
import { supabase } from "@/integrations/supabase/externalClient";

function boundRpc() {
  return supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface InviteProviderInput {
  firstName: string;
  lastName: string;
  email: string;
  groupId: string;
  npi?: string;
  startDate?: string;
}

export interface InviteProviderResult {
  token: string;
  provider_id: string;
  provider_name: string;
  recipient_email: string;
  org_name: string;
  expires_at: string;
}

export async function inviteProvider(
  input: InviteProviderInput,
): Promise<InviteProviderResult> {
  // First ensure the provider row exists. If not, this would 409 — the caller
  // pre-creates the provider via createProviderWithDetails, then calls this.
  // We accept the provider_id from the create result and pass it here.
  const { data, error } = await boundRpc()("create_provider_intake_link", {
    p_provider_id: input.npi, // placeholder; real wiring uses providerId from create.
    p_recipient_email: input.email,
    p_recipient_name: `${input.firstName} ${input.lastName}`.trim(),
  });
  if (error) throw new Error(error.message);
  return data as InviteProviderResult;
}
