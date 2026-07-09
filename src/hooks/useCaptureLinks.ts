// Capture-link hooks (redesign E0.5). Operator-side only — the public recipient
// route (/capture/:token) calls the service directly (no query cache, no session).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys, FIVE_MINUTES } from "./queryKeys";
import {
  getCaptureLink,
  issueCaptureLink,
  type IssueCaptureLinkInput,
} from "@/services/captureLinks";

export function useCaptureLink() {
  const orgId = useActiveOrgId();
  return useQuery({
    queryKey: queryKeys.captureLink(orgId ?? "none"),
    queryFn: getCaptureLink,
    enabled: Boolean(orgId),
    staleTime: FIVE_MINUTES,
  });
}

export function useIssueCaptureLink() {
  const orgId = useActiveOrgId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: IssueCaptureLinkInput) => issueCaptureLink(input),
    onSuccess: () => {
      if (orgId) queryClient.invalidateQueries({ queryKey: queryKeys.captureLink(orgId) });
    },
  });
}
