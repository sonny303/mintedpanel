// E3.0 — internal power-tool run history (F3.0.1 full visibility): the org's
// recent import runs with their durable state and counts. Selecting a run
// opens its live panel — this is how a scan started earlier (or left mid-way,
// TS-60) is found again after navigating back.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ImportRunPanel, ImportRunStatePill } from "@/components/import/ImportRunPanel";
import { useImportRuns } from "@/hooks/useImportRuns";
import { fmtDateTime } from "@/lib/format";
import type { ImportEntityKind, ImportRunSource } from "@/types";

const SOURCE_LABELS: Record<ImportRunSource, string> = {
  internal: "Internal",
  onboarding: "Onboarding",
};

// E3.3 TE-4: mixed-kind history reads clearly with a per-run entity label.
const ENTITY_KIND_LABELS: Record<ImportEntityKind, string> = {
  provider_group: "Provider groups",
  facility: "Facilities",
  provider: "Providers",
  combined: "Combined (legacy)",
};

export function ImportRunList() {
  const runsQ = useImportRuns();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const runs = runsQ.data ?? [];

  if (runsQ.isLoading) {
    return <p className="text-[13px] text-muted-foreground">Loading runs…</p>;
  }
  if (runs.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No import runs yet — upload a roster above to start one.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {runs.map((run) => (
          <li
            key={run.id}
            className="flex items-center justify-between gap-3 rounded-md border border-[#E8E5E0] bg-white px-3 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-foreground">
                {run.fileName ?? "Roster file"}
              </div>
              <div className="text-[12px] text-muted-foreground tabular-nums">
                {fmtDateTime(run.createdAt)} · {ENTITY_KIND_LABELS[run.entityKind]} ·{" "}
                {SOURCE_LABELS[run.source]} · {run.stagedRows ?? 0} staged · {run.errorRows ?? 0}{" "}
                error{(run.errorRows ?? 0) === 1 ? "" : "s"} of {run.totalRows ?? 0}
              </div>
            </div>
            <div className="flex flex-none items-center gap-2">
              <ImportRunStatePill state={run.state} />
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => setSelectedId(selectedId === run.id ? null : run.id)}
              >
                {selectedId === run.id ? "Hide" : "View"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {selectedId ? <ImportRunPanel runId={selectedId} variant="internal" /> : null}
    </div>
  );
}
