import { useQuery } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import { supabase } from "@/integrations/supabase/externalClient";
import { normalizePortalKey } from "@/lib/tokenFormat";
import { listEffectivePortalMapResolutions } from "@/services/portalFieldMaps";

/** Resolve one portal key through the canonical owner-aware map resolver.
 * This avoids selecting the first same-key row from legacy global/org lists. */
export function useExactPortalConfiguration(portalKey: string | null | undefined) {
  const orgId = useActiveOrgId();
  const key = normalizePortalKey(portalKey);
  return useQuery({
    queryKey: queryKeys.effectivePortalMapResolution(orgId ?? "no-org", key ?? "no-key", "web"),
    queryFn: async () => {
      if (!orgId || !key) return null;
      const [resolution] = await listEffectivePortalMapResolutions(
        { db: supabase, orgId },
        { portalKey: key, mapType: "web" },
      );
      return resolution ?? null;
    },
    enabled: Boolean(orgId && key),
    staleTime: FIVE_MINUTES,
  });
}
