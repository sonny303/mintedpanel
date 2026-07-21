// Read-only org identity summary. Slimmed 2026-07-21 (user handoff Task A):
// people are NOT restated here — the unified People section below is the ONE
// place contacts appear, with the Authorized/Organization contact
// designations rendered as role chips (governed party_role_types labels,
// migration 20260721120000). Org-level identity only: name + organization
// address (the intake's "Organization address" section writes the
// organization-contact party's address columns — that address IS the org's).
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgContacts } from "@/hooks/useParties";
import { useActiveMembership } from "@/lib/auth-store";
import type { Party } from "@/types";

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

  const orgContact = contacts.find((c) => c.roleKey === "customer_escalation_contact");
  const orgAddress = orgContact ? formatAddress(orgContact.party) : null;

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
        <DataRow label="Organization address" value={orgAddress} />
      </CardContent>
    </Card>
  );
}
