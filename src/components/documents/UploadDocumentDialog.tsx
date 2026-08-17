// E4.5 F4.5.1 — the explicit upload form (TE-10): kind select (the shared
// metadata map — never a hard-coded kind array), file input with the
// centralized MIME/size pre-flight, effective/expiration dates. Kinds that
// expire REQUIRE an expiration date (D2) — validated here AND at the server
// AND by the DB CHECK. Replace mode locks the kind and versions the family.
import { useRef, useState } from "react";
import { toast } from "sonner";
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
import {
  DOCUMENT_KIND_META,
  DOCUMENT_MIME_TYPES,
  checkDocumentFile,
  expirationDateError,
  vaultPickerKinds,
} from "@/lib/documents";
import { useUploadDocument } from "@/hooks/useDocuments";
import type { DocumentKind, DocumentOwnerType, ProviderDocument } from "@/types";

interface UploadDocumentDialogProps {
  ownerType: DocumentOwnerType;
  ownerId: string;
  ownerName: string;
  /** Replace mode: the CURRENT version being superseded — locks the kind and
   * versions its family (prior versions retained, TE-1). */
  replaceTarget?: ProviderDocument | null;
  /** ASD BITE-ASD-03 — preselect + lock the kind when there's no
   * replaceTarget yet (the case-required-documents rail uploading a
   * currently-MISSING kind, so there's no existing document to version).
   * Ignored when replaceTarget is set — its docType wins. */
  presetKind?: DocumentKind | null;
  /** Optional usage context threaded to the upload-intent (ASD BITE-ASD-02). */
  caseId?: string | null;
  onClose: () => void;
}

export function UploadDocumentDialog({
  ownerType,
  ownerId,
  ownerName,
  replaceTarget,
  presetKind,
  caseId,
  onClose,
}: UploadDocumentDialogProps) {
  const uploadM = useUploadDocument();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind | "">(replaceTarget?.docType ?? presetKind ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(replaceTarget?.effectiveDate ?? "");
  const [expirationDate, setExpirationDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const kindLocked = Boolean(replaceTarget) || Boolean(presetKind);
  const kinds = vaultPickerKinds(ownerType);
  const expirationRequired = kind !== "" && DOCUMENT_KIND_META[kind].expirationRequired;

  const submit = () => {
    if (!kind) {
      setError("Choose a document kind");
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
    const expError = expirationDateError(kind, expirationDate || null);
    if (expError) {
      setError(expError);
      return;
    }
    setError(null);
    uploadM.mutate(
      {
        ownerType,
        ownerId,
        kind,
        file,
        effectiveDate: effectiveDate || null,
        expirationDate: expirationDate || null,
        familyId: replaceTarget?.documentFamilyId ?? null,
        caseId: caseId ?? null,
      },
      {
        onSuccess: (doc) => {
          toast.success(
            replaceTarget
              ? `${DOCUMENT_KIND_META[kind].label} replaced — now v${doc.versionNumber}`
              : `${DOCUMENT_KIND_META[kind].label} uploaded`,
          );
          onClose();
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Upload failed"),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>
            {replaceTarget
              ? `Replace ${DOCUMENT_KIND_META[replaceTarget.docType].label}`
              : presetKind
                ? `Upload ${DOCUMENT_KIND_META[presetKind].label}`
                : "Upload document"}
          </DialogTitle>
          <DialogDescription>
            {replaceTarget
              ? `A new version for ${ownerName} — prior versions are retained.`
              : `For ${ownerName}. PDF, PNG, or JPEG.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="doc-kind">Document kind</Label>
            <Select
              value={kind || undefined}
              onValueChange={(v) => setKind(v as DocumentKind)}
              disabled={kindLocked}
            >
              <SelectTrigger id="doc-kind">
                <SelectValue placeholder="Choose a kind" />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((m) => (
                  <SelectItem key={m.kind} value={m.kind}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="doc-file">File</Label>
            <Input
              id="doc-file"
              ref={fileInputRef}
              type="file"
              accept={DOCUMENT_MIME_TYPES.join(",")}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="doc-effective">Effective date</Label>
              <DatePicker
                id="doc-effective"
                value={effectiveDate}
                onChange={setEffectiveDate}
                ariaLabel="Effective date"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-expiration">
                Expiration date{expirationRequired ? " (required)" : ""}
              </Label>
              <DatePicker
                id="doc-expiration"
                value={expirationDate}
                onChange={setExpirationDate}
                ariaLabel="Expiration date"
                invalid={expirationRequired && !expirationDate}
              />
            </div>
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
          <Button variant="outline" onClick={onClose} disabled={uploadM.isPending}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
            onClick={submit}
            disabled={uploadM.isPending}
          >
            {uploadM.isPending ? "Uploading…" : replaceTarget ? "Upload new version" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
