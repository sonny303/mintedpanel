// Touches hooks: list per case and append-only log mutation.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  getLastTouchDates,
  getLatestTouchFollowUps,
  getTouches,
  logTouch,
  type TouchInput,
} from "@/services/touches";

const THIRTY_SECONDS = 30_000;

export function useLastTouchDates() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: ["touches", orgId, "last-per-case"] as const,
    queryFn: () => getLastTouchDates(),
    enabled: orgId !== "no-org",
    staleTime: THIRTY_SECONDS,
  });
}

// M5 (sanctioned): latest touch follow-up per case for the Home queue.
export function useFollowUpsDue() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: ["touches", orgId, "latest-follow-ups"] as const,
    queryFn: () => getLatestTouchFollowUps(),
    enabled: orgId !== "no-org",
    staleTime: THIRTY_SECONDS,
  });
}

export function useTouches(caseId: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.touches(orgId, caseId ?? ""),
    queryFn: () => getTouches(caseId as string),
    enabled: orgId !== "no-org" && Boolean(caseId),
    staleTime: THIRTY_SECONDS,
  });
}

export interface LogTouchVars {
  caseId: string;
  input: TouchInput;
}

export function useLogTouch() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (vars: LogTouchVars) => logTouch(vars.caseId, vars.input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.touches(orgId, vars.caseId) });
      qc.invalidateQueries({ queryKey: ["touches", orgId, "last-per-case"] });
      qc.invalidateQueries({ queryKey: queryKeys.case(orgId, vars.caseId) });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}
