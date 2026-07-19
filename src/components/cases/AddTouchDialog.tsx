// E6.6 F6.6.5 — THE global Add-touch dialog: the one logging action for any
// number of cases. Case selection (the E4.1 bulk semantics: one touch row per
// selected case + one TOUCH_LOGGED audit per touch + a batch summary, all via
// bulkLogTouch) over the SHARED AddTouchForm, so structure, validation, and
// the F6.0.3 bump suggestion are identical to case detail's inline entry.
// Accepted bumps run per case — each case's own touch is the transition's
// evidence (set_case_status, expectedStatus null: an auto trigger may have
// just advanced the case). A failed bump never unwinds the logged touches;
// the ledger stays append-only. Supersedes BulkLogTouchDialog AND the
// "Log Payer Call" BatchTouchpointDialog (both retired).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useBulkLogTouch } from "@/hooks/useTouches";
import { useSetCaseStatus } from "@/hooks/useCases";
import { caseStatusLabel, type CaseStatus } from "@/lib/caseStatus";
import type { TouchInput } from "@/services/touches";
import { AddTouchForm, type AcceptedTouchBump } from "@/components/cases/AddTouchForm";

export interface TouchCaseCandidate {
  id: string;
  label: string;
  currentStatus: CaseStatus;
}

export function AddTouchDialog({
  open,
  candidates,
  defaultSelectedIds,
  onClose,
  onLogged,
}: {
  open: boolean;
  candidates: TouchCaseCandidate[];
  /** Preselected case ids (e.g. the one case a record panel targets). Absent
   * = none selected, pick explicitly. */
  defaultSelectedIds?: readonly string[];
  onClose: () => void;
  onLogged?: (caseIds: string[]) => void;
}) {
  const bulkM = useBulkLogTouch();
  const statusM = useSetCaseStatus();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelectedIds ?? []));
  const [saving, setSaving] = useState(false);

  const closeAndReset = () => {
    setSelected(new Set(defaultSelectedIds ?? []));
    onClose();
  };

  const toggle = (caseId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(caseId);
      else next.delete(caseId);
      return next;
    });
  };
  const allSelected = candidates.length > 0 && selected.size === candidates.length;
  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(candidates.map((c) => c.id)) : new Set());
  };

  const selectedCandidates = useMemo(
    () => candidates.filter((c) => selected.has(c.id)),
    [candidates, selected],
  );

  const handleSave = async (input: TouchInput, acceptedBumps: AcceptedTouchBump[]) => {
    if (selectedCandidates.length === 0) {
      toast.error("Select at least one case");
      return;
    }
    setSaving(true);
    try {
      const result = await bulkM.mutateAsync({
        caseIds: selectedCandidates.map((c) => c.id),
        input,
      });
      toast.success(
        result.caseIds.length === 1
          ? "Touch logged"
          : `Touch logged on ${result.caseIds.length} cases`,
      );
      // Accepted bumps: each case's OWN touch is the evidence.
      const touchByCase = new Map(result.created.map((t) => [t.caseId, t]));
      let bumped = 0;
      for (const bump of acceptedBumps) {
        const touch = touchByCase.get(bump.targetId);
        if (!touch) continue;
        try {
          await statusM.mutateAsync({
            caseId: bump.targetId,
            toStatus: bump.toStatus,
            expectedStatus: null,
            evidenceTouchId: touch.id,
          });
          bumped += 1;
        } catch (e) {
          const label = candidates.find((c) => c.id === bump.targetId)?.label ?? bump.targetId;
          toast.error(
            `Couldn't move ${label} to ${caseStatusLabel(bump.toStatus)}: ${(e as Error).message}`,
          );
        }
      }
      if (bumped > 0) {
        toast.success(
          bumped === 1
            ? "Status updated with the touch as evidence"
            : `Status updated on ${bumped} cases with the touches as evidence`,
        );
      }
      onLogged?.(result.caseIds);
      closeAndReset();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeAndReset()}>
      <DialogContent className="max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add touch</DialogTitle>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p className="text-[13px] text-muted-foreground py-2">No open cases to log against.</p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Cases ({selected.size} selected)
              </Label>
              <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground cursor-pointer">
                <Checkbox checked={allSelected} onCheckedChange={(v) => toggleAll(Boolean(v))} />
                Select all
              </label>
            </div>
            <div className="border border-border rounded-md divide-y divide-border max-h-[200px] overflow-y-auto">
              {candidates.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 p-2 cursor-pointer hover:bg-muted/30"
                >
                  <Checkbox
                    checked={selected.has(c.id)}
                    onCheckedChange={(v) => toggle(c.id, Boolean(v))}
                  />
                  <span className="text-[13px] text-foreground">{c.label}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {caseStatusLabel(c.currentStatus)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <AddTouchForm
          correctionOf={null}
          saving={saving}
          variant="dialog"
          bumpTargets={selectedCandidates.map((c) => ({
            id: c.id,
            currentStatus: c.currentStatus,
          }))}
          onCancel={closeAndReset}
          onSave={handleSave}
        />
      </DialogContent>
    </Dialog>
  );
}
