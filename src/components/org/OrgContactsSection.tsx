// Org CRM contacts surface (E0.2 F0.2.3 / FR-3 + FR-4). A labelled section on the
// org workspace showing the customer-escalation contact and the sales rep (plus
// the owner, read-only) with edit-in-place. Edits validate the required contact
// fields (FR-2) and refresh immediately via the hook's cache invalidation
// (FR-3 "real time"). No history/audit UI (FR-4); the service still writes the
// standard audit row. Composed from existing primitives.
import { useState } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ContactFields } from "@/components/org/ContactFields";
import { useOrgContacts, useUpdateParty } from "@/hooks/useParties";
import { contactErrors, hasContactErrors, type ContactFieldErrors } from "@/lib/contactValidation";
import { PARTY_ROLE_LABELS, partyToContactInput } from "@/lib/contacts";
import type { ContactInput, OrgContact, Party, PartyRoleKey } from "@/types";

// Display order; only the two CRM contacts are editable in E0.2.
const DISPLAY_ORDER: PartyRoleKey[] = ["customer_escalation_contact", "sales_rep", "owner"];
const EDITABLE: PartyRoleKey[] = ["customer_escalation_contact", "sales_rep"];

function formatAddress(p: Party): string | null {
  const cityLine = [p.city, [p.state, p.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const parts = [p.addressLine1, p.addressLine2, cityLine, p.country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function ContactRow({ contact, onEdit }: { contact: OrgContact; onEdit: (c: OrgContact) => void }) {
  const { party, roleKey } = contact;
  const address = formatAddress(party);
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-[#E8E5E0] p-4">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {PARTY_ROLE_LABELS[roleKey]}
        </div>
        <div className="mt-1 text-[14px] font-medium text-foreground">{party.name}</div>
        <div className="mt-0.5 text-[13px] text-muted-foreground break-words">
          {party.email ?? "—"}
          {party.phoneOffice ? ` · ${party.phoneOffice}` : ""}
        </div>
        {address ? (
          <div className="mt-0.5 text-[12px] text-muted-foreground break-words">{address}</div>
        ) : null}
      </div>
      {EDITABLE.includes(roleKey) ? (
        <Button variant="outline" size="sm" onClick={() => onEdit(contact)}>
          <Pencil className="h-4 w-4" />
          Edit
        </Button>
      ) : null}
    </div>
  );
}

function EditContactDialog({ contact, onClose }: { contact: OrgContact; onClose: () => void }) {
  const update = useUpdateParty();
  const [value, setValue] = useState<ContactInput>(partyToContactInput(contact.party));
  const [errors, setErrors] = useState<ContactFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  function save() {
    const e = contactErrors(value);
    setErrors(e);
    if (hasContactErrors(e)) return;
    setFormError(null);
    update.mutate(
      { partyId: contact.party.id, input: value },
      {
        onSuccess: () => {
          toast.success("Contact updated");
          onClose();
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : "Couldn't update contact";
          setFormError(msg);
          toast.error(msg);
        },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {PARTY_ROLE_LABELS[contact.roleKey].toLowerCase()}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <ContactFields
            value={value}
            onChange={(p) => setValue((v) => ({ ...v, ...p }))}
            errors={errors}
            idPrefix={`edit-${contact.roleKey}`}
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
            {update.isPending ? "Saving…" : "Save contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OrgContactsSection() {
  const { data, isLoading, isError } = useOrgContacts();
  const [editing, setEditing] = useState<OrgContact | null>(null);

  const ordered = (data ?? [])
    .slice()
    .sort((a, b) => DISPLAY_ORDER.indexOf(a.roleKey) - DISPLAY_ORDER.indexOf(b.roleKey));

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-semibold text-foreground">Contacts</h2>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-[86px] rounded-md" />
          <Skeleton className="h-[86px] rounded-md" />
        </div>
      ) : isError ? (
        <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#B91C1C]">
          We couldn't load this organization's contacts.
        </div>
      ) : ordered.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-[13px] text-muted-foreground">
            No contacts recorded yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {ordered.map((contact) => (
            <ContactRow key={contact.party.id} contact={contact} onEdit={setEditing} />
          ))}
        </div>
      )}
      {editing ? <EditContactDialog contact={editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}
