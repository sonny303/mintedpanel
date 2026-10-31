// MINT-107 — TanStack Query hooks for the org's notification sequences.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  listNotificationSequences,
  saveNotificationSequence,
  type NotificationSequencesResult,
  type SaveNotificationSequenceInput,
} from "@/services/notificationSequences";

/**
 * The org's sequences, or `{ status: "unavailable" }` while this database has
 * no notification tables yet. That is a result, not an error, so it is never
 * retried and never shows the card's load-error box.
 */
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
    onSuccess: async (config) => {
      const key = queryKeys.notificationSequences(orgId);
      // Show the saved copy at once, so the open editor sees its own save as
      // the server's state instead of as a change by someone else.
      qc.setQueryData<NotificationSequencesResult>(key, (old) =>
        old?.status === "available"
          ? { status: "available", sequences: { ...old.sequences, [config.purpose]: config } }
          : old,
      );
      await qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}
