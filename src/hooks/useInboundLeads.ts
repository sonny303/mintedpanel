// Inbound-lead hooks (redesign E0.5 / F0.5.5). The triage list is CROSS-org (a
// lead has no org until converted). The public /contact submit calls the service
// directly (no session). Convert refetches memberships so the new prospect org
// appears in the switcher.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth-store";
import { queryKeys } from "./queryKeys";
import { listInboundLeads, convertInboundLead, dismissInboundLead } from "@/services/inboundLeads";
import type { InboundLead } from "@/types";

export function useInboundLeads() {
  const session = useAuthStore((s) => s.session);
  return useQuery({
    queryKey: queryKeys.inboundLeads(),
    queryFn: listInboundLeads,
    enabled: Boolean(session),
  });
}

export function useConvertInboundLead() {
  const queryClient = useQueryClient();
  const loadMemberships = useAuthStore((s) => s.loadMemberships);
  return useMutation({
    mutationFn: (lead: InboundLead) => convertInboundLead(lead),
    onSuccess: async () => {
      await loadMemberships();
      queryClient.invalidateQueries({ queryKey: queryKeys.inboundLeads() });
      queryClient.invalidateQueries({ queryKey: queryKeys.portfolio() });
    },
  });
}

export function useDismissInboundLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dismissInboundLead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.inboundLeads() }),
  });
}
