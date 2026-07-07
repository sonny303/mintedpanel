// Create-organization modal — the intake entry for an existing signed-in user
// making an ADDITIONAL org (reached from Admin → Settings → Organization).
// Self-serve: not gated on any role. On success the hook switches the active
// org to the new one and navigates Home, so we just close.
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateOrganization } from "@/hooks/useOrganizations";

export function CreateOrganizationModal({ onClose }: { onClose: () => void }) {
  const createOrg = useCreateOrganization();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Organization name is required");
      return;
    }
    setError(null);
    createOrg.mutate(trimmed, {
      onSuccess: () => {
        toast.success("Organization created");
        onClose();
      },
      onError: (e) => {
        const msg = e instanceof Error ? e.message : "Couldn't create organization";
        setError(msg);
        toast.error(msg);
      },
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-[12px] text-[#6B7280]">
            You'll be added as an admin of the new organization and switched to it.
          </p>
          <div>
            <Label className="text-[12px]">Name</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
              className="h-9"
            />
          </div>
          {error ? (
            <div className="text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={createOrg.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={createOrg.isPending || !name.trim()}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {createOrg.isPending ? "Creating…" : "Create organization"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
