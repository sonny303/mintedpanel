// E6.5 F6.5.1 — composition hook for the Payer Setup funnel head. Joins the
// existing caches (payers, subscriptions, SOP heads, portals, field maps) plus
// the shared drift composition and runs the pure buildPayerReadinessFunnel
// derivation over the org's ACTIVE payers (the E4.2 inclusion rule —
// activeOrgPayers, never targets). Nothing stored; every authoring write
// re-derives this list through the existing query invalidations.
import { useMemo } from "react";
import { usePayers, useSops } from "@/hooks/useAdmin";
import { useOrgPayerAssignments } from "@/hooks/useOrgPayerAssignments";
import { usePortals, usePortalFieldMaps } from "@/hooks/usePortals";
import { useFormDrift } from "@/hooks/useFormDrift";
import { activeOrgPayers } from "@/lib/payerSetup";
import { buildPayerReadinessFunnel, type FunnelRow } from "@/lib/payerReadinessFunnel";

export interface PayerReadinessFunnelData {
  rows: FunnelRow[] | undefined;
  totalDrift: number;
  isLoading: boolean;
  isError: boolean;
}

export function usePayerReadinessFunnel(): PayerReadinessFunnelData {
  const payersQ = usePayers();
  const assignmentsQ = useOrgPayerAssignments();
  const templatesQ = useSops();
  const portalsQ = usePortals();
  const fieldMapsQ = usePortalFieldMaps();
  const drift = useFormDrift();

  const sources = [payersQ, assignmentsQ, templatesQ, portalsQ, fieldMapsQ];
  const resolved = sources.every((q) => q.data !== undefined);

  const rows = useMemo(() => {
    if (!resolved) return undefined;
    const included = activeOrgPayers(payersQ.data ?? [], assignmentsQ.data ?? []);
    return buildPayerReadinessFunnel({
      payers: included.map(({ payer }) => ({ id: payer.id, name: payer.name })),
      sops: templatesQ.data ?? [],
      portals: portalsQ.data ?? [],
      fieldMaps: fieldMapsQ.data ?? [],
      driftByPortal: drift.driftByPortal,
    });
  }, [
    resolved,
    payersQ.data,
    assignmentsQ.data,
    templatesQ.data,
    portalsQ.data,
    fieldMapsQ.data,
    drift.driftByPortal,
  ]);

  return {
    rows,
    totalDrift: drift.totalCount,
    isLoading: sources.some((q) => q.isLoading) || drift.isLoading,
    isError: sources.some((q) => q.isError) || drift.isError,
  };
}
