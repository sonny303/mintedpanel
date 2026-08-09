// E1.6 — global payer catalog hooks (cross-org key; no org scoping). The E4.2
// governance PR removed the org-user diff-review hooks — catalog curation is
// platform tooling (see services/payerCatalog.ts).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/queryKeys";
import { usePayers } from "@/hooks/useAdmin";
import { mergeAuthoringPayers } from "@/lib/authoringPayers";
import { listGlobalPayers } from "@/services/payerCatalog";
import type { Payer } from "@/types";

export function useGlobalPayers() {
  return useQuery({
    queryKey: queryKeys.payerCatalog(),
    queryFn: listGlobalPayers,
  });
}

/**
 * 3M Slice 6 / D6.5 — the payer universe the Template Editor names: the org's
 * visible payers UNION the global catalog, so a payer created without org
 * adoption (create_payer p_assign_to_org = false) is still pickable and still
 * renders its own name on the template being authored for it. See
 * src/lib/authoringPayers.ts for why this is a read union rather than a
 * widened payers policy.
 *
 * Loading/error are reported honestly across BOTH reads: a half-loaded union
 * would silently look like a missing payer.
 */
export function useAuthoringPayers(): {
  data: Payer[] | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const orgQ = usePayers();
  const catalogQ = useGlobalPayers();
  const data = useMemo(
    () =>
      orgQ.data === undefined && catalogQ.data === undefined
        ? undefined
        : mergeAuthoringPayers(orgQ.data, catalogQ.data),
    [orgQ.data, catalogQ.data],
  );
  return {
    data,
    isLoading: orgQ.isLoading || catalogQ.isLoading,
    isError: orgQ.isError || catalogQ.isError,
  };
}
