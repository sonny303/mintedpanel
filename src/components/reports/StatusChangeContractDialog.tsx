// Dialog for changing a contract's contracting-track status. Enforces
// required_fields for Executed (effective date) and Terminated (reason).
import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateContractStatus } from "@/hooks/useContracts";
import type { Contract, StatusConfig } from "@/types";

function isExecutedLabel(label: string | undefined | null): boolean {
  return (label ?? "").toLowerCase().includes("execut");
}
function isTerminatedLabel(label: string | undefined | null): boolean {
  return (label ?? "").toLowerCase().includes("terminat");
}

export function StatusChangeContractDialog({
  contract,
  statuses,
  onClose,
}: {
  contract: Contract | null;
  statuses: StatusConfig[];
  onClose: () => void;
}) {
  const updateM = useUpdateContractStatus();
  const [statusId, setStatusId] = useState<string>("");
  const [effectiveDate, setEffectiveDate] = useState<string>("");
  const [terminationReason, setTerminationReason] = useState<string>("");

  const open = contract !== null;
  const selected = statuses.find((s) => s.id === statusId) ?? null;
  const requiresEffective = isExecutedLabel(selected?.label);
  const requiresReason = isTerminatedLabel(selected?.label);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setStatusId("");
      setEffectiveDate("");
      setTerminationReason("");
      onClose();
    }
  }

  async function handleSubmit() {
    if (!contract || !statusId) return;
    if (requiresEffective && !effectiveDate) {
      toast.error("Effective date is required.");
      return;
    }
    if (requiresReason && !terminationReason.trim()) {
      toast.error("Termination reason is required.");
      return;
    }
    const metadata: Record<string, unknown> = {};
    if (requiresEffective) metadata.effectiveDate = effectiveDate;
    if (requiresReason) {
      const stamp = format(new Date(), "MMM dd, yyyy");
      const prefix = contract.notes ? `${contract.notes}\n` : "";
      metadata.notes = `${prefix}[${stamp}] Terminated: ${terminationReason.trim()}`;
    }
    try {
      await updateM.mutateAsync({ contractId: contract.id, statusId, metadata });
      toast.success("Contract status updated.");
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update status.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change contract status</DialogTitle>
          <DialogDescription>Writes to status history and audit log.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>New status</Label>
            <Select value={statusId} onValueChange={setStatusId}>
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {requiresEffective && (
            <div className="space-y-1.5">
              <Label>
                Effective date <span className="text-[#DC2626]">*</span>
              </Label>
              <Input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </div>
          )}
          {requiresReason && (
            <div className="space-y-1.5">
              <Label>
                Termination reason <span className="text-[#DC2626]">*</span>
              </Label>
              <Textarea
                value={terminationReason}
                onChange={(e) => setTerminationReason(e.target.value)}
                rows={3}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
            disabled={!statusId || updateM.isPending}
            onClick={handleSubmit}
          >
            {updateM.isPending ? "Saving…" : "Update status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
