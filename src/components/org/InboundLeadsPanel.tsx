// Operator triage for inbound "contact us" leads (redesign E0.5 / F0.5.5 / TE-7).
// The shared internal queue of NEW leads (a lead is not an org until converted).
// Convert -> a prospect org (E0.1 create_organization) + owner party; Dismiss ->
// drop it. Composed only from existing primitives.
import { toast } from "sonner";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  useInboundLeads,
  useConvertInboundLead,
  useDismissInboundLead,
} from "@/hooks/useInboundLeads";
import { fmtDate } from "@/lib/format";
import type { InboundLead } from "@/types";

function LeadRow({ lead }: { lead: InboundLead }) {
  const convert = useConvertInboundLead();
  const dismiss = useDismissInboundLead();
  const busy = convert.isPending || dismiss.isPending;

  return (
    <div className="rounded-md border border-[#E8E5E0] bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-foreground">{lead.orgName}</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            {lead.contactName} · {lead.contactEmail}
            {lead.contactPhone ? ` · ${lead.contactPhone}` : ""}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            Received {fmtDate(lead.createdAt)}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-8"
            disabled={busy}
            onClick={() =>
              dismiss.mutate(lead.id, {
                onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't dismiss"),
              })
            }
          >
            Dismiss
          </Button>
          <Button
            type="button"
            className="h-8 bg-[#1B4D3E] text-white hover:bg-[#163E32]"
            disabled={busy}
            onClick={() =>
              convert.mutate(lead, {
                onSuccess: () => toast.success(`Created ${lead.orgName} as a prospect`),
                onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't convert"),
              })
            }
          >
            Convert to org
          </Button>
        </div>
      </div>
    </div>
  );
}

export function InboundLeadsPanel() {
  const { data, isLoading } = useInboundLeads();
  const leads = (data ?? []).filter((l) => l.status === "new");

  // Hide the panel entirely when there's nothing to triage — it's not part of the
  // org's own setup, just a shared inbox that appears when leads arrive.
  if (isLoading || leads.length === 0) return null;

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-[15px] font-semibold text-foreground">New inbound inquiries</h2>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {leads.length}
          </span>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Submitted through the public contact form. Convert one into a prospect organization or
          dismiss it.
        </p>
        <div className="space-y-2">
          {leads.map((lead) => (
            <LeadRow key={lead.id} lead={lead} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
