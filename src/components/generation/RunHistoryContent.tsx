// E2.4 F2.4.1 — the generation-runs list: who ran it, when, and its
// disposition counts. Counts derive from the immutable child rows when a run
// has them (the TE-1 single-source rule); a rowless run (pre-E2.4, or one
// that died before recording anything) shows its stored confirm-time plan,
// labeled as such — never passed off as outcomes. Read-only; reached from
// the generation surface, no nav item ([r4-review] Q10).
import { Link } from "@tanstack/react-router";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useGenerationRunRowCounts, useGenerationRuns } from "@/hooks/useGenerationRuns";
import { deriveRunCounts } from "@/lib/generationRuns";
import { fmtDateTime } from "@/lib/format";

export function RunHistoryContent() {
  const runsQ = useGenerationRuns();
  const rowsByRunQ = useGenerationRunRowCounts();

  if (runsQ.isError || rowsByRunQ.isError) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-[13px] text-[#B91C1C]">Couldn&apos;t load the run history.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (runsQ.isError) runsQ.refetch();
            if (rowsByRunQ.isError) rowsByRunQ.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }
  const rowsByRun = rowsByRunQ.data;
  if (!runsQ.data || !rowsByRun) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (runsQ.data.length === 0) {
    return (
      <div className="rounded-md border border-[#E8E5E0] p-6 text-center">
        <History className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-[13px] font-medium">No generation runs yet</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Every confirmed batch records an immutable run here — what was proposed, created, skipped,
          or excluded, and why.
        </p>
        <Button asChild size="sm" className="mt-3 bg-[#1B4D3E] text-white hover:bg-[#163F33]">
          <Link to="/generation">Generate cases</Link>
        </Button>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Confirmed</TableHead>
          <TableHead>By</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Skipped (existing)</TableHead>
          <TableHead>Excluded</TableHead>
          <TableHead>Failed</TableHead>
          <TableHead>
            <span className="sr-only">Open run</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runsQ.data.map((run) => {
          const counts = deriveRunCounts(run, rowsByRun.get(run.id) ?? []);
          return (
            <TableRow key={run.id}>
              <TableCell className="text-[13px] font-medium">
                {fmtDateTime(run.createdAt)}
              </TableCell>
              <TableCell className="text-[13px]">{run.createdByName ?? "Unknown"}</TableCell>
              <TableCell className="text-[13px] tabular-nums">{counts.created}</TableCell>
              <TableCell className="text-[13px] tabular-nums">{counts.skippedExisting}</TableCell>
              <TableCell className="text-[13px] tabular-nums">{counts.excluded}</TableCell>
              <TableCell className="text-[13px] tabular-nums">{counts.failed}</TableCell>
              <TableCell className="text-right">
                <span className="inline-flex items-center gap-2">
                  {counts.fromPlan ? (
                    <span className="text-[11px] text-muted-foreground">
                      plan counts — no per-row record
                    </span>
                  ) : null}
                  <Link
                    to="/generation/runs/$runId"
                    params={{ runId: run.id }}
                    className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
                  >
                    Open run
                  </Link>
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
