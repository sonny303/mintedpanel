// Settings → Organization: entry point for an existing user to spin up an
// ADDITIONAL organization. Opens the shared create-organization modal. Any
// authenticated user may create an org (they become its admin) — not gated on
// being an admin of the current org.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CreateOrganizationModal } from "@/components/org/CreateOrganizationModal";

export function CreateOrgPanel() {
  const [open, setOpen] = useState(false);
  return (
    <section className="border border-[#E8E5E0] rounded-md bg-white p-4">
      <h2 className="text-[15px] font-semibold mb-1">Create a new organization</h2>
      <p className="text-[12px] text-[#6B7280] mb-3">
        Start a separate organization. You'll be added as its admin and switched to it.
      </p>
      <Button
        onClick={() => setOpen(true)}
        className="bg-[#1B4D3E] hover:bg-[#163F33] text-white h-9"
      >
        Create organization
      </Button>
      {open ? <CreateOrganizationModal onClose={() => setOpen(false)} /> : null}
    </section>
  );
}
