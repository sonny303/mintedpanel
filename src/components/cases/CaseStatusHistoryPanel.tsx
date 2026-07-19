// E6.0 — the "Status history" timeline on case detail: every unified-status
// transition, attributed system/user (F6.0.2), evidence-linked to its touch
// when one exists (F6.0.3), corrections flagged with their note (F6.0.4).
// Read-only to ALL org roles; append-only underneath.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { History } from "lucide-react";
import { StatusPill } from "@/components/StatusPill";
import { fmtDateTime } from "@/lib/format";
import { CaseStatusPill } from "@/components/cases/CaseStatusPill";
import { caseStatusLabel } from "@/lib/caseStatus";
import { touchTypeLabel } from "@/lib/touchTypes";
import type { CaseStatusHistoryEntry, Touch, TouchType } from "@/types";

export function CaseStatusHistoryPanel({
  history,
  touches,
}: {
  history: CaseStatusHistoryEntry[];
  /** The case's touch embed — evidence_touch_id resolves against it locally
   * (same case, already loaded; no second fetch). */
  touches?: Touch[];
}) {
  // Tolerate an absent embed (narrow/mock case objects) — the real getCase
  // always provides the array; never crash the case detail on its absence.
  const sorted = [...(history ?? [])].sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  const touchById = new Map((touches ?? []).map((t) => [t.id, t]));

  return (
    <Card className="shadow-none border-border">
      <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
        <CardTitle className="text-[14px] font-semibold flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" /> Status history
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {sorted.length === 0 ? (
          <div className="p-6">
            <EmptyState message="No status changes yet" />
          </div>
        ) : (
          <ul className="space-y-3 text-[13px]">
            {sorted.map((h) => {
              const evidence = h.evidenceTouchId ? touchById.get(h.evidenceTouchId) : undefined;
              return (
                <li key={h.id} className="flex justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-foreground">
                      <span className="text-muted-foreground">
                        {h.fromStatus ? caseStatusLabel(h.fromStatus) : "—"}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <CaseStatusPill status={h.toStatus} />
                      {h.isCorrection ? <StatusPill status="amber" label="Correction" /> : null}
                    </div>
                    {h.reasonLabel ? (
                      <div className="text-[11px] text-muted-foreground">
                        Reason: {h.reasonLabel}
                      </div>
                    ) : null}
                    {h.note ? (
                      <div className="text-[11px] text-muted-foreground">“{h.note}”</div>
                    ) : null}
                    {h.evidenceTouchId ? (
                      <div className="text-[11px] text-muted-foreground">
                        Evidence:{" "}
                        {evidence
                          ? `${touchTypeLabel(evidence.touchType as TouchType | null)} touch`
                          : "logged touch"}
                      </div>
                    ) : null}
                    <div className="text-[11px] text-muted-foreground">
                      {h.actorKind === "system" ? "by system" : `by ${h.changedByName ?? "someone"}`}
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground text-right shrink-0 tabular-nums">
                    {fmtDateTime(h.changedAt)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
