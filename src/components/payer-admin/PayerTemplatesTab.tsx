// Payer & Cases design bundle, screen 3 Templates (Slice C) — the payer's
// templates list. Detail-level next-step lives on PayerDetailPage's banner
// (MP-5); this tab keeps per-row facts (tasks) and does not compete with a
// second primary CTA.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/StatusPill";
import { useSops } from "@/hooks/useAdmin";
import { useProviderGroups } from "@/hooks/useLookups";
import { formatSopStateLabel } from "@/lib/sopMatchKey";
import { fmtDate } from "@/lib/format";
import { payerTemplateRows, templateStateCoverage } from "@/lib/payerDetailView";
import type { Payer } from "@/types";

export function PayerTemplatesTab({ payer }: { payer: Payer }) {
  const templatesQ = useSops();
  const groupsQ = useProviderGroups();

  const rows = useMemo(
    () => payerTemplateRows(templatesQ.data ?? [], payer.id),
    [templatesQ.data, payer.id],
  );
  const groupNames = useMemo(
    () => new Map((groupsQ.data ?? []).map((g) => [g.id, g.name])),
    [groupsQ.data],
  );
  const coverage = useMemo(() => templateStateCoverage(payer, rows), [payer, rows]);

  if (templatesQ.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (templatesQ.isError) {
    return (
      <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#B91C1C]">
        Couldn&apos;t load templates.{" "}
        <button type="button" className="underline" onClick={() => void templatesQ.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[6px] border border-[#E8E5E0] bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#E8E5E0] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold text-foreground">Templates</h2>
            <p className="text-[12.5px] text-muted-foreground">
              The task checklist coordinators follow — can vary by state and group.
              {coverage.label ? <span className="text-foreground"> {coverage.label}.</span> : null}
            </p>
          </div>
          {rows.length > 0 ? (
            <Button asChild variant="outline" size="sm" className="h-8 flex-none px-3 text-[12px]">
              <Link to="/admin/templates/new" search={{ payerId: payer.id, tier: "global" }}>
                + New template
              </Link>
            </Button>
          ) : null}
        </div>
        <div className="p-5">
          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#E8E5E0] px-4 py-8 text-center">
              <p className="text-[14px] font-medium text-foreground">
                No template for this payer yet
              </p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Cases will fall back to the default template until you author one.
              </p>
              <Button asChild className="mt-4 bg-[#1B4D3E] text-white hover:bg-[#163F33]">
                <Link to="/admin/templates/new" search={{ payerId: payer.id, tier: "global" }}>
                  + Author template
                </Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-[6px] border border-[#E8E5E0]">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#E8E5E0] bg-[#FBFBF9] text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground">
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">State</th>
                    <th className="px-3 py-2">Group</th>
                    <th className="px-3 py-2">Tasks</th>
                    <th className="px-3 py-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-[#F0EEEA] last:border-b-0">
                      <td className="px-3 py-2.5 text-[13px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to="/admin/templates/$id"
                            params={{ id: row.id }}
                            className="font-medium text-foreground underline-offset-2 hover:text-[#1B4D3E] hover:underline"
                          >
                            {row.name}
                          </Link>
                          {row.isActiveMatch ? (
                            <StatusPill status="green" label="Active match" />
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                        {row.states.length === 0 ? "Any state" : formatSopStateLabel(row.states)}
                      </td>
                      <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                        {row.groupId ? (groupNames.get(row.groupId) ?? "One group") : "Any group"}
                      </td>
                      <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                        {row.taskCount}
                      </td>
                      <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                        {fmtDate(row.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
