// E2.1 F2.1.3 / E6.0 — the "reapply" affordance on a DENIED case. Reapplying
// is the denied → in_progress reapply edge + new tasks ON THE SAME CASE —
// never a second case at the 4-part key — so the payer/provider history
// (touches, status history, the prior denial) stays continuous across cycles.
// The transition rides set_case_status (unified history + audit, atomic); the
// task set is regenerated from the CURRENT SOP version (Model A: new work
// gets latest) via the same pickTemplate/resolveTemplate tier every creation
// surface uses, appended after the case's existing tasks.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isAllStates, templateStates } from "@/lib/sopMatchKey";
import { isFallbackTemplate, topRankedTemplates } from "@/lib/pickTemplate";
import { resolveTemplate } from "@/lib/sopResolver";
import { stampTasks } from "@/lib/sopStamp";
import { useReapplyCase } from "@/hooks/useCases";
import { useSops } from "@/hooks/useAdmin";
import type { CaseDetail } from "@/types";

interface ReapplyCaseActionProps {
  c: CaseDetail;
  canEdit: boolean;
}

export function ReapplyCaseAction({ c, canEdit }: ReapplyCaseActionProps) {
  const templatesQ = useSops();
  const reapply = useReapplyCase();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const autoTemplate = useMemo(() => {
    const top = topRankedTemplates(
      templatesQ.data ?? [],
      c.payerId,
      c.state,
      c.groupId,
      c.caseType ?? null,
    );
    return top.length === 1 ? top[0] : null;
  }, [templatesQ.data, c.payerId, c.state, c.groupId, c.caseType]);

  const candidateTemplates = useMemo(() => {
    const all = templatesQ.data ?? [];
    return all.filter((t) => {
      if (t.archived || (t.caseType ?? null) !== (c.caseType ?? null)) return false;
      if (isFallbackTemplate(t)) return true;
      if (t.payerId !== c.payerId) return false;
      if (t.groupId !== null && t.groupId !== c.groupId) return false;
      const states = templateStates(t);
      if (!isAllStates(states) && !states.includes(c.state)) return false;
      return true;
    });
  }, [templatesQ.data, c.payerId, c.groupId, c.state, c.caseType]);

  const templateOptions = useMemo(() => {
    const list = [...candidateTemplates];
    if (autoTemplate && !list.some((t) => t.id === autoTemplate.id)) {
      list.push(autoTemplate);
    }
    return list;
  }, [candidateTemplates, autoTemplate]);

  const effectiveTemplate = useMemo(() => {
    if (selectedTemplateId) {
      return templateOptions.find((t) => t.id === selectedTemplateId) ?? null;
    }
    return autoTemplate;
  }, [selectedTemplateId, templateOptions, autoTemplate]);

  if (c.caseType === "recredentialing" || c.caseType === "contract") {
    return c.caseStatus === "denied" && canEdit ? (
      <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
        {c.caseType === "contract"
          ? "Contract work belongs in the Group Contracts Matrix and cannot be reapplied as a provider case."
          : "Recredentialing execution is not supported. This SOP type is available for authoring only."}
      </p>
    ) : null;
  }
  if (c.caseStatus !== "denied" || !canEdit) return null;

  const run = () => {
    const template = effectiveTemplate;
    if (!template) return;
    const resolved =
      template && c.provider ? resolveTemplate(template, c.provider, c.group, null, null) : [];
    // Append after the case's existing tasks so the combined checklist keeps
    // a stable order across cycles. E2.2 F2.2.3: the new cycle stamps the
    // CURRENT selection/version (a payer SOP authored since the original
    // generation now wins over the fallback); the prior cycle's tasks and
    // stamps are untouched.
    const offset = (c.tasks ?? []).reduce((max, t) => Math.max(max, t.sortOrder + 1), 0);
    const tasks = stampTasks(
      resolved.map((t) => ({ ...t, sortOrder: t.sortOrder + offset })),
      template,
    );

    reapply.mutate(
      { caseId: c.id, tasks },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          toast.success(
            tasks.length > 0
              ? `Case reopened — In Progress, ${tasks.length} task${tasks.length === 1 ? "" : "s"} regenerated.`
              : "Case reopened — In Progress.",
          );
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Could not reapply on this case."),
      },
    );
  };

  return (
    <div className="rounded-md border border-[#E8E5E0] p-3 flex flex-wrap items-center gap-2 text-[13px]">
      <span className="text-muted-foreground">
        This application was denied. Reapplying continues on this case — the full history stays in
        one place.
      </span>
      <Button
        variant="outline"
        size="sm"
        className="ml-auto h-8"
        onClick={() => setConfirmOpen(true)}
        disabled={templatesQ.isLoading}
      >
        <RotateCcw className="w-4 h-4 mr-1" /> Reapply
      </Button>

      {confirmOpen ? (
        <Dialog open onOpenChange={(o) => !o && setConfirmOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Reapply on this case</DialogTitle>
            </DialogHeader>
            <p className="text-[13px] text-muted-foreground">
              The case moves Denied → In Progress (recorded in status history) and its checklist is
              regenerated from the current SOP. Existing tasks, touches, and the prior denial are
              kept.
            </p>
            {templateOptions.length === 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
                No matching {c.caseType ?? "legacy / unclassified"} SOP is available for this payer,
                state, and group. Configure a matching SOP before reapplying.
                <Button asChild variant="outline" size="sm" className="mt-2">
                  <Link
                    to="/admin/payer-admin/setup/$payerId"
                    params={{ payerId: c.payerId }}
                    search={{ tab: "templates" }}
                  >
                    Open payer templates
                  </Link>
                </Button>
              </div>
            ) : null}
            {templateOptions.length > 0 ? (
              <div className="space-y-1.5 pt-2">
                <Label htmlFor="reapply-template">Template to apply</Label>
                <Select
                  value={effectiveTemplate?.id ?? ""}
                  onValueChange={(val) => setSelectedTemplateId(val)}
                >
                  <SelectTrigger id="reapply-template">
                    <SelectValue placeholder="Select a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templateOptions.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                        {t.taskDefinitions?.length
                          ? ` (${t.taskDefinitions.length} task${t.taskDefinitions.length === 1 ? "" : "s"})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {topRankedTemplates(
                  templatesQ.data ?? [],
                  c.payerId,
                  c.state,
                  c.groupId,
                  c.caseType ?? null,
                ).length > 1 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Several equally ranked SOPs match. Choose one; other eligible same-type SOPs
                    remain available.
                  </p>
                ) : null}
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
                disabled={reapply.isPending || templateOptions.length === 0 || !effectiveTemplate}
                onClick={run}
              >
                {reapply.isPending ? "Reapplying…" : "Reapply"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
