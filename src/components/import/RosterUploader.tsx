// E3.0 + E3.3 — the ONE upload pipeline every section renders (F3.3.1: one
// shared upload composition, no divergent data paths). Template download
// (generated from the same per-section header list the gate checks), client
// file checks (.csv + 10 MB), the exact-match header front gate BEFORE any row
// work, the columns-and-sample-rows preview, then the chunked async scan via
// useStartRosterScan. The `entityKind` prop (E3.3 TE-4) selects the per-section
// descriptor (template, gate, scan) and is written onto the run; the three
// wizard sections and /admin/import mount three instances of this component, so
// "upload UX identical across sections" is structural. Variants differ only in
// presentation: 'internal' shows raw error detail, 'streamlined' keeps errors
// simple — same validation, same staging.
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImportRunPanel } from "@/components/import/ImportRunPanel";
import { RosterDropZone } from "@/components/import/RosterDropZone";
import { useImportRuns, useStartRosterScan } from "@/hooks/useImportRuns";
import { parseCsv, type ParsedCsv } from "@/lib/csvImport";
import { downloadCsvText } from "@/lib/csv";
import {
  checkHeaders,
  checkRosterFile,
  headerGateMessage,
  presentHeaders,
  previewRows,
} from "@/lib/rosterImport";
import {
  COMBINED_TEMPLATE_RETIRED_MESSAGE,
  looksLikeCombinedTemplate,
  sectionDescriptor,
  sectionTemplateCsv,
  type SectionEntityKind,
  type SectionScanContext,
} from "@/lib/importSections";
import type { ImportRunSource } from "@/types";

type Phase =
  | { kind: "idle" }
  | { kind: "rejected"; fileName: string; message: string }
  | { kind: "preview"; fileName: string; parsed: ParsedCsv }
  | { kind: "run"; runId: string };

export function RosterUploader({
  source,
  variant,
  entityKind,
  scanContext,
}: {
  source: ImportRunSource;
  variant: "internal" | "streamlined";
  /** E3.3 TE-4: which per-section template/gate/scan this uploader runs. */
  entityKind: SectionEntityKind;
  /** E6.2 — org-context for descriptors with a contextScan (payer attach). */
  scanContext?: SectionScanContext;
}) {
  const descriptor = sectionDescriptor(entityKind);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const startScan = useStartRosterScan();
  const runsQ = useImportRuns();

  // Resume affordance: a run started earlier from this SECTION surfaces on
  // return — filtered by entity_kind (TE-4) so a section only resumes its own
  // runs. Progress lives on the run row, not this component's state.
  const resumeStates =
    variant === "internal"
      ? ["uploading", "scanning"]
      : ["uploading", "scanning", "ready_for_review", "failed"];
  const inFlight =
    phase.kind === "idle"
      ? (runsQ.data ?? []).find(
          (r) =>
            r.source === source && r.entityKind === entityKind && resumeStates.includes(r.state),
        )
      : undefined;

  const handleFile = async (file: File) => {
    const fileError = checkRosterFile(file.name, file.size);
    if (fileError) {
      setPhase({ kind: "rejected", fileName: file.name, message: fileError });
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    const gate = checkHeaders(parsed.headers, descriptor.headers);
    if (!gate.ok) {
      // TE-7: a retired combined-template upload gets an actionable message
      // naming the per-section templates, not a generic missing/extra list.
      const message = looksLikeCombinedTemplate(parsed.headers)
        ? COMBINED_TEMPLATE_RETIRED_MESSAGE
        : (headerGateMessage(gate) ??
          "The column headers don't match the template. Download the template and re-upload.");
      setPhase({ kind: "rejected", fileName: file.name, message });
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
      { source, entityKind, fileName, parsed, scanContext },
      { onSuccess: (runId) => setPhase({ kind: "run", runId }) },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">{descriptor.helperText}</p>
        <Button
          variant="outline"
          className="h-8"
          onClick={() =>
            downloadCsvText(descriptor.templateFilename, sectionTemplateCsv(descriptor))
          }
        >
          <Download className="mr-1 h-4 w-4" />
          Download {descriptor.label} template
        </Button>
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
