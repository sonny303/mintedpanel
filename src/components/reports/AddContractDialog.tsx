// Dialog for creating a new contract for a group + payer + state pair.
// Used from the Contracts tab of the Reports page. E6.0 retired the
// contracting status machine as user-facing — a contract records the
// relationship + dates/notes; no status is picked here.
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StateSelect } from "@/components/StateSelect";
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
import { useCreateContract } from "@/hooks/useContracts";
import { usePayers } from "@/hooks/useAdmin";
import { useProviderGroups } from "@/hooks/useLookups";

export function AddContractDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createM = useCreateContract();
  const groupsQ = useProviderGroups();
  const payersQ = usePayers();

  const [groupId, setGroupId] = useState<string>("");
  const [payerId, setPayerId] = useState<string>("");
  const [state, setState] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  function handleOpenChange(next: boolean) {
    if (!next) {
      setGroupId("");
      setPayerId("");
      setState("");
      setNotes("");
      onClose();
    }
  }

  async function handleSubmit() {
    if (!groupId || !payerId || !state.trim()) {
      toast.error("Group, payer, and state are required.");
      return;
    }
    try {
      await createM.mutateAsync({
        groupId,
        payerId,
        state: state.trim().toUpperCase(),
        notes: notes.trim() || null,
      });
      toast.success("Contract created.");
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create contract.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add contract</DialogTitle>
          <DialogDescription>One contract per group + payer + state.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Group <span className="text-[#DC2626]">*</span>
            </Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger>
                <SelectValue placeholder="Select group" />
              </SelectTrigger>
              <SelectContent>
                {(groupsQ.data ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>
              Payer <span className="text-[#DC2626]">*</span>
            </Label>
            <Select value={payerId} onValueChange={setPayerId}>
              <SelectTrigger>
                <SelectValue placeholder="Select payer" />
              </SelectTrigger>
              <SelectContent>
                {(payersQ.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>
              State <span className="text-[#DC2626]">*</span>
            </Label>
            <StateSelect value={state} onChange={setState} allowNone={false} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
            disabled={createM.isPending}
            onClick={handleSubmit}
          >
            {createM.isPending ? "Saving…" : "Add contract"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
