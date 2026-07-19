// E6.2 F6.2.1 — group facts on the hub: legal name, TIN (shown XX-XXXXXXX),
// operating states. Inline-editable by admins through the audited
// updateProviderGroup path (the same write the wizard form uses); everyone
// else reads. Address/contact blocks stay in the wizard's full group form —
// the hub edits only the three facts the epic names.
import { useState } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatesMultiSelect } from "@/components/onboarding/StatesMultiSelect";
import { useUpdateProviderGroup } from "@/hooks/useOrgSettings";
import { formatTin, isValidTin, normalizeTin } from "@/lib/providerGroup";
import { useIsAdmin } from "@/lib/permissions";
import type { ProviderGroup } from "@/types";

export function GroupFactsCard({ group }: { group: ProviderGroup }) {
  const isAdmin = useIsAdmin();
  const [editing, setEditing] = useState(false);

  const facts = [
    { label: "Legal name", value: group.name },
    { label: "TIN", value: group.tin ? formatTin(group.tin) : "—" },
    {
      label: "Operating states",
      value: (group.states ?? []).length > 0 ? (group.states ?? []).join(", ") : "—",
    },
  ];

  return (
    <Card className="border-[#E8E5E0]">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-foreground">Group facts</h2>
          {isAdmin ? (
            <Button variant="outline" size="sm" className="h-8" onClick={() => setEditing(true)}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              Edit
            </Button>
          ) : null}
        </div>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="text-[11.5px] uppercase tracking-wide text-muted-foreground">
                {f.label}
              </dt>
              <dd className="mt-0.5 text-[13.5px] text-foreground">{f.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
      {editing ? <GroupFactsDialog group={group} onClose={() => setEditing(false)} /> : null}
    </Card>
  );
}

function GroupFactsDialog({ group, onClose }: { group: ProviderGroup; onClose: () => void }) {
  const [name, setName] = useState(group.name);
  const [tin, setTin] = useState(group.tin ? formatTin(group.tin) : "");
  const [states, setStates] = useState<string[]>(group.states ?? []);
  const [errors, setErrors] = useState<{ name?: string; tin?: string; states?: string }>({});
  const updateMut = useUpdateProviderGroup(group.id);

  const handleSave = () => {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Legal name is required";
    if (!isValidTin(tin)) next.tin = "TIN must be 9 digits (shown XX-XXXXXXX)";
    if (states.length === 0) next.states = "Select at least one operating state";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    updateMut.mutate(
      { name: name.trim(), tin: normalizeTin(tin), states },
      {
        onSuccess: () => {
          toast.success("Group facts updated");
          onClose();
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Couldn't update the group"),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>Edit group facts</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="group-facts-name" className="text-[12px]">
              Legal name
            </Label>
            <Input
              id="group-facts-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9"
            />
            {errors.name ? (
              <p className="mt-1 text-[12px] text-[#B91C1C]">{errors.name}</p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="group-facts-tin" className="text-[12px]">
              TIN
            </Label>
            <Input
              id="group-facts-tin"
              value={tin}
              onChange={(e) => setTin(e.target.value)}
              placeholder="XX-XXXXXXX"
              className="h-9"
            />
            {errors.tin ? <p className="mt-1 text-[12px] text-[#B91C1C]">{errors.tin}</p> : null}
          </div>
          <div>
            <Label className="text-[12px]">Operating states</Label>
            <StatesMultiSelect value={states} onChange={setStates} />
            {errors.states ? (
              <p className="mt-1 text-[12px] text-[#B91C1C]">{errors.states}</p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateMut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateMut.isPending}
            className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
          >
            {updateMut.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
