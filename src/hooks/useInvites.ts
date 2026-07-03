// TanStack Query hooks for pending invites and membership removal.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import {
  createPendingInvite,
  listPendingInvites,
  removeMembership,
  revokePendingInvite,
  type CreatePendingInviteInput,
  type PendingInvite,
  type RemoveMembershipInput,
} from "@/services/invites";

const invitesKey = (orgId: string) => ["pending-invites", orgId] as const;
const membersKey = (orgId: string) => ["memberships-admin", orgId] as const;
const auditKey = (orgId: string) => ["audit-log", orgId] as const;

export function usePendingInvites() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: invitesKey(orgId),
    queryFn: () => listPendingInvites(),
    enabled: orgId !== "no-org",
  });
}

export function useCreatePendingInvite() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: CreatePendingInviteInput) => createPendingInvite(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invitesKey(orgId) });
      qc.invalidateQueries({ queryKey: auditKey(orgId) });
    },
  });
}

export function useRevokePendingInvite() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (invite: PendingInvite) => revokePendingInvite(invite),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invitesKey(orgId) });
      qc.invalidateQueries({ queryKey: auditKey(orgId) });
    },
  });
}

export function useRemoveMembership() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: RemoveMembershipInput) => removeMembership(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersKey(orgId) });
      qc.invalidateQueries({ queryKey: auditKey(orgId) });
    },
  });
}
