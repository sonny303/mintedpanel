// TanStack Query hooks for org-wide reports data:
// touch summary rows and roster auxiliary data.
import { useQuery } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import { getRosterAux, getTouchSummary } from "@/services/reports";

export function useTouchSummary() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.touchSummary(orgId),
    queryFn: () => getTouchSummary(),
    enabled: orgId !== "no-org",
  });
}

export function useRosterAux() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.rosterAux(orgId),
    queryFn: () => getRosterAux(),
    enabled: orgId !== "no-org",
  });
}
