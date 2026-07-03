// TanStack Query hooks for provider groups, coordinators, state licenses,
// mso routing rule lookup, and note creation.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import {
  createNote,
  getCoordinators,
  getFacilities,
  getMsoRoutingRule,
  getNotesFor,
  getProviderGroups,
  getStateLicensesByProvider,
  type CreateNoteInput,
} from "@/services/lookups";
import type { NoteEntityType } from "@/types";

export function useFacilities(groupId?: string | null) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.facilities(orgId, groupId),
    queryFn: () => getFacilities(groupId),
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useProviderGroups() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.providerGroups(orgId),
    queryFn: () => getProviderGroups(),
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useCoordinators() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.coordinators(orgId),
    queryFn: () => getCoordinators(),
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useStateLicensesByProvider(providerId: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.stateLicenses(orgId, providerId ?? ""),
    queryFn: () => getStateLicensesByProvider(providerId as string),
    enabled: orgId !== "no-org" && Boolean(providerId),
    staleTime: FIVE_MINUTES,
  });
}

export function useMsoRoutingRule(
  payerId: string | undefined,
  state: string | undefined,
  specialty: string | null | undefined,
) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.msoRoutingRule(orgId, payerId ?? "", state ?? "", specialty ?? ""),
    queryFn: () => getMsoRoutingRule(payerId as string, state as string, specialty ?? null),
    enabled: orgId !== "no-org" && Boolean(payerId && state),
    staleTime: FIVE_MINUTES,
  });
}

export function useNotes(entityType: NoteEntityType, entityId: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.notes(orgId, entityType, entityId ?? ""),
    queryFn: () => getNotesFor(entityType, entityId as string),
    enabled: orgId !== "no-org" && Boolean(entityId),
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: CreateNoteInput) => createNote(input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.notes(orgId, vars.entityType, vars.entityId) });
      if (vars.entityType === "case") {
        qc.invalidateQueries({ queryKey: queryKeys.case(orgId, vars.entityId) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.auditLog(orgId) });
    },
  });
}
