// Payer & Cases design bundle, screen 3 Cases (Slice C) — this payer's open
// cases by PAYER PIPELINE STAGE (the external machine, payerPipeline.ts). The
// Cases page shows the internal case status; these are two different columns
// by design and are never merged into one label (§2.6).
//
// Link-out only: the row opens the case. Nothing from the case-detail screen
// is imported here — the payer page reads state and hands off.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { useCases } from "@/hooks/useCases";
import { useProviders } from "@/hooks/useProviders";
import { fmtDate } from "@/lib/format";
import { buildPayerCaseRows } from "@/lib/payerDetailView";
import { PAYER_PIPELINE_LABELS, type PayerPipelineState } from "@/lib/payerPipeline";
import type { Payer } from "@/types";

// The E4.0 tone map, kept visually distinct from the internal status pill.
const PIPELINE_TONE: Record<PayerPipelineState, StatusColor> = {
  not_started: "neutral",
  assigned: "blue",
  drafting: "blue",
  submitted: "teal",
  in_review: "teal",
  action_required: "amber",
  approved: "green",
  denied: "red",
  oon: "neutral",
};

function pipelineLabel(state: string): string {
  return PAYER_PIPELINE_LABELS[state as PayerPipelineState] ?? state;
}

function pipelineTone(state: string): StatusColor {
  return PIPELINE_TONE[state as PayerPipelineState] ?? "neutral";
}

export function PayerCasesTab({ payer }: { payer: Payer }) {
  const casesQ = useCases();
  const providersQ = useProviders();

  const providerNames = useMemo(
    () =>
      new Map(
        (providersQ.data ?? []).map((p) => [
          p.id,
          `${p.lastName}, ${p.firstName}${p.credentials ? `, ${p.credentials}` : ""}`,
        ]),
      ),
    [providersQ.data],
  );

  const rows = useMemo(
    () => buildPayerCaseRows(payer.id, casesQ.data ?? [], providerNames),
    [payer.id, casesQ.data, providerNames],
  );

  return (
    <section className="rounded-[6px] border border-[#E8E5E0] bg-white">
      <div className="border-b border-[#E8E5E0] px-5 py-4">
        <h2 className="text-[16px] font-semibold text-foreground">Open cases</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Where each open case stands with the payer. Case status itself lives on the case.
        </p>
      </div>
      <div className="p-5">
        {/* providersQ resolves the provider names these rows render, so it
            gates the same way casesQ does — see PayerEnrollmentsTab. */}
        {casesQ.isError || providersQ.isError ? (
          <p className="text-[13px] text-[#B91C1C]">Couldn&apos;t load cases.</p>
        ) : casesQ.data === undefined || providersQ.data === undefined ? (
          <Skeleton className="h-20 w-full rounded-[6px]" />
        ) : rows.length === 0 ? (
          <div className="rounded-[6px] border border-dashed border-[#DCDAD4] px-4 py-10 text-center">
            <div className="text-[14px] font-semibold text-foreground">No open cases</div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Cases for this payer appear here while they are in flight.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[6px] border border-[#E8E5E0]">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#E8E5E0] bg-[#FBFBF9] text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground">
                  <th className="px-3 py-2">Case#</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Payer pipeline stage</th>
                  <th className="px-3 py-2">Submitted</th>
                  <th className="px-3 py-2">Effective</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    // Action Required is the one stage where the ball is in our
                    // court, so the whole row carries the warn tint rather than
                    // leaving the signal to the pill alone.
                    className={`border-b border-[#F0EEEA] last:border-b-0 ${
                      row.pipelineState === "action_required" ? "bg-[var(--mp-warn-tint)]" : ""
                    }`}
                  >
                    <td className="px-3 py-2.5 text-[13px]">
                      <Link
                        to="/cases/$id"
                        params={{ id: row.id }}
                        className="font-mono font-medium text-[#1B4D3E] underline underline-offset-2"
                      >
                        {row.caseNumber ? `C-${row.caseNumber}` : "Open"}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-[13px]">
                      <Link
                        to="/cases/$id"
                        params={{ id: row.id }}
                        className="font-medium text-foreground underline-offset-2 hover:text-[#1B4D3E] hover:underline"
                      >
                        {row.providerName}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-muted-foreground">{row.state}</td>
                    <td className="px-3 py-2.5">
                      <StatusPill
                        status={pipelineTone(row.pipelineState)}
                        label={pipelineLabel(row.pipelineState)}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                      {row.submittedDate ? fmtDate(row.submittedDate) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                      {row.effectiveDate ? fmtDate(row.effectiveDate) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
