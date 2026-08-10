// Payer & Cases design bundle, screen 3 Templates (Slice C) — the payer's
// templates, plus the ONE next step that moves this payer forward.
//
// This tab is also the new HOME of the ?intent= producer CTAs. Slice F built
// the Template Editor's five inline online-form modes and the readiness CTAs
// that deep-link them; Slice A superseded the surface those CTAs used to live
// on, and §2.7 forbids putting them back on Payer Setup. So the per-payer
// next-step affordance lands here, where the payer's own templates are. The
// param spellings come from Slice F's shipped TEMPLATE_EDITOR_INTENTS via the
// pure templateIntentForFormSuggestion map (asserted against that union in
// payerDetailView.test.ts — a silent spelling drift would break the deep link
// with no error). The E6.5 funnel derivation is REUSED — Ready is checklist
// SOP only; autofill is a soft secondary CTA (`autofillSuggestionStep`).
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/StatusPill";
import { useSops } from "@/hooks/useAdmin";
import { useProviderGroups } from "@/hooks/useLookups";
import { usePayerReadinessFunnel } from "@/hooks/usePayerReadinessFunnel";
import { fmtDate } from "@/lib/format";
import {
  autofillSuggestionStep,
  payerTemplateRows,
  templateNextStep,
  templateStateCoverage,
} from "@/lib/payerDetailView";
import type { Payer } from "@/types";

function NextStepCard({ payer }: { payer: Payer }) {
  const { rows, isLoading, isError } = usePayerReadinessFunnel();
  const row = useMemo(
    () => (rows ?? []).find((r) => r.payerId === payer.id) ?? null,
    [rows, payer.id],
  );

  if (isLoading) return <Skeleton className="h-16 w-full rounded-[6px]" />;
  // A payer outside the org's network has no readiness row — the templates
  // list below still renders, and authoring still works from its CTA.
  if (isError || !row) return null;

  const step = templateNextStep(row);
  if (step.action === "ready") {
    const autofill = autofillSuggestionStep(row);
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-[6px] border border-[#E8E5E0] bg-white px-4 py-3">
        <StatusPill status="green" label="Ready for business" />
        <span className="min-w-[160px] flex-1 text-[12.5px] text-muted-foreground">
          {row.readyNote ?? "Published enrollment checklist — nothing blocking."}
        </span>
        {autofill?.templateId ? (
          <Button asChild size="sm" variant="outline" className="h-8 flex-none">
            <Link
              to="/admin/templates/$id"
              params={{ id: autofill.templateId }}
              search={autofill.intent ? { intent: autofill.intent } : undefined}
            >
              {autofill.label} <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[6px] border border-[#E8E5E0] bg-white px-4 py-3">
      <div className="min-w-[200px] flex-1">
        <div className="text-[13px] font-semibold text-foreground">Next step: {step.label}</div>
        {step.position ? (
          <div className="text-[12px] text-muted-foreground">{step.position}</div>
        ) : null}
      </div>
      <Button asChild size="sm" className="h-8 flex-none bg-[#1B4D3E] text-white hover:bg-[#163F33]">
        <Link to="/admin/templates/new" search={{ payerId: payer.id, tier: "global" }}>
          {step.label} <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Link>
      </Button>
    </div>
  );
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

  return (
    <div className="space-y-4">
      <NextStepCard payer={payer} />

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
                <table className="w-full min-w-[640px] border-collapse text-left">
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
                          {row.state ?? "Any state"}
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
              <p className="mt-3 text-[12px] text-muted-foreground">
                A case picks the most specific match — exact group beats any-group, and a payer
                template beats the default. Only the active match runs.
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
