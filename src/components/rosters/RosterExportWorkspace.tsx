import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDownToLine, ArrowLeft, ArrowRight, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useDownloadRosterExport,
  useExportRosterMapping,
  useRosterPreview,
  useRosterValidation,
} from "@/hooks/useRosterEngine";
import { useCanWrite } from "@/lib/permissions";
import { downloadRosterBlob, formatRosterDisplayDate } from "@/lib/rosterDisplay";
import type { RosterExportFormat, RosterMappingDetail, RosterExportSnapshot } from "@/types";
import { RosterEmpty, RosterError, RosterLoading, RosterStatus } from "./shared";

export function RosterExportWorkspace({ detail }: { detail: RosterMappingDetail }) {
  const canWrite = useCanWrite();
  const validationQ = useRosterValidation(detail.mapping.id);
  const previewQ = useRosterPreview(detail.mapping.id);
  const exportMutation = useExportRosterMapping(detail.mapping.id);
  const downloadMutation = useDownloadRosterExport();
  const [format, setFormat] = useState<RosterExportFormat>("csv");
  const exportAttempt = useRef<{
    mappingId: string;
    fingerprint: string;
    format: RosterExportFormat;
    idempotencyKey: string;
  } | null>(null);
  const validation = validationQ.data;
  const preview = previewQ.data;
  const current = Boolean(
    validation &&
    validation.revision === detail.mapping.revision &&
    preview &&
    preview.revision === validation.revision &&
    preview.inputFingerprint === validation.inputFingerprint,
  );
  const ready = Boolean(canWrite && current && validation?.exportable && !exportMutation.isPending);
  const snapshot = exportMutation.data;

  function download(snapshotToDownload: RosterExportSnapshot) {
    downloadMutation.mutate(snapshotToDownload.id, {
      onSuccess: (blob) => downloadRosterBlob(blob, snapshotToDownload.fileName),
    });
  }

  function createExport() {
    if (!ready || !validation) return;
    const previousAttempt = exportAttempt.current;
    const sameAttempt =
      previousAttempt?.mappingId === detail.mapping.id &&
      previousAttempt.fingerprint === validation.inputFingerprint &&
      previousAttempt.format === format;
    const idempotencyKey = sameAttempt ? previousAttempt.idempotencyKey : crypto.randomUUID();
    exportAttempt.current = {
      mappingId: detail.mapping.id,
      fingerprint: validation.inputFingerprint,
      format,
      idempotencyKey,
    };
    exportMutation.mutate(
      {
        format,
        expectedInputFingerprint: validation.inputFingerprint,
        idempotencyKey,
      },
      {
        onSuccess: (created) => {
          exportAttempt.current = null;
          download(created);
        },
      },
    );
  }

  if (validationQ.isLoading || previewQ.isLoading) return <RosterLoading />;
  if (validationQ.isError) {
    return <RosterError error={validationQ.error} retry={() => void validationQ.refetch()} />;
  }
  if (previewQ.isError) {
    return <RosterError error={previewQ.error} retry={() => void previewQ.refetch()} />;
  }
  if (!validation || !preview) {
    return (
      <RosterEmpty
        title="Current validation is unavailable"
        description="Return to validation and refresh the current source rows before exporting."
      />
    );
  }

  return (
    <div className="space-y-4">
      {!detail.template.verified ? (
        <div className="rounded-md border border-border bg-[var(--mp-warn-tint)] p-3 text-[12px] text-[var(--mp-warn-ink)]">
          <div className="font-semibold">Draft payer schema</div>
          <p className="mt-1">
            This starter worksheet has not been verified against a current payer workbook. Review
            its headers and requirements before submission; this export does not claim payer
            acceptance.
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-3 rounded-md border border-border p-4">
          <div className="flex items-start gap-2">
            <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <h2 className="text-[14px] font-semibold">{detail.mapping.name}</h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {detail.template.name} · {validation.rowCount} rows · revision {validation.revision}
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="roster-format" className="text-[12px]">
              File format
            </Label>
            <Select
              value={format}
              onValueChange={(value) => setFormat(value as RosterExportFormat)}
            >
              <SelectTrigger id="roster-format" className="h-9 max-w-xs text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV · UTF-8</SelectItem>
                <SelectItem value="xlsx">Excel workbook · XLSX</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <RosterStatus tone={current && validation.exportable ? "success" : "danger"}>
              {current
                ? validation.exportable
                  ? "Validation current"
                  : "Validation blockers remain"
                : "Validation is stale"}
            </RosterStatus>
            <RosterStatus>{validation.overriddenErrorCount} applied overrides</RosterStatus>
            <span className="text-[11px] text-muted-foreground">
              Hash is recorded from the stored file bytes.
            </span>
          </div>
          {validation.hardErrorCount > 0 ? (
            <div className="rounded-md border border-destructive/30 p-3 text-[12px] text-destructive">
              {validation.hardErrorCount} hard error(s) still block export. Resolve them or record
              an eligible audited override.
            </div>
          ) : null}
          {!current ? (
            <div className="rounded-md border border-border p-3 text-[12px] text-muted-foreground">
              The mapping or source data changed after validation. Return to validation and refresh
              before exporting.
            </div>
          ) : null}
          {!canWrite ? (
            <p className="text-[12px] text-muted-foreground">
              Billing members can review export readiness but cannot generate files.
            </p>
          ) : null}
          <div className="flex flex-wrap justify-between gap-2 pt-1">
            <Button asChild variant="outline">
              <Link to="/reporting/rosters/validation/$id" params={{ id: detail.mapping.id }}>
                <ArrowLeft /> Back to validation
              </Link>
            </Button>
            <Button disabled={!ready} onClick={createExport}>
              {exportMutation.isPending ? (
                "Creating snapshot…"
              ) : (
                <>
                  <ShieldCheck /> Export and save snapshot
                </>
              )}
            </Button>
          </div>
          {exportMutation.isError ? <RosterError error={exportMutation.error} /> : null}
        </section>

        <aside className="h-fit rounded-md border border-border p-3 lg:sticky lg:top-4">
          <h3 className="text-[13px] font-semibold">Before export</h3>
          <ul className="mt-2 space-y-2 text-[12px] text-muted-foreground">
            <li className="flex gap-2">
              <span>•</span>
              <span>The server regenerates the file from current organization records.</span>
            </li>
            <li className="flex gap-2">
              <span>•</span>
              <span>
                Snapshot records the template, mapping revision, actor, row count, overrides, and
                SHA-256 checksum.
              </span>
            </li>
            <li className="flex gap-2">
              <span>•</span>
              <span>The history download returns the original stored file bytes.</span>
            </li>
          </ul>
          <div className="mt-3 border-t border-border pt-3">
            <div className="text-[11px] text-muted-foreground">Projected output rows</div>
            <div className="mt-0.5 text-[20px] font-semibold tabular-nums">{preview.rowCount}</div>
          </div>
        </aside>
      </div>

      {snapshot ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[13px] font-semibold">Snapshot saved</div>
              <div className="text-[11px] text-muted-foreground">
                {snapshot.fileName} · {snapshot.totalRows} rows ·{" "}
                {formatRosterDisplayDate(snapshot.exportedAt)}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => download(snapshot)}
              disabled={downloadMutation.isPending}
            >
              <ArrowDownToLine /> {downloadMutation.isPending ? "Downloading…" : "Download again"}
            </Button>
          </div>
          <dl className="grid gap-2 text-[11px] sm:grid-cols-[100px_minmax(0,1fr)]">
            <dt className="text-muted-foreground">SHA-256</dt>
            <dd className="break-all font-mono">{snapshot.checksum}</dd>
            <dt className="text-muted-foreground">Applied overrides</dt>
            <dd>{snapshot.appliedOverrides}</dd>
            <dt className="text-muted-foreground">Snapshot ID</dt>
            <dd className="break-all font-mono">{snapshot.id}</dd>
          </dl>
          {downloadMutation.isError ? <RosterError error={downloadMutation.error} /> : null}
          <div className="flex justify-end">
            <Button asChild variant="link" size="sm">
              <Link to="/reporting/rosters/history">
                View export history <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
