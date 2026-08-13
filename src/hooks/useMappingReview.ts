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
  setFieldMapHardcoded,
  setFieldMapTransform,
  batchApproveFieldMaps,
  type BatchApproveItem,
  updateSharedFieldRegistry,
  type SharedRegistryPatch,
  proposeSharedFieldMap,
} from "@/services/portalFieldMaps";
import { listFieldDictionary, upsertDictionaryEntry } from "@/services/fieldDictionary";
import { listTokenCatalog } from "@/services/tokenCatalog";
import { markPortalVerified } from "@/services/portals";
import { normalizeTokenKey } from "@/lib/tokenFormat";
import type { PortalFieldMap } from "@/types";
import { newManualSelector } from "@/lib/fieldRegistry";

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

export function useSetFieldMapHardcoded() {
  return useMutation({
    mutationFn: ({
      id,
      value,
      fieldLabel,
    }: {
      id: string;
      value: string;
      fieldLabel: string | null;
    }) => setFieldMapHardcoded(id, value, fieldLabel),
  });
}

export function useSetFieldMapTransform() {
  return useMutation({
    mutationFn: ({ id, transform }: { id: string; transform: string | null }) =>
      setFieldMapTransform(id, transform),
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

// E6.9 F6.9.6 — "Add field" on an online-form step: a reference row the admin
// adds by hand rather than something capture saw. It carries a deterministic
// `manual:` selector because portal_field_maps.selector is NOT NULL and stays
// that way; the fill engine and drift repair both skip that prefix.
export function useAddSharedRegistryField() {
  return useMutation({
    mutationFn: (input: { portalKey: string; label: string; pageStep?: string | null }) =>
      proposeSharedFieldMap({
        portalKey: input.portalKey,
        selector: newManualSelector(),
        fieldLabel: input.label,
        pageStep: input.pageStep ?? null,
        notes: "Added by hand in the form editor",
      }),
  });
}

// E6.9 F6.9.5 — write display_label / section / sort_order on SHARED rows.
// Batched because re-capture reorders a whole page at once: one RPC call, one
// transaction, no half-ordered intermediate state.
export function useUpdateSharedFieldRegistry() {
  return useMutation({
    mutationFn: (patches: SharedRegistryPatch[]) => updateSharedFieldRegistry(patches),
  });
}

// Confirm-all also teaches the dictionary (one suggested entry per approved
// label), mirroring the one-by-one Approve path, and returns how many labels
// were learned so the session tally stays accurate. Dictionary learning is
// best-effort and never fails the batch.
export function useBatchApprove() {
  return useMutation({
    mutationFn: async ({ items, portalKey }: { items: BatchApproveItem[]; portalKey: string }) => {
      const count = await batchApproveFieldMaps(items, portalKey);
      let learned = 0;
      for (const item of items) {
        try {
          const r = await upsertDictionaryEntry(item.fieldLabel, normalizeTokenKey(item.token));
          if (r.learned) learned += 1;
        } catch {
          // best-effort; a learning failure never fails the batch
        }
      }
      return { count, learned };
    },
  });
}

export function useFinishTraining() {
  return useMutation({
    mutationFn: (portalId: string) => markPortalVerified(portalId),
  });
}
