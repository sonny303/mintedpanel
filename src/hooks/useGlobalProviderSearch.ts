// Type-ahead hook for the cross-org provider lookup (spike PoC).
//
// Unlike every other list hook here this is NOT scoped to the active org —
// see the service for why, and queryKeys.globalProviderSearch for what that
// does to the cache key.
import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth-store";
import { MIN_SEARCH_LENGTH, sanitizeSearchTerm } from "@/lib/globalSearch";
import { useDebounced } from "@/hooks/useDebounced";
import { queryKeys } from "@/hooks/queryKeys";
import { searchProvidersAcrossOrgs, type GlobalProviderHit } from "@/services/globalProviderSearch";

export type { GlobalProviderHit } from "@/services/globalProviderSearch";

const SEARCH_DEBOUNCE_MS = 200;
const THIRTY_SECONDS = 30 * 1000;

export interface GlobalProviderSearchResult {
  hits: GlobalProviderHit[];
  isFetching: boolean;
  isError: boolean;
  /** The term actually searched, after sanitizing and debouncing. */
  term: string;
  /** True once the term is long enough for a query to be issued. */
  isSearchable: boolean;
  /** Orgs the lookup spans — the caller's memberships. */
  orgCount: number;
}

export function useGlobalProviderSearch(rawTerm: string): GlobalProviderSearchResult {
  const memberships = useAuthStore((s) => s.memberships);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const debounced = useDebounced(rawTerm, SEARCH_DEBOUNCE_MS);
  const term = sanitizeSearchTerm(debounced);

  // The caller's own membership list, used to narrow results and to label each
  // hit with its org. Never widens the read — RLS already bounds it.
  const authorizedOrgNames = useMemo(
    () => new Map(memberships.map((m) => [m.orgId, m.orgName])),
    [memberships],
  );

  const isSearchable = Boolean(userId) && term.length >= MIN_SEARCH_LENGTH;

  const query = useQuery({
    queryKey: queryKeys.globalProviderSearch(userId ?? "anon", term),
    queryFn: () => searchProvidersAcrossOrgs(term, authorizedOrgNames),
    enabled: isSearchable,
    staleTime: THIRTY_SECONDS,
    // Typeahead: keep the previous term's rows on screen while the next term
    // resolves, so the palette does not blank out between keystrokes.
    placeholderData: keepPreviousData,
  });

  return {
    hits: query.data ?? [],
    isFetching: query.isFetching,
    isError: query.isError,
    term,
    isSearchable,
    orgCount: authorizedOrgNames.size,
  };
}
