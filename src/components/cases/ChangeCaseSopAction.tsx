import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useReplaceCaseSop } from "@/hooks/useCases";
import type { ChangeCaseSopOptions } from "@/lib/changeCaseSop";
import { contractSpecialtyForTaxonomy } from "@/lib/contractSpecialty";
import { topRankedTemplates } from "@/lib/pickTemplate";
import { resolveTemplate } from "@/lib/sopResolver";
import type { CaseDetail, SOPTemplate } from "@/types";

const OPEN_CASE_STATUSES = new Set(["not_started", "in_progress"]);

/** Case types whose checklist cannot be swapped carry real information for the
 * coordinator, so they keep an inline notice. Every other case says nothing
 * here: the swap itself lives in the case ⋯ menu (CaseActionsMenu). */
export function CaseTypeNotice({ c, canEdit }: { c: CaseDetail; canEdit: boolean }) {
  if (!canEdit || !OPEN_CASE_STATUSES.has(c.caseStatus)) return null;
  if (c.caseType === "recredentialing") {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
        Recredentialing execution is not supported. This SOP type is available for authoring only.
      </p>
    );
  }
  if (c.caseType === "contract") {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
        Contract work belongs in the Group Contracts Matrix and cannot be changed as a provider
        case.
        {c.groupId && c.payerId && c.state ? (
          <Button asChild variant="link" size="sm" className="h-auto px-1 py-0">
            <Link
              to="/reporting/contracts-matrix"
              search={{
                groupId: c.groupId,
                payerId: c.payerId,
                state: c.state,
                // The matrix opens the case's specialty table (GCM-20).
                specialty: contractSpecialtyForTaxonomy(c.provider?.taxonomyCode) ?? undefined,
              }}
            >
              Open matching Matrix cell
            </Link>
          </Button>
        ) : null}
      </p>
    );
  }
  return null;
}

/** Replace an unstarted checklist with another matching template. Mounted by
 * the case ⋯ menu only when `changeCaseSopOptions` says the item is eligible. */
export function ChangeCaseSopDialog({
  c,
  sop,
  templates,
  onClose,
}: {
  c: CaseDetail;
  sop: ChangeCaseSopOptions;
  templates: readonly SOPTemplate[];
  onClose: () => void;
}) {
  const replace = useReplaceCaseSop();
  const [selectedId, setSelectedId] = useState("");
  const { alternatives, currentTemplateId } = sop;
  const chosen = sop.options.find((t) => t.id === selectedId) ?? null;
  const save = () => {
    if (!chosen || !c.provider || !chosen.currentVersion) return;
    const resolved = resolveTemplate(chosen, c.provider, c.group, null, null);
    replace.mutate(
      {
        caseId: c.id,
        templateId: chosen.id,
        expectedVersion: chosen.currentVersion,
        tasks: resolved,
      },
      {
        onSuccess: () => {
          onClose();
          toast.success(`Case checklist changed to ${chosen.name}.`);
        },
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : "Could not change the template."),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change case template</DialogTitle>
        </DialogHeader>
        <p className="text-[13px] text-muted-foreground">
          Replace the unstarted checklist with tasks from the selected template. The case and its
          history stay in place.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="case-template-choice">Template to apply</Label>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger id="case-template-choice">
              <SelectValue placeholder="Select a template" />
            </SelectTrigger>
            <SelectContent>
              {alternatives.map((t) => (
                <SelectItem key={t.id} value={t.id} disabled={t.id === currentTemplateId}>
                  {t.name}
                  {t.taskDefinitions?.length
                    ? ` (${t.taskDefinitions.length} task${t.taskDefinitions.length === 1 ? "" : "s"})`
                    : ""}
                  {t.id === currentTemplateId ? " (current)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {topRankedTemplates([...templates], c.payerId, c.state, c.groupId, c.caseType ?? null)
            .length > 1 ? (
            <p className="text-[11px] text-muted-foreground">
              Several equally ranked {c.caseType ?? "legacy / unclassified"} SOPs match. The list
              includes all eligible same-type SOPs.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!chosen || chosen.id === currentTemplateId || replace.isPending}
            onClick={save}
          >
            {replace.isPending ? "Changing…" : "Replace checklist"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
