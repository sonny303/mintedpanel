// E3.0 — one import run's live state (F3.0.3/F3.0.4): the Uploading →
// Scanning → Success/Failed pill, a progress bar bound to the run row's
// server-persisted staged/error counts (so it survives navigation away and
// back), the downloadable error report, and the honest interrupted state for
// a run whose driving tab closed mid-scan (the epic's client-driven-async
// note — never a silent hang). The 'internal' variant additionally lists raw
// per-row error detail; 'streamlined' keeps errors to a count + download.
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Download, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { useCancelImportRun, useImportRun, isScanDrivenHere } from "@/hooks/useImportRuns";
import { downloadCsv } from "@/lib/csv";
import { errorReportCsvRows } from "@/lib/rosterImport";
import type { ImportRun, ImportRunState } from "@/types";

const STATE_PILLS: Record<ImportRunState, { label: string; color: StatusColor }> = {
  uploading: { label: "Uploading", color: "blue" },
  scanning: { label: "Scanning", color: "teal" },
  ready_for_review: { label: "Ready for review", color: "green" },
  committed: { label: "Committed", color: "brand" },
  failed: { label: "Failed", color: "red" },
  cancelled: { label: "Cancelled", color: "neutral" },
};

export function ImportRunStatePill({ state }: { state: ImportRunState }) {
  const pill = STATE_PILLS[state];
  return <StatusPill status={pill.color} label={pill.label} />;
}

// Unspecced composition (logged in DESIGN-DEBT.md): a progress element bound
// to staged/total, built from tokens — no progress primitive exists in ui/.
function ScanProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label="Scan progress"
      className="h-2 w-full overflow-hidden rounded-[4px] bg-[var(--mp-neutral-tint)]"
    >
      <div
        className="h-full bg-[#1B4D3E] transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function downloadErrorReport(run: ImportRun) {
  downloadCsv("roster-import-errors.csv", errorReportCsvRows(run.errorReport ?? []));
}

export function ImportRunPanel({
  runId,
  variant,
}: {
  runId: string;
  variant: "internal" | "streamlined";
}) {
  const runQ = useImportRun(runId);
  const cancelMut = useCancelImportRun();
  const run = runQ.data;

  if (runQ.isLoading) {
    return <p className="text-[13px] text-muted-foreground">Loading run…</p>;
  }
  if (!run) {
    return (
      <p className="text-[13px] text-muted-foreground">This import run is no longer visible.</p>
    );
  }

  const total = run.totalRows ?? 0;
  const done = (run.stagedRows ?? 0) + (run.errorRows ?? 0);
  const scanning = run.state === "uploading" || run.state === "scanning";
  const interrupted = run.state === "scanning" && !isScanDrivenHere(run.id);
  const errors = run.errorReport ?? [];

  const cancel = () =>
    cancelMut.mutate(run.id, {
      onSuccess: () => toast.success("Import run cancelled — staged rows removed"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't cancel the run"),
    });

  return (
    <div className="space-y-3 rounded-md border border-[#E8E5E0] bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-foreground">
            {run.fileName ?? "Roster file"}
          </div>
          <div className="text-[12px] text-muted-foreground tabular-nums">
            {total} row{total === 1 ? "" : "s"}
            {run.state === "ready_for_review" || scanning
              ? ` · ${run.stagedRows ?? 0} staged · ${run.errorRows ?? 0} error${(run.errorRows ?? 0) === 1 ? "" : "s"}`
              : null}
          </div>
        </div>
        <ImportRunStatePill state={run.state} />
      </div>

      {scanning && !interrupted ? (
        <div className="space-y-1">
          <ScanProgressBar done={done} total={total} />
          <p className="text-[12px] text-muted-foreground">
            Scanning in the background — you can leave this page and come back; progress is saved.
          </p>
        </div>
      ) : null}

      {interrupted ? (
        <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-[12px] text-[#92400E]">
          This scan was interrupted before it finished (the tab driving it closed). Cancel the run
          and upload the file again.
        </div>
      ) : null}

      {run.state === "failed" ? (
        <div
          className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]"
          role="alert"
        >
          {errors[0]?.reason ?? "The scan failed."} Cancel the run and upload the file again.
        </div>
      ) : null}

      {run.state === "ready_for_review" ? (
        <div className="space-y-2">
          <p className="text-[12px] text-muted-foreground">
            Staged rows are held for review — nothing has been written to live provider, group, or
            facility records until you commit.
          </p>
          <Button asChild className="h-8 bg-[#1B4D3E] text-white hover:bg-[#163F33]">
            <Link to="/import/$runId" params={{ runId: run.id }}>
              Review &amp; commit
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      ) : null}

      {run.state === "committed" ? (
        <div className="space-y-2">
          <p className="text-[12px] text-muted-foreground">
            Committed — imported providers are Pending Verification until verified on the roster.
          </p>
          <Button asChild variant="outline" className="h-8">
            <Link to="/import/$runId" params={{ runId: run.id }}>
              Open committed run
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      ) : null}

      {run.state === "ready_for_review" && errors.length > 0 ? (
        <div className="flex items-center gap-2 text-[12px] text-[#92400E]">
          <FileWarning className="h-4 w-4" />
          {errors.length} row{errors.length === 1 ? "" : "s"} could not be staged.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {errors.length > 0 && !scanning ? (
          <Button variant="outline" className="h-8" onClick={() => downloadErrorReport(run)}>
            <Download className="mr-1 h-4 w-4" />
            Download error report
          </Button>
        ) : null}
        {interrupted || run.state === "failed" ? (
          <Button
            variant="outline"
            className="h-8 border-[#FCA5A5] text-[#B91C1C]"
            disabled={cancelMut.isPending}
            onClick={cancel}
          >
            {cancelMut.isPending ? "Cancelling…" : "Cancel run"}
          </Button>
        ) : null}
      </div>

      {variant === "internal" && !scanning && errors.length > 0 ? (
        <div className="overflow-hidden rounded-md border border-[#FCA5A5]/60">
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[#B91C1C]">
                  <th className="px-3 py-1.5 font-medium">Row</th>
                  <th className="px-3 py-1.5 font-medium">Column</th>
                  <th className="px-3 py-1.5 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e, i) => (
                  <tr key={i} className="border-t border-[#FCA5A5]/40 text-[#7F1D1D]">
                    <td className="px-3 py-1.5 tabular-nums">{e.line}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{e.column ?? "—"}</td>
                    <td className="px-3 py-1.5">{e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
