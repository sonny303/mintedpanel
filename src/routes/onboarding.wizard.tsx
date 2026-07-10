// Onboarding wizard (E0.8): vertical-section single-page wizard. Section 1 shows
// an org summary from party data; sections 2-4 are placeholders for future stages.
import { createFileRoute, Link } from "@tanstack/react-router";
import { FileUp, Building, Users, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { buttonVariants } from "@/components/ui/button";
import { useOrgContacts } from "@/hooks/useParties";
import { useActiveMembership } from "@/lib/auth-store";
import type { OrgContact, Party, PartyRoleKey } from "@/types";

const WIZARD_ROLE_LABELS: Partial<Record<PartyRoleKey, string>> = {
  owner: "Authorized contact",
  customer_escalation_contact: "Organization contact",
};

export const Route = createFileRoute("/onboarding/wizard")({
  component: OnboardingWizardPage,
});

// ---------- helpers ----------

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

// ---------- org details section ----------

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

function OrgDetailsSection() {
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
          <Skeleton className="h-16 rounded-md" />
        </CardContent>
      </Card>
    );
  }

  if (contactsQ.isError) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#B91C1C]">
            We couldn't load organization details.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <h2 className="text-[15px] font-semibold text-foreground">Organization details</h2>
        {fieldRow("Organization name", active?.orgName ?? null)}
        {owner ? (
          <>
            <Separator />
            <ContactRow
              title={WIZARD_ROLE_LABELS[owner.roleKey] ?? owner.roleKey}
              contact={owner}
            />
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
      </CardContent>
    </Card>
  );
}

// ---------- placeholder sections ----------

function PlaceholderSection({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: typeof FileUp;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-[15px] font-semibold text-foreground">{title}</div>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- main page ----------

function OnboardingWizardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Onboarding"
        actions={
          <Link to="/get-started" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft className="h-4 w-4" />
            Account Detail
          </Link>
        }
      />

      {/* Section 1: Organization details (read-only from party data) */}
      <OrgDetailsSection />

      {/* Section 2: Import data (placeholder) */}
      <PlaceholderSection
        title="Import data"
        description="CSV import will be available in a later release."
        icon={FileUp}
      />

      {/* Section 3: Facilities (placeholder) */}
      <PlaceholderSection
        title="Facilities"
        description="Facility setup will be available in a later release."
        icon={Building}
      />

      {/* Section 4: Providers (placeholder) */}
      <PlaceholderSection
        title="Providers"
        description="Provider enrollment will be available in a later release."
        icon={Users}
      />
    </div>
  );
}
