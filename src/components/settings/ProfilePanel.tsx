// Your-name section of the Settings → Profile tab. User-level (any role edits
// their own): writes auth user_metadata.full_name, which the server resolves
// as the {{user.name}} preparer token on payer forms.
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/lib/auth-store";
import { useUpdateDisplayName } from "@/hooks/useUserProfile";

function metadataFullName(metadata: Record<string, unknown> | undefined): string {
  const value = metadata?.full_name;
  return typeof value === "string" ? value : "";
}

export function ProfilePanel() {
  const savedName = useAuthStore((s) => metadataFullName(s.user?.user_metadata));

  const [name, setName] = useState<string>("");
  const [nameDirty, setNameDirty] = useState(false);
  const [nameErr, setNameErr] = useState<string | null>(null);

  const currentName = nameDirty ? name : savedName;

  const saveName = useUpdateDisplayName();

  const handleSaveName = () => {
    setNameErr(null);
    saveName.mutate(currentName, {
      onSuccess: () => {
        setNameDirty(false);
        toast.success("Name updated");
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
      <h2 className="text-[15px] font-semibold mb-3">Profile</h2>
      <div className="flex items-end gap-3 max-w-xl">
        <div className="flex-1">
          <Label className="text-[12px]">Your name</Label>
          <Input
            value={currentName}
            onChange={(e) => {
              setName(e.target.value);
              setNameDirty(true);
            }}
            className="h-9"
          />
        </div>
        <Button
          disabled={!nameDirty || saveName.isPending || !currentName.trim()}
          onClick={handleSaveName}
          className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9"
        >
          {saveName.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="mt-1.5 text-[12px] text-[#6B7280]">
        This name appears as the preparer on payer forms filled by the extension.
      </p>
      {nameErr ? <div className="mt-2 text-[12px] text-[#B91C1C]">{nameErr}</div> : null}
    </section>
  );
}
