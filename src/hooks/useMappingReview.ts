// Mapping review (Surface 2) data + mutations. The training route seeds its
// deck from a single load and drives it from local state, so these mutations
// persist each decision but do NOT invalidate the field-maps query mid-flow
// (that would re-split the deck under the user). The route invalidates the
// field-map / portal / fix-it caches on finish and on exit.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { proposePdfImportRows, summarizePdfImport } from "@/lib/pdfFieldImport";
import { fetchPdfBytes, readPdfAcroFields } from "@/lib/pdfFieldImportClient";

const STATIC = { staleTime: Infinity, gcTime: Infinity } as const;

export function useFieldDictionary(enabled = true) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.fieldDictionary(orgId),
    queryFn: listFieldDictionary,
    enabled: enabled && orgId !== "no-org",
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
  expectedMappingGeneration?: number | null;
}

// Approve one field to a token and teach the dictionary. Dictionary learning is
// best-effort: a failure there never fails the approval.
export function useApproveField() {
  return useMutation({
    mutationFn: async ({ id, token, fieldLabel, expectedMappingGeneration }: ApproveArgs) => {
      const row = await approveFieldMap(id, token, expectedMappingGeneration, fieldLabel);
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
    mutationFn: ({
      id,
      fieldLabel,
      expectedMappingGeneration,
    }: {
      id: string;
      fieldLabel: string | null;
      expectedMappingGeneration?: number | null;
    }) => markFieldMapManual(id, expectedMappingGeneration, fieldLabel),
  });
}

export function useSetFieldMapHardcoded() {
  return useMutation({
    mutationFn: ({
      id,
      value,
      fieldLabel,
      expectedMappingGeneration,
    }: {
      id: string;
      value: string;
      fieldLabel: string | null;
      expectedMappingGeneration?: number | null;
    }) => setFieldMapHardcoded(id, value, expectedMappingGeneration, fieldLabel),
  });
}

export function useSetFieldMapTransform() {
  return useMutation({
    mutationFn: ({
      id,
      transform,
      expectedMappingGeneration,
    }: {
      id: string;
      transform: string | null;
      expectedMappingGeneration?: number | null;
    }) => setFieldMapTransform(id, transform, expectedMappingGeneration),
  });
}

export function useReproposeField() {
  return useMutation({
    mutationFn: ({
      id,
      previous,
      expectedMappingGeneration,
    }: {
      id: string;
      previous: { token: string | null; source: PortalFieldMap["source"] };
      expectedMappingGeneration?: number | null;
    }) => reproposeFieldMap(id, previous, expectedMappingGeneration),
  });
}

// E6.9 F6.9.6 — "Add field" on an online-form step: a reference row the admin
// adds by hand rather than something capture saw. It carries a deterministic
// `manual:` selector because portal_field_maps.selector is NOT NULL and stays
// that way; the fill engine and drift repair both skip that prefix.
export function useAddSharedRegistryField() {
  return useMutation({
    mutationFn: (input: {
      portalKey: string;
      label: string;
      pageStep?: string | null;
      expectedMappingGeneration?: number | null;
    }) =>
      proposeSharedFieldMap({
        portalKey: input.portalKey,
        expectedMappingGeneration: input.expectedMappingGeneration,
        selector: newManualSelector(),
        fieldLabel: input.label,
        pageStep: input.pageStep ?? null,
        notes: "Added by hand in the form editor",
      }),
  });
}

// E6.11 B4 — import a blank payer PDF's AcroForm fields into the shared
// registry, under the FORM FAMILY's portal key.
//
// Propose in bounded parallel batches. A payer PDF may have 100+ fields, but
// flooding the RPC with all of them at once makes partial failures opaque.
// Each proposal is idempotent, so a retry repairs only missing rows and keeps
// every existing decision.
//
// A file with no AcroForm fields resolves with `totalFields: 0`; that is the
// "this PDF is a flat scan" answer, not an error, and the caller says so.
export function useImportPdfFormFields() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: async (
      input: {
        familyId: string;
        expectedMappingGeneration?: number | null;
      } & ({ signedUrl: string } | { file: File }),
    ) => {
      const bytes =
        "file" in input ? await input.file.arrayBuffer() : await fetchPdfBytes(input.signedUrl);
      const descriptors = await readPdfAcroFields(bytes);
      const summary = summarizePdfImport(input.familyId, descriptors);
      const outcome = await proposePdfImportRows(summary.rows, (row) =>
        proposeSharedFieldMap({
          ...row,
          mapType: "pdf",
          expectedMappingGeneration: input.expectedMappingGeneration,
        }),
      );
      return { ...summary, ...outcome };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-field-maps", orgId] }),
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
    mutationFn: async ({
      items,
      portalKey,
      expectedMappingGeneration,
    }: {
      items: BatchApproveItem[];
      portalKey: string;
      expectedMappingGeneration?: number | null;
    }) => {
      const count = await batchApproveFieldMaps(items, portalKey, expectedMappingGeneration);
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
    mutationFn: ({
      portalId,
      expectedMappingGeneration,
    }: {
      portalId: string;
      expectedMappingGeneration?: number | null;
    }) => markPortalVerified(portalId, expectedMappingGeneration),
  });
}
