// 2026-10-20 — TanStack Query wrappers for portal credential write/reveal.
import { useMutation } from "@tanstack/react-query";
import { revealPortalCredential, storePortalCredential } from "@/services/portalCredentials";
import type { PortalCredentialReveal, PortalCredentialStoreResult, PortalId } from "@/types";

export function useStorePortalCredential() {
  return useMutation<
    PortalCredentialStoreResult,
    Error,
    { providerId: string; portal: PortalId; username: string; password: string }
  >({
    mutationFn: ({ providerId, portal, username, password }) =>
      storePortalCredential({ providerId, portal, username, password }),
  });
}

export function useRevealPortalCredential() {
  return useMutation<
    PortalCredentialReveal,
    Error,
    { providerId: string; portal: PortalId; justification: string }
  >({
    mutationFn: ({ providerId, portal, justification }) =>
      revealPortalCredential({ providerId, portal, justification }),
  });
}
