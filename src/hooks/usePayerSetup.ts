// E4.2 unified payer setup — composition hook for the Setup tab. Joins the
// caches the workspace already depends on (payers, subscriptions, F4.2.2
// readiness incl. gating, portals, field maps, recent fills, org payer
// settings) and runs the pure buildPayerSetupRows derivation. Nothing stored;
// every configuration write elsewhere re-derives this list through the
// existing query invalidations.
import { useMemo } from "react";
import { usePayers, useSops } from "@/hooks/useAdmin";
import { useOrgPayerAssignments } from "@/hooks/useOrgPayerAssignments";
import { useOrgPayerSettings } from "@/hooks/useOrgPayerSettings";
import { usePayerReadiness } from "@/hooks/usePayerReadiness";
import { usePortals, usePortalFieldMaps, useRecentFills } from "@/hooks/usePortals";
import {
  buildPayerSetupRows,
  summarizePayerSetup,
  type PayerSetupRow,
  type PayerSetupSummary,
} from "@/lib/payerSetup";

export interface PayerSetupData {
  rows: PayerSetupRow[] | undefined;
  summary: PayerSetupSummary | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function usePayerSetup(): PayerSetupData {
  const payersQ = usePayers();
  const assignmentsQ = useOrgPayerAssignments();
  const readiness = usePayerReadiness();
  // Shares the templates cache usePayerReadiness already populated — the lib
  // only resolves each covered row's tier from it.
  const templatesQ = useSops();
  const portalsQ = usePortals();
  const fieldMapsQ = usePortalFieldMaps();
  const fillsQ = useRecentFills();
  const settingsQ = useOrgPayerSettings();

  const sources = [payersQ, assignmentsQ, templatesQ, portalsQ, fieldMapsQ, fillsQ, settingsQ];
  const resolved = sources.every((q) => q.data !== undefined) && readiness.rows !== undefined;

  const rows = useMemo(() => {
    if (!resolved) return undefined;
    return buildPayerSetupRows({
      payers: payersQ.data ?? [],
      assignments: assignmentsQ.data ?? [],
      readinessRows: readiness.rows ?? [],
      templates: templatesQ.data ?? [],
      portals: portalsQ.data ?? [],
      fieldMaps: fieldMapsQ.data ?? [],
      fills: fillsQ.data ?? [],
      orgSettings: settingsQ.data ?? [],
    });
  }, [
    resolved,
    payersQ.data,
    assignmentsQ.data,
    readiness.rows,
    templatesQ.data,
    portalsQ.data,
    fieldMapsQ.data,
    fillsQ.data,
    settingsQ.data,
  ]);

  return {
    rows,
    summary: rows ? summarizePayerSetup(rows) : undefined,
    isLoading: sources.some((q) => q.isLoading) || readiness.isLoading,
    isError: sources.some((q) => q.isError) || readiness.isError,
  };
}
