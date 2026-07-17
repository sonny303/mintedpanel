// Party / CRM-contact hooks (E0.2 contacts + E0.3 Full Party model). Org-scoped
// query keys; every mutation invalidates the org's contacts + parties lists so
// the workspace refreshes immediately (F0.2.3 "real time" = refresh after the
// user's own edit, no Realtime subscription).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys, FIVE_MINUTES } from "./queryKeys";
import {
  listOrgContacts,
  listOrgParties,
  listPartyRoleTypes,
  listVisibleParties,
  updateParty,
  createParty,
  assignRole,
  unassignRole,
  removePartyFromOrg,
  type UpdatePartyInput,
} from "@/services/parties";
import type { ContactInput, PartyRoleKey } from "@/types";

export function useOrgContacts() {
  const orgId = useActiveOrgId();
  return useQuery({
    queryKey: queryKeys.orgContacts(orgId ?? "none"),
    queryFn: listOrgContacts,
    enabled: Boolean(orgId),
    staleTime: FIVE_MINUTES,
  });
}

export function useOrgParties() {
  const orgId = useActiveOrgId();
  return useQuery({
    queryKey: queryKeys.orgParties(orgId ?? "none"),
    queryFn: listOrgParties,
    enabled: Boolean(orgId),
    staleTime: FIVE_MINUTES,
  });
}

export function usePartyRoleTypes() {
  return useQuery({
    queryKey: queryKeys.partyRoleTypes(),
    queryFn: listPartyRoleTypes,
    staleTime: FIVE_MINUTES,
  });
}

export function useVisibleParties() {
  const orgId = useActiveOrgId();
  return useQuery({
    queryKey: ["visible-parties", orgId ?? "none"] as const,
    queryFn: listVisibleParties,
    enabled: Boolean(orgId),
    staleTime: FIVE_MINUTES,
  });
}

// One invalidator for every party mutation — contacts + parties both derive from
// party_role_assignments, so both caches must refresh.
function useInvalidateParties() {
  const orgId = useActiveOrgId();
  const queryClient = useQueryClient();
  return () => {
    if (!orgId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.orgContacts(orgId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.orgParties(orgId) });
    queryClient.invalidateQueries({ queryKey: ["visible-parties", orgId] });
  };
}

export function useUpdateParty() {
  const invalidate = useInvalidateParties();
  return useMutation({
    mutationFn: (vars: { partyId: string; input: UpdatePartyInput }) =>
      updateParty(vars.partyId, vars.input),
    onSuccess: invalidate,
  });
}

export function useCreateParty() {
  const invalidate = useInvalidateParties();
  return useMutation({
    mutationFn: (input: ContactInput) => createParty(input),
    onSuccess: invalidate,
  });
}

export function useAssignRole() {
  const invalidate = useInvalidateParties();
  return useMutation({
    mutationFn: (vars: { partyId: string; roleKey: PartyRoleKey }) =>
      assignRole(vars.partyId, vars.roleKey),
    onSuccess: invalidate,
  });
}

export function useUnassignRole() {
  const invalidate = useInvalidateParties();
  return useMutation({
    mutationFn: (vars: { partyId: string; roleKey: PartyRoleKey }) =>
      unassignRole(vars.partyId, vars.roleKey),
    onSuccess: invalidate,
  });
}

export function useRemovePartyFromOrg() {
  const invalidate = useInvalidateParties();
  return useMutation({
    mutationFn: (partyId: string) => removePartyFromOrg(partyId),
    onSuccess: invalidate,
  });
}
