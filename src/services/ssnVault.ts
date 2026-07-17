// E4.4 Sensitive Identifiers Vault service (browser + anon). The full SSN NEVER
// travels through an ordinary table read: every path here is a SECURITY DEFINER
// RPC. The vault table itself has no client SELECT grant, so it is never queried
// from the browser.
//
// Two audiences share this file, like captureLinks.ts:
//   - OPERATOR (authenticated): store the full SSN via store_ssn, reveal it
//     (admin-only) via reveal_ssn, and issue/read a secure intake link.
//   - RECIPIENT (unauthenticated, public /ssn-intake/:token route): validate +
//     submit via the anon RPCs (no session — a token link, no login).
//
// The server-only fill release path lives in ssnRelease.ts (service-role ctx),
// never here, so the browser bundle never imports the release RPC binding.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg } from "@/lib/audit";
import type {
  IssuedSsnIntakeLink,
  SsnIntakeLink,
  SsnIntakeTokenState,
  SsnIntakeTokenView,
  SsnRevealResult,
  SsnStoreResult,
} from "@/types";

// `supabase.rpc` must be called bound (CLAUDE.md gotcha). One loose signature
// reused for every RPC in this file.
function boundRpc() {
  return supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

// Operator (writer): store the full SSN into the vault. The value is passed once
// to the RPC and never held, cached, or logged; only the mask comes back.
export async function storeSsn(providerId: string, ssn: string): Promise<SsnStoreResult> {
  const { data, error } = await boundRpc()("store_ssn", {
    p_provider_id: providerId,
    p_ssn: ssn,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  const last4 = (row.ssn_last4 as string) ?? "";
  return {
    ok: Boolean(row.ok),
    ssnLast4: last4,
    mask: (row.mask as string) ?? `***--${last4}`,
  };
}

// Operator (admin only, re-checked server-side): reveal the full SSN with a
// justification. Returns the plaintext ONCE for a brief auto-rehide window — the
// caller must never persist, cache, or log it. Called from a mutation, so it
// never enters the query cache.
export async function revealSsn(
  providerId: string,
  justification: string,
): Promise<SsnRevealResult> {
  const { data, error } = await boundRpc()("reveal_ssn", {
    p_provider_id: providerId,
    p_justification: justification,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ssn: (row.ssn as string) ?? "",
    ssnLast4: (row.ssn_last4 as string) ?? "",
  };
}

// Operator: the provider's most recent SSN intake link (drives the status
// surface — none / active-until / used / expired). RLS scopes reads to the
// caller's orgs; the extra org filter is defensive.
export async function getSsnIntakeLink(providerId: string): Promise<SsnIntakeLink | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("provider_ssn_intake_links")
    .select("*")
    .eq("org_id", orgId)
    .eq("provider_id", providerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<SsnIntakeLink>(data) : null;
}

export interface IssueSsnIntakeLinkInput {
  providerId: string;
  recipientEmail: string;
  recipientName?: string;
}

// Operator (writer): issue (or re-issue — the RPC revokes any prior active link
// for the provider) a secure intake link. Returns the raw token ONCE for URL +
// instructions assembly; it is never persisted.
export async function issueSsnIntakeLink(
  input: IssueSsnIntakeLinkInput,
): Promise<IssuedSsnIntakeLink> {
  const email = input.recipientEmail.trim();
  if (!email) throw new Error("Recipient email is required");
  const { data, error } = await boundRpc()("create_ssn_intake_link", {
    p_provider_id: input.providerId,
    p_recipient_email: email,
    p_recipient_name: input.recipientName?.trim() || null,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    token: row.token as string,
    providerId: row.provider_id as string,
    providerName: (row.provider_name as string) ?? "",
    recipientEmail: row.recipient_email as string,
    recipientName: (row.recipient_name as string) ?? email,
    orgName: (row.org_name as string) ?? "",
    expiresAt: row.expires_at as string,
  };
}

// Recipient (anon): what the public route learns about a token. Never leaks any
// org beyond the single authorized one, and never the SSN (write-only ingress).
export async function validateSsnIntakeToken(token: string): Promise<SsnIntakeTokenView> {
  const { data, error } = await boundRpc()("validate_ssn_intake_token", { p_token: token });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    state: row.state as SsnIntakeTokenState,
    orgName: (row.org_name as string) ?? undefined,
    providerName: (row.provider_name as string) ?? undefined,
    recipientEmail: (row.recipient_email as string) ?? undefined,
    expiresAt: (row.expires_at as string) ?? undefined,
  };
}

// Recipient (anon): submit the full SSN. Server encrypts it into the vault and
// echoes back only the mask + the resulting link state; the value is never
// returned.
export async function submitSsnIntake(
  token: string,
  ssn: string,
): Promise<{ ok: boolean; state: SsnIntakeTokenState; mask?: string }> {
  const { data, error } = await boundRpc()("submit_ssn_intake", {
    p_token: token,
    p_ssn: ssn,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ok: Boolean(row.ok),
    state: row.state as SsnIntakeTokenState,
    mask: (row.mask as string) ?? undefined,
  };
}
