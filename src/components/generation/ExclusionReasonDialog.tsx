// E2.0 F2.0.2 — unchecking a preview row prompts for a reason and records a
// PERSISTENT exclusion (decided once, not re-litigated every run). Reason is
// required; "other" additionally requires the note (the DB CHECK mirrors
// this). Cancel leaves the row checked — nothing is written.
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import { useCreateCaseGenerationExclusion } from "@/hooks/useGenerationPreview";
import { EXCLUSION_REASON_LABELS, type GenerationPreviewRow } from "@/lib/generationPreview";
import type { CaseGenerationExclusionReason } from "@/types";

const REASONS = Object.keys(EXCLUSION_REASON_LABELS) as CaseGenerationExclusionReason[];

interface ExclusionReasonDialogProps {
  row: GenerationPreviewRow;
  onClose: () => void;
}

export function ExclusionReasonDialog({ row, onClose }: ExclusionReasonDialogProps) {
  const [reason, setReason] = useState<CaseGenerationExclusionReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useCreateCaseGenerationExclusion();

  const submit = () => {
    if (!reason) {
      setError("Pick a reason — exclusions are decided once and persist across runs.");
      return;
    }
    if (reason === "other" && note.trim() === "") {
      setError("A note is required when the reason is Other.");
      return;
    }
    create.mutate(
      {
        providerId: row.providerId,
        groupId: row.groupId,
        payerId: row.payerId,
        state: row.state,
        reason,
        note: note.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success("Excluded from generation. Restore it any time from the excluded list.");
          onClose();
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Could not save the exclusion."),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Exclude from generation</DialogTitle>
          <DialogDescription>
            {row.providerName} — {row.payerName} in {row.state} under {row.groupName}. This
            combination won&apos;t be proposed on future runs until you restore it. Existing cases
            are never touched.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="exclusion-reason">Reason</Label>
            <Select
              value={reason}
              onValueChange={(v) => {
                setReason(v as CaseGenerationExclusionReason);
                setError(null);
              }}
            >
              <SelectTrigger id="exclusion-reason" aria-label="Exclusion reason">
                <SelectValue placeholder="Pick a reason" />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {EXCLUSION_REASON_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exclusion-note">
              Note{reason === "other" ? " (required)" : " (optional)"}
            </Label>
            <Textarea
              id="exclusion-note"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setError(null);
              }}
              rows={3}
            />
          </div>
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-2 text-[13px] text-[#B91C1C]"
            >
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] hover:bg-[#163F33]"
            onClick={submit}
            disabled={create.isPending}
          >
            {create.isPending ? "Excluding…" : "Exclude"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
