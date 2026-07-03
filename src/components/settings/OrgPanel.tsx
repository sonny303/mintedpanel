// Organization-name section of the Settings → Organization tab.
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOrganization, useUpdateOrganizationName } from "@/hooks/useOrgSettings";
import { useIsAdmin } from "@/lib/permissions";

export function OrgPanel() {
  const canEdit = useIsAdmin();
  const orgQ = useOrganization();

  const [name, setName] = useState<string>("");
  const [nameDirty, setNameDirty] = useState(false);
  const [nameErr, setNameErr] = useState<string | null>(null);

  const orgName = orgQ.data?.name ?? "";
  const currentName = nameDirty ? name : orgName;

  const saveName = useUpdateOrganizationName();

  const handleSaveName = () => {
    setNameErr(null);
    saveName.mutate(currentName, {
      onSuccess: () => {
        setNameDirty(false);
        toast.success("Organization name updated");
      },
      onError: (e) => {
        const msg = e instanceof Error ? e.message : "Save failed";
        setNameErr(msg);
        toast.error(msg);
      },
    });
  };

  return (
    <section className="border border-[#E8E5E0] rounded-md bg-white p-4">
      <h2 className="text-[15px] font-semibold mb-3">Organization</h2>
      <div className="flex items-end gap-3 max-w-xl">
        <div className="flex-1">
          <Label className="text-[12px]">Name</Label>
          <Input
            value={currentName}
            disabled={!canEdit || orgQ.isLoading}
            onChange={(e) => {
              setName(e.target.value);
              setNameDirty(true);
            }}
            className="h-9"
          />
        </div>
        <Button
          disabled={!canEdit || !nameDirty || saveName.isPending || !currentName.trim()}
          onClick={handleSaveName}
          className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9"
        >
          {saveName.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      {nameErr ? <div className="mt-2 text-[12px] text-[#B91C1C]">{nameErr}</div> : null}
    </section>
  );
}
