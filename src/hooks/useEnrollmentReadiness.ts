// E1.8 composition hook — assembles the readiness inputs from the SAME
// org-scoped caches the wizard already maintains (targets, group membership,
// facilities, licenses) plus the three new readiness reads, and runs the pure
// evaluator. Nothing is stored: any source mutation invalidates its own cache
// and the matrix re-derives (F1.8.1 — a PSV recorded in the roster flips the
// check here with zero readiness writes).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import { useFacilities, useOrgStateLicenses, useProviderGroups } from "@/hooks/useLookups";
import { useProviderGroupAssignments } from "@/hooks/useProviders";
import { usePayers } from "@/hooks/useAdmin";
import { usePayerNetworkTargets } from "@/hooks/usePayerNetworkTargets";
import {
  evaluateEnrollmentReadiness,
  readinessSummary,
  type ReadinessRow,
  type ReadinessSummary,
} from "@/lib/enrollmentReadiness";
import {
  listGroupInsurancePolicies,
  listGroupReadinessDocuments,
  listProviderReadinessFacts,
} from "@/services/enrollmentReadiness";
import type { Payer, ProviderGroup } from "@/types";

/** Date-only "today" in the user's local calendar (readiness mirrors the
 * spreadsheet pre-flight, which Sowmya reads in local time). */
export function localTodayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function useProviderReadinessFacts() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.providerReadinessFacts(orgId),
    queryFn: listProviderReadinessFacts,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useGroupReadinessDocuments() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.groupReadinessDocuments(orgId),
    queryFn: listGroupReadinessDocuments,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useGroupInsurancePolicies() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.groupInsurancePolicies(orgId),
    queryFn: listGroupInsurancePolicies,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export interface EnrollmentReadinessData {
  /** undefined while any source read is unresolved (loading or error). */
  rows: ReadinessRow[] | undefined;
  summary: ReadinessSummary | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  /** Display/filter lookups (names resolved by id in the matrix). */
  groups: ProviderGroup[];
  payers: Payer[];
}

export function useEnrollmentReadiness(): EnrollmentReadinessData {
  const targetsQ = usePayerNetworkTargets();
  const groupAssignmentsQ = useProviderGroupAssignments();
  const factsQ = useProviderReadinessFacts();
  const licensesQ = useOrgStateLicenses();
  const facilitiesQ = useFacilities();
  const documentsQ = useGroupReadinessDocuments();
  const insuranceQ = useGroupInsurancePolicies();
  const groupsQ = useProviderGroups();
  const payersQ = usePayers();

  const sources = [
    targetsQ,
    groupAssignmentsQ,
    factsQ,
    licensesQ,
    facilitiesQ,
    documentsQ,
    insuranceQ,
  ];
  const resolved = sources.every((q) => q.data !== undefined);
  const today = localTodayIso();

  const rows = useMemo(() => {
    if (!resolved) return undefined;
    return evaluateEnrollmentReadiness({
      today,
      targets: targetsQ.data ?? [],
      groupAssignments: groupAssignmentsQ.data ?? [],
      providers: factsQ.data ?? [],
      licenses: licensesQ.data ?? [],
      facilities: facilitiesQ.data ?? [],
      groupDocuments: documentsQ.data ?? [],
      groupInsurancePolicies: insuranceQ.data ?? [],
    });
  }, [
    resolved,
    today,
    targetsQ.data,
    groupAssignmentsQ.data,
    factsQ.data,
    licensesQ.data,
    facilitiesQ.data,
    documentsQ.data,
    insuranceQ.data,
  ]);

  return {
    rows,
    summary: rows ? readinessSummary(rows) : undefined,
    isLoading: sources.some((q) => q.isLoading),
    isError: sources.some((q) => q.isError),
    refetch: () => {
      for (const q of sources) if (q.isError) q.refetch();
    },
    groups: groupsQ.data ?? [],
    payers: payersQ.data ?? [],
  };
}
