// E4.2 F4.2.2 — the payer readiness composition. Pure projection over ACTIVE
// payer_network_targets × SOP resolution (buildPayerReadiness), enriched with:
//   - TE-16 form readiness: the SAME `mappingCoverage` scorecard derivation over
//     the payer's portals + field maps, shown only when the resolved SOP has an
//     extension_fill task (row.hasExtensionFill).
//   - TE-13 blocked-provider count per payer × state, derived from the shared
//     generation gating (useGenerationPreview().gated).
// Nothing is stored — every read re-derives.
import { useMemo } from "react";
import { usePayerNetworkTargets } from "@/hooks/usePayerNetworkTargets";
import { usePayers, useSops } from "@/hooks/useAdmin";
import { usePortals, usePortalFieldMaps } from "@/hooks/usePortals";
import { useGenerationPreview } from "@/hooks/useGenerationPreview";
import {
  buildPayerReadiness,
  readinessSummary,
  type PayerReadinessRow,
  type ReadinessSummary,
} from "@/lib/payerReadiness";
import { mappingCoverage, type ScorecardIndicator } from "@/lib/payerScorecard";

export interface EnrichedReadinessRow extends PayerReadinessRow {
  /** TE-16 — mapping coverage for an extension_fill SOP; null when N/A. */
  formCoverage: ScorecardIndicator | null;
  /** TE-13 — currently gated (blocked) providers for this payer × state. */
  blockedCount: number;
}

export interface PayerReadinessData {
  rows: EnrichedReadinessRow[] | undefined;
  summary: ReadinessSummary | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function usePayerReadiness(): PayerReadinessData {
  const targetsQ = usePayerNetworkTargets();
  const templatesQ = useSops();
  const payersQ = usePayers();
  const portalsQ = usePortals();
  const fieldMapsQ = usePortalFieldMaps();
  const preview = useGenerationPreview();

  const sources = [targetsQ, templatesQ, payersQ, portalsQ, fieldMapsQ];
  const resolved = sources.every((q) => q.data !== undefined);

  const rows = useMemo(() => {
    if (!resolved) return undefined;
    const payerName = new Map((payersQ.data ?? []).map((p) => [p.id, p.name]));
    const base = buildPayerReadiness({
      targets: (targetsQ.data ?? [])
        .filter((t) => t.status === "active")
        .map((t) => ({ payerId: t.payerId, groupId: t.groupId, state: t.state })),
      templates: templatesQ.data ?? [],
      payerName: (id) => payerName.get(id) ?? id,
    });

    // Blocked counts per payer|state from the shared generation gating.
    const blockedByKey = new Map<string, number>();
    for (const g of preview.gated ?? []) {
      const key = `${g.row.payerId}|${g.row.state}`;
      blockedByKey.set(key, (blockedByKey.get(key) ?? 0) + 1);
    }

    const portals = portalsQ.data ?? [];
    const fieldMaps = fieldMapsQ.data ?? [];

    return base.map<EnrichedReadinessRow>((row) => {
      const formCoverage =
        row.ready && row.hasExtensionFill
          ? mappingCoverage({
              payerId: row.payerId,
              portals,
              fieldMaps,
              cases: [],
              statusConfigs: [],
              fillSessions: [],
            })
          : null;
      return {
        ...row,
        formCoverage,
        blockedCount: blockedByKey.get(`${row.payerId}|${row.state}`) ?? 0,
      };
    });
  }, [
    resolved,
    targetsQ.data,
    templatesQ.data,
    payersQ.data,
    portalsQ.data,
    fieldMapsQ.data,
    preview.gated,
  ]);

  return {
    rows,
    summary: rows ? readinessSummary(rows) : undefined,
    isLoading: sources.some((q) => q.isLoading) || preview.isLoading,
    isError: sources.some((q) => q.isError) || preview.isError,
  };
}
