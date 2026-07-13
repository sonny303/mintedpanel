// E2.4 F2.4.2 — "where did I come from" on case detail. EXTENDS the E2.2
// SOP-provenance block (composed below, never re-implemented): the origin
// line (generating run deep link, or a distinct manual origin — NULL run id,
// the E2.1 F2.1.4 contract) with the creation actor and date, and — when the
// case has been reapplied — the derived cycle timeline (TE-6: task creation
// clusters with their version stamps, recovered from append-only data; each
// cycle's status transition is the status-history card the page already
// renders). Read-only; everything here is derivation over loaded data.
import { Link } from "@tanstack/react-router";
import { GitBranch, History } from "lucide-react";
import { CaseSopProvenance } from "@/components/cases/CaseSopProvenance";
import { caseOrigin, deriveTaskCycles } from "@/lib/generationRuns";
import { fmtDate } from "@/lib/format";
import type { CaseDetail, Task } from "@/types";

export function CaseProvenancePanel({ c, tasks }: { c: CaseDetail; tasks: Task[] }) {
  const origin = caseOrigin(c);
  const cycles = deriveTaskCycles(tasks);
  const actor = origin.actorName ?? "unknown";

  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <History className="h-4 w-4 shrink-0" />
        {origin.kind === "generation" ? (
          <span>
            Created by a{" "}
            <Link
              to="/generation/runs/$runId"
              params={{ runId: origin.runId }}
              className="font-medium text-[#1B4D3E] underline underline-offset-2"
            >
              generation run
            </Link>{" "}
            — confirmed by {actor} on {fmtDate(origin.createdAt)}
          </span>
        ) : (
          <span>
            Created manually by {actor} on {fmtDate(origin.createdAt)}
          </span>
        )}
      </span>

      <CaseSopProvenance tasks={tasks} />

      {cycles.length > 1 ? (
        <span className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          <GitBranch className="h-4 w-4 shrink-0" />
          <span>
            {cycles.length} application cycles on this case:{" "}
            {cycles
              .map(
                (cycle, i) =>
                  `${i === 0 ? "original" : "reapplied"} ${fmtDate(cycle.createdAt)} (${
                    cycle.taskCount
                  } ${cycle.taskCount === 1 ? "task" : "tasks"}${
                    cycle.stamps.length > 0
                      ? `, v${cycle.stamps.map((s) => s.sopVersion).join("/v")}`
                      : ""
                  })`,
              )
              .join(" · ")}{" "}
            — status transitions in the history card below.
          </span>
        </span>
      ) : null}
    </div>
  );
}
