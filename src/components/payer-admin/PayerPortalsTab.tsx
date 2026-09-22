// MP-3 — payer-scoped portal inventory on Payer Detail. Row click opens the
// maintenance drawer (URL update / stop using). No writes on this list.
import { useMemo, useState } from "react";
import { StatusPill } from "@/components/StatusPill";
import { Skeleton } from "@/components/ui/skeleton";
import { PortalDrawer } from "@/components/PortalDrawer";
import { useSops } from "@/hooks/useAdmin";
import { usePortalFieldMaps, usePortals } from "@/hooks/usePortals";
import { useFormDrift } from "@/hooks/useFormDrift";
import { buildPayerPortalInventory } from "@/lib/payerPortalsView";
import type { Payer, Portal } from "@/types";

export function PayerPortalsTab({ payer }: { payer: Payer }) {
  const portalsQ = usePortals();
  const templatesQ = useSops();
  const mapsQ = usePortalFieldMaps();
  const drift = useFormDrift();
  const [active, setActive] = useState<Portal | null>(null);

  const rows = useMemo(
    () =>
      buildPayerPortalInventory({
        payerId: payer.id,
        portals: portalsQ.data ?? [],
        templates: templatesQ.data ?? [],
        fieldMaps: mapsQ.data ?? [],
        driftByPortal: drift.driftByPortal,
      }),
    [payer.id, portalsQ.data, templatesQ.data, mapsQ.data, drift.driftByPortal],
  );

  const loading = portalsQ.isLoading || templatesQ.isLoading || mapsQ.isLoading;
  const errored = portalsQ.isError || templatesQ.isError || mapsQ.isError;

  return (
    <div className="space-y-4">
      <section className="rounded-[6px] border border-[#E8E5E0] bg-white">
        <div className="border-b border-[#E8E5E0] px-5 py-4">
          <h2 className="text-[16px] font-semibold text-foreground">Portals — {payer.name}</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Row opens URL edit and stop-using. Portal keys are permanent identity.
          </p>
        </div>
        <div className="p-5">
          {errored ? (
            <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#B91C1C]">
              Couldn&apos;t load portals.{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => {
                  void portalsQ.refetch();
                  void templatesQ.refetch();
                  void mapsQ.refetch();
                }}
              >
                Retry
              </button>
            </div>
          ) : loading ? (
            <Skeleton className="h-28 w-full rounded-[6px]" />
          ) : rows.length === 0 ? (
            <div className="rounded-[6px] border border-dashed border-[#DCDAD4] px-4 py-10 text-center">
              <div className="text-[14px] font-semibold text-foreground">
                No portals for this payer
              </div>
              <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
                Register a portal from a template&apos;s online-form step (Form setup), or when an
                Action links one during authoring.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-[6px] border border-[#E8E5E0]">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#E8E5E0] bg-[#FBFBF9] text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="h-10 px-3">Portal key</th>
                    <th className="h-10 px-3">URL</th>
                    <th className="h-10 px-3">Tier</th>
                    <th className="h-10 px-3">Status</th>
                    <th className="h-10 px-3">Used by</th>
                    <th className="h-10 px-3">Last proven</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.portal.id}
                      className="h-10 cursor-pointer border-b border-[#F0EEEA] last:border-b-0 hover:bg-[#FAFAF9]"
                      tabIndex={0}
                      onClick={() => setActive(row.portal)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setActive(row.portal);
                        }
                      }}
                    >
                      <td className="px-3">
                        <div className="text-[13px] font-medium text-foreground">
                          {row.displayName}
                        </div>
                        <code className="text-[11px] text-muted-foreground">
                          {row.portal.portalKey}
                        </code>
                      </td>
                      <td
                        className="max-w-[220px] truncate px-3 font-mono text-[12px] text-muted-foreground"
                        title={row.portal.formUrl ?? undefined}
                      >
                        {row.formUrlDisplay}
                      </td>
                      <td className="px-3">
                        <StatusPill
                          status={row.tier === "global" ? "brand" : "neutral"}
                          label={row.tier === "global" ? "Global" : "Org"}
                        />
                      </td>
                      <td className="px-3">
                        <StatusPill status={row.status.tone} label={row.status.label} />
                      </td>
                      <td className="px-3 text-[13px] text-muted-foreground">
                        {row.usedByCount} step{row.usedByCount === 1 ? "" : "s"}
                      </td>
                      <td className="px-3 text-[13px] text-muted-foreground">
                        {row.lastProvenLabel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {active ? (
        <PortalDrawer
          portal={active}
          payerId={payer.id}
          onClose={() => setActive(null)}
          onPortalUpdated={(p) => setActive(p)}
        />
      ) : null}
    </div>
  );
}
