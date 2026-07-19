// E2.1 F2.1.3 / E6.0 — the "reapply" affordance on a DENIED case. Reapplying
// is the denied → in_progress reapply edge + new tasks ON THE SAME CASE —
// never a second case at the 4-part key — so the payer/provider history
// (touches, status history, the prior denial) stays continuous across cycles.
// The transition rides set_case_status (unified history + audit, atomic); the
// task set is regenerated from the CURRENT SOP version (Model A: new work
// gets latest) via the same pickTemplate/resolveTemplate tier every creation
// surface uses, appended after the case's existing tasks.
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

  if (c.caseStatus !== "denied" || !canEdit) return null;

  const run = () => {
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
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
                disabled={reapply.isPending}
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
