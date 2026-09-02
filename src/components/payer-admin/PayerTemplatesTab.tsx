// Payer & Cases design bundle, screen 3 Templates (Slice C) — the payer's
// templates plus a per-row form readiness action that deep-links into Form
// setup (?intent=). Detail-level next-step lives on PayerDetailPage's banner
// (MP-5); this tab does not compete with a second primary CTA.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/StatusPill";
import { useSops } from "@/hooks/useAdmin";
import { useProviderGroups } from "@/hooks/useLookups";
import { usePayerReadinessFunnel } from "@/hooks/usePayerReadinessFunnel";
import { formatSopStateLabel } from "@/lib/sopMatchKey";
import { fmtDate } from "@/lib/format";
import {
  autofillSuggestionStep,
  payerTemplateRows,
  templateStateCoverage,
} from "@/lib/payerDetailView";
import { needsFormFollowUp } from "@/lib/executionTypes";
import type { Payer } from "@/types";

function FormReadinessCell({
  payerId,
  templateId,
  needsPortal,
}: {
  payerId: string;
  templateId: string;
  needsPortal: boolean;
}) {
  const { rows, isLoading } = usePayerReadinessFunnel();
  const row = useMemo(
    () => (rows ?? []).find((r) => r.payerId === payerId) ?? null,
    [rows, payerId],
  );

  if (isLoading) return <Skeleton className="h-6 w-24" />;
  if (!needsPortal) {
    return <span className="text-[12.5px] text-muted-foreground">No online form</span>;
  }
  if (!row) return <span className="text-[12.5px] text-muted-foreground">—</span>;

  if (row.driftCount > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status="red" label={`Drift — ${row.driftCount}`} />
        <Button asChild size="sm" variant="outline" className="h-7 text-[12px]">
          <Link to="/admin/templates/$id" params={{ id: templateId }} search={{ intent: "repair" }}>
            Repair <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </div>
    );
  }

  const soft = autofillSuggestionStep(row);
  if (soft?.intent) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill
          status={row.formState === "proven" ? "green" : "amber"}
          label={
            row.formState === "proven"
              ? "Proven"
              : row.formState === "trained"
                ? "Trained"
                : row.formState === "registered"
                  ? "Registered"
                  : "Not registered"
          }
        />
        <Button asChild size="sm" variant="outline" className="h-7 text-[12px]">
          <Link
            to="/admin/templates/$id"
            params={{ id: soft.templateId ?? templateId }}
            search={{ intent: soft.intent }}
          >
            {soft.label} <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </div>
    );
  }

  return <StatusPill status="green" label="Proven" />;
}

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
  const templateById = useMemo(() => {
    const map = new Map((templatesQ.data ?? []).map((t) => [t.id, t]));
    return map;
  }, [templatesQ.data]);

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
          {templatesQ.isError ? (
            <p className="text-[13px] text-[#B91C1C]">Couldn&apos;t load templates.</p>
          ) : templatesQ.data === undefined ? (
            <Skeleton className="h-20 w-full rounded-[6px]" />
          ) : rows.length === 0 ? (
            <div className="rounded-[6px] border border-dashed border-[#DCDAD4] px-4 py-10 text-center">
              <div className="text-[14px] font-semibold text-foreground">
                No template for this payer yet
              </div>
              <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
                Cases for {payer.name} fall back to the default template, which won&apos;t carry
                this payer&apos;s own tasks or portal form.
              </p>
              <Button asChild className="mt-4 bg-[#1B4D3E] text-white hover:bg-[#163F33]">
                <Link to="/admin/templates/new" search={{ payerId: payer.id, tier: "global" }}>
                  + Author template
                </Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-[6px] border border-[#E8E5E0]">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[#E8E5E0] bg-[#FBFBF9] text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground">
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">State</th>
                      <th className="px-3 py-2">Group</th>
                      <th className="px-3 py-2">Form status</th>
                      <th className="px-3 py-2">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const full = templateById.get(row.id);
                      const needsPortal = full
                        ? needsFormFollowUp(full.taskDefinitions ?? [])
                        : false;
                      return (
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
                            {row.groupId
                              ? (groupNames.get(row.groupId) ?? "One group")
                              : "Any group"}
                          </td>
                          <td className="px-3 py-2.5">
                            <FormReadinessCell
                              payerId={payer.id}
                              templateId={row.id}
                              needsPortal={needsPortal}
                            />
                          </td>
                          <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                            {fmtDate(row.updatedAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[12px] text-muted-foreground">
                Form actions deep-link into Form setup with an intent — no need to walk Basics →
                Actions → step by hand.
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
