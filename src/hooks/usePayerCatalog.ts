// E1.6 — global payer catalog hooks (cross-org key; no org scoping). The E4.2
// governance PR removed the org-user diff-review hooks — catalog curation is
// platform tooling (see services/payerCatalog.ts).
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/queryKeys";
import { listGlobalPayers } from "@/services/payerCatalog";

export function useGlobalPayers() {
  return useQuery({
    queryKey: queryKeys.payerCatalog(),
    queryFn: listGlobalPayers,
  });
}
