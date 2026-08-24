// Payer PDF — the upload panel inside a Payer PDF action row (Template Editor,
// Step 2 "Actions"). Sits where the Portal action's FormStepPanel sits, for the
// same reason: the thing the action needs is configured on the action, not in a
// separate screen the author has to go find.
//
// PAYER AND STATES ARE READ-ONLY CONTEXT, never a picker. The template already
// names the payer and the states it targets, so tagging the form would be
// re-entering data the template holds — and a mismatch between the two would be
// unresolvable. A form that applies to only SOME of a multi-state template's
// states belongs on its own single-state template.
//
// A form can only be attached to a template that EXISTS (the row's FK), so in
// create mode this panel says so rather than offering an upload that would
// fail. That is a real ordering constraint, not a limitation worth hiding —
// but it must not be a dead end: `sopPublishLint`'s "payer_form_missing" rule
// is the one rule the wizard's initial Create defers, so hitting Create with
// this panel still unresolved creates the template anyway and hands the
// author straight back into ITS OWN editor (not the templates list) to
// upload. "Save first" always resolves in one click, never a search.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useRetirePayerForm,
  useTemplatePayerForms,
  useUploadPayerForm,
  usePayerFormDownload,
} from "@/hooks/usePayerForms";
import { payerFormFileError, payerFormLabelError } from "@/lib/payerForms";
import { fmtDate } from "@/lib/format";
import type { PayerForm } from "@/types";

interface PayerFormStepPanelProps {
  /** The template the form attaches to. null in create mode (no row yet). */
  templateId: string | null;
  /** The family this action points at, "" when no file is chosen yet. */
  familyId: string;
  /** Read-only context echoed from the template. */
  payerName: string | null;
  states: string[];
  canEdit: boolean;
  onFamilyChange: (familyId: string) => void;
}

export function PayerFormStepPanel({
  templateId,
  familyId,
  payerName,
  states,
  canEdit,
  onFamilyChange,
}: PayerFormStepPanelProps) {
  const formsQ = useTemplatePayerForms(templateId ?? undefined);
  const upload = useUploadPayerForm();
  const retire = useRetirePayerForm();
  const download = usePayerFormDownload();
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState<File | null>(null);

  const forms = formsQ.data ?? [];
  const attached = familyId ? (forms.find((f) => f.familyId === familyId) ?? null) : null;

  async function runUpload(replacing: PayerForm | null) {
    if (!templateId || !pending) return;
    const name = replacing ? replacing.label : label;
    const labelError = payerFormLabelError(name);
    if (labelError) {
      toast.error(labelError);
      return;
    }
    const fileError = payerFormFileError(pending);
    if (fileError) {
      toast.error(fileError);
      return;
    }
    try {
      const form = await upload.mutateAsync({
        templateId,
        label: name,
        file: pending,
        familyId: replacing?.familyId ?? null,
      });
      // Point the action at the family, not the row: a later replace then
      // reaches new cases without the template being republished.
      onFamilyChange(form.familyId);
      setPending(null);
      setLabel("");
      if (fileRef.current) fileRef.current.value = "";
      toast.success(replacing ? `Replaced “${form.label}”` : `Added “${form.label}”`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not upload that form.");
    }
  }

  async function runDownload(form: PayerForm) {
    try {
      const signed = await download.mutateAsync(form.id);
      window.open(signed.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open that form.");
    }
  }

  async function runRetire(form: PayerForm) {
    try {
      await retire.mutateAsync(form);
      onFamilyChange("");
      toast.success(`Removed “${form.label}” from this template`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove that form.");
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-[#E8E5E0] bg-[#FAFAF9] p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          Payer: <span className="font-medium text-foreground">{payerName ?? "—"}</span>
        </span>
        <span>
          States:{" "}
          <span className="font-medium text-foreground">
            {states.length > 0 ? states.join(", ") : "—"}
          </span>
        </span>
        <span className="text-[10px]">from this template — not tagged per form</span>
      </div>

      {templateId === null ? (
        <p className="text-[12px] text-[#92400E]">
          A form attaches to a template that exists, so uploading opens up once this template is
          created — you don&rsquo;t need to finish this first. Go to Review and create the template,
          then come straight back here to upload.
        </p>
      ) : attached ? (
        <div className="flex items-start gap-2 rounded-md border border-[#E8E5E0] bg-card p-2">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{attached.label}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {attached.fileName} · v{attached.version} · added {fmtDate(attached.createdAt)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => runDownload(attached)}
              disabled={download.isPending}
            >
              <Download className="h-4 w-4" />
            </Button>
            {canEdit ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-[#B91C1C] hover:text-[#B91C1C]"
                onClick={() => runRetire(attached)}
                disabled={retire.isPending}
                aria-label={`Remove ${attached.label}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          No form on this action yet. Upload the payer&rsquo;s PDF and give it a name the team will
          recognise on the case.
        </p>
      )}

      {canEdit && templateId !== null ? (
        <div className="space-y-2">
          {attached ? null : (
            <div>
              <Label className="text-xs">Form name</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="PT Credentialing Supplement"
                disabled={upload.isPending}
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="h-9 max-w-[260px] text-[12px]"
              disabled={upload.isPending}
              onChange={(e) => setPending(e.target.files?.[0] ?? null)}
            />
            <Button
              size="sm"
              className="h-9"
              disabled={!pending || upload.isPending}
              onClick={() => runUpload(attached)}
            >
              {upload.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {attached ? "Replace" : "Add form"}
            </Button>
          </div>
          {attached ? (
            <p className="text-[11px] text-muted-foreground">
              Replacing keeps the name and reaches cases generated from now on. Cases already
              created keep the file they were generated with.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
