// E6.1 F6.1.1/F6.1.4 (2026-07-19) — the Groups nav item's SHELL. E6.2 (Groups
// & Payer Network board) fills this surface; per the epic's sequencing rule
// this epic ships the shell + redirects and the sibling replaces the interim
// content. Interim: the Organization-data summaries relocated off Org Detail
// (read-only group/facility cards) + pointers into the wizard sections where
// the underlying data is edited today, including the group's Payer Network.
// /generation* redirects here until E6.2/E6.3 land generation on the group's
// Payer Network board.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { GroupSummaryCard } from "@/components/org/GroupSummaryCard";
import { FacilitySummaryCard } from "@/components/org/FacilitySummaryCard";

export const Route = createFileRoute("/groups")({
  component: GroupsPage,
});

const WIZARD_LINKS = [
  {
    section: "provider_group",
    label: "Edit provider groups",
    detail: "Legal entities, TINs, addresses and contacts.",
  },
  {
    section: "facilities",
    label: "Edit facilities",
    detail: "Practice locations, hours, and CAQH details.",
  },
  {
    section: "payer_network",
    label: "Payer Network",
    detail: "Which payers each group pursues, per state — generation reads these targets.",
  },
] as const;

function GroupsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Groups"
        description="Provider groups, their locations, and their payer network. The full Groups board arrives with the next epic (E6.2)."
      />
      <Card className="border-[#E8E5E0]">
        <CardContent className="p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {WIZARD_LINKS.map((l) => (
              <Link
                key={l.section}
                to="/onboarding/wizard"
                search={{ section: l.section }}
                className="group rounded-md border border-[#E8E5E0] p-4 transition-colors hover:border-[#1B4D3E]"
              >
                <span className="flex items-center justify-between text-[13.5px] font-medium text-foreground">
                  {l.label}
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="mt-1 block text-[12.5px] text-muted-foreground">{l.detail}</span>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
      {/* Organization-data summaries relocated from Org Detail (F6.1.4). */}
      <GroupSummaryCard />
      <FacilitySummaryCard />
    </div>
  );
}
