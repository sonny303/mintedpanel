// E6.5 F6.5.4 — the ONE drift composition: latest real fill per portal ×
// live field maps → drifted mappings by portal. Feeds the Sidebar badge
// (total count), the Payer Setup funnel's drift column, and the SOP editor's
// queue-first repair list. Two org caches (vs the retired Fix-it deck's nine).
import { useMemo } from "react";
import { usePortalFieldMaps, useRecentFills } from "@/hooks/usePortals";
import { buildDriftByPortal, latestRealFillPerPortal, totalDriftCount } from "@/lib/formDrift";
import type { PortalFieldMap } from "@/types";

export interface UseFormDriftResult {
  driftByPortal: Map<string, PortalFieldMap[]>;
  totalCount: number;
  isLoading: boolean;
  isError: boolean;
}

export function useFormDrift(): UseFormDriftResult {
  const fillsQ = useRecentFills();
  const mapsQ = usePortalFieldMaps();

  const driftByPortal = useMemo(() => {
    if (!fillsQ.data || !mapsQ.data) return new Map<string, PortalFieldMap[]>();
    return buildDriftByPortal(latestRealFillPerPortal(fillsQ.data), mapsQ.data);
  }, [fillsQ.data, mapsQ.data]);

  return {
    driftByPortal,
    totalCount: totalDriftCount(driftByPortal),
    isLoading: fillsQ.isLoading || mapsQ.isLoading,
    isError: fillsQ.isError || mapsQ.isError,
  };
}
