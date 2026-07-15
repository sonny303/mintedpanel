// E4.2 F4.2.1 — SOP wizard draft hooks (save-as-draft WIP, deleted on publish).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import {
  deleteSopTemplateDraft,
  getSopTemplateDraft,
  listSopTemplateDrafts,
  saveSopTemplateDraft,
  type SopTemplateDraftInput,
} from "@/services/sopTemplateDrafts";

export function useSopTemplateDrafts() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.sopTemplateDrafts(orgId),
    queryFn: listSopTemplateDrafts,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useSopTemplateDraft(id: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.sopTemplateDraft(orgId, id ?? "none"),
    queryFn: () => getSopTemplateDraft(id as string),
    enabled: orgId !== "no-org" && Boolean(id),
  });
}

export function useSaveSopTemplateDraft() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: SopTemplateDraftInput) => saveSopTemplateDraft(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.sopTemplateDrafts(orgId) }),
  });
}

export function useDeleteSopTemplateDraft() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (id: string) => deleteSopTemplateDraft(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.sopTemplateDrafts(orgId) }),
  });
}
