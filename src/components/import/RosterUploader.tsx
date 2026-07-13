// E3.0 — the ONE upload pipeline both role-gated surfaces render (F3.0.1: no
// divergent data paths). Template download (F3.0.2, generated from the same
// canonical header list the gate checks), client file checks (.csv + 10 MB),
// the exact-match header front gate BEFORE any row work, the
// columns-and-sample-rows preview (F3.0.3), then the chunked async scan
// (F3.0.4) via useStartRosterScan. Variants differ only in presentation:
// 'internal' shows raw error detail, 'streamlined' (the org-rep wizard
// surface) keeps errors simple — same validation, same staging.
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImportRunPanel } from "@/components/import/ImportRunPanel";
import { RosterDropZone } from "@/components/import/RosterDropZone";
import { useImportRuns, useStartRosterScan } from "@/hooks/useImportRuns";
import { parseCsv, type ParsedCsv } from "@/lib/csvImport";
import { downloadCsvText } from "@/lib/csv";
import {
  ROSTER_TEMPLATE_FILENAME,
  checkRosterFile,
  checkRosterHeaders,
  headerGateMessage,
  presentHeaders,
  previewRows,
  rosterTemplateCsv,
} from "@/lib/rosterImport";
import type { ImportRunSource } from "@/types";

type Phase =
  | { kind: "idle" }
  | { kind: "rejected"; fileName: string; message: string }
  | { kind: "preview"; fileName: string; parsed: ParsedCsv }
  | { kind: "run"; runId: string };

function TemplateDownloadButton() {
  return (
    <Button
      variant="outline"
      className="h-8"
      onClick={() => downloadCsvText(ROSTER_TEMPLATE_FILENAME, rosterTemplateCsv())}
    >
      <Download className="mr-1 h-4 w-4" />
      Download CSV template
    </Button>
  );
}

export function RosterUploader({
  source,
  variant,
}: {
  source: ImportRunSource;
  variant: "internal" | "streamlined";
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const startScan = useStartRosterScan();
  const runsQ = useImportRuns();

  // Resume affordance (F3.0.4): a run started earlier from this surface
  // surfaces on return — progress lives on the run row, not in this
  // component's state. The internal tool resumes in-flight scans only (its
  // run history covers outcomes); the streamlined wizard surface has no
  // history list, so a run awaiting review or failed stays visible here too.
  const resumeStates =
    variant === "internal"
      ? ["uploading", "scanning"]
      : ["uploading", "scanning", "ready_for_review", "failed"];
  const inFlight =
    phase.kind === "idle"
      ? (runsQ.data ?? []).find((r) => r.source === source && resumeStates.includes(r.state))
      : undefined;

  const handleFile = async (file: File) => {
    const fileError = checkRosterFile(file.name, file.size);
    if (fileError) {
      setPhase({ kind: "rejected", fileName: file.name, message: fileError });
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    const gate = checkRosterHeaders(parsed.headers);
    const gateMessage = headerGateMessage(gate);
    if (gateMessage) {
      setPhase({ kind: "rejected", fileName: file.name, message: gateMessage });
      return;
    }
    if (parsed.records.length === 0) {
      setPhase({
        kind: "rejected",
        fileName: file.name,
        message: "The file has the right columns but no data rows.",
      });
      return;
    }
    setPhase({ kind: "preview", fileName: file.name, parsed });
  };

  const startImport = (fileName: string, parsed: ParsedCsv) => {
    startScan.mutate(
      { source, fileName, parsed },
      { onSuccess: (runId) => setPhase({ kind: "run", runId }) },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">
          One row per provider × group × facility; repeat rows per license. Headers must match the
          template exactly.
        </p>
        <TemplateDownloadButton />
      </div>

      {phase.kind === "idle" || phase.kind === "rejected" ? (
        <>
          {phase.kind === "rejected" ? (
            <div
              className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]"
              role="alert"
            >
              <span className="font-medium">{phase.fileName}</span> was rejected: {phase.message}
            </div>
          ) : null}
          <RosterDropZone onFile={handleFile} />
          {inFlight ? <ImportRunPanel runId={inFlight.id} variant={variant} /> : null}
        </>
      ) : null}

      {phase.kind === "preview" ? (
        <div className="space-y-3">
          <div className="text-[13px] text-foreground">
            <span className="font-medium">{phase.fileName}</span>{" "}
            <span className="text-muted-foreground tabular-nums">
              — {phase.parsed.records.length} data row
              {phase.parsed.records.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="overflow-x-auto rounded-md border border-[#E8E5E0] bg-white">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[#E8E5E0] bg-[#FAFAF9] text-left text-muted-foreground">
                  {presentHeaders(phase.parsed).map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows(phase.parsed).map((cells, i) => (
                  <tr key={i} className="border-t border-[#E8E5E0]">
                    {cells.map((cell, j) => (
                      <td key={j} className="whitespace-nowrap px-3 py-1.5">
                        {cell || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-muted-foreground">
            First {Math.min(5, phase.parsed.records.length)} rows shown. Rows are validated during
            the scan; nothing is written to live records.
          </p>
          <div className="flex items-center gap-2">
            <Button
              className="h-9 bg-[#1B4D3E] text-white hover:bg-[#163F33]"
              disabled={startScan.isPending}
              onClick={() => startImport(phase.fileName, phase.parsed)}
            >
              {startScan.isPending ? "Starting…" : "Start import"}
            </Button>
            <Button
              variant="outline"
              className="h-9"
              disabled={startScan.isPending}
              onClick={() => setPhase({ kind: "idle" })}
            >
              Choose a different file
            </Button>
          </div>
          {startScan.isError ? (
            <div
              className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]"
              role="alert"
            >
              {startScan.error instanceof Error
                ? startScan.error.message
                : "Couldn't start the import"}
            </div>
          ) : null}
        </div>
      ) : null}

      {phase.kind === "run" ? (
        <div className="space-y-3">
          <ImportRunPanel runId={phase.runId} variant={variant} />
          <Button variant="outline" className="h-8" onClick={() => setPhase({ kind: "idle" })}>
            Import another file
          </Button>
        </div>
      ) : null}
    </div>
  );
}
