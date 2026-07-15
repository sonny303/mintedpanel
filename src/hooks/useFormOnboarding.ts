// E4.2 F4.2.7 — form onboarding & test runner hooks. The designated test
// provider is an ordinary providers row (isTestProvider); a dry run records a
// marked (is_test) fill session with the per-field results computed from the
// portal's field maps × the test provider's resolved tokens. Nothing submits.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  listTestFillsFromApp,
  recordTestFillFromApp,
  type TestFillInput,
} from "@/services/fillSessions";

export function useTestFills(portalKey: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.testFills(orgId, portalKey ?? "none"),
    queryFn: () => listTestFillsFromApp(portalKey as string),
    enabled: orgId !== "no-org" && Boolean(portalKey),
  });
}

export function useRecordTestFill() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: TestFillInput) => recordTestFillFromApp(input),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: queryKeys.testFills(orgId, input.portalKey) });
      qc.invalidateQueries({ queryKey: queryKeys.lastFills(orgId) });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}
