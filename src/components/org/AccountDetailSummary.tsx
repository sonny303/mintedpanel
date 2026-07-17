import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgContacts } from "@/hooks/useParties";
import { useActiveMembership } from "@/lib/auth-store";
import type { Party } from "@/types";

const ROLE_DISPLAY: Record<string, string> = {
  owner: "Authorized contact",
  customer_escalation_contact: "Organization contact",
};

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

function DataRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[12px] font-medium text-muted-foreground">{label}</div>
      <div className="text-[14px] text-foreground">{value || "—"}</div>
    </div>
  );
}

export function AccountDetailSummary() {
  const active = useActiveMembership();
  const contactsQ = useOrgContacts();
  const contacts = contactsQ.data ?? [];

  const owner = contacts.find((c) => c.roleKey === "owner");
  const customer = contacts.find((c) => c.roleKey === "customer_escalation_contact");

  if (contactsQ.isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-16 rounded-md" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <h2 className="text-[15px] font-semibold text-foreground">Organization summary</h2>

        <DataRow label="Organization name" value={active?.orgName ?? null} />

        {owner ? (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="text-[13px] font-semibold text-foreground">
                {ROLE_DISPLAY[owner.roleKey] ?? owner.roleKey}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <DataRow label="Name" value={owner.party.name} />
                <DataRow label="Email" value={owner.party.email} />
              </div>
            </div>
          </>
        ) : null}

        {customer ? (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="text-[13px] font-semibold text-foreground">
                {ROLE_DISPLAY[customer.roleKey] ?? customer.roleKey}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <DataRow label="Name" value={customer.party.name} />
                <DataRow label="Email" value={customer.party.email} />
                {customer.party.phoneOffice ? (
                  <DataRow label="Phone" value={customer.party.phoneOffice} />
                ) : null}
              </div>
              {formatAddress(customer.party) ? (
                <DataRow label="Address" value={formatAddress(customer.party)} />
              ) : null}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
