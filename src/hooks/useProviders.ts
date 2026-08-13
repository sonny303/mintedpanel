// Providers query hooks: filter by active org; invalidate on mutations.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  createProvider,
  createProviderWithDetails,
  getProvider,
  getProviders,
  listProviderGroupAssignments,
  setGroupAssignments,
  terminateProvider,
  updateProvider,
  verifyProviders,
  updateProviderWithLicenses,
  type CreateProviderWithDetailsInput,
  type ProviderFilters,
  type ProviderInput,
  type TerminateProviderInput,
  type UpdateProviderWithLicensesInput,
} from "@/services/providers";
import { FIVE_MINUTES } from "@/hooks/queryKeys";
import {
  listOrgAssignments,
  setAssignments,
  setPrimaryAssignment,
} from "@/services/providerAssignments";
import type { AssignmentDraft } from "@/lib/assignmentScope";
import { invalidateProviderRosterCaches } from "@/lib/providerRosterCaches";

const THIRTY_SECONDS = 30_000;

export function useProviders(filters: ProviderFilters = {}) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.providers(orgId, filters),
    queryFn: () => getProviders(filters),
    enabled: orgId !== "no-org",
    staleTime: THIRTY_SECONDS,
  });
}

export function useProvider(id: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.provider(orgId, id ?? ""),
    queryFn: () => getProvider(id as string),
    enabled: orgId !== "no-org" && Boolean(id),
    staleTime: THIRTY_SECONDS,
  });
}

export function useCreateProvider() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: ProviderInput) => createProvider(input),
    onSuccess: async () => {
      await invalidateProviderRosterCaches(qc, orgId);
    },
  });
}

export function useUpdateProvider(id: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (patch: Partial<ProviderInput>) => updateProvider(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.provider(orgId, id) });
    },
  });
}

export function useUpdateProviderWithLicenses(id: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: UpdateProviderWithLicensesInput) => updateProviderWithLicenses(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.provider(orgId, id) });
      qc.invalidateQueries({ queryKey: ["state-licenses", orgId, id] });
      qc.invalidateQueries({ queryKey: queryKeys.orgStateLicenses(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.providerGroupAssignments(orgId) });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

export function useTerminateProvider(id: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: Omit<TerminateProviderInput, "providerId">) =>
      terminateProvider({ ...input, providerId: id }),
    onSuccess: async () => {
      await invalidateProviderRosterCaches(qc, orgId);
      qc.invalidateQueries({ queryKey: queryKeys.provider(orgId, id) });
      qc.invalidateQueries({ queryKey: ["cases", orgId] });
      qc.invalidateQueries({ queryKey: ["tasks", orgId] });
    },
  });
}

// E1.3 — the M:N provider↔group assignment rows (roster list + summaries).
export function useProviderGroupAssignments() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.providerGroupAssignments(orgId),
    queryFn: () => listProviderGroupAssignments(),
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

// E1.3 — the wizard's create path: provider + licenses (PSV) + group
// assignments in one service call. Awaits the roster/readiness refetch so
// /providers/new can navigate to the record without a stale Cases tab.
export function useCreateProviderWithDetails() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: CreateProviderWithDetailsInput) => createProviderWithDetails(input),
    onSuccess: async () => {
      await invalidateProviderRosterCaches(qc, orgId);
    },
  });
}

// E1.4 — provider↔facility assignments (the wizard Assignments section).
// Shares the launches "facility-assignments" cache (same table, one cache).
export function useProviderAssignments() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.facilityAssignments(orgId),
    queryFn: () => listOrgAssignments(),
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useSetAssignments(providerId: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (drafts: AssignmentDraft[]) => setAssignments(providerId, drafts),
    onSuccess: async () => {
      await invalidateProviderRosterCaches(qc, orgId);
    },
  });
}

export function useSetPrimaryAssignment() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (vars: { providerId: string; assignmentId: string }) =>
      setPrimaryAssignment(vars.providerId, vars.assignmentId),
    onSuccess: async () => {
      await invalidateProviderRosterCaches(qc, orgId);
    },
  });
}

/** E6.4 F6.4.3 — the record's in-place group-membership editor. A narrow
 * write to provider_group_assignments only (same invariants/RPC-free order as
 * the roster form path); the frozen providers.group_id mirror follows the
 * primary, so the providers cache invalidates too. */
export function useSetGroupAssignments(providerId: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (assignments: { groupId: string; isPrimary: boolean }[]) =>
      setGroupAssignments(providerId, assignments),
    onSuccess: async () => {
      await invalidateProviderRosterCaches(qc, orgId);
    },
  });
}

/** E3.1 F3.1.4 — the explicit verify action (single or bulk). Invalidates the
 * provider caches AND the readiness-facts read (the TE-2 staging fence), so
 * the verified provider is a readiness/generation candidate on the very next
 * derivation — no re-import. */
export function useVerifyProviders() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (providerIds: string[]) => verifyProviders(providerIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers", orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.providerReadinessFacts(orgId) });
    },
  });
}
