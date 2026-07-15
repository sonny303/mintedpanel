// E4.1 F4.1.7: bulk-log one structured touch across several selected cases. One
// service call writes one touch row per case + one TOUCH_LOGGED audit per touch
// (bulkLogTouch, org-bounded server-side). On success the parent surfaces a
// one-click link to the filtered view of exactly the affected cases.
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBulkLogTouch } from "@/hooks/useTouches";
import { CANONICAL_TOUCH_TYPES, TOUCH_TYPE_LABELS } from "@/lib/touchTypes";
import {
  dispositionRequiresContext,
  OTHER_DISPOSITION,
  TOUCH_DISPOSITIONS,
} from "@/lib/touchDispositions";
import type { TouchOutcome, TouchType } from "@/types";

const NO_OUTCOME = "__none__";

export interface BulkCaseCandidate {
  caseId: string;
  label: string;
}

export function BulkLogTouchDialog({
  open,
  candidates,
  onClose,
  onLogged,
}: {
  open: boolean;
  candidates: BulkCaseCandidate[];
  onClose: () => void;
  onLogged: (caseIds: string[]) => void;
}) {
  const bulkM = useBulkLogTouch();
  const today = format(new Date(), "yyyy-MM-dd");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [touchType, setTouchType] = useState<TouchType>("call");
  const [outcome, setOutcome] = useState<string>(NO_OUTCOME);
  const [recipientName, setRecipientName] = useState("");
  const [recipientContact, setRecipientContact] = useState("");
  const [notes, setNotes] = useState("");
  const [nextFollowUpDate, setNextFollowUpDate] = useState("");

  const reset = () => {
    setSelected(new Set());
    setTouchType("call");
    setOutcome(NO_OUTCOME);
    setRecipientName("");
    setRecipientContact("");
    setNotes("");
    setNextFollowUpDate("");
  };

  const closeAndReset = () => {
    reset();
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
    setSelected(checked ? new Set(candidates.map((c) => c.caseId)) : new Set());
  };

  const requiresContext = dispositionRequiresContext(outcome as TouchOutcome);
  const contextMissing = requiresContext && !notes.trim();
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const canSave = selectedIds.length > 0 && !contextMissing && !bulkM.isPending;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      const result = await bulkM.mutateAsync({
        caseIds: selectedIds,
        input: {
          touchDate: today,
          touchType,
          outcome: outcome === NO_OUTCOME ? null : (outcome as TouchOutcome),
          recipientName: recipientName.trim() ? recipientName.trim() : null,
          recipientContact: recipientContact.trim() ? recipientContact.trim() : null,
          notes: notes.trim() ? notes.trim() : null,
          nextFollowUpDate: nextFollowUpDate || null,
        },
      });
      toast.success(
        `Logged ${TOUCH_TYPE_LABELS[touchType]} touch across ${result.caseIds.length} case${
          result.caseIds.length === 1 ? "" : "s"
        }`,
      );
      onLogged(result.caseIds);
      closeAndReset();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeAndReset()}>
      <DialogContent className="max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log touch on multiple cases</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Type
            </Label>
            <Select value={touchType} onValueChange={(v) => setTouchType(v as TouchType)}>
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CANONICAL_TOUCH_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TOUCH_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Outcome <span className="normal-case text-muted-foreground/70">(optional)</span>
            </Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_OUTCOME}>— No outcome —</SelectItem>
                {TOUCH_DISPOSITIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Recipient
            </Label>
            <Input
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Who you contacted"
              className="h-8 text-[13px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Recipient contact
            </Label>
            <Input
              value={recipientContact}
              onChange={(e) => setRecipientContact(e.target.value)}
              placeholder="Phone, email, portal…"
              className="h-8 text-[13px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Follow-up
            </Label>
            <Input
              type="date"
              value={nextFollowUpDate}
              onChange={(e) => setNextFollowUpDate(e.target.value)}
              className="h-8 text-[13px]"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {outcome === OTHER_DISPOSITION ? "Context (required for Other)" : "Context"}
          </Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Applied to every selected case…"
            className="min-h-[56px] text-[13px] resize-none"
          />
          {contextMissing ? (
            <p className="text-[11px] text-[#B91C1C]">
              A one-line context is required for “Other”.
            </p>
          ) : null}
        </div>

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
            <div className="border border-border rounded-md divide-y divide-border max-h-[240px] overflow-y-auto">
              {candidates.map((c) => (
                <label
                  key={c.caseId}
                  className="flex items-center gap-2 p-2 cursor-pointer hover:bg-muted/30"
                >
                  <Checkbox
                    checked={selected.has(c.caseId)}
                    onCheckedChange={(v) => toggle(c.caseId, Boolean(v))}
                  />
                  <span className="text-[13px] text-foreground">{c.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={closeAndReset} disabled={bulkM.isPending}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] hover:bg-[#1B4D3E]/90 text-white"
            onClick={handleSave}
            disabled={!canSave}
          >
            {bulkM.isPending ? "Saving…" : `Log touch${selected.size ? ` (${selected.size})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
