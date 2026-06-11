// TanStack Query hooks for provider groups and coordinator profile lookups,
// org-scoped via the active org id from the auth store.
import { useQuery } from '@tanstack/react-query';
import { useActiveOrgId } from '@/lib/auth-store';
import { getCoordinators, getProviderGroups } from '@/services/lookups';

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
