// Portals admin query/mutation hooks (Surface 3). Also exposes the field-map
// and last-fill readers the Mapping review (Surface 2) and Fix-it queue
// (Surface 1) reuse — all org-scoped via queryKeys.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import { createPortal, listPortals, updatePortalUrl, type PortalInput } from "@/services/portals";
import { listPortalFieldMapsFromApp } from "@/services/portalFieldMaps";
import { listRecentFillsFromApp } from "@/services/fillSessions";
import type { FillSession } from "@/types";

export function usePortals() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.portals(orgId),
    queryFn: listPortals,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function usePortalFieldMaps(portalKey?: string) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.portalFieldMaps(orgId, portalKey),
    queryFn: () => listPortalFieldMapsFromApp(portalKey),
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

// The raw recent-fills list (no reduction), sharing useLastFills' cache key and
// reader. The payer scorecard needs per-case fill counts, which the
// latest-per-portal reduction would collapse.
export function useRecentFills() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.lastFills(orgId),
    queryFn: () => listRecentFillsFromApp(),
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

// Latest fill session per portal_key (the list arrives newest-first, so the
// first row seen for a key is the most recent).
export function useLastFills() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.lastFills(orgId),
    queryFn: () => listRecentFillsFromApp(),
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
    select: (rows: FillSession[]) => {
      const byPortal = new Map<string, FillSession>();
      for (const row of rows) {
        if (!byPortal.has(row.portalKey)) byPortal.set(row.portalKey, row);
      }
      return byPortal;
    },
  });
}

export function useCreatePortal() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: PortalInput) => createPortal(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.portals(orgId) }),
  });
}

export function useUpdatePortalUrl() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: ({ id, formUrl }: { id: string; formUrl: string }) => updatePortalUrl(id, formUrl),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.portals(orgId) }),
  });
}
