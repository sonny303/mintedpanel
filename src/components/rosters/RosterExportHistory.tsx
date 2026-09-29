import { ArrowDownToLine, FileArchive } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDownloadRosterExport, useRosterExportHistory } from "@/hooks/useRosterEngine";
import { useActiveOrgId } from "@/lib/auth-store";
import { downloadRosterBlob, formatRosterDisplayDate } from "@/lib/rosterDisplay";
import {
  NoRosterOrganization,
  RosterEmpty,
  RosterError,
  RosterLoading,
  RosterStatus,
} from "./shared";

export function RosterExportHistory() {
  const orgId = useActiveOrgId();
  const historyQ = useRosterExportHistory();
  const downloadMutation = useDownloadRosterExport();

  if (!orgId) return <NoRosterOrganization />;
  if (historyQ.isLoading) return <RosterLoading />;
  if (historyQ.isError)
    return <RosterError error={historyQ.error} retry={() => void historyQ.refetch()} />;
  const snapshots = historyQ.data ?? [];
  if (snapshots.length === 0) {
    return (
      <RosterEmpty
        title="No roster exports yet"
        description="Completed exports will appear here with their original download, checksum, row count, and applied override count."
      />
    );
  }

  function download(id: string, fileName: string) {
    downloadMutation.mutate(id, { onSuccess: (blob) => downloadRosterBlob(blob, fileName) });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <FileArchive className="h-4 w-4" />
        {snapshots.length} immutable export snapshot{snapshots.length === 1 ? "" : "s"}
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-9 min-w-64">Export</TableHead>
              <TableHead className="h-9 min-w-32">Rows / format</TableHead>
              <TableHead className="h-9 min-w-28">Overrides</TableHead>
              <TableHead className="h-9 min-w-48">SHA-256</TableHead>
              <TableHead className="h-9 text-right">Download</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshots.map((snapshot) => {
              const isDownloading =
                downloadMutation.isPending && downloadMutation.variables === snapshot.id;
              return (
                <TableRow key={snapshot.id} className="h-14">
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <FileArchive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-medium">
                          {snapshot.mappingName}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {snapshot.templateName} · {snapshot.fileName}
                        </div>
                        {!snapshot.templateVerified ? (
                          <RosterStatus tone="warning">Draft payer schema</RosterStatus>
                        ) : null}
                        <div className="text-[10px] text-muted-foreground">
                          {formatRosterDisplayDate(snapshot.exportedAt)}
                          {snapshot.exportedBy ? ` · ${snapshot.exportedBy}` : ""}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-[12px] tabular-nums">
                    <div>{snapshot.totalRows} rows</div>
                    <RosterStatus>{snapshot.format.toUpperCase()}</RosterStatus>
                  </TableCell>
                  <TableCell className="text-[12px] tabular-nums">
                    {snapshot.appliedOverrides}
                  </TableCell>
                  <TableCell
                    className="max-w-56 truncate font-mono text-[10px]"
                    title={snapshot.checksum}
                  >
                    {snapshot.checksum}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => download(snapshot.id, snapshot.fileName)}
                      disabled={downloadMutation.isPending}
                    >
                      <ArrowDownToLine /> {isDownloading ? "Downloading…" : "Download"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {downloadMutation.isError ? <RosterError error={downloadMutation.error} /> : null}
      {!downloadMutation.isError ? (
        <p className="text-[11px] text-muted-foreground">
          Downloads are the stored snapshot bytes, so later source or mapping edits do not change
          earlier files.
        </p>
      ) : null}
    </div>
  );
}
