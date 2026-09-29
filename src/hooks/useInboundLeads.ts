// Inbound-lead hooks (redesign E0.5 / F0.5.5). The triage list is CROSS-org (a
// lead has no org until converted). The public /contact submit calls the service
// directly (no session). Convert refetches memberships so the new prospect org
// appears in the switcher.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuthStore } from "@/lib/auth-store";
import { queryKeys } from "./queryKeys";
import { listInboundLeads, convertInboundLead, dismissInboundLead } from "@/services/inboundLeads";
import type { InboundLead } from "@/types";

type ConversionMutationContext = {
  actorUserId: string | null;
  accessToken: string | null;
  authGeneration: number;
  audience: "staff" | "client" | null;
  restrictedExternal: boolean;
};

function compatibleInternalScope(origin: ConversionMutationContext): boolean {
  const current = useAuthStore.getState();
  return (
    !!origin.actorUserId &&
    current.user?.id === origin.actorUserId &&
    current.session !== null &&
    current.session.access_token === origin.accessToken &&
    current.authGeneration === origin.authGeneration &&
    origin.audience === "staff" &&
    current.accessContext?.audience === "staff" &&
    current.accessContext.restrictedExternal === origin.restrictedExternal
  );
}

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
    onMutate: (): ConversionMutationContext => {
      const state = useAuthStore.getState();
      return {
        actorUserId: state.user?.id ?? null,
        accessToken: state.session?.access_token ?? null,
        authGeneration: state.authGeneration,
        audience: state.accessContext?.audience ?? null,
        restrictedExternal: state.accessContext?.restrictedExternal ?? false,
      };
    },
    onSuccess: async (_orgId, lead, context) => {
      const origin = context as ConversionMutationContext | undefined;
      if (!origin || !compatibleInternalScope(origin)) return;

      let membershipRefreshError: unknown = null;
      try {
        await loadMemberships();
      } catch (error) {
        // Conversion is already committed. Keep the success outcome distinct
        // from a follow-up membership refresh failure.
        membershipRefreshError = error;
      }
      if (!compatibleInternalScope(origin)) return;

      queryClient.invalidateQueries({ queryKey: queryKeys.inboundLeads() });
      queryClient.invalidateQueries({ queryKey: queryKeys.portfolio() });
      toast.success(`Created ${lead.orgName} as a prospect`);
      if (membershipRefreshError) {
        toast.warning(
          "The prospect was created, but your memberships could not refresh. Refresh to see it.",
        );
      }
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
