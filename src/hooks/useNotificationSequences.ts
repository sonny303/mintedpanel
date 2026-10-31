// MINT-107 — TanStack Query hooks for the org's notification sequences.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  listNotificationSequences,
  saveNotificationSequence,
  type SaveNotificationSequenceInput,
} from "@/services/notificationSequences";

export function useNotificationSequences() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.notificationSequences(orgId),
    queryFn: () => listNotificationSequences(),
    enabled: orgId !== "no-org",
  });
}

export function useSaveNotificationSequence() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: SaveNotificationSequenceInput) => saveNotificationSequence(input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.notificationSequences(orgId) });
      void qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}
