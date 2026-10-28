// Staff provider invites (slice 1). Sanctioned /api surface: the invite email
// is sent by the server, so this can't run over browser RLS.
import { authedApiFetch } from "@/services/authedApi";

export interface ProviderInviteInput {
  firstName: string;
  lastName: string;
  email: string;
  groupId: string;
  npi?: string;
  startDate?: string;
}

/** "sandbox": SendGrid accepted it in sandbox mode, so nothing was delivered. */
export type InviteDelivery = "sent" | "sandbox" | "failed";

export type ProviderInviteResult =
  | { outcome: "created"; providerId: string; delivery: InviteDelivery }
  | { outcome: "already_exists"; providerId: string };

export function createProviderInvite(input: ProviderInviteInput): Promise<ProviderInviteResult> {
  return authedApiFetch<ProviderInviteResult>("/api/provider-invites", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** `email` is where the invite went: the provider record's current address. */
export interface ResendInviteResult {
  delivery: InviteDelivery;
  email: string;
}

export function resendProviderInvite(providerId: string): Promise<ResendInviteResult> {
  return authedApiFetch<ResendInviteResult>(
    `/api/provider-invites/${encodeURIComponent(providerId)}/resend`,
    { method: "POST", body: "{}" },
  );
}
