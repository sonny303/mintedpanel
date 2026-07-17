// E4.5 F4.5.1/TE-1 — read-only version history for one document family:
// every retained version, newest first, the current one clearly marked; each
// version downloads through the same audited signed-URL contract.
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusPill } from "@/components/StatusPill";
import { fmtDate } from "@/lib/format";
import { documentKindLabel, familyHistory } from "@/lib/documents";
import type { ProviderDocument } from "@/types";
import { DocumentDownloadButton } from "./DocumentDownloadButton";

interface DocumentHistoryDialogProps {
  familyId: string;
  /** All of the owner's document rows — the dialog derives the family slice. */
  documents: ProviderDocument[];
  currentId: string;
  uploaderNames: Map<string, string>;
  onClose: () => void;
}

export function DocumentHistoryDialog({
  familyId,
  documents,
  currentId,
  uploaderNames,
  onClose,
}: DocumentHistoryDialogProps) {
  const versions = familyHistory(documents, familyId);
  const kind = versions[0] ? documentKindLabel(versions[0].docType) : "Document";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>{kind} — version history</DialogTitle>
          <DialogDescription>
            Prior versions are retained and stay downloadable; the current version is marked.
          </DialogDescription>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-9">Version</TableHead>
              <TableHead className="h-9">File</TableHead>
              <TableHead className="h-9">Expires</TableHead>
              <TableHead className="h-9">Uploaded</TableHead>
              <TableHead className="h-9">By</TableHead>
              <TableHead className="h-9 text-right">Download</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => (
              <TableRow key={v.id} className="h-10">
                <TableCell className="tabular-nums">
                  v{v.versionNumber}
                  {v.id === currentId ? (
                    <StatusPill status="green" label="Current" className="ml-2" />
                  ) : null}
                </TableCell>
                <TableCell className="max-w-[220px] truncate">{v.fileName}</TableCell>
                <TableCell className="tabular-nums">{fmtDate(v.expirationDate)}</TableCell>
                <TableCell className="tabular-nums">{fmtDate(v.createdAt)}</TableCell>
                <TableCell>
                  {v.uploadedBy ? (uploaderNames.get(v.uploadedBy) ?? "—") : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <DocumentDownloadButton documentId={v.id} fileName={v.fileName} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
