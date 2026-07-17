// E2.1 F2.1.3 — the "reapply" affordance on a DENIED case. Reapplying is a
// status transition + new tasks ON THE SAME CASE — never a second case at the
// 4-part key — so the payer/provider history (touches, status_history) stays
// continuous across cycles. Destination is Denied → In Progress ([r4-review]
// Q6), written through the existing updateCaseStatus path (status_history +
// audit); the task set is regenerated from the CURRENT SOP version (Model A:
// new work gets latest) via the same pickTemplate/resolveTemplate tier every
// creation surface uses, appended after the case's existing tasks.
import { useState } from "react";
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
import { pickTemplate } from "@/lib/pickTemplate";
import { resolveTemplate } from "@/lib/sopResolver";
import { stampTasks } from "@/lib/sopStamp";
import { canonicalLabel } from "@/lib/canonicalStatuses";
import { DENIED_LABEL, IN_PROGRESS_LABEL } from "@/lib/statusLabels";
import { useReapplyCase } from "@/hooks/useCases";
import { useSops, useStatusConfigs } from "@/hooks/useAdmin";
import type { CaseDetail } from "@/types";

interface ReapplyCaseActionProps {
  c: CaseDetail;
  credStatusLabel: string | null;
  canEdit: boolean;
}

export function ReapplyCaseAction({ c, credStatusLabel, canEdit }: ReapplyCaseActionProps) {
  const statusesQ = useStatusConfigs();
  const templatesQ = useSops();
  const reapply = useReapplyCase();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const denied = credStatusLabel !== null && canonicalLabel(credStatusLabel) === DENIED_LABEL;
  if (!denied || !canEdit) return null;

  const inProgress = (statusesQ.data ?? []).find(
    (s) => s.track === "credentialing" && canonicalLabel(s.label) === IN_PROGRESS_LABEL,
  );

  const run = () => {
    if (!inProgress) return;
    const template = pickTemplate(templatesQ.data ?? [], c.payerId, c.state, c.groupId);
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
      { caseId: c.id, statusId: inProgress.id, tasks },
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
        disabled={statusesQ.isLoading || templatesQ.isLoading}
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
              regenerated from the current SOP. Existing tasks, touches, and history are kept.
            </p>
            {!inProgress && !statusesQ.isLoading ? (
              <p className="text-[13px] text-[#B91C1C]">
                No In Progress credentialing status is configured for this organization.
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
                disabled={!inProgress || reapply.isPending}
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
