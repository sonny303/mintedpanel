// Payer & Cases design bundle, screen 3 Overview (Slice C) — the Contacts
// card: who to reach at this payer, with ONE row per purpose marked Default —
// the contact a template's Draft-email step addresses. Rides the E6.7
// payer_contacts seam (RLS reads, audited RPC writes; the RPC swaps the
// one-default-per-purpose flag atomically, so "Make default" is a single call).
//
// Design deviation, deliberate: the prototype types Purpose free-text
// ("Provider relations"). The shipped column is a governed CHECK domain
// (credentialing | enrollment | escalation | general), so the field is a
// Select over that domain — a free-text value would be rejected by the RPC.
// The prototype's free-text intent is preserved by the optional Name field the
// table already carries.
import { useState } from "react";
import { toast } from "sonner";
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
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/StatusPill";
import {
  useDeletePayerContact,
  usePayerContacts,
  useUpsertPayerContact,
} from "@/hooks/usePayerContacts";
import { useIsAdmin } from "@/lib/permissions";
import type { Payer, PayerContact, PayerContactPurpose } from "@/types";

const PURPOSES: PayerContactPurpose[] = ["credentialing", "enrollment", "escalation", "general"];

const PURPOSE_LABELS: Record<PayerContactPurpose, string> = {
  credentialing: "Credentialing",
  enrollment: "Enrollment",
  escalation: "Escalation",
  general: "General",
};

interface ContactDraft {
  purpose: PayerContactPurpose;
  name: string;
  email: string;
  phone: string;
  note: string;
  isDefault: boolean;
}

const EMPTY_CONTACT: ContactDraft = {
  purpose: "credentialing",
  name: "",
  email: "",
  phone: "",
  note: "",
  isDefault: false,
};

export function PayerContactsCard({ payer }: { payer: Payer }) {
  const contactsQ = usePayerContacts(payer.id);
  const upsertMut = useUpsertPayerContact();
  const deleteMut = useDeletePayerContact();
  const isAdmin = useIsAdmin();

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_CONTACT);
  const [formError, setFormError] = useState<string | null>(null);

  const contacts = contactsQ.data ?? [];
  const pending = upsertMut.isPending || deleteMut.isPending;

  const closeForm = () => {
    setFormOpen(false);
    setDraft(EMPTY_CONTACT);
    setFormError(null);
  };

  const handleAdd = () => {
    // The RPC enforces reachability too; asking here keeps the round trip off
    // the obviously-incomplete path.
    if (draft.email.trim() === "" && draft.phone.trim() === "") {
      setFormError("A contact needs an email address or a phone number.");
      return;
    }
    setFormError(null);
    upsertMut.mutate(
      {
        payerId: payer.id,
        purpose: draft.purpose,
        name: draft.name.trim() || null,
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        note: draft.note.trim() || null,
        isDefault: draft.isDefault,
      },
      {
        onSuccess: () => {
          toast.success("Contact added");
          closeForm();
        },
        onError: (e) => setFormError(e instanceof Error ? e.message : "Couldn't add the contact."),
      },
    );
  };

  const handleMakeDefault = (contact: PayerContact) => {
    upsertMut.mutate(
      {
        id: contact.id,
        payerId: contact.payerId,
        purpose: contact.purpose,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        note: contact.note,
        isDefault: true,
      },
      {
        onSuccess: () => toast.success(`${PURPOSE_LABELS[contact.purpose]} default updated`),
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Couldn't update the default contact"),
      },
    );
  };

  const handleRemove = (contact: PayerContact) => {
    deleteMut.mutate(
      { id: contact.id, payerId: contact.payerId },
      {
        onSuccess: () => toast.success("Contact removed"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't remove the contact"),
      },
    );
  };

  return (
    <section className="rounded-[6px] border border-[#E8E5E0] bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#E8E5E0] px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold text-foreground">Contacts</h2>
          <p className="text-[12.5px] text-muted-foreground">
            Who to reach at this payer. Template email steps and cases pull from here.
          </p>
        </div>
        {isAdmin && !formOpen ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 flex-none px-3 text-[12px]"
            onClick={() => setFormOpen(true)}
          >
            + Add contact
          </Button>
        ) : null}
      </div>

      {formOpen ? (
        <div className="space-y-3 border-b border-[#E8E5E0] bg-[#FBFBF9] p-5">
          <div className="text-[13px] font-semibold text-foreground">New contact</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact-purpose" className="text-[12px] font-medium">
                Purpose
              </Label>
              <Select
                value={draft.purpose}
                onValueChange={(v) => setDraft({ ...draft, purpose: v as PayerContactPurpose })}
              >
                <SelectTrigger id="contact-purpose" className="h-9" aria-label="Contact purpose">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PURPOSES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PURPOSE_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-email" className="text-[12px] font-medium">
                Email
              </Label>
              <Input
                id="contact-email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="name@payer.com"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-phone" className="text-[12px] font-medium">
                Phone
              </Label>
              <Input
                id="contact-phone"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder="555-555-0100"
                className="h-9"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contact-name" className="text-[12px] font-medium">
                Name <span className="font-normal text-muted-foreground">— optional</span>
              </Label>
              <Input
                id="contact-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Provider relations desk"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-note" className="text-[12px] font-medium">
                Notes <span className="font-normal text-muted-foreground">— optional</span>
              </Label>
              <Input
                id="contact-note"
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="Hours, escalation path, anything worth knowing"
                className="h-9"
              />
            </div>
          </div>
          {formError ? (
            <p role="alert" className="text-[12.5px] text-[#B91C1C]">
              {formError}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex flex-1 items-center gap-2">
              <Checkbox
                id="contact-default"
                checked={draft.isDefault}
                onCheckedChange={(checked) => setDraft({ ...draft, isDefault: checked === true })}
              />
              <Label htmlFor="contact-default" className="cursor-pointer text-[13px] font-normal">
                Make this the default — template email steps address it
              </Label>
            </span>
            <Button variant="outline" size="sm" onClick={closeForm} disabled={pending}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
              onClick={handleAdd}
              disabled={pending}
            >
              Add contact
            </Button>
          </div>
        </div>
      ) : null}

      <div className="p-5">
        {contactsQ.isError ? (
          <p className="text-[13px] text-[#B91C1C]">Couldn&apos;t load contacts.</p>
        ) : contactsQ.data === undefined ? (
          <Skeleton className="h-16 w-full rounded-[6px]" />
        ) : contacts.length === 0 ? (
          <div className="rounded-[6px] border border-dashed border-[#DCDAD4] px-4 py-8 text-center">
            <div className="text-[14px] font-semibold text-foreground">No contacts yet</div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Add the provider-relations line or your rep, so template steps can reference them.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[6px] border border-[#E8E5E0]">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[#E8E5E0] bg-[#FBFBF9] text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground">
                  <th className="px-3 py-2">Purpose</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Notes</th>
                  {isAdmin ? <th className="px-3 py-2">Manage</th> : null}
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.id} className="border-b border-[#F0EEEA] last:border-b-0">
                    <td className="px-3 py-2.5 text-[13px]">
                      <span className="font-medium text-foreground">
                        {PURPOSE_LABELS[contact.purpose]}
                      </span>
                      {contact.name ? (
                        <span className="ml-1.5 text-muted-foreground">{contact.name}</span>
                      ) : null}
                      {contact.isDefault ? (
                        <span className="ml-2 inline-flex align-middle">
                          <StatusPill status="green" label="Default" />
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                      {contact.email ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                      {contact.phone ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                      {contact.note ?? "—"}
                    </td>
                    {isAdmin ? (
                      <td className="px-3 py-2.5 text-[12.5px]">
                        <span className="flex flex-wrap items-center gap-2.5">
                          {contact.isDefault ? null : (
                            <button
                              type="button"
                              className="font-medium text-[#1B4D3E] underline-offset-2 hover:underline disabled:opacity-50"
                              disabled={pending}
                              onClick={() => handleMakeDefault(contact)}
                            >
                              Make default
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-muted-foreground underline-offset-2 hover:text-[#B91C1C] hover:underline disabled:opacity-50"
                            disabled={pending}
                            onClick={() => handleRemove(contact)}
                          >
                            Remove
                          </button>
                        </span>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
