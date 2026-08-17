// ASD (Active Submission Drawer rebuild) BITE-ASD-02/03 — the step-artifact
// panel: attach an existing vault document, upload a fresh one, or replace
// (version) an existing attachment. All three write paths honor the
// corrected D-ASD-1..6 model — there is exactly ONE document, it lives in
// the provider/group vault (`provider_documents`), and a step only ever
// holds a POINTER (`SOPStepAttachment`: documentId + artifactName). Nothing
// here ever writes a second, case-scoped copy of a file (the rejected #328
// `caseArtifact` mechanism), and attach/detach never touch task status
// (D-ASD-6 — enforced in sopStepAttachments.ts, not re-checked here).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Paperclip, Plus, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/DatePicker";
import { DocumentDownloadButton } from "@/components/documents/DocumentDownloadButton";
import { fmtDate } from "@/lib/format";
import {
  DOCUMENT_KIND_META,
  DOCUMENT_MIME_TYPES,
  checkDocumentFile,
  currentVersions,
  documentKindLabel,
  expirationDateError,
  resolveDocumentOwnerTarget,
  stepArtifactRows,
  type StepArtifactRow,
} from "@/lib/documents";
import { useGroupDocuments, useProviderDocuments, useUploadDocument } from "@/hooks/useDocuments";
import { useAttachStepArtifact, useDetachStepArtifact } from "@/hooks/useTasks";
import { useCanWrite } from "@/lib/permissions";
import type {
  DocumentKind,
  DocumentOwnerType,
  ProviderDocument,
  SOPStep,
  SOPStepAttachment,
} from "@/types";

interface StepArtifactsPanelProps {
  taskId: string;
  step: SOPStep;
  /** Optional usage context threaded to the upload-intent (BITE-ASD-02). */
  caseId: string | null;
  providerId: string | null;
  groupId: string | null;
}

function attachmentFromDocument(doc: ProviderDocument, artifactName: string): SOPStepAttachment {
  return {
    documentId: doc.id,
    artifactName,
    fileName: doc.fileName,
    uploadedAt: doc.createdAt,
    uploadedBy: doc.uploadedBy,
    kind: doc.docType,
  };
}

/** Which vault grain a NEW upload for this row should land in. An orphan
 * artifact name (no resolvable kind) files as the `filled_form` catch-all,
 * which both grains accept; the owner choice itself is the shared
 * `resolveDocumentOwnerTarget` (documents.ts), also used by
 * CaseRequiredDocuments so the two panels can't disagree. */
function resolveUploadTarget(
  resolvedKind: DocumentKind | null,
  providerId: string | null,
  groupId: string | null,
): { ownerType: DocumentOwnerType; ownerId: string; kind: DocumentKind } | null {
  const kind = resolvedKind ?? "filled_form";
  const owner = resolveDocumentOwnerTarget(kind, providerId, groupId);
  return owner ? { ...owner, kind } : null;
}

export function StepArtifactsPanel({
  taskId,
  step,
  caseId,
  providerId,
  groupId,
}: StepArtifactsPanelProps) {
  const canEdit = useCanWrite();
  const providerDocsQ = useProviderDocuments(providerId ?? "");
  const groupDocsQ = useGroupDocuments(groupId ?? "");
  const vaultDocuments = useMemo(
    () => [...(providerDocsQ.data ?? []), ...(groupDocsQ.data ?? [])],
    [providerDocsQ.data, groupDocsQ.data],
  );
  const vaultCurrent = useMemo(() => currentVersions(vaultDocuments), [vaultDocuments]);
  const vaultByDocId = useMemo(
    () => new Map(vaultDocuments.map((d) => [d.id, d] as const)),
    [vaultDocuments],
  );

  const { rows, orphans } = useMemo(() => stepArtifactRows(step), [step]);
  const [attachTarget, setAttachTarget] = useState<StepArtifactRow | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<{
    attachment: SOPStepAttachment;
    document: ProviderDocument;
  } | null>(null);

  const openReplace = (attachment: SOPStepAttachment) => {
    const document = vaultByDocId.get(attachment.documentId);
    if (!document) {
      toast.error("That document could not be found in the vault");
      return;
    }
    setReplaceTarget({ attachment, document });
  };

  if (rows.length === 0 && orphans.length === 0) return null;

  return (
    <div className="space-y-2.5 rounded-md border border-[#E8E5E0] p-3">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
        <Paperclip className="h-3.5 w-3.5" />
        Documents for this step
      </div>

      <div className="space-y-2.5">
        {rows.map((row) => (
          <div key={row.artifactName} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-muted-foreground">{row.artifactName}</span>
              {canEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[11px] shadow-none"
                  onClick={() => setAttachTarget(row)}
                >
                  <Plus className="h-3 w-3" />
                  Attach
                </Button>
              ) : null}
            </div>
            {row.attachments.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">Nothing attached yet.</p>
            ) : (
              <AttachmentList
                taskId={taskId}
                stepId={step.id}
                attachments={row.attachments}
                canEdit={canEdit}
                onReplace={openReplace}
              />
            )}
          </div>
        ))}

        {orphans.length > 0 ? (
          <div className="space-y-1">
            <span className="text-[12px] text-muted-foreground">Other attachments</span>
            <AttachmentList
              taskId={taskId}
              stepId={step.id}
              attachments={orphans}
              canEdit={canEdit}
              onReplace={openReplace}
            />
          </div>
        ) : null}
      </div>

      {attachTarget ? (
        <AttachArtifactDialog
          taskId={taskId}
          stepId={step.id}
          row={attachTarget}
          caseId={caseId}
          providerId={providerId}
          groupId={groupId}
          vaultCurrent={vaultCurrent}
          onClose={() => setAttachTarget(null)}
        />
      ) : null}
      {replaceTarget ? (
        <ReplaceArtifactDialog
          taskId={taskId}
          stepId={step.id}
          attachment={replaceTarget.attachment}
          document={replaceTarget.document}
          caseId={caseId}
          onClose={() => setReplaceTarget(null)}
        />
      ) : null}
    </div>
  );
}

function AttachmentList({
  taskId,
  stepId,
  attachments,
  canEdit,
  onReplace,
}: {
  taskId: string;
  stepId: string;
  attachments: SOPStepAttachment[];
  canEdit: boolean;
  onReplace: (attachment: SOPStepAttachment) => void;
}) {
  return (
    <ul className="space-y-1">
      {attachments.map((a) => (
        <li
          key={a.documentId}
          className="flex items-center justify-between gap-2 rounded-md border border-[#E8E5E0] bg-muted/20 px-2 py-1.5"
        >
          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium text-foreground">{a.fileName}</div>
            <div className="text-[11px] text-muted-foreground">
              {documentKindLabel(a.kind)} · {fmtDate(a.uploadedAt)}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-0.5">
            <DocumentDownloadButton documentId={a.documentId} fileName={a.fileName} />
            {canEdit ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={`Replace ${a.fileName}`}
                  onClick={() => onReplace(a)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <DetachButton taskId={taskId} stepId={stepId} attachment={a} />
              </>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function DetachButton({
  taskId,
  stepId,
  attachment,
}: {
  taskId: string;
  stepId: string;
  attachment: SOPStepAttachment;
}) {
  const detachM = useDetachStepArtifact();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      aria-label={`Remove ${attachment.fileName}`}
      disabled={detachM.isPending}
      onClick={() =>
        detachM.mutate(
          { taskId, stepId, documentId: attachment.documentId },
          {
            onSuccess: () => toast.success(`${attachment.fileName} removed from this step`),
            onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove"),
          },
        )
      }
    >
      <X className="h-3.5 w-3.5" />
    </Button>
  );
}

// Add a NEW attachment (D-ASD-5 — this always APPENDS): either point at an
// already-vaulted document ("attach existing") or upload a fresh one and
// attach the result in one flow. Never touches an existing attachment.
function AttachArtifactDialog({
  taskId,
  stepId,
  row,
  caseId,
  providerId,
  groupId,
  vaultCurrent,
  onClose,
}: {
  taskId: string;
  stepId: string;
  row: StepArtifactRow;
  caseId: string | null;
  providerId: string | null;
  groupId: string | null;
  vaultCurrent: ProviderDocument[];
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "upload">("existing");
  const attachM = useAttachStepArtifact();
  const uploadM = useUploadDocument();

  const candidates = useMemo(
    () =>
      row.resolvedKind ? vaultCurrent.filter((d) => d.docType === row.resolvedKind) : vaultCurrent,
    [vaultCurrent, row.resolvedKind],
  );
  const alreadyAttached = useMemo(
    () => new Set(row.attachments.map((a) => a.documentId)),
    [row.attachments],
  );
  const [selectedDocId, setSelectedDocId] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const target = resolveUploadTarget(row.resolvedKind, providerId, groupId);
  const busy = attachM.isPending || uploadM.isPending;

  const submitExisting = () => {
    const doc = vaultCurrent.find((d) => d.id === selectedDocId);
    if (!doc) {
      setError("Choose a document");
      return;
    }
    setError(null);
    attachM.mutate(
      { taskId, stepId, attachment: attachmentFromDocument(doc, row.artifactName) },
      {
        onSuccess: () => {
          toast.success(`${doc.fileName} attached`);
          onClose();
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Could not attach"),
      },
    );
  };

  const submitUpload = () => {
    if (!target) {
      setError("No provider or group is linked to this task, so a file can't be filed.");
      return;
    }
    if (!file) {
      setError("Choose a file to upload");
      return;
    }
    const fileError = checkDocumentFile(file);
    if (fileError) {
      setError(fileError);
      return;
    }
    const expError = expirationDateError(target.kind, expirationDate || null);
    if (expError) {
      setError(expError);
      return;
    }
    setError(null);
    uploadM.mutate(
      {
        ownerType: target.ownerType,
        ownerId: target.ownerId,
        kind: target.kind,
        file,
        effectiveDate: effectiveDate || null,
        expirationDate: expirationDate || null,
        caseId,
      },
      {
        onSuccess: (doc) => {
          attachM.mutate(
            { taskId, stepId, attachment: attachmentFromDocument(doc, row.artifactName) },
            {
              onSuccess: () => {
                toast.success(`${doc.fileName} uploaded and attached`);
                onClose();
              },
              onError: (e) =>
                setError(e instanceof Error ? e.message : "Uploaded but could not attach"),
            },
          );
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Upload failed"),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>Attach a document</DialogTitle>
          <DialogDescription>For &quot;{row.artifactName}&quot;.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 text-[13px]">
          <button
            type="button"
            className={`rounded-md border px-2.5 py-1 ${
              mode === "existing"
                ? "border-[#1B4D3E] bg-[#1B4D3E]/5 font-medium text-[#1B4D3E]"
                : "border-[#E8E5E0] text-muted-foreground"
            }`}
            onClick={() => setMode("existing")}
          >
            Use existing document
          </button>
          <button
            type="button"
            className={`rounded-md border px-2.5 py-1 ${
              mode === "upload"
                ? "border-[#1B4D3E] bg-[#1B4D3E]/5 font-medium text-[#1B4D3E]"
                : "border-[#E8E5E0] text-muted-foreground"
            }`}
            onClick={() => setMode("upload")}
          >
            Upload new
          </button>
        </div>

        {mode === "existing" ? (
          <div className="space-y-1.5">
            <Label htmlFor="artifact-existing-doc">Document</Label>
            {candidates.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No matching documents on file yet — upload one instead.
              </p>
            ) : (
              <Select value={selectedDocId || undefined} onValueChange={setSelectedDocId}>
                <SelectTrigger id="artifact-existing-doc">
                  <SelectValue placeholder="Choose a document" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((d) => (
                    <SelectItem key={d.id} value={d.id} disabled={alreadyAttached.has(d.id)}>
                      {d.fileName}
                      {alreadyAttached.has(d.id) ? " (already attached)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="artifact-upload-file">File</Label>
              <Input
                id="artifact-upload-file"
                type="file"
                accept={DOCUMENT_MIME_TYPES.join(",")}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="artifact-upload-effective">Effective date</Label>
                <DatePicker
                  id="artifact-upload-effective"
                  value={effectiveDate}
                  onChange={setEffectiveDate}
                  ariaLabel="Effective date"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="artifact-upload-expiration">
                  Expiration date
                  {target && DOCUMENT_KIND_META[target.kind].expirationRequired
                    ? " (required)"
                    : ""}
                </Label>
                <DatePicker
                  id="artifact-upload-expiration"
                  value={expirationDate}
                  onChange={setExpirationDate}
                  ariaLabel="Expiration date"
                  invalid={Boolean(
                    target && DOCUMENT_KIND_META[target.kind].expirationRequired && !expirationDate,
                  )}
                />
              </div>
            </div>
          </div>
        )}

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-2 text-[13px] text-[#B91C1C]"
          >
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
            onClick={mode === "existing" ? submitExisting : submitUpload}
            disabled={busy}
          >
            {busy ? "Working…" : "Attach"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Replace-supersede (BITE-ASD-02): upload a new version into the SAME family
// as the document being replaced (never a duplicate family), then swap the
// step's pointer to it under the same artifactName. The swap is ordered
// attach-then-detach on purpose — see the comment on the upload's onSuccess:
// attach appends, so a half-completed swap shows BOTH versions rather than
// leaving the step pointing at nothing.
function ReplaceArtifactDialog({
  taskId,
  stepId,
  attachment,
  document,
  caseId,
  onClose,
}: {
  taskId: string;
  stepId: string;
  attachment: SOPStepAttachment;
  document: ProviderDocument;
  caseId: string | null;
  onClose: () => void;
}) {
  const uploadM = useUploadDocument();
  const attachM = useAttachStepArtifact();
  const detachM = useDetachStepArtifact();
  const [file, setFile] = useState<File | null>(null);
  const [expirationDate, setExpirationDate] = useState(document.expirationDate ?? "");
  const [error, setError] = useState<string | null>(null);

  const ownerType: DocumentOwnerType = document.providerId ? "provider" : "group";
  const ownerId = document.providerId ?? document.groupId ?? "";
  const kindMeta = DOCUMENT_KIND_META[document.docType];
  const busy = uploadM.isPending || attachM.isPending || detachM.isPending;

  const submit = () => {
    if (!file) {
      setError("Choose the replacement file");
      return;
    }
    const fileError = checkDocumentFile(file);
    if (fileError) {
      setError(fileError);
      return;
    }
    const expError = expirationDateError(document.docType, expirationDate || null);
    if (expError) {
      setError(expError);
      return;
    }
    setError(null);
    uploadM.mutate(
      {
        ownerType,
        ownerId,
        kind: document.docType,
        file,
        effectiveDate: document.effectiveDate,
        expirationDate: expirationDate || null,
        familyId: document.documentFamilyId,
        caseId,
      },
      {
        // ATTACH the new version BEFORE detaching the old one. Attach appends
        // (D-ASD-5), so the intermediate state is both-attached — which is
        // visible and recoverable. The reverse order has a strictly worse
        // failure mode: a detach that succeeds followed by an attach that
        // fails leaves the step pointing at NOTHING while the new version
        // sits in the vault unreferenced.
        onSuccess: (newDoc) => {
          attachM.mutate(
            {
              taskId,
              stepId,
              attachment: attachmentFromDocument(newDoc, attachment.artifactName),
            },
            {
              onSuccess: () => {
                detachM.mutate(
                  { taskId, stepId, documentId: attachment.documentId },
                  {
                    onSuccess: () => {
                      toast.success(`Replaced with v${newDoc.versionNumber}`);
                      onClose();
                    },
                    // The new version IS attached at this point; only the old
                    // pointer survives. Say so plainly — the row shows both,
                    // and removing the old one is one click away.
                    onError: (e) =>
                      setError(
                        e instanceof Error
                          ? `New version attached, but the old one could not be removed: ${e.message}`
                          : "New version attached, but the old one could not be removed",
                      ),
                  },
                );
              },
              onError: (e) =>
                setError(e instanceof Error ? e.message : "Uploaded but could not attach"),
            },
          );
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Upload failed"),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>Replace {kindMeta.label}</DialogTitle>
          <DialogDescription>
            A new version of &quot;{attachment.fileName}&quot; — the prior version stays in the
            vault.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="artifact-replace-file">File</Label>
            <Input
              id="artifact-replace-file"
              type="file"
              accept={DOCUMENT_MIME_TYPES.join(",")}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="artifact-replace-expiration">
              Expiration date{kindMeta.expirationRequired ? " (required)" : ""}
            </Label>
            <DatePicker
              id="artifact-replace-expiration"
              value={expirationDate}
              onChange={setExpirationDate}
              ariaLabel="Expiration date"
              invalid={kindMeta.expirationRequired && !expirationDate}
            />
          </div>
          {error ? (
            <div
              role="alert"
              className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-2 text-[13px] text-[#B91C1C]"
            >
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Working…" : "Upload new version"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
