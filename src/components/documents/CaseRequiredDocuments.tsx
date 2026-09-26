// E4.5 F4.5.3/TE-7 — the Assigned-phase document verification panel on case
// detail: the documents the case's SOP tasks require (stable machine kinds
// parsed from step requiredArtifacts — free-form artifact names never join),
// each derived LIVE against the provider's and group's CURRENT document
// versions: present / missing / expired, with one-click audited download of
// each present document for the manual portal attach (the documented D3
// interim path). Advisory only — nothing is copied onto the case or task and
// nothing here disables anything.
//
// ASD (Active Submission Drawer rebuild) BITE-ASD-03 (D-ASD-7) — this IS the
// PRD's "Active Documents" panel; there is no second, case-scoped documents
// surface. Mounted in TaskDrawer (below the step list) so it's visible right
// where a coordinator is working the checklist. Two write affordances added:
// Upload (a MISSING kind, filed straight into the right vault grain) and
// Replace [↻] (a new version of a PRESENT/EXPIRED document's family) —
// both reuse the shared UploadDocumentDialog, never a second upload path.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Download, Plus, RefreshCw, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/StatusPill";
import {
  caseDocumentStatus,
  downloadableCaseDocuments,
  formatCaseDocumentDownloadName,
  requiredDocumentKinds,
  uploadOwnerTargetForCheck,
  type CaseDocumentCheck,
} from "@/lib/documents";
import { localTodayIso } from "@/hooks/useEnrollmentReadiness";
import {
  useDownloadDocumentFile,
  useGroupDocuments,
  useProviderDocuments,
} from "@/hooks/useDocuments";
import { useCanWrite } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";
import type { DocumentKind, ProviderDocument, Task } from "@/types";
import { DocumentDownloadButton } from "./DocumentDownloadButton";
import { UploadDocumentDialog } from "./UploadDocumentDialog";

interface CaseRequiredDocumentsProps {
  providerId: string;
  providerName: string;
  groupId: string | null;
  groupName: string | null;
  caseId?: string | null;
  tasks: Task[];
}

// D-ASD-8 — fetch each audited signed object fully before starting its local
// Blob download. This keeps downloads separate, avoids cross-origin navigation
// races, and never opens a popup for every document.
async function downloadSequentially(
  documents: ProviderDocument[],
  getDownloadFile: (
    documentId: string,
    downloadName: string,
  ) => Promise<{ blob: Blob; fileName: string }>,
  getDownloadName: (document: ProviderDocument) => string,
): Promise<{ failed: number }> {
  let failed = 0;
  for (const doc of documents) {
    let objectUrl: string | null = null;
    try {
      const downloadName = getDownloadName(doc);
      const downloaded = await getDownloadFile(doc.id, downloadName);
      objectUrl = URL.createObjectURL(downloaded.blob);
      const a = window.document.createElement("a");
      a.href = objectUrl;
      a.download = downloaded.fileName;
      a.rel = "noopener";
      try {
        window.document.body.appendChild(a);
        a.click();
      } finally {
        a.remove();
      }
    } catch {
      failed += 1;
    } finally {
      if (objectUrl) {
        // Let the browser consume the Blob URL, then release it on a bounded
        // timer even if the user keeps this task open.
        const createdObjectUrl = objectUrl;
        window.setTimeout(() => URL.revokeObjectURL(createdObjectUrl), 30_000);
      }
    }
  }
  return { failed };
}

export function CaseRequiredDocuments({
  providerId,
  providerName,
  groupId,
  groupName,
  caseId = null,
  tasks,
}: CaseRequiredDocumentsProps) {
  const canWrite = useCanWrite();
  const requiredKinds = useMemo(() => requiredDocumentKinds(tasks), [tasks]);
  const providerDocsQ = useProviderDocuments(requiredKinds.length > 0 ? providerId : "");
  const groupDocsQ = useGroupDocuments(requiredKinds.length > 0 && groupId ? groupId : "");
  const today = localTodayIso();
  const downloadM = useDownloadDocumentFile();
  const [uploadTarget, setUploadTarget] = useState<CaseDocumentCheck<ProviderDocument> | null>(
    null,
  );
  const [downloadingAll, setDownloadingAll] = useState(false);

  const checks = useMemo(
    () =>
      caseDocumentStatus(
        requiredKinds,
        providerDocsQ.data ?? [],
        groupId ? (groupDocsQ.data ?? []) : [],
        today,
      ),
    [requiredKinds, providerDocsQ.data, groupDocsQ.data, groupId, today],
  );
  const downloadable = useMemo(() => downloadableCaseDocuments(checks), [checks]);

  // No SOP-required document kinds on this case — no panel (the
  // portal-launcher visibility idiom).
  if (requiredKinds.length === 0) return null;

  const handleDownloadAll = async () => {
    if (downloadable.length === 0 || downloadingAll) return;
    setDownloadingAll(true);
    try {
      const { failed } = await downloadSequentially(
        downloadable,
        (documentId, fileName) => downloadM.mutateAsync({ documentId, fileName }),
        (doc) =>
          formatCaseDocumentDownloadName(
            providerName.trim().toLowerCase() === "this provider" ? null : providerName,
            doc,
          ),
      );
      if (failed > 0) {
        toast.error(
          failed === downloadable.length
            ? "Could not download any documents"
            : `Downloaded ${downloadable.length - failed} of ${downloadable.length} — ${failed} failed`,
        );
      }
    } finally {
      // The mutation result contains the file bytes; clear the final result as
      // soon as all object URLs have been handed to the browser.
      downloadM.reset();
      setDownloadingAll(false);
    }
  };

  const openUploadFor = (check: CaseDocumentCheck<ProviderDocument>) => {
    if (!uploadOwnerTargetForCheck(check, providerId, groupId)) {
      toast.error(`No provider or group is linked to file ${check.label} against`);
      return;
    }
    setUploadTarget(check);
  };

  // A REPLACE follows the document's own grain: a dual-owner kind (COI) whose
  // existing version belongs to the group must version the GROUP's family, or
  // the server rejects the intent for changing a family's owner.
  const uploadOwner = uploadTarget
    ? uploadOwnerTargetForCheck(uploadTarget, providerId, groupId)
    : null;
  const uploadOwnerName =
    uploadOwner?.ownerType === "group" ? (groupName ?? "the group") : providerName;

  return (
    <section className="rounded-md border border-border bg-card">
      <header className="flex h-10 items-center justify-between border-b border-border px-4">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Required documents
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {checks.filter((c) => c.state === "present").length} of {checks.length} ready
          </span>
          {downloadable.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              disabled={downloadingAll}
              onClick={handleDownloadAll}
            >
              <Download className="h-3.5 w-3.5" />
              {downloadingAll ? "Downloading…" : `Download all (${downloadable.length})`}
            </Button>
          ) : null}
        </div>
      </header>
      <ul className="divide-y divide-border">
        {checks.map((c) => (
          <li key={c.kind} className="flex h-10 items-center gap-2 px-4 text-[13px]">
            {c.state === "present" ? (
              <Check className="h-3.5 w-3.5 flex-none text-[var(--mp-ok-ink)]" />
            ) : c.state === "expired" ? (
              <TriangleAlert className="h-3.5 w-3.5 flex-none text-[var(--mp-danger-ink)]" />
            ) : (
              <X className="h-3.5 w-3.5 flex-none text-[var(--mp-danger-ink)]" />
            )}
            <span className="font-medium text-foreground">{c.label}</span>
            {c.state === "present" ? (
              c.expiringSoon ? (
                <StatusPill status="amber" label="Expiring soon" />
              ) : (
                <StatusPill status="green" label="Present" />
              )
            ) : c.state === "expired" ? (
              <StatusPill status="red" label="Expired" />
            ) : (
              <StatusPill status="red" label="Missing" />
            )}
            {c.kind === "w9" && c.document ? (
              <span className="text-[12px] text-muted-foreground">
                {c.document.effectiveDate
                  ? `Signed ${fmtDate(c.document.effectiveDate)}`
                  : "Signed date not set"}
              </span>
            ) : c.document?.expirationDate ? (
              <span className="text-[12px] text-muted-foreground">
                {c.state === "expired" ? "expired" : "expires"} {fmtDate(c.document.expirationDate)}
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-0.5">
              {c.document && c.state !== "missing" ? (
                <DocumentDownloadButton documentId={c.document.id} fileName={c.document.fileName} />
              ) : null}
              {canWrite ? (
                c.state === "missing" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[11px] shadow-none"
                    onClick={() => openUploadFor(c)}
                  >
                    <Plus className="h-3 w-3" />
                    Upload
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Replace ${c.label}`}
                    onClick={() => openUploadFor(c)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                )
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {uploadTarget && uploadOwner ? (
        <UploadDocumentDialog
          ownerType={uploadOwner.ownerType}
          ownerId={uploadOwner.ownerId}
          ownerName={uploadOwnerName}
          replaceTarget={uploadTarget.state === "missing" ? null : uploadTarget.document}
          presetKind={uploadTarget.state === "missing" ? (uploadTarget.kind as DocumentKind) : null}
          caseId={caseId}
          onClose={() => setUploadTarget(null)}
        />
      ) : null}
    </section>
  );
}
