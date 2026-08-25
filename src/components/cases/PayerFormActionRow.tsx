// Payer PDF — the case-side controls on a Payer PDF action.
//
// The action's whole job is a short loop: get the payer's blank form, send it
// with the application, say so. So the row carries exactly three affordances —
// Download, Mark sent, Remove — instead of the generic step list, which for
// this action would be one step reading "Send payer form" and nothing else.
//
// Mark sent completes the action AND writes a touch, so the send shows up on
// the case activity spine beside every other thing that happened. It does NOT
// move the case status: advancing a case stays with the case status control, so
// the case never depends on the order the checklist was worked in.
//
// E6.11 adds a fourth affordance, "Fill & download", when the form's family has
// trained field mappings: the same file, with everything the panel already
// knows written into it. The blank download stays, because a mapping can be
// absent, partial, or simply not what this case needs.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Loader2, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFillPayerForm, usePayerFormDownload } from "@/hooks/usePayerForms";
import { useMarkPayerFormSent, useRemovePayerFormFromCase } from "@/hooks/useTasks";
import { usePortalFieldMaps } from "@/hooks/usePortals";
import { payerFormDisplayName, type ResolvedPayerFormPointer } from "@/lib/payerForms";
import { pdfFormPortalKey } from "@/lib/pdfFieldImport";
import { planPayerFormFill } from "@/lib/payerFormFill";
import type { RegistryRow } from "@/lib/fieldRegistry";
import type { Task } from "@/types";

export function PayerFormActionRow({
  task,
  pointer,
  canEdit,
  tokenValues,
}: {
  task: Task;
  pointer: ResolvedPayerFormPointer;
  canEdit: boolean;
  /** The case's resolved token values — what a fill can write. */
  tokenValues?: Record<string, string>;
}) {
  const download = usePayerFormDownload();
  const markSent = useMarkPayerFormSent();
  const remove = useRemovePayerFormFromCase();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [reason, setReason] = useState("");

  const portalKey = pdfFormPortalKey(pointer.familyId);
  const mapsQ = usePortalFieldMaps(portalKey);
  const fill = useFillPayerForm();
  const values = useMemo(() => tokenValues ?? {}, [tokenValues]);

  const rows = useMemo(
    () => (mapsQ.data ?? []).filter((m) => m.portalKey === portalKey) as RegistryRow[],
    [mapsQ.data, portalKey],
  );
  // The plan is computed here too, not just inside the fill, so the row can say
  // what a fill WOULD do before the coordinator commits to downloading it.
  const plan = useMemo(() => planPayerFormFill(rows, values), [rows, values]);

  const label = payerFormDisplayName(pointer);
  const sent = task.status === "completed";
  const canFill = Boolean(pointer.formId) && plan.fill.length > 0;

  const runDownload = async () => {
    try {
      const signed = await download.mutateAsync(pointer.formId);
      window.open(signed.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open that form.");
    }
  };

  const runFill = async () => {
    try {
      const result = await fill.mutateAsync({
        formId: pointer.formId,
        familyId: pointer.familyId,
        caseId: task.caseId ?? "",
        providerId: task.providerId,
        rows,
        tokenValues: values,
        fileStem: `${label.replace(/[^\w.-]+/g, "-")}-filled`,
      });
      const left = result.plan.manualLabels.length + result.plan.fieldsSkipped.length;
      toast.success(
        left > 0
          ? `Filled ${result.written} field${result.written === 1 ? "" : "s"} — ${left} still need${left === 1 ? "s" : ""} a person`
          : `Filled ${result.written} field${result.written === 1 ? "" : "s"}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not fill that form.");
    }
  };

  const runMarkSent = () => {
    markSent.mutate(
      { task, formLabel: label },
      {
        onSuccess: () => toast.success(`Marked “${label}” sent`),
        onError: (e: unknown) =>
          toast.error(e instanceof Error ? e.message : "Could not mark that sent."),
      },
    );
  };

  const runRemove = () => {
    remove.mutate(
      { task, reason: reason.trim() || null },
      {
        onSuccess: () => {
          setConfirmRemove(false);
          setReason("");
          toast.success(`Removed “${label}” from this case`);
        },
        onError: (e: unknown) =>
          toast.error(e instanceof Error ? e.message : "Could not remove that form."),
      },
    );
  };

  return (
    <div className="px-3 pb-3 pl-11">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#E8E5E0] bg-[#FAFAF9] p-2">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[13px]">
          {label}
          {pointer.fileName ? (
            <span className="ml-2 text-[11px] text-muted-foreground">{pointer.fileName}</span>
          ) : null}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={runDownload}
          disabled={download.isPending || !pointer.formId}
        >
          {download.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1 h-4 w-4" />
          )}
          Download
        </Button>
        {canFill ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={runFill}
            disabled={fill.isPending}
            title={`Writes ${plan.fill.length} mapped field${plan.fill.length === 1 ? "" : "s"}; ${plan.manualLabels.length + plan.fieldsSkipped.length} left for you`}
          >
            {fill.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-4 w-4" />
            )}
            Fill &amp; download
          </Button>
        ) : null}
        {canEdit && !sent ? (
          <Button size="sm" className="h-8" onClick={runMarkSent} disabled={markSent.isPending}>
            <Send className="mr-1 h-4 w-4" />
            Mark sent
          </Button>
        ) : null}
        {canEdit ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-muted-foreground"
            onClick={() => setConfirmRemove(true)}
            disabled={remove.isPending}
            aria-label={`Remove ${label} from this case`}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {canFill ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          A filled copy downloads to this computer only and stays editable — nothing is uploaded.
          {plan.manualLabels.length + plan.fieldsSkipped.length > 0
            ? ` ${plan.manualLabels.length + plan.fieldsSkipped.length} field(s) come back blank for you to complete.`
            : ""}
        </p>
      ) : null}

      {confirmRemove ? (
        <Dialog open onOpenChange={(o) => !o && setConfirmRemove(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Remove this payer form?</DialogTitle>
              <DialogDescription>
                “{label}” comes off this case&rsquo;s checklist. It will not come back — payer forms
                are attached when a case is generated, and this case has already been generated. The
                template keeps the form for future cases.
              </DialogDescription>
            </DialogHeader>
            <div>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why? (optional — kept on the record)"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
              <Button
                className="bg-[#B91C1C] text-white hover:bg-[#991B1B]"
                onClick={runRemove}
                disabled={remove.isPending}
              >
                {remove.isPending ? "Removing…" : "Remove"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
