// Provider-groups table + edit dialog for Settings → Organization.
import { useState } from "react";
import { Plus, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TableSkeletonRows } from "@/components/TableSkeletonRows";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/StatusPill";
import { useProviderGroups } from "@/hooks/useLookups";
import { useCreateProviderGroup, useUpdateProviderGroup } from "@/hooks/useOrgSettings";
import { useIsAdmin } from "@/lib/permissions";
import type { ProviderGroupInput } from "@/services/orgSettings";
import type { ProviderGroup } from "@/types";
import { US_STATES } from "./shared";

export function GroupsPanel() {
  const canEdit = useIsAdmin();
  const groupsQ = useProviderGroups();
  const [modal, setModal] = useState<{ group: ProviderGroup | null } | null>(null);

  return (
    <section className="border border-[#E8E5E0] rounded-md bg-white">
      <div className="flex items-center justify-between p-4 border-b border-[#E8E5E0]">
        <h2 className="text-[15px] font-semibold">Provider groups</h2>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => setModal({ group: null })}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-8"
          >
            <Plus className="w-4 h-4 mr-1" /> Add group
          </Button>
        )}
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0]">
            {["Name", "TIN", "Group NPI", "States", "Active", ""].map((h, i) => (
              <th
                key={i}
                className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groupsQ.isLoading ? (
            <TableSkeletonRows rows={6} cols={6} />
          ) : groupsQ.isError ? (
            <tr>
              <td colSpan={6} className="px-3 py-12 text-center">
                <EmptyState
                  message="Failed to load provider groups"
                  action={
                    <Button variant="outline" size="sm" onClick={() => groupsQ.refetch()}>
                      Retry
                    </Button>
                  }
                />
              </td>
            </tr>
          ) : (groupsQ.data ?? []).length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-12">
                <EmptyState message="No provider groups yet" />
              </td>
            </tr>
          ) : (
            (groupsQ.data ?? []).map((g) => (
              <tr
                key={g.id}
                className="border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#FAFAF9]"
              >
                <td className="px-3 h-10 align-middle font-medium">{g.name}</td>
                <td className="px-3 h-10 align-middle text-muted-foreground">{g.tin ?? "—"}</td>
                <td className="px-3 h-10 align-middle text-muted-foreground">
                  {g.npiType2 ?? "—"}
                </td>
                <td className="px-3 h-10 align-middle text-muted-foreground">
                  {g.states && g.states.length > 0 ? g.states.join(", ") : "—"}
                </td>
                <td className="px-3 h-10 align-middle">
                  {g.isActive ? (
                    <StatusPill status="green" label="Active" />
                  ) : (
                    <StatusPill status="neutral" label="Inactive" />
                  )}
                </td>
                <td className="px-3 h-10 align-middle text-right">
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px] px-2"
                      onClick={() => setModal({ group: g })}
                    >
                      Edit
                    </Button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {modal ? <GroupEditModal group={modal.group} onClose={() => setModal(null)} /> : null}
    </section>
  );
}

function GroupEditModal({ group, onClose }: { group: ProviderGroup | null; onClose: () => void }) {
  const g = (group ?? {}) as Record<string, unknown>;
  const initStr = (k: string) => (typeof g[k] === "string" ? (g[k] as string) : "");
  const [name, setName] = useState(group?.name ?? "");
  const [tin, setTin] = useState(group?.tin ?? "");
  const [npi, setNpi] = useState(group?.npiType2 ?? "");
  const [states, setStates] = useState<string>(group?.states?.join(", ") ?? "");
  const [active, setActive] = useState<boolean>(group?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  const [billStreet, setBillStreet] = useState(initStr("billingStreet"));
  const [billCity, setBillCity] = useState(initStr("billingCity"));
  const [billState, setBillState] = useState(initStr("billingState"));
  const [billZip, setBillZip] = useState(initStr("billingZip"));

  const [corrStreet, setCorrStreet] = useState(initStr("correspondenceStreet"));
  const [corrCity, setCorrCity] = useState(initStr("correspondenceCity"));
  const [corrState, setCorrState] = useState(initStr("correspondenceState"));
  const [corrZip, setCorrZip] = useState(initStr("correspondenceZip"));

  const initialSame =
    Boolean(group) &&
    (initStr("correspondenceStreet") !== "" || initStr("correspondenceCity") !== "") &&
    initStr("correspondenceStreet") === initStr("billingStreet") &&
    initStr("correspondenceCity") === initStr("billingCity") &&
    initStr("correspondenceState") === initStr("billingState") &&
    initStr("correspondenceZip") === initStr("billingZip");
  const [sameAsBilling, setSameAsBilling] = useState<boolean>(initialSame);

  const [billingOpen, setBillingOpen] = useState(false);
  const [corrOpen, setCorrOpen] = useState(false);

  const onToggleSame = (v: boolean) => {
    setSameAsBilling(v);
    if (v) {
      setCorrStreet(billStreet);
      setCorrCity(billCity);
      setCorrState(billState);
      setCorrZip(billZip);
    }
  };

  const createMut = useCreateProviderGroup();
  const updateMut = useUpdateProviderGroup(group?.id ?? "");
  const pending = createMut.isPending || updateMut.isPending;

  const handleSave = () => {
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    const stateArr = states
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const cs = sameAsBilling ? billStreet : corrStreet;
    const cc = sameAsBilling ? billCity : corrCity;
    const cst = sameAsBilling ? billState : corrState;
    const cz = sameAsBilling ? billZip : corrZip;
    const input: ProviderGroupInput = {
      name: name.trim(),
      tin: tin.trim() || null,
      npiType2: npi.trim() || null,
      states: stateArr.length > 0 ? stateArr : null,
      isActive: active,
      billingStreet: billStreet.trim() || null,
      billingCity: billCity.trim() || null,
      billingState: billState || null,
      billingZip: billZip.trim() || null,
      correspondenceStreet: cs.trim() || null,
      correspondenceCity: cc.trim() || null,
      correspondenceState: cst || null,
      correspondenceZip: cz.trim() || null,
    };
    const onErr = (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      toast.error(msg);
    };
    if (group) {
      updateMut.mutate(input, {
        onSuccess: () => {
          toast.success("Group updated");
          onClose();
        },
        onError: onErr,
      });
    } else {
      createMut.mutate(input, {
        onSuccess: () => {
          toast.success("Group created");
          onClose();
        },
        onError: onErr,
      });
    }
  };

  const renderStateSelect = (value: string, onChange: (v: string) => void, disabled = false) => (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-9 rounded-[4px]">
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {US_STATES.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const sectionTriggerCls =
    "flex w-full items-center justify-between border border-[#E8E5E0] rounded-md px-3 py-2 text-[13px] font-medium hover:bg-[#FAFAF9] [&[data-state=open]>svg]:rotate-180";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border-[#E8E5E0] shadow-none max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{group ? "Edit provider group" : "Add provider group"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-[12px] uppercase tracking-wider">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 rounded-[4px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[12px] uppercase tracking-wider">TIN</Label>
              <Input
                value={tin}
                onChange={(e) => setTin(e.target.value)}
                className="h-9 rounded-[4px]"
              />
            </div>
            <div>
              <Label className="text-[12px] uppercase tracking-wider">Group NPI</Label>
              <Input
                value={npi}
                onChange={(e) => setNpi(e.target.value)}
                className="h-9 rounded-[4px]"
              />
            </div>
          </div>
          <div>
            <Label className="text-[12px] uppercase tracking-wider">States (comma separated)</Label>
            <Input
              value={states}
              onChange={(e) => setStates(e.target.value)}
              placeholder="TX, CA, NY"
              className="h-9 rounded-[4px]"
            />
          </div>

          <Collapsible open={billingOpen} onOpenChange={setBillingOpen}>
            <CollapsibleTrigger className={sectionTriggerCls}>
              <span>Billing address</span>
              <ChevronDown className="h-4 w-4 text-[#6B7280] transition-transform" />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-3">
              <p className="text-[12px] text-[#6B7280]">Where payers send checks and EOBs.</p>
              <div>
                <Label className="text-[12px] uppercase tracking-wider">Street</Label>
                <Input
                  value={billStreet}
                  onChange={(e) => setBillStreet(e.target.value)}
                  className="h-9 rounded-[4px]"
                />
              </div>
              <div className="grid grid-cols-[1fr_120px_120px] gap-3">
                <div>
                  <Label className="text-[12px] uppercase tracking-wider">City</Label>
                  <Input
                    value={billCity}
                    onChange={(e) => setBillCity(e.target.value)}
                    className="h-9 rounded-[4px]"
                  />
                </div>
                <div>
                  <Label className="text-[12px] uppercase tracking-wider">State</Label>
                  {renderStateSelect(billState, setBillState)}
                </div>
                <div>
                  <Label className="text-[12px] uppercase tracking-wider">Zip</Label>
                  <Input
                    value={billZip}
                    onChange={(e) => setBillZip(e.target.value)}
                    className="h-9 rounded-[4px]"
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={corrOpen} onOpenChange={setCorrOpen}>
            <CollapsibleTrigger className={sectionTriggerCls}>
              <span>Correspondence address</span>
              <ChevronDown className="h-4 w-4 text-[#6B7280] transition-transform" />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-3">
              <p className="text-[12px] text-[#6B7280]">Where payers send credentialing mail.</p>
              <label className="flex items-center gap-2 text-[13px]">
                <Checkbox
                  checked={sameAsBilling}
                  onCheckedChange={(v) => onToggleSame(v === true)}
                />
                <span>Same as billing address</span>
              </label>
              <div>
                <Label className="text-[12px] uppercase tracking-wider">Street</Label>
                <Input
                  value={sameAsBilling ? billStreet : corrStreet}
                  onChange={(e) => setCorrStreet(e.target.value)}
                  disabled={sameAsBilling}
                  className="h-9 rounded-[4px]"
                />
              </div>
              <div className="grid grid-cols-[1fr_120px_120px] gap-3">
                <div>
                  <Label className="text-[12px] uppercase tracking-wider">City</Label>
                  <Input
                    value={sameAsBilling ? billCity : corrCity}
                    onChange={(e) => setCorrCity(e.target.value)}
                    disabled={sameAsBilling}
                    className="h-9 rounded-[4px]"
                  />
                </div>
                <div>
                  <Label className="text-[12px] uppercase tracking-wider">State</Label>
                  {renderStateSelect(
                    sameAsBilling ? billState : corrState,
                    setCorrState,
                    sameAsBilling,
                  )}
                </div>
                <div>
                  <Label className="text-[12px] uppercase tracking-wider">Zip</Label>
                  <Input
                    value={sameAsBilling ? billZip : corrZip}
                    onChange={(e) => setCorrZip(e.target.value)}
                    disabled={sameAsBilling}
                    className="h-9 rounded-[4px]"
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex items-center justify-between border border-[#E8E5E0] rounded-md px-3 py-2">
            <div className="text-[13px] font-medium">Active</div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
          {error ? (
            <div className="text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={pending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {pending ? "Saving…" : group ? "Save changes" : "Create group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
