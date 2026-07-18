// E4.4 Sensitive Identifiers Vault hooks (operator side). The public recipient
// route (/ssn-intake/:token) calls the service directly — no query cache, no
// session. Reveal is a MUTATION (never a query) so the plaintext never enters
// the cache; the reveal component holds it in local state for a brief window.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys, FIVE_MINUTES } from "./queryKeys";
import {
  getSsnIntakeLink,
  issueSsnIntakeLink,
  revealSsn,
  storeSsn,
  type IssueSsnIntakeLinkInput,
} from "@/services/ssnVault";

export function useSsnIntakeLink(providerId: string) {
  const orgId = useActiveOrgId();
  return useQuery({
    queryKey: queryKeys.ssnIntakeLink(orgId ?? "none", providerId),
    queryFn: () => getSsnIntakeLink(providerId),
    enabled: Boolean(orgId && providerId),
    staleTime: FIVE_MINUTES,
  });
}

export function useIssueSsnIntakeLink() {
  const orgId = useActiveOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: IssueSsnIntakeLinkInput) => issueSsnIntakeLink(input),
    onSuccess: (_data, input) => {
      if (orgId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.ssnIntakeLink(orgId, input.providerId),
        });
      }
    },
  });
}

export function useStoreSsn(providerId: string) {
  const orgId = useActiveOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ssn: string) => storeSsn(providerId, ssn),
    onSuccess: () => {
      if (!orgId) return;
      // ssn_last4 changed on the provider row — refresh the provider surfaces
      // that render the mask.
      queryClient.invalidateQueries({ queryKey: queryKeys.provider(orgId, providerId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.providers(orgId) });
    },
  });
}

export function useRevealSsn(providerId: string) {
  return useMutation({
    mutationFn: (justification: string) => revealSsn(providerId, justification),
  });
}
