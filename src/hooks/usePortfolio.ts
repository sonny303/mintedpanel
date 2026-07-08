// Portfolio query hook (redesign E0.0, enabler TE-2). Cross-org: the key is
// intentionally NOT org-scoped (the Portfolio spans all the caller's orgs and
// renders without an active org). Server state is still cleared on org switch
// via auth-store.setActiveOrg -> queryClient.removeQueries().
import { useQuery } from "@tanstack/react-query";
import { listPortfolioOrgs } from "@/services/portfolio";
import { queryKeys, FIVE_MINUTES } from "./queryKeys";

export function usePortfolio() {
  return useQuery({
    queryKey: queryKeys.portfolio(),
    queryFn: listPortfolioOrgs,
    staleTime: FIVE_MINUTES,
  });
}
