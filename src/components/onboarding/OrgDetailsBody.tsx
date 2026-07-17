// Org details section body — the E0.8 intake outputs rendered live from party
// data (moved out of the route file by E1.0 TE-1; the route stays the page
// composer). Read-only: intake edits happen on Account Detail / People Enroll.
import { Separator } from "@/components/ui/separator";
import type { OrgContact, Party, PartyRoleKey } from "@/types";

const WIZARD_ROLE_LABELS: Partial<Record<PartyRoleKey, string>> = {
  owner: "Authorized contact",
  customer_escalation_contact: "Organization contact",
};

function fieldRow(label: string, value: string | null | undefined) {
  return (
    <div>
      <div className="text-[12px] font-medium text-muted-foreground">{label}</div>
      <div className="text-[14px] text-foreground">{value || "—"}</div>
    </div>
  );
}

function formatAddress(p: Party): string | null {
  const parts: string[] = [];
  if (p.addressLine1) parts.push(p.addressLine1);
  if (p.addressLine2) parts.push(p.addressLine2);
  const cityLine = [p.city, [p.state, p.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  if (cityLine) parts.push(cityLine);
  return parts.length ? parts.join(", ") : null;
}

function ContactRow({ title, contact }: { title: string; contact: OrgContact }) {
  const { party } = contact;
  return (
    <div className="space-y-2">
      <div className="text-[13px] font-semibold text-foreground">{title}</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {fieldRow("Name", party.name)}
        {fieldRow("Email", party.email)}
        {party.phoneOffice ? fieldRow("Phone", party.phoneOffice) : null}
      </div>
      {formatAddress(party) ? fieldRow("Address", formatAddress(party)) : null}
    </div>
  );
}

export function OrgDetailsBody({
  orgName,
  contacts,
}: {
  orgName: string | null;
  contacts: OrgContact[];
}) {
  const owner = contacts.find((c) => c.roleKey === "owner");
  const customer = contacts.find((c) => c.roleKey === "customer_escalation_contact");
  return (
    <div className="space-y-4">
      {fieldRow("Organization name", orgName)}
      {owner ? (
        <>
          <Separator />
          <ContactRow title={WIZARD_ROLE_LABELS[owner.roleKey] ?? owner.roleKey} contact={owner} />
        </>
      ) : null}
      {customer ? (
        <>
          <Separator />
          <ContactRow
            title={WIZARD_ROLE_LABELS[customer.roleKey] ?? customer.roleKey}
            contact={customer}
          />
        </>
      ) : null}
    </div>
  );
}
