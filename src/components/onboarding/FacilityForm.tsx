// Facility form dialog (E1.2 F1.2.1/F1.2.2) — CAQH practice-location dataset
// over the EXISTING facilities columns. Minimum to save (PM 2026-07-10):
// address + state + owning group + at least one reachable contact channel;
// when the facility has no contact of its own, the owning group's default
// contact (locked precedence credentialing → correspondence → billing) is
// shown as INHERITED and the facility's contact columns stay null — never a
// copy. The CAQH extras (accepting new patients, languages, interpreter
// languages, ADA, appointment phone) are optional and never block save.
// Hours ride the locked jsonb contract via src/lib/facilityHours only.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HoursEditor } from "@/components/onboarding/HoursEditor";
import { TagListInput } from "@/components/onboarding/TagListInput";
import { useCreateFacility, useUpdateFacility } from "@/hooks/useOrgSettings";
import {
  decodeHours,
  encodeHours,
  validateHoursDraft,
  type DayKey,
  type HoursDraft,
} from "@/lib/facilityHours";
import { groupDefaultContact, hasReachableContact } from "@/lib/facilityContact";
import { US_STATES } from "@/lib/usStates";
import type { FacilityInput } from "@/services/orgSettings";
import type { Facility, ProviderGroup } from "@/types";

interface FacilityFormErrors {
  name?: string;
  groupId?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  contact?: string;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-[12px] text-[#B91C1C]">{message}</p>;
}

const BLOCK_LABELS = {
  credentialing: "credentialing",
  correspondence: "correspondence",
  billing: "billing",
} as const;

export function FacilityForm({
  facility,
  groups,
  onClose,
}: {
  /** null = create; a row = edit (mount-when-editing pattern). */
  facility: Facility | null;
  /** The org's groups (picker offers active ones). */
  groups: ProviderGroup[];
  onClose: () => void;
}) {
  const [name, setName] = useState(facility?.name ?? "");
  const [groupId, setGroupId] = useState<string>(facility?.groupId ?? "__none__");
  const [street, setStreet] = useState(facility?.street ?? "");
  const [suite, setSuite] = useState(facility?.suite ?? "");
  const [city, setCity] = useState(facility?.city ?? "");
  const [state, setState] = useState<string>(facility?.state ?? "__none__");
  const [zip, setZip] = useState(facility?.zip ?? "");
  const [county, setCounty] = useState(facility?.county ?? "");
  const [phone, setPhone] = useState(facility?.phone ?? "");
  const [fax, setFax] = useState(facility?.fax ?? "");
  const [email, setEmail] = useState(facility?.email ?? "");
  const [appointmentPhone, setAppointmentPhone] = useState(facility?.appointmentPhone ?? "");
  const [contactName, setContactName] = useState(facility?.contactName ?? "");
  const [accepting, setAccepting] = useState<boolean>(facility?.acceptingNewPatients ?? true);
  const [languages, setLanguages] = useState<string[]>(facility?.languagesOffered ?? []);
  const [interpreters, setInterpreters] = useState<string[]>(facility?.interpreterLanguages ?? []);
  const [adaAccessible, setAdaAccessible] = useState<string>(
    facility?.adaCompliance?.accessible === true
      ? "yes"
      : facility?.adaCompliance?.accessible === false
        ? "no"
        : "__none__",
  );
  const [adaNotes, setAdaNotes] = useState(facility?.adaCompliance?.notes ?? "");
  const [hoursDraft, setHoursDraft] = useState<HoursDraft>(decodeHours(facility?.hours));
  const [errors, setErrors] = useState<FacilityFormErrors>({});
  const [hoursErrors, setHoursErrors] = useState<Partial<Record<DayKey, string>>>({});

  const createMut = useCreateFacility();
  const updateMut = useUpdateFacility(facility?.id ?? "");
  const pending = createMut.isPending || updateMut.isPending;

  const activeGroups = groups.filter((g) => g.isActive);
  const selectedGroup = groups.find((g) => g.id === groupId) ?? null;

  // Display-only inheritance (TE-4): resolved at render time, never copied.
  const ownContact = { contactName, phone, fax, email };
  const inheritedDefault = useMemo(() => groupDefaultContact(selectedGroup), [selectedGroup]);
  const ownContactBlank = !contactName.trim() && !phone.trim() && !fax.trim() && !email.trim();

  const handleSave = () => {
    const next: FacilityFormErrors = {};
    if (!name.trim()) next.name = "Name is required";
    if (groupId === "__none__") next.groupId = "Select the owning provider group";
    if (!street.trim()) next.street = "Street is required";
    if (!city.trim()) next.city = "City is required";
    if (state === "__none__") next.state = "State is required";
    if (!zip.trim()) next.zip = "ZIP is required";
    if (!hasReachableContact(ownContact, selectedGroup)) {
      next.contact =
        "Add a contact channel (phone, email, fax, or contact name) — this group has no default contact to inherit.";
    }
    const hErrs = validateHoursDraft(hoursDraft);
    setErrors(next);
    setHoursErrors(hErrs);
    if (Object.keys(next).length > 0 || Object.keys(hErrs).length > 0) return;

    const anyDayOpen = Object.values(hoursDraft).some((d) => d.open);
    const input: FacilityInput = {
      name: name.trim(),
      groupId,
      street: street.trim() || null,
      suite: suite.trim() || null,
      city: city.trim() || null,
      state,
      zip: zip.trim() || null,
      county: county.trim() || null,
      phone: phone.trim() || null,
      fax: fax.trim() || null,
      email: email.trim() || null,
      appointmentPhone: appointmentPhone.trim() || null,
      contactName: contactName.trim() || null,
      acceptingNewPatients: accepting,
      languagesOffered: languages,
      interpreterLanguages: interpreters,
      // Locked contract: encode only through the pure module. All-closed
      // untouched drafts store {} = "not entered yet".
      hours: anyDayOpen ? encodeHours(hoursDraft) : {},
      adaCompliance: {
        ...(adaAccessible === "__none__" ? {} : { accessible: adaAccessible === "yes" }),
        ...(adaNotes.trim() ? { notes: adaNotes.trim() } : {}),
      },
    };
    const onError = (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Couldn't save the facility");
    if (facility) {
      updateMut.mutate(input, {
        onSuccess: () => {
          toast.success("Facility updated");
          onClose();
        },
        onError,
      });
    } else {
      createMut.mutate(input, {
        onSuccess: () => {
          toast.success("Facility saved");
          onClose();
        },
        onError,
      });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>{facility ? "Edit facility" : "Add facility"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="facility-name" className="text-[12px]">
                Facility name
              </Label>
              <Input
                id="facility-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9"
              />
              <FieldError message={errors.name} />
            </div>
            <div>
              <Label htmlFor="facility-group" className="text-[12px]">
                Provider group
              </Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger id="facility-group" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select a group</SelectItem>
                  {activeGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                  {/* An existing link to a soft-deleted group must still render. */}
                  {selectedGroup && !selectedGroup.isActive ? (
                    <SelectItem value={selectedGroup.id}>
                      {selectedGroup.name} (inactive)
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              <FieldError message={errors.groupId} />
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-[#E8E5E0] p-3">
            <h3 className="text-[13px] font-semibold text-foreground">Address</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="facility-street" className="text-[12px]">
                  Street
                </Label>
                <Input
                  id="facility-street"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  className="h-9"
                />
                <FieldError message={errors.street} />
              </div>
              <div>
                <Label htmlFor="facility-suite" className="text-[12px]">
                  Suite
                </Label>
                <Input
                  id="facility-suite"
                  value={suite}
                  onChange={(e) => setSuite(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <Label htmlFor="facility-city" className="text-[12px]">
                  City
                </Label>
                <Input
                  id="facility-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="h-9"
                />
                <FieldError message={errors.city} />
              </div>
              <div>
                <Label htmlFor="facility-state" className="text-[12px]">
                  State
                </Label>
                <Select value={state} onValueChange={setState}>
                  <SelectTrigger id="facility-state" className="h-9">
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
                <FieldError message={errors.state} />
              </div>
              <div>
                <Label htmlFor="facility-zip" className="text-[12px]">
                  ZIP
                </Label>
                <Input
                  id="facility-zip"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  className="h-9"
                />
                <FieldError message={errors.zip} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="facility-county" className="text-[12px]">
                  County
                </Label>
                <Input
                  id="facility-county"
                  value={county}
                  onChange={(e) => setCounty(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-[#E8E5E0] p-3">
            <h3 className="text-[13px] font-semibold text-foreground">Contact</h3>
            {ownContactBlank && inheritedDefault ? (
              <p className="rounded-md bg-muted px-3 py-2 text-[12.5px] text-muted-foreground">
                Inherited from the group&apos;s {BLOCK_LABELS[inheritedDefault.block]} contact:{" "}
                {[inheritedDefault.channel.contactName, inheritedDefault.channel.phone]
                  .filter(Boolean)
                  .join(" · ") || inheritedDefault.channel.email}
                . Enter values below only if this location differs.
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="facility-contact-name" className="text-[12px]">
                  Contact name
                </Label>
                <Input
                  id="facility-contact-name"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="h-9"
                />
              </div>
              <div>
                <Label htmlFor="facility-phone" className="text-[12px]">
                  Phone
                </Label>
                <Input
                  id="facility-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="facility-fax" className="text-[12px]">
                  Fax
                </Label>
                <Input
                  id="facility-fax"
                  value={fax}
                  onChange={(e) => setFax(e.target.value)}
                  className="h-9"
                />
              </div>
              <div>
                <Label htmlFor="facility-email" className="text-[12px]">
                  Email
                </Label>
                <Input
                  id="facility-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-9"
                />
              </div>
              <div>
                <Label htmlFor="facility-appt-phone" className="text-[12px]">
                  Appointment phone
                </Label>
                <Input
                  id="facility-appt-phone"
                  value={appointmentPhone}
                  onChange={(e) => setAppointmentPhone(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
            <FieldError message={errors.contact} />
          </div>

          <div className="space-y-3 rounded-md border border-[#E8E5E0] p-3">
            <h3 className="text-[13px] font-semibold text-foreground">Hours</h3>
            <HoursEditor value={hoursDraft} onChange={setHoursDraft} errors={hoursErrors} />
          </div>

          <div className="space-y-3 rounded-md border border-[#E8E5E0] p-3">
            <h3 className="text-[13px] font-semibold text-foreground">Directory details</h3>
            <div className="flex items-center justify-between rounded-md border border-[#E8E5E0] px-3 py-2">
              <span className="text-[13px] font-medium">Accepting new patients</span>
              <Switch checked={accepting} onCheckedChange={setAccepting} />
            </div>
            <div>
              <Label htmlFor="facility-languages" className="text-[12px]">
                Languages offered
              </Label>
              <TagListInput
                id="facility-languages"
                value={languages}
                onChange={setLanguages}
                addLabel="Add language"
              />
            </div>
            <div>
              <Label htmlFor="facility-interpreters" className="text-[12px]">
                Interpreter languages
              </Label>
              <TagListInput
                id="facility-interpreters"
                value={interpreters}
                onChange={setInterpreters}
                addLabel="Add language"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="facility-ada" className="text-[12px]">
                  ADA accessible
                </Label>
                <Select value={adaAccessible} onValueChange={setAdaAccessible}>
                  <SelectTrigger id="facility-ada" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not set</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="facility-ada-notes" className="text-[12px]">
                  Accessibility notes
                </Label>
                <Input
                  id="facility-ada-notes"
                  value={adaNotes}
                  onChange={(e) => setAdaNotes(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
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
            {pending ? "Saving…" : facility ? "Save changes" : "Save facility"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
