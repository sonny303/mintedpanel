// TS-164/165 — the documents a step must SEND to the payer, resolved live
// against the provider's and group's vault. Renders under every SOP step type
// via StepBody: a fax or mail step sends the same packet an email step does.
//
// The direction of travel is outward. A step's requiredArtifacts entry that
// resolves to a governed kind (stepDocumentRequirements) becomes a row here
// showing whether that document is on file and current, with a download; a
// gap can be filled in place, writing a CANONICAL document into the vault
// (never a case-scoped copy — there is one document and it belongs to the
// provider or the group). Proof of submission is NOT captured here: the
// case's tracking id and the touchlog are the record (BR-7).
//
// Advisory only (BR-6) — nothing here disables the Gmail hand-off or blocks
// completing the step.
//
// DESIGN-DEBT: unspecced composition, stock primitives + tokens per AGENTS.md.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, TriangleAlert, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/DatePicker";
import { StatusPill } from "@/components/StatusPill";
import {
  DOCUMENT_KIND_META,
  DOCUMENT_MIME_TYPES,
  caseDocumentStatus,
  checkDocumentFile,
  expirationDateError,
  stepDocumentRequirements,
  type CaseDocumentCheck,
} from "@/lib/documents";
import { localTodayIso } from "@/hooks/useEnrollmentReadiness";
import { useDocumentDownload, useGroupDocuments, useProviderDocuments } from "@/hooks/useDocuments";
import { useUploadDocument } from "@/hooks/useDocuments";
import { useCanWrite } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";
import { DocumentDownloadButton } from "./DocumentDownloadButton";
import type { DocumentKind, DocumentOwnerType, ProviderDocument, SOPStep } from "@/types";

/** Identifiers the panel needs to resolve documents and record provenance.
 * No taskId: this surface never writes to the task. */
export interface RequiredDocumentsContext {
  caseId: string | null;
  providerId: string | null;
  groupId: string | null;
}

/** Which vault a kind's document belongs in, given what this case has. The
 * kind's own owner grains (D1) decide; the case supplies the ids. */
function ownerForKind(
  kind: DocumentKind,
  ctx: RequiredDocumentsContext,
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

/** Spacing the batch so the browser does not suppress the second and
 * subsequent saves (US-3 AC3). */
const DOWNLOAD_STAGGER_MS = 300;

function StateCell({ check }: { check: CaseDocumentCheck<ProviderDocument> }) {
  if (check.state === "present") {
    return check.expiringSoon ? (
      <StatusPill status="amber" label="Expiring soon" />
    ) : (
      <StatusPill status="green" label="Ready" />
    );
  }
  if (check.state === "expired") return <StatusPill status="red" label="Expired" />;
  return <StatusPill status="red" label="Missing" />;
}

function GapUploader({
  check,
  ctx,
}: {
  check: CaseDocumentCheck<ProviderDocument>;
  ctx: RequiredDocumentsContext;
}) {
  const uploadM = useUploadDocument();
  const [file, setFile] = useState<File | null>(null);
  const [expiration, setExpiration] = useState("");
  const [error, setError] = useState<string | null>(null);

  const meta = DOCUMENT_KIND_META[check.kind];
  const owner = ownerForKind(check.kind, ctx);

  if (!owner) {
    return (
      <p className="text-[12px] text-muted-foreground">
        This case has no {meta.owners.includes("group") ? "group" : "provider"} to file a{" "}
        {meta.label} against.
      </p>
    );
  }

  const submit = () => {
    if (!file) {
      setError("Choose a file first");
      return;
    }
    const fileError = checkDocumentFile(file);
    if (fileError) {
      setError(fileError);
      return;
    }
    const expError = expirationDateError(check.kind, expiration || null);
    if (expError) {
      setError(expError);
      return;
    }
    setError(null);
    uploadM.mutate(
      {
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        kind: check.kind,
        file,
        effectiveDate: null,
        expirationDate: expiration || null,
        // Replacing an expired document versions its EXISTING family so the
        // prior version is retained, never orphaned as a second lineage.
        familyId: check.document?.documentFamilyId ?? null,
        caseId: ctx.caseId,
      },
      {
        onSuccess: () => {
          toast.success(`${meta.label} added`);
          setFile(null);
          setExpiration("");
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Upload failed"),
      },
    );
  };

  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="file"
          accept={DOCUMENT_MIME_TYPES.join(",")}
          className="h-8 max-w-[210px] text-[12px]"
          aria-label={`Upload ${meta.label}`}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {meta.expirationRequired ? (
          <span className="w-[150px]">
            <DatePicker
              value={expiration}
              onChange={setExpiration}
              ariaLabel={`${meta.label} expiration date`}
              invalid={Boolean(file) && !expiration}
            />
          </span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2 text-[12px]"
          disabled={!file || uploadM.isPending}
          onClick={submit}
        >
          {uploadM.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {check.state === "expired" ? "Replace" : "Add"}
        </Button>
      </div>
      {error ? (
        <div role="alert" className="text-[12px] text-[#B91C1C]">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function RequiredDocumentsPanel({
  step,
  ctx,
}: {
  step: SOPStep;
  ctx: RequiredDocumentsContext;
}) {
  const canWrite = useCanWrite();
  const downloadM = useDocumentDownload();
  const today = localTodayIso();

  const { kinds, notes } = useMemo(() => stepDocumentRequirements(step), [step]);

  const providerQ = useProviderDocuments(kinds.length > 0 && ctx.providerId ? ctx.providerId : "");
  const groupQ = useGroupDocuments(kinds.length > 0 && ctx.groupId ? ctx.groupId : "");

  const checks = useMemo(
    () => caseDocumentStatus(kinds, providerQ.data ?? [], groupQ.data ?? [], today),
    [kinds, providerQ.data, groupQ.data, today],
  );

  // No requirements authored on this step — render nothing at all (US-2 AC6).
  if (kinds.length === 0 && notes.length === 0) return null;

  const ready = checks.filter((c) => c.document !== null);

  const downloadAll = async () => {
    for (let i = 0; i < ready.length; i++) {
      const doc = ready[i].document;
      if (!doc) continue;
      try {
        const signed = await downloadM.mutateAsync(doc.id);
        window.open(signed.url, "_blank", "noopener");
      } catch {
        toast.error(`Couldn't download ${DOCUMENT_KIND_META[ready[i].kind].label}`);
      }
      if (i < ready.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_STAGGER_MS));
      }
    }
  };

  return (
    <div className="rounded-md border border-[#E8E5E0]">
      <div className="flex items-center justify-between gap-3 border-b border-[#E8E5E0] px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Documents to send
        </span>
        {kinds.length > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            {ready.length} of {checks.length} on file
          </span>
        ) : null}
      </div>

      <ul className="divide-y divide-[#E8E5E0]">
        {checks.map((check) => (
          <li key={check.kind} className="px-3 py-2 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              {check.state === "present" ? (
                <Check className="h-3.5 w-3.5 flex-none text-[var(--mp-ok-ink)]" />
              ) : check.state === "expired" ? (
                <TriangleAlert className="h-3.5 w-3.5 flex-none text-[var(--mp-danger-ink)]" />
              ) : (
                <X className="h-3.5 w-3.5 flex-none text-[var(--mp-danger-ink)]" />
              )}
              <span className="font-medium text-foreground">{check.label}</span>
              <StateCell check={check} />
              {check.document?.expirationDate ? (
                <span className="text-[12px] text-muted-foreground">
                  {check.state === "expired" ? "expired" : "expires"}{" "}
                  {fmtDate(check.document.expirationDate)}
                </span>
              ) : null}
              {check.document ? (
                <span className="ml-auto">
                  <DocumentDownloadButton
                    documentId={check.document.id}
                    fileName={check.document.fileName}
                  />
                </span>
              ) : null}
            </div>
            {check.state !== "present" && canWrite ? <GapUploader check={check} ctx={ctx} /> : null}
          </li>
        ))}

        {notes.length > 0 ? (
          <li className="px-3 py-2">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Also noted on this step
            </div>
            <ul className="space-y-0.5">
              {notes.map((note) => (
                <li key={note} className="text-[12px] text-muted-foreground">
                  {note}
                </li>
              ))}
            </ul>
          </li>
        ) : null}
      </ul>

      {ready.length > 1 ? (
        <div className="border-t border-[#E8E5E0] px-3 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[12px]"
            disabled={downloadM.isPending}
            onClick={downloadAll}
          >
            Download all {ready.length} documents
          </Button>
        </div>
      ) : null}
    </div>
  );
}
