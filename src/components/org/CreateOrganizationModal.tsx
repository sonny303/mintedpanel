// Create-organization modal — the intake entry for an existing signed-in user
// making an ADDITIONAL org (reached from Admin → Settings → Organization and the
// Portfolio empty state). Self-serve: not gated on any role. Owner name + email
// are required (E0.1 F0.1.2); the shared useOrgCreateForm validates and the RPC
// enforces. On success the hook switches the active org to the new one and lands
// inside its workspace, so we just close.
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOrgCreateForm } from "@/hooks/useOrgCreateForm";
import { OrgCreateFields } from "@/components/org/OrgCreateFields";

export function CreateOrganizationModal({ onClose }: { onClose: () => void }) {
  const form = useOrgCreateForm({ onCreated: onClose });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-[12px] text-[#6B7280]">
            You'll be added as an admin of the new organization and switched to it.
          </p>
          <OrgCreateFields form={form} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={form.isPending}>
            Cancel
          </Button>
          <Button
            onClick={form.submit}
            disabled={form.isPending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {form.isPending ? "Creating…" : "Create organization"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
