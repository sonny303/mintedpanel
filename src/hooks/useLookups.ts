// TanStack Query hooks for provider groups, coordinators, state licenses,
// mso routing rule lookup, and note creation.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveOrgId } from '@/lib/auth-store';
import {
  createNote,
  getCoordinators,
  getFacilities,
  getMsoRoutingRule,
  getProviderGroups,
  getStateLicensesByProvider,
  type CreateNoteInput,
} from '@/services/lookups';

export function useFacilities(groupId?: string | null) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: ['facilities', orgId, groupId ?? 'all'] as const,
    queryFn: () => getFacilities(groupId),
    enabled: orgId !== 'no-org',
  });
}

export function useProviderGroups() {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: ['provider-groups', orgId] as const,
    queryFn: () => getProviderGroups(),
    enabled: orgId !== 'no-org',
  });
}

export function useCoordinators() {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: ['coordinators', orgId] as const,
    queryFn: () => getCoordinators(),
    enabled: orgId !== 'no-org',
  });
}

export function useStateLicensesByProvider(providerId: string | undefined) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: ['state-licenses', orgId, providerId ?? ''] as const,
    queryFn: () => getStateLicensesByProvider(providerId as string),
    enabled: orgId !== 'no-org' && Boolean(providerId),
  });
}

export function useMsoRoutingRule(
  payerId: string | undefined,
  state: string | undefined,
  specialty: string | null | undefined,
) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: ['mso-routing-rule', orgId, payerId ?? '', state ?? '', specialty ?? ''] as const,
    queryFn: () => getMsoRoutingRule(payerId as string, state as string, specialty ?? null),
    enabled: orgId !== 'no-org' && Boolean(payerId && state),
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (input: CreateNoteInput) => createNote(input),
    onSuccess: (_data, vars) => {
      if (vars.entityType === 'case') {
        qc.invalidateQueries({ queryKey: ['case', orgId, vars.entityId] });
      }
      qc.invalidateQueries({ queryKey: ['audit-log', orgId] });
    },
  });
}
