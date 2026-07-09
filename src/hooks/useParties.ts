// Party / CRM-contact hooks (E0.2). Org-scoped query keys; an edit invalidates
// the contacts list so the workspace refreshes immediately (F0.2.3 "real time"
// = immediate refresh after the user's own edit, no Realtime subscription).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys, FIVE_MINUTES } from "./queryKeys";
import { listOrgContacts, updateParty, type UpdatePartyInput } from "@/services/parties";

export function useOrgContacts() {
  const orgId = useActiveOrgId();
  return useQuery({
    queryKey: queryKeys.orgContacts(orgId ?? "none"),
    queryFn: listOrgContacts,
    enabled: Boolean(orgId),
    staleTime: FIVE_MINUTES,
  });
}

export function useUpdateParty() {
  const orgId = useActiveOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { partyId: string; input: UpdatePartyInput }) =>
      updateParty(vars.partyId, vars.input),
    onSuccess: () => {
      if (orgId) queryClient.invalidateQueries({ queryKey: queryKeys.orgContacts(orgId) });
    },
  });
}
