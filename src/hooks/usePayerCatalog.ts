// E1.6 — global payer catalog hooks (cross-org keys; no org scoping).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/queryKeys";
import { listCatalogChanges, listGlobalPayers, reviewCatalogChange } from "@/services/payerCatalog";

export function useGlobalPayers() {
  return useQuery({
    queryKey: queryKeys.payerCatalog(),
    queryFn: listGlobalPayers,
  });
}

export function useCatalogChanges() {
  return useQuery({
    queryKey: queryKeys.payerCatalogChanges(),
    queryFn: listCatalogChanges,
  });
}

export function useReviewCatalogChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ changeId, accept }: { changeId: string; accept: boolean }) =>
      reviewCatalogChange(changeId, accept),
    onSuccess: () => {
      // Accepting applies the field to the payer row, so both caches move.
      void queryClient.invalidateQueries({ queryKey: queryKeys.payerCatalogChanges() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.payerCatalog() });
    },
  });
}
