// Provider self-onboarding — portal login vault (browser surface). Mirrors
// ssnVault.ts exactly: the decryptable portal password NEVER travels through an
// ordinary table read. provider_portal_credentials has no client SELECT grant, so
// it is never queried from the browser — every path here is a SECURITY DEFINER
// RPC (store_portal_credential / reveal_portal_credential).
//
// The fill-release path (release_portal_credential_for_fill, service_role-only)
// is deliberately NOT reachable from this file: it belongs to the /api layer
// behind guard.ts, like ssnRelease.ts, so the browser bundle never even binds
// that RPC.
import { supabase } from "@/integrations/supabase/externalClient";
import type { PortalCredentialReveal, PortalCredentialStoreResult, PortalId } from "@/types";

// `supabase.rpc` must be called bound (CLAUDE.md gotcha). One loose signature
// reused for every RPC in this file.
function boundRpc() {
  return supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface StorePortalCredentialInput {
  providerId: string;
  portal: PortalId;
  username: string;
  password: string;
}

// Operator (writer): store a portal login. The password is passed once to the
// RPC and never held, cached, or logged; only metadata comes back. A store is a
// rotation, so the server stamps rotated_at.
export async function storePortalCredential(
  input: StorePortalCredentialInput,
): Promise<PortalCredentialStoreResult> {
  const username = input.username.trim();
  if (!username) throw new Error("Portal username is required");
  const { data, error } = await boundRpc()("store_portal_credential", {
    p_provider_id: input.providerId,
    p_portal: input.portal,
    p_username: username,
    p_password: input.password,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ok: Boolean(row.ok),
    providerId: (row.provider_id as string) ?? input.providerId,
    orgId: (row.org_id as string) ?? "",
    portal: (row.portal as PortalId) ?? input.portal,
    username: (row.username as string) ?? username,
    rotatedAt: (row.rotated_at as string) ?? "",
  };
}

export interface RevealPortalCredentialInput {
  providerId: string;
  portal: PortalId;
  justification: string;
}

// Operator (writer roles, re-checked server-side): reveal the portal password
// with a justification. Returns the plaintext ONCE for a brief auto-rehide
// window — the caller must never persist, cache, or log it. Called from a
// mutation, so it never enters the query cache.
export async function revealPortalCredential(
  input: RevealPortalCredentialInput,
): Promise<PortalCredentialReveal> {
  const justification = input.justification.trim();
  if (!justification) throw new Error("A justification is required");
  const { data, error } = await boundRpc()("reveal_portal_credential", {
    p_provider_id: input.providerId,
    p_portal: input.portal,
    p_justification: justification,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    portal: (row.portal as PortalId) ?? input.portal,
    username: (row.username as string) ?? "",
    password: (row.password as string) ?? "",
    lastVerifiedAt: (row.last_verified_at as string) ?? "",
  };
}
