// Provider Group form dialog (E1.1 F1.1.1). Captures the legal billing
// entity over the EXISTING provider_groups columns
// — legal name, TIN (required, 9 digits, shown XX-XXXXXXX, stored bare), Type 2
// NPI (10 digits), operating states (multi-select, ≥1), website URL (optional;
// fill token group.websiteUrl), and the three purpose-keyed address + contact
// blocks. This form is the group's HIGH-LEVEL METADATA only:
// malpractice coverage moved out to the group's own InsurancePanel (2026-07-29)
// because a group carries a primary policy AND any number of secondaries,
// which one set of fields here cannot hold. Billing is required; correspondence and
// credentialing carry a "Same as billing" quick-fill (live-mirror, the
// GroupsPanel pattern). Saves through the EXISTING orgSettings service path
// via useCreateProviderGroup/useUpdateProviderGroup — org_id and audit are
// the service's job. Validation is format-level only (v1; registry checks
// deferred to R5) via the pure src/lib/providerGroup helpers.
import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatesMultiSelect } from "@/components/onboarding/StatesMultiSelect";
import { useCreateProviderGroup, useUpdateProviderGroup } from "@/hooks/useOrgSettings";
import {
  EMPTY_GROUP_FORM,
  formatTin,
  formValueToInput,
  groupFormErrors,
  groupToFormValue,
  hasGroupFormErrors,
  normalizeWebsiteUrl,
  type GroupContactBlock,
  type GroupFormErrors,
  type GroupFormValue,
} from "@/lib/providerGroup";
import { US_STATES } from "@/lib/usStates";
import type { ProviderGroup } from "@/types";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-[12px] text-[#B91C1C]">{message}</p>;
}

// One address + contact block. `mirror` renders the block locked to the
// billing values (the "Same as billing" quick-fill).
function BlockFields({
  idPrefix,
  value,
  onChange,
  mirror,
  errors,
}: {
  idPrefix: string;
  value: GroupContactBlock;
  onChange: (next: GroupContactBlock) => void;
  mirror?: GroupContactBlock | null;
  errors?: Pick<GroupFormErrors, "billingStreet" | "billingCity" | "billingState" | "billingZip">;
}) {
  const v = mirror ?? value;
  const disabled = Boolean(mirror);
  const set = (patch: Partial<GroupContactBlock>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={`${idPrefix}-street`} className="text-[12px]">
          Street
        </Label>
        <Input
          id={`${idPrefix}-street`}
          value={v.street}
          disabled={disabled}
          onChange={(e) => set({ street: e.target.value })}
          className="h-9"
        />
        <FieldError message={errors?.billingStreet} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${idPrefix}-suite`} className="text-[12px]">
            Suite
          </Label>
          <Input
            id={`${idPrefix}-suite`}
            value={v.suite}
            disabled={disabled}
            onChange={(e) => set({ suite: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-city`} className="text-[12px]">
            City
          </Label>
          <Input
            id={`${idPrefix}-city`}
            value={v.city}
            disabled={disabled}
            onChange={(e) => set({ city: e.target.value })}
            className="h-9"
          />
          <FieldError message={errors?.billingCity} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${idPrefix}-state`} className="text-[12px]">
            State
          </Label>
          <Select
            value={v.state || "__none__"}
            disabled={disabled}
            onValueChange={(s) => set({ state: s === "__none__" ? "" : s })}
          >
            <SelectTrigger id={`${idPrefix}-state`} className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">—</SelectItem>
              {US_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError message={errors?.billingState} />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-zip`} className="text-[12px]">
            ZIP
          </Label>
          <Input
            id={`${idPrefix}-zip`}
            value={v.zip}
            disabled={disabled}
            onChange={(e) => set({ zip: e.target.value })}
            className="h-9"
          />
          <FieldError message={errors?.billingZip} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${idPrefix}-contact`} className="text-[12px]">
            Contact name
          </Label>
          <Input
            id={`${idPrefix}-contact`}
            value={v.contactName}
            disabled={disabled}
            onChange={(e) => set({ contactName: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-phone`} className="text-[12px]">
            Phone
          </Label>
          <Input
            id={`${idPrefix}-phone`}
            value={v.phone}
            disabled={disabled}
            onChange={(e) => set({ phone: e.target.value })}
            className="h-9"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${idPrefix}-fax`} className="text-[12px]">
            Fax
          </Label>
          <Input
            id={`${idPrefix}-fax`}
            value={v.fax}
            disabled={disabled}
            onChange={(e) => set({ fax: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-email`} className="text-[12px]">
            Email
          </Label>
          <Input
            id={`${idPrefix}-email`}
            value={v.email}
            disabled={disabled}
            onChange={(e) => set({ email: e.target.value })}
            className="h-9"
          />
        </div>
      </div>
    </div>
  );
}

export function ProviderGroupForm({
  group,
  onClose,
  onSaved,
}: {
  /** null = create; a row = edit (mount-when-editing pattern). */
  group: ProviderGroup | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [value, setValue] = useState<GroupFormValue>(
    group ? groupToFormValue(group) : EMPTY_GROUP_FORM,
  );
  const [sameCorr, setSameCorr] = useState(false);
  const [sameCred, setSameCred] = useState(false);
  const [errors, setErrors] = useState<GroupFormErrors>({});

  const createMut = useCreateProviderGroup();
  const updateMut = useUpdateProviderGroup(group?.id ?? "");
  const pending = createMut.isPending || updateMut.isPending;

  const set = (patch: Partial<GroupFormValue>) => setValue((v) => ({ ...v, ...patch }));

  const handleSave = async () => {
    const resolved: GroupFormValue = {
      ...value,
      correspondence: sameCorr ? value.billing : value.correspondence,
      credentialing: sameCred ? value.billing : value.credentialing,
    };
    const errs = groupFormErrors(resolved);
    setErrors(errs);
    if (hasGroupFormErrors(errs)) return;
    const input = formValueToInput(resolved);
    try {
      if (group) {
        await updateMut.mutateAsync(input);
      } else {
        await createMut.mutateAsync(input);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the provider group");
      return;
    }
    toast.success(group ? "Provider group updated" : "Provider group saved");
    onSaved?.();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>{group ? "Edit provider group" : "Add provider group"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="group-name" className="text-[12px]">
              Legal name
            </Label>
            <Input
              id="group-name"
              value={value.name}
              onChange={(e) => set({ name: e.target.value })}
              className="h-9"
            />
            <FieldError message={errors.name} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="group-tin" className="text-[12px]">
                TIN
              </Label>
              <Input
                id="group-tin"
                value={value.tin}
                onChange={(e) => set({ tin: e.target.value })}
                onBlur={() => set({ tin: formatTin(value.tin) })}
                inputMode="numeric"
                className="h-9"
              />
              <FieldError message={errors.tin} />
            </div>
            <div>
              <Label htmlFor="group-npi" className="text-[12px]">
                Type 2 NPI
              </Label>
              <Input
                id="group-npi"
                value={value.npiType2}
                onChange={(e) => set({ npiType2: e.target.value })}
                inputMode="numeric"
                className="h-9"
              />
              <FieldError message={errors.npiType2} />
            </div>
          </div>
          <div>
            <Label htmlFor="group-states" className="text-[12px]">
              Operating states
            </Label>
            <StatesMultiSelect
              id="group-states"
              value={value.states}
              onChange={(states) => set({ states })}
              invalid={Boolean(errors.states)}
            />
            <FieldError message={errors.states} />
          </div>
          <div>
            <Label htmlFor="group-website" className="text-[12px]">
              Website URL
            </Label>
            <Input
              id="group-website"
              type="text"
              inputMode="url"
              autoComplete="url"
              value={value.websiteUrl}
              onChange={(e) => set({ websiteUrl: e.target.value })}
              onBlur={(e) => {
                const next = e.currentTarget.value.trim();
                set({ websiteUrl: next ? normalizeWebsiteUrl(next) : "" });
              }}
              className="h-9"
            />
            <FieldError message={errors.websiteUrl} />
          </div>

          <div className="space-y-3 rounded-md border border-[#E8E5E0] p-3">
            <h3 className="text-[13px] font-semibold text-foreground">Billing address & contact</h3>
            <BlockFields
              idPrefix="billing"
              value={value.billing}
              onChange={(billing) => set({ billing })}
              errors={errors}
            />
          </div>

          <div className="space-y-3 rounded-md border border-[#E8E5E0] p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[13px] font-semibold text-foreground">
                Correspondence address & contact
              </h3>
              <label className="flex items-center gap-2 text-[12.5px]">
                <Checkbox
                  checked={sameCorr}
                  onCheckedChange={(v) => setSameCorr(v === true)}
                  aria-label="Correspondence same as billing"
                />
                <span>Same as billing</span>
              </label>
            </div>
            <BlockFields
              idPrefix="corr"
              value={value.correspondence}
              onChange={(correspondence) => set({ correspondence })}
              mirror={sameCorr ? value.billing : null}
            />
          </div>

          <div className="space-y-3 rounded-md border border-[#E8E5E0] p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[13px] font-semibold text-foreground">
                Credentialing address & contact
              </h3>
              <label className="flex items-center gap-2 text-[12.5px]">
                <Checkbox
                  checked={sameCred}
                  onCheckedChange={(v) => setSameCred(v === true)}
                  aria-label="Credentialing same as billing"
                />
                <span>Same as billing</span>
              </label>
            </div>
            <BlockFields
              idPrefix="cred"
              value={value.credentialing}
              onChange={(credentialing) => set({ credentialing })}
              mirror={sameCred ? value.billing : null}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={pending}
            className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
          >
            {pending ? "Saving…" : group ? "Save changes" : "Save provider group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
