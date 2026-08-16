// TS-163 — per-step artifact attachment. Every SOP step's requiredArtifacts
// checklist renders here (draft_email, online_form, fax/phone/mail/custom —
// deliberately NOT step-type-gated, since a fax or mail step needs proof of
// submission as much as an email does). A free-form artifact ("Submission
// confirmation PDF") uploads as a case-scoped filled_form document
// (provider_documents, caseId set — E4.5's existing "usage context" shape,
// TE-1); an artifact name that resolves to a canonical machine kind
// (parseDocumentKind, e.g. "State License") additionally offers an explicit
// "Also save to <owner>'s documents" promote checkbox — a SECOND, canonical
// upload, never a rewrite of the case-scoped one (the two rows are
// independently addressable and independently downloadable).
//
// DESIGN-DEBT: unspecced component, stock shadcn + token-styled per AGENTS.md.
import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/DatePicker";
import { StatusPill } from "@/components/StatusPill";
import {
  DOCUMENT_KIND_META,
  DOCUMENT_MIME_TYPES,
  checkDocumentFile,
  documentKindLabel,
  expirationDateError,
  stepArtifactRows,
} from "@/lib/documents";
import { useDocumentDownload, useUploadDocument } from "@/hooks/useDocuments";
import { useAttachStepArtifact, useDetachStepArtifact } from "@/hooks/useTasks";
import { useCanWrite } from "@/lib/permissions";
import { currentUserId } from "@/lib/audit";
import { DocumentDownloadButton } from "./DocumentDownloadButton";
import type { DocumentKind, DocumentOwnerType, SOPStep, SOPStepAttachment } from "@/types";

export interface StepArtifactsContext {
  taskId: string;
  caseId: string | null;
  providerId: string | null;
  groupId: string | null;
}

/** The owner grain a case-scoped (filled_form) artifact uploads under —
 * provider preferred (the step's case is almost always about the provider),
 * group as the fallback for the rare group-only task. */
function caseArtifactOwner(
  ctx: StepArtifactsContext,
): { ownerType: DocumentOwnerType; ownerId: string } | null {
  if (ctx.providerId) return { ownerType: "provider", ownerId: ctx.providerId };
  if (ctx.groupId) return { ownerType: "group", ownerId: ctx.groupId };
  return null;
}

/** The owner grain a PROMOTED (canonical-kind) upload must use — the kind's
 * own owner grains (D1), intersected with what's actually available here. */
function promoteOwner(
  kind: DocumentKind,
  ctx: StepArtifactsContext,
): { ownerType: DocumentOwnerType; ownerId: string } | null {
  const owners = DOCUMENT_KIND_META[kind].owners;
  if (owners.includes("provider") && ctx.providerId) {
    return { ownerType: "provider", ownerId: ctx.providerId };
  }
  if (owners.includes("group") && ctx.groupId) {
    return { ownerType: "group", ownerId: ctx.groupId };
  }
  return null;
}

function AttachedRow({
  artifactName,
  attachment,
  stepId,
  ctx,
  canWrite,
}: {
  artifactName: string;
  attachment: SOPStepAttachment;
  stepId: string;
  ctx: StepArtifactsContext;
  canWrite: boolean;
}) {
  const detachM = useDetachStepArtifact();
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-[13px]">
      <Check className="h-3.5 w-3.5 flex-none text-[var(--mp-ok-ink)]" />
      <span className="font-medium text-foreground">{artifactName}</span>
      <StatusPill status="green" label="Attached" />
      <span className="truncate text-[12px] text-muted-foreground">{attachment.fileName}</span>
      <span className="ml-auto flex items-center gap-1">
        <DocumentDownloadButton documentId={attachment.documentId} fileName={attachment.fileName} />
        {canWrite ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={`Remove ${artifactName} attachment`}
            disabled={detachM.isPending}
            onClick={() =>
              detachM.mutate(
                { taskId: ctx.taskId, stepId, documentId: attachment.documentId },
                { onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't remove") },
              )
            }
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </span>
    </li>
  );
}

function MissingArtifactRow({
  artifactName,
  resolvedKind,
  stepId,
  ctx,
}: {
  artifactName: string;
  resolvedKind: DocumentKind | null;
  stepId: string;
  ctx: StepArtifactsContext;
}) {
  const uploadM = useUploadDocument();
  const attachM = useAttachStepArtifact();
  const [file, setFile] = useState<File | null>(null);
  const [promote, setPromote] = useState(false);
  const [promoteExpiration, setPromoteExpiration] = useState("");
  const [error, setError] = useState<string | null>(null);

  const owner = caseArtifactOwner(ctx);
  const promotable = resolvedKind ? promoteOwner(resolvedKind, ctx) : null;
  const promoteMeta = resolvedKind ? DOCUMENT_KIND_META[resolvedKind] : null;
  const busy = uploadM.isPending || attachM.isPending;

  const submit = async () => {
    if (!owner || !ctx.caseId) {
      setError("No case context to attach this artifact to");
      return;
    }
    if (!file) {
      setError("Choose a file first");
      return;
    }
    const fileError = checkDocumentFile(file);
    if (fileError) {
      setError(fileError);
      return;
    }
    if (promote && resolvedKind && promoteMeta?.expirationRequired) {
      const expError = expirationDateError(resolvedKind, promoteExpiration || null);
      if (expError) {
        setError(expError);
        return;
      }
    }
    setError(null);
    try {
      const doc = await uploadM.mutateAsync({
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        kind: "filled_form",
        file,
        effectiveDate: null,
        expirationDate: null,
        caseId: ctx.caseId,
      });
      await attachM.mutateAsync({
        taskId: ctx.taskId,
        stepId,
        attachment: {
          documentId: doc.id,
          artifactName,
          fileName: file.name,
          uploadedAt: new Date().toISOString(),
          uploadedBy: currentUserId(),
          kind: "filled_form",
        },
      });
      if (promote && resolvedKind && promotable) {
        await uploadM.mutateAsync({
          ownerType: promotable.ownerType,
          ownerId: promotable.ownerId,
          kind: resolvedKind,
          file,
          effectiveDate: null,
          expirationDate: promoteExpiration || null,
          caseId: ctx.caseId,
        });
        toast.success(`Attached — also saved to documents as ${promoteMeta?.label}`);
      } else {
        toast.success("Artifact attached");
      }
      setFile(null);
      setPromote(false);
      setPromoteExpiration("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't attach this file");
    }
  };

  return (
    <li className="px-3 py-2 text-[13px]">
      <div className="flex items-center gap-2">
        <X className="h-3.5 w-3.5 flex-none text-[var(--mp-danger-ink)]" />
        <span className="font-medium text-foreground">{artifactName}</span>
        <StatusPill status="red" label="Missing" />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-[22px]">
        <Input
          type="file"
          accept={DOCUMENT_MIME_TYPES.join(",")}
          className="h-8 max-w-[220px] text-[12px]"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          aria-label={`Attach a file for ${artifactName}`}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2 text-[12px]"
          disabled={!file || busy}
          onClick={submit}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Paperclip className="h-3.5 w-3.5" />
          )}
          Attach
        </Button>
      </div>
      {resolvedKind && promotable ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-[22px]">
          <Checkbox
            id={`promote-${stepId}-${artifactName}`}
            checked={promote}
            onCheckedChange={(v) => setPromote(Boolean(v))}
          />
          <Label
            htmlFor={`promote-${stepId}-${artifactName}`}
            className="text-[12px] font-normal text-muted-foreground"
          >
            Also save to {promotable.ownerType === "provider" ? "the provider's" : "the group's"}{" "}
            documents as {promoteMeta?.label}
          </Label>
          {promote && promoteMeta?.expirationRequired ? (
            <DatePicker
              id={`promote-exp-${stepId}-${artifactName}`}
              value={promoteExpiration}
              onChange={setPromoteExpiration}
              ariaLabel={`${promoteMeta.label} expiration date`}
              invalid={!promoteExpiration}
            />
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="mt-1.5 pl-[22px] text-[12px] text-[#B91C1C]">
          {error}
        </div>
      ) : null}
    </li>
  );
}

export function StepArtifactsPanel({ step, ctx }: { step: SOPStep; ctx: StepArtifactsContext }) {
  const canWrite = useCanWrite();
  const downloadM = useDocumentDownload();
  const { rows, orphans } = stepArtifactRows(step);

  if (rows.length === 0 && orphans.length === 0) return null;

  const attachedCount = rows.filter((r) => r.attachment).length + orphans.length;

  const downloadAll = async () => {
    const all = [
      ...rows.map((r) => r.attachment).filter((a): a is SOPStepAttachment => Boolean(a)),
      ...orphans,
    ];
    for (let i = 0; i < all.length; i++) {
      try {
        const signed = await downloadM.mutateAsync(all[i].documentId);
        window.open(signed.url, "_blank", "noopener");
      } catch {
        toast.error(`Couldn't download ${all[i].fileName}`);
      }
      if (i < all.length - 1) await new Promise((r) => setTimeout(r, 300));
    }
  };

  return (
    <div className="rounded-md border border-[#E8E5E0]">
      <div className="flex items-center justify-between gap-3 border-b border-[#E8E5E0] px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Attachments
        </span>
        {attachedCount > 1 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[12px]"
            disabled={downloadM.isPending}
            onClick={downloadAll}
          >
            Download all attachments
          </Button>
        ) : null}
      </div>
      <ul className="divide-y divide-[#E8E5E0]">
        {rows.map((row) =>
          row.attachment ? (
            <AttachedRow
              key={row.artifactName}
              artifactName={row.artifactName}
              attachment={row.attachment}
              stepId={step.id}
              ctx={ctx}
              canWrite={canWrite}
            />
          ) : (
            <MissingArtifactRow
              key={row.artifactName}
              artifactName={row.artifactName}
              resolvedKind={row.resolvedKind}
              stepId={step.id}
              ctx={ctx}
            />
          ),
        )}
        {orphans.length > 0 ? (
          <li className="px-3 py-2 text-[13px]">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Other attachments
            </div>
            <ul className="space-y-1.5">
              {orphans.map((a) => (
                <li key={a.documentId} className="flex items-center gap-2">
                  <span className="truncate text-[12px] text-muted-foreground">
                    {a.fileName} ({documentKindLabel(a.kind)})
                  </span>
                  <DocumentDownloadButton documentId={a.documentId} fileName={a.fileName} />
                </li>
              ))}
            </ul>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
