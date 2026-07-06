// Mapping review (Surface 2) data + mutations. The training route seeds its
// deck from a single load and drives it from local state, so these mutations
// persist each decision but do NOT invalidate the field-maps query mid-flow
// (that would re-split the deck under the user). The route invalidates the
// field-map / portal / fix-it caches on finish and on exit.
import { useMutation, useQuery } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  approveFieldMap,
  markFieldMapManual,
  reproposeFieldMap,
  batchApproveFieldMaps,
  type BatchApproveItem,
} from "@/services/portalFieldMaps";
import { listFieldDictionary, upsertDictionaryEntry } from "@/services/fieldDictionary";
import { listTokenCatalog } from "@/services/tokenCatalog";
import { markPortalVerified } from "@/services/portals";
import { normalizeTokenKey } from "@/lib/tokenFormat";
import type { PortalFieldMap } from "@/types";

const STATIC = { staleTime: Infinity, gcTime: Infinity } as const;

export function useFieldDictionary() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.fieldDictionary(orgId),
    queryFn: listFieldDictionary,
    enabled: orgId !== "no-org",
  });
}

export function useTokenCatalog() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.tokenCatalog(orgId),
    queryFn: listTokenCatalog,
    enabled: orgId !== "no-org",
    ...STATIC,
  });
}

export interface ApproveArgs {
  id: string;
  token: string;
  fieldLabel: string | null;
}

// Approve one field to a token and teach the dictionary. Dictionary learning is
// best-effort: a failure there never fails the approval.
export function useApproveField() {
  return useMutation({
    mutationFn: async ({ id, token, fieldLabel }: ApproveArgs) => {
      const row = await approveFieldMap(id, token, fieldLabel);
      let learned = false;
      try {
        const r = await upsertDictionaryEntry(fieldLabel, normalizeTokenKey(token));
        learned = r.learned;
      } catch {
        learned = false;
      }
      return { row, learned };
    },
  });
}

export function useManualField() {
  return useMutation({
    mutationFn: ({ id, fieldLabel }: { id: string; fieldLabel: string | null }) =>
      markFieldMapManual(id, fieldLabel),
  });
}

export function useReproposeField() {
  return useMutation({
    mutationFn: ({
      id,
      previous,
    }: {
      id: string;
      previous: { token: string | null; source: PortalFieldMap["source"] };
    }) => reproposeFieldMap(id, previous),
  });
}

export function useBatchApprove() {
  return useMutation({
    mutationFn: ({ items, portalKey }: { items: BatchApproveItem[]; portalKey: string }) =>
      batchApproveFieldMaps(items, portalKey),
  });
}

export function useFinishTraining() {
  return useMutation({
    mutationFn: (portalId: string) => markPortalVerified(portalId),
  });
}
