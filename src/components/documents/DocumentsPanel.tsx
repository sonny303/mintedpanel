// E4.5 F4.5.1 — the shared per-owner document table (provider record + group
// record render the same panel with their grain). One row per document FAMILY
// showing its derived CURRENT version (TE-1): kind, dates + derived
// expiration state, version + history, uploader, uploaded-at, actions.
// Writers upload/replace; every member downloads (TE-2 read rule). Dense
// stock-primitive table, tokens only (TE-10).
import { useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { useCanWrite } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";
import {
  DOCUMENT_KIND_META,
  classifyExpiration,
  currentVersions,
  documentKindLabel,
  isDocumentKind,
} from "@/lib/documents";
import { localTodayIso } from "@/hooks/useEnrollmentReadiness";
import {
  useDocumentUploaderNames,
  useGroupDocuments,
  useProviderDocuments,
} from "@/hooks/useDocuments";
import type { DocumentOwnerType, ProviderDocument } from "@/types";
import { DocumentDownloadButton } from "./DocumentDownloadButton";
import { DocumentExpirationPill } from "./DocumentExpirationPill";
import { DocumentHistoryDialog } from "./DocumentHistoryDialog";
import { UploadDocumentDialog } from "./UploadDocumentDialog";

interface DocumentsPanelProps {
  ownerType: DocumentOwnerType;
  ownerId: string;
  ownerName: string;
}

export function DocumentsPanel({ ownerType, ownerId, ownerName }: DocumentsPanelProps) {
  const canWrite = useCanWrite();
  const providerQ = useProviderDocuments(ownerType === "provider" ? ownerId : "");
  const groupQ = useGroupDocuments(ownerType === "group" ? ownerId : "");
  const docsQ = ownerType === "provider" ? providerQ : groupQ;
  // TS-163: filled_form is a case-scoped step artifact, never a canonical
  // provider/group document — the vault list never shows it (a promoted
  // step artifact writes a SECOND, canonical-kind row, which is what
  // belongs here).
  const documents = useMemo(
    () =>
      (docsQ.data ?? []).filter(
        (d) => !(isDocumentKind(d.docType) && DOCUMENT_KIND_META[d.docType].caseArtifact),
      ),
    [docsQ.data],
  );
  const today = localTodayIso();

  const [upload, setUpload] = useState<{ replaceTarget: ProviderDocument | null } | null>(null);
  const [historyFamily, setHistoryFamily] = useState<string | null>(null);

  const rows = useMemo(() => {
    const versionCount = new Map<string, number>();
    for (const d of documents) {
      versionCount.set(d.documentFamilyId, (versionCount.get(d.documentFamilyId) ?? 0) + 1);
    }
    return currentVersions(documents)
      .slice()
      .sort(
        (a, b) =>
          documentKindLabel(a.docType).localeCompare(documentKindLabel(b.docType)) ||
          b.createdAt.localeCompare(a.createdAt),
      )
      .map((d) => ({
        document: d,
        versions: versionCount.get(d.documentFamilyId) ?? 1,
        status: classifyExpiration(
          isDocumentKind(d.docType) ? d.docType : "other",
          d.expirationDate,
          today,
        ),
      }));
  }, [documents, today]);

  const uploaderQ = useDocumentUploaderNames(
    documents.map((d) => d.uploadedBy).filter((id): id is string => Boolean(id)),
  );
  const uploaderNames = uploaderQ.data ?? new Map<string, string>();

  return (
    <section className="rounded-md border border-border bg-card">
      <header className="flex h-10 items-center justify-between border-b border-border px-4">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Documents
        </h2>
        {canWrite ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => setUpload({ replaceTarget: null })}
          >
            <Plus className="h-3.5 w-3.5" />
            Upload
          </Button>
        ) : null}
      </header>

      {docsQ.isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : docsQ.isError ? (
        <div className="p-4 text-[13px] text-[#B91C1C]">
          Failed to load documents: {(docsQ.error as Error).message}
        </div>
      ) : rows.length === 0 ? (
        <div className="p-4 text-[13px] text-muted-foreground">
          No documents on file{canWrite ? " — upload the first one." : "."}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-9">Document</TableHead>
              <TableHead className="h-9">Effective</TableHead>
              <TableHead className="h-9">Expires</TableHead>
              <TableHead className="h-9">Version</TableHead>
              <TableHead className="h-9">Uploaded by</TableHead>
              <TableHead className="h-9">Uploaded</TableHead>
              <TableHead className="h-9 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ document, versions, status }) => (
              <TableRow key={document.id} className="h-10">
                <TableCell>
                  <div className="text-[13px] font-medium text-foreground">
                    {documentKindLabel(document.docType)}
                  </div>
                  <div className="max-w-[200px] truncate text-[11px] text-muted-foreground">
                    {document.fileName}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{fmtDate(document.effectiveDate)}</TableCell>
                <TableCell>
                  <span className="tabular-nums">{fmtDate(document.expirationDate)}</span>
                  {status ? (
                    <span className="ml-2 inline-flex">
                      <DocumentExpirationPill status={status} />
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  {versions > 1 ? (
                    <button
                      type="button"
                      className="text-[13px] tabular-nums text-foreground underline decoration-dotted underline-offset-2 hover:text-[#1B4D3E]"
                      onClick={() => setHistoryFamily(document.documentFamilyId)}
                    >
                      v{document.versionNumber} · history
                    </button>
                  ) : (
                    <span className="tabular-nums">v{document.versionNumber}</span>
                  )}
                </TableCell>
                <TableCell>
                  {document.uploadedBy ? (uploaderNames.get(document.uploadedBy) ?? "—") : "—"}
                </TableCell>
                <TableCell className="tabular-nums">{fmtDate(document.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <DocumentDownloadButton documentId={document.id} fileName={document.fileName} />
                    {canWrite ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={`Replace ${documentKindLabel(document.docType)}`}
                            onClick={() => setUpload({ replaceTarget: document })}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Upload a new version</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {upload ? (
        <UploadDocumentDialog
          ownerType={ownerType}
          ownerId={ownerId}
          ownerName={ownerName}
          replaceTarget={upload.replaceTarget}
          onClose={() => setUpload(null)}
        />
      ) : null}
      {historyFamily ? (
        <DocumentHistoryDialog
          familyId={historyFamily}
          documents={documents}
          currentId={
            rows.find((r) => r.document.documentFamilyId === historyFamily)?.document.id ?? ""
          }
          uploaderNames={uploaderNames}
          onClose={() => setHistoryFamily(null)}
        />
      ) : null}
    </section>
  );
}
