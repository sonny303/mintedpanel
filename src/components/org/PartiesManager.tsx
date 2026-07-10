// Manage-parties surface (redesign E0.3 TE-5). The org's people and the roles
// they hold, with full CRUD + role management, composed only from existing
// primitives. Supersedes the E0.2 contacts-only view (contacts are just parties
// holding customer/sales roles, and stay labelled here — FR-3):
//   F0.3.1 create/edit/remove a person party
//   F0.3.2 assign an active role (org scope); reserved roles visible-disabled
//   F0.3.3 one party, many roles      F0.3.4 reuse an existing party in this org
//   F0.3.5 governed role list         F0.2.2 can't remove the only sales rep
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
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
import { ContactFields } from "@/components/org/ContactFields";
import {
  useOrgParties,
  usePartyRoleTypes,
  useVisibleParties,
  useCreateParty,
  useAssignRole,
  useUnassignRole,
  useUpdateParty,
  useRemovePartyFromOrg,
} from "@/hooks/useParties";
import { contactErrors, hasContactErrors, type ContactFieldErrors } from "@/lib/contactValidation";
import { PARTY_ROLE_LABELS, EMPTY_CONTACT, partyToContactInput } from "@/lib/contacts";
import type { ContactInput, OrgParty, Party, PartyRoleKey, PartyRoleType } from "@/types";

const chipClass =
  "inline-flex items-center gap-1 rounded-full border border-[#E8E5E0] bg-muted px-2 py-0.5 text-[12px] text-foreground";

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

function formatAddress(p: Party): string | null {
  const cityLine = [p.city, [p.state, p.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const parts = [p.addressLine1, p.addressLine2, cityLine, p.country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// Role picker for adding a role to a party. Shows every governed role: an active
// role not already held is selectable; already-held and reserved roles are
// present but disabled (F0.3.5).
function AddRoleSelect({
  held,
  roleTypes,
  onAssign,
  disabled,
}: {
  held: PartyRoleKey[];
  roleTypes: PartyRoleType[];
  onAssign: (roleKey: PartyRoleKey) => void;
  disabled?: boolean;
}) {
  const ordered = useMemo(
    () => [...roleTypes].sort((a, b) => Number(b.isActive) - Number(a.isActive)),
    [roleTypes],
  );
  return (
    <Select value="" disabled={disabled} onValueChange={(v) => onAssign(v as PartyRoleKey)}>
      <SelectTrigger className="h-8 w-[190px] text-[12px]">
        <SelectValue placeholder="Add role…" />
      </SelectTrigger>
      <SelectContent>
        {ordered.map((t) => {
          const isDisabled = !t.isActive || held.includes(t.roleKey);
          return (
            <SelectItem key={t.roleKey} value={t.roleKey} disabled={isDisabled}>
              {t.label}
              {!t.isActive ? " (coming soon)" : held.includes(t.roleKey) ? " (assigned)" : ""}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function PartyCard({
  orgParty,
  roleTypes,
  onEdit,
  onRemove,
}: {
  orgParty: OrgParty;
  roleTypes: PartyRoleType[];
  onEdit: (p: Party) => void;
  onRemove: (op: OrgParty) => void;
}) {
  const { party, roleKeys } = orgParty;
  const assignRole = useAssignRole();
  const unassignRole = useUnassignRole();
  const address = formatAddress(party);

  const doAssign = (roleKey: PartyRoleKey) =>
    assignRole.mutate(
      { partyId: party.id, roleKey },
      { onError: (e) => toast.error(errMessage(e, "Couldn't add role")) },
    );
  const doUnassign = (roleKey: PartyRoleKey) =>
    unassignRole.mutate(
      { partyId: party.id, roleKey },
      { onError: (e) => toast.error(errMessage(e, "Couldn't remove role")) },
    );

  return (
    <div className="rounded-md border border-[#E8E5E0] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-foreground">{party.name}</div>
          <div className="mt-0.5 text-[13px] text-muted-foreground break-words">
            {party.email ?? "—"}
            {party.phoneOffice ? ` · ${party.phoneOffice}` : ""}
          </div>
          {address ? (
            <div className="mt-0.5 text-[12px] text-muted-foreground break-words">{address}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => onEdit(party)}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => onRemove(orgParty)}>
            <Trash2 className="h-4 w-4" />
            Remove
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {roleKeys.map((rk) => (
          <span key={rk} className={chipClass}>
            {PARTY_ROLE_LABELS[rk]}
            <button
              type="button"
              aria-label={`Remove ${PARTY_ROLE_LABELS[rk]} role`}
              onClick={() => doUnassign(rk)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <AddRoleSelect
          held={roleKeys}
          roleTypes={roleTypes}
          onAssign={doAssign}
          disabled={assignRole.isPending}
        />
      </div>
    </div>
  );
}

function ActiveRoleSelect({
  roleTypes,
  value,
  onChange,
}: {
  roleTypes: PartyRoleType[];
  value: string;
  onChange: (v: PartyRoleKey) => void;
}) {
  const ordered = [...roleTypes].sort((a, b) => Number(b.isActive) - Number(a.isActive));
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PartyRoleKey)}>
      <SelectTrigger className="h-9">
        <SelectValue placeholder="Select a role" />
      </SelectTrigger>
      <SelectContent>
        {ordered.map((t) => (
          <SelectItem key={t.roleKey} value={t.roleKey} disabled={!t.isActive}>
            {t.label}
            {!t.isActive ? " (coming soon)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AddPartyDialog({
  roleTypes,
  onClose,
}: {
  roleTypes: PartyRoleType[];
  onClose: () => void;
}) {
  const createParty = useCreateParty();
  const assignRole = useAssignRole();
  const [value, setValue] = useState<ContactInput>(EMPTY_CONTACT);
  const [roleKey, setRoleKey] = useState<PartyRoleKey | "">("");
  const [errors, setErrors] = useState<ContactFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const pending = createParty.isPending || assignRole.isPending;

  async function save() {
    const e = contactErrors(value);
    setErrors(e);
    if (hasContactErrors(e)) return;
    if (!roleKey) {
      setFormError("Choose a role for this person.");
      return;
    }
    setFormError(null);
    try {
      const party = await createParty.mutateAsync(value);
      await assignRole.mutateAsync({ partyId: party.id, roleKey });
      toast.success("Party added");
      onClose();
    } catch (err) {
      setFormError(errMessage(err, "Couldn't add party"));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a person</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <ContactFields
            value={value}
            onChange={(p) => setValue((v) => ({ ...v, ...p }))}
            errors={errors}
            idPrefix="new-party"
          />
          <div>
            <Label className="text-[12px]">Role</Label>
            <ActiveRoleSelect roleTypes={roleTypes} value={roleKey} onChange={setRoleKey} />
          </div>
          {formError ? (
            <div className="text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
              {formError}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={pending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {pending ? "Adding…" : "Add person"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddExistingPartyDialog({
  roleTypes,
  candidates,
  onClose,
}: {
  roleTypes: PartyRoleType[];
  candidates: Party[];
  onClose: () => void;
}) {
  const assignRole = useAssignRole();
  const [partyId, setPartyId] = useState<string>("");
  const [roleKey, setRoleKey] = useState<PartyRoleKey | "">("");
  const [formError, setFormError] = useState<string | null>(null);

  function save() {
    if (!partyId) {
      setFormError("Choose a person to add.");
      return;
    }
    if (!roleKey) {
      setFormError("Choose a role.");
      return;
    }
    setFormError(null);
    assignRole.mutate(
      { partyId, roleKey },
      {
        onSuccess: () => {
          toast.success("Party added to this organization");
          onClose();
        },
        onError: (e) => setFormError(errMessage(e, "Couldn't add party")),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>Add an existing person</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-[12px] text-muted-foreground">
            Reuse someone already in your portfolio (one record across organizations).
          </p>
          <div>
            <Label className="text-[12px]">Person</Label>
            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select a person" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.email ? ` · ${p.email}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[12px]">Role</Label>
            <ActiveRoleSelect roleTypes={roleTypes} value={roleKey} onChange={setRoleKey} />
          </div>
          {formError ? (
            <div className="text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
              {formError}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={assignRole.isPending}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={assignRole.isPending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {assignRole.isPending ? "Adding…" : "Add to organization"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditPartyDialog({ party, onClose }: { party: Party; onClose: () => void }) {
  const update = useUpdateParty();
  const [value, setValue] = useState<ContactInput>(partyToContactInput(party));
  const [errors, setErrors] = useState<ContactFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  function save() {
    const e = contactErrors(value);
    setErrors(e);
    if (hasContactErrors(e)) return;
    setFormError(null);
    update.mutate(
      { partyId: party.id, input: value },
      {
        onSuccess: () => {
          toast.success("Party updated");
          onClose();
        },
        onError: (err) => setFormError(errMessage(err, "Couldn't update party")),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit person</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <ContactFields
            value={value}
            onChange={(p) => setValue((v) => ({ ...v, ...p }))}
            errors={errors}
            idPrefix={`edit-${party.id}`}
          />
          {formError ? (
            <div className="mt-3 text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
              {formError}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={update.isPending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemovePartyDialog({ orgParty, onClose }: { orgParty: OrgParty; onClose: () => void }) {
  const remove = useRemovePartyFromOrg();
  const [formError, setFormError] = useState<string | null>(null);
  function confirm() {
    setFormError(null);
    remove.mutate(orgParty.party.id, {
      onSuccess: () => {
        toast.success("Removed from this organization");
        onClose();
      },
      onError: (e) => setFormError(errMessage(e, "Couldn't remove party")),
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>Remove {orgParty.party.name}?</DialogTitle>
        </DialogHeader>
        <p className="py-2 text-[13px] text-muted-foreground">
          This removes {orgParty.party.name} and their roles from this organization. The person
          record stays available for reuse in other organizations.
        </p>
        {formError ? (
          <div className="mb-2 text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
            {formError}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={remove.isPending}>
            {remove.isPending ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PartiesManager() {
  const partiesQ = useOrgParties();
  const roleTypesQ = usePartyRoleTypes();
  const visibleQ = useVisibleParties();
  const [adding, setAdding] = useState(false);
  const [addingExisting, setAddingExisting] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);
  const [removing, setRemoving] = useState<OrgParty | null>(null);

  const parties = partiesQ.data ?? [];
  const roleTypes = roleTypesQ.data ?? [];
  const inOrgIds = new Set(parties.map((p) => p.party.id));
  const candidates = (visibleQ.data ?? []).filter((p) => !inOrgIds.has(p.id));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[15px] font-semibold text-foreground">People Enroll</h2>
        <div className="flex gap-2">
          {candidates.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setAddingExisting(true)}>
              <UserPlus className="h-4 w-4" />
              Add existing
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => setAdding(true)}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            <Plus className="h-4 w-4" />
            Add person
          </Button>
        </div>
      </div>

      {partiesQ.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-[104px] rounded-md" />
          <Skeleton className="h-[104px] rounded-md" />
        </div>
      ) : partiesQ.isError ? (
        <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#B91C1C]">
          We couldn't load this organization's people.
        </div>
      ) : parties.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-[13px] text-muted-foreground">
            No people recorded yet. Add the first one to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {parties.map((op) => (
            <PartyCard
              key={op.party.id}
              orgParty={op}
              roleTypes={roleTypes}
              onEdit={setEditing}
              onRemove={setRemoving}
            />
          ))}
        </div>
      )}

      {adding ? <AddPartyDialog roleTypes={roleTypes} onClose={() => setAdding(false)} /> : null}
      {addingExisting ? (
        <AddExistingPartyDialog
          roleTypes={roleTypes}
          candidates={candidates}
          onClose={() => setAddingExisting(false)}
        />
      ) : null}
      {editing ? <EditPartyDialog party={editing} onClose={() => setEditing(null)} /> : null}
      {removing ? (
        <RemovePartyDialog orgParty={removing} onClose={() => setRemoving(null)} />
      ) : null}
    </section>
  );
}
