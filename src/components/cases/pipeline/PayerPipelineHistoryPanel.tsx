// E4.0 F4.0.1 — the user-visible "Payer pipeline history" timeline on case
// detail. Read-only to ALL org roles (P1/P2/billing alike); append-only —
// every transition, correction (flagged, with justification), and its reason,
// each attributed (who / when / from → to). Never backend-only.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { History } from "lucide-react";
import { StatusPill } from "@/components/StatusPill";
import { fmtDateTime } from "@/lib/format";
import { payerPipelineTone } from "./PayerPipelineBadge";
import { pipelineLabel, type PayerPipelineState } from "@/lib/payerPipeline";
import type { PayerPipelineHistoryEntry } from "@/types";

export function PayerPipelineHistoryPanel({ history }: { history: PayerPipelineHistoryEntry[] }) {
  const sorted = [...history].sort((a, b) => b.changedAt.localeCompare(a.changedAt));

  return (
    <Card className="shadow-none border-border">
      <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
        <CardTitle className="text-[14px] font-semibold flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" /> Payer pipeline history
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {sorted.length === 0 ? (
          <div className="p-6">
            <EmptyState message="No pipeline changes yet" />
          </div>
        ) : (
          <ul className="space-y-3 text-[13px]">
            {sorted.map((h) => (
              <li key={h.id} className="flex justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-foreground">
                    <span className="text-muted-foreground">
                      {h.fromState ? pipelineLabel(h.fromState as PayerPipelineState) : "—"}
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <StatusPill
                      status={payerPipelineTone(h.toState)}
                      label={pipelineLabel(h.toState)}
                    />
                    {h.isCorrection ? <StatusPill status="amber" label="Correction" /> : null}
                  </div>
                  {h.reasonLabel ? (
                    <div className="text-[11px] text-muted-foreground">Reason: {h.reasonLabel}</div>
                  ) : null}
                  {h.justification ? (
                    <div className="text-[11px] text-muted-foreground">“{h.justification}”</div>
                  ) : null}
                  {h.changedByName ? (
                    <div className="text-[11px] text-muted-foreground">by {h.changedByName}</div>
                  ) : null}
                </div>
                <div className="text-[11px] text-muted-foreground text-right shrink-0 tabular-nums">
                  {fmtDateTime(h.changedAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
