// TanStack Query hooks for org settings: organization, facilities, memberships,
// group insurance policies. Provider groups reuse the shared useProviderGroups
// hook in useLookups so there is a single cache.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveOrgId, useAuthStore } from '@/lib/auth-store';
import type { AppRole } from '@/types';
import {
  createFacility,
  createGroupInsurancePolicy,
  createProviderGroup,
  getOrganization,
  listFacilities,
  listGroupInsurancePolicies,
  listMemberships,
  updateFacility,
  updateGroupInsurancePolicy,
  updateMembershipRole,
  updateOrganizationName,
  updateProviderGroup,
  type FacilityInput,
  type InsurancePolicyInput,
  type ProviderGroupInput,
} from '@/services/orgSettings';

const auditKey = (orgId: string) => ['audit-log', orgId] as const;

/* ------------------------------ Organization ------------------------------ */

export function useOrganization() {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: ['organization', orgId] as const,
    queryFn: () => getOrganization(),
    enabled: orgId !== 'no-org',
  });
}

export function useUpdateOrganizationName() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  const loadMemberships = useAuthStore((s) => s.loadMemberships);
  return useMutation({
    mutationFn: (name: string) => updateOrganizationName(name),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['organization', orgId] });
      await qc.invalidateQueries({ queryKey: auditKey(orgId) });
      await loadMemberships();
    },
  });
}

/* ---------------------------- Provider groups ----------------------------- */

export function useCreateProviderGroup() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (input: ProviderGroupInput) => createProviderGroup(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider-groups', orgId] });
      qc.invalidateQueries({ queryKey: auditKey(orgId) });
    },
  });
}

export function useUpdateProviderGroup(id: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (patch: Partial<ProviderGroupInput>) => updateProviderGroup(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider-groups', orgId] });
      qc.invalidateQueries({ queryKey: auditKey(orgId) });
    },
  });
}

/* -------------------------------- Facilities ------------------------------ */

export function useFacilitiesAll() {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: ['facilities', orgId, 'all'] as const,
    queryFn: () => listFacilities(),
    enabled: orgId !== 'no-org',
  });
}

export function useCreateFacility() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (input: FacilityInput) => createFacility(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facilities', orgId] });
      qc.invalidateQueries({ queryKey: auditKey(orgId) });
    },
  });
}

export function useUpdateFacility(id: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (patch: Partial<FacilityInput>) => updateFacility(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facilities', orgId] });
      qc.invalidateQueries({ queryKey: auditKey(orgId) });
    },
  });
}

/* ------------------------------ Memberships ------------------------------- */

export function useMemberships() {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: ['memberships-admin', orgId] as const,
    queryFn: () => listMemberships(),
    enabled: orgId !== 'no-org',
  });
}

export function useUpdateMembershipRole() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (args: { id: string; role: AppRole }) =>
      updateMembershipRole(args.id, args.role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships-admin', orgId] });
      qc.invalidateQueries({ queryKey: auditKey(orgId) });
    },
  });
}

/* --------------------------- Insurance Policies --------------------------- */

export function useGroupInsurancePolicies(groupId: string) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: ['group-insurance-policies', orgId, groupId] as const,
    queryFn: () => listGroupInsurancePolicies(groupId),
    enabled: orgId !== 'no-org' && Boolean(groupId),
  });
}

export function useCreateGroupInsurancePolicy(groupId: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (input: InsurancePolicyInput) => createGroupInsurancePolicy(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-insurance-policies', orgId, groupId] });
      qc.invalidateQueries({ queryKey: auditKey(orgId) });
    },
  });
}

export function useUpdateGroupInsurancePolicy(id: string, groupId: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (patch: Partial<InsurancePolicyInput>) =>
      updateGroupInsurancePolicy(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-insurance-policies', orgId, groupId] });
      qc.invalidateQueries({ queryKey: auditKey(orgId) });
    },
  });
}
