// E6.2 F6.2.1 — group facts on the hub: the group's stored metadata, edited
// through the SAME ProviderGroupForm the onboarding wizard uses (2026-07-29).
//
// Editing a group used to open a three-field dialog here (name/TIN/states)
// while onboarding captured the full entity, so a group edited outside the
// wizard could never reach its NPI or its address + contact blocks. There is
// one form now, and one write path (the audited updateProviderGroup).
// Malpractice coverage is NOT here — it lives in the group's InsurancePanel,
// which the hub renders below this card.
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProviderGroupForm } from "@/components/onboarding/ProviderGroupForm";
import { formatTin } from "@/lib/providerGroup";
import { useIsAdmin } from "@/lib/permissions";
import type { ProviderGroup } from "@/types";

/** The address + contact block the hub summarizes: credentialing is what a
 * payer application asks for, so it leads; billing is the fallback. */
function contactSummary(group: ProviderGroup): string {
  const blocks = [
    {
      street: group.credentialingStreet,
      city: group.credentialingCity,
      state: group.credentialingState,
      zip: group.credentialingZip,
      label: "Credentialing",
    },
    {
      street: group.billingStreet,
      city: group.billingCity,
      state: group.billingState,
      zip: group.billingZip,
      label: "Billing",
    },
  ];
  const block = blocks.find((b) => b.street || b.city || b.state || b.zip);
  if (!block) return "—";
  const line = [block.street, [block.city, block.state].filter(Boolean).join(", "), block.zip]
    .filter(Boolean)
    .join(" · ");
  return `${block.label}: ${line}`;
}

export function GroupFactsCard({ group }: { group: ProviderGroup }) {
  const isAdmin = useIsAdmin();
  const [editing, setEditing] = useState(false);

  const facts = [
    { label: "Legal name", value: group.name },
    { label: "TIN", value: group.tin ? formatTin(group.tin) : "—" },
    { label: "Type 2 NPI", value: group.npiType2 || "—" },
    {
      label: "Operating states",
      value: (group.states ?? []).length > 0 ? (group.states ?? []).join(", ") : "—",
    },
    { label: "Address", value: contactSummary(group) },
  ];

  return (
    <Card className="border-[#E8E5E0]">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-foreground">Group facts</h2>
          {isAdmin ? (
            <Button variant="outline" size="sm" className="h-8" onClick={() => setEditing(true)}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              Edit
            </Button>
          ) : null}
        </div>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="text-[11.5px] uppercase tracking-wide text-muted-foreground">
                {f.label}
              </dt>
              <dd className="mt-0.5 text-[13.5px] text-foreground">{f.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
      {editing ? <ProviderGroupForm group={group} onClose={() => setEditing(false)} /> : null}
    </Card>
  );
}
