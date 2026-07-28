// Case detail header (Slice E / payer-and-cases screen 6): one bordered card
// carrying the case's identity — provider name (links to the record), the
// case-type badge, the payer (links to its catalog detail) · state · specialty
// · owning group, and the inline-editable tracking ID — with the ONE unified
// status control + its attribution on the right. The dual credentialing +
// payer-pipeline pills and the separate contract pill are long gone (E6.0);
// the duplicate tracking-ID warning is deliberately not surfaced here
// (handoff §2.7 — a collision is only ever a data-entry error).
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { CaseDetail } from "@/types";

export function CaseHeader({
  c,
  statusControl,
  trackingId,
}: {
  c: CaseDetail;
  /** E6.0 — the unified status control (pill + attribution + legal-moves
   * menu), rendered by the parent so the header stays presentational. */
  statusControl?: React.ReactNode;
  /** E4.0 F4.0.2 — the copyable, inline-editable Reference/Tracking ID. */
  trackingId?: React.ReactNode;
}) {
  const providerName = c.provider
    ? `${c.provider.firstName} ${c.provider.lastName}${c.provider.credentials ? `, ${c.provider.credentials}` : ""}`
    : "Unknown provider";

  return (
    <Card className="shadow-none border-border">
      <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-[20px] font-semibold text-foreground">
            {c.provider ? (
              <Link to="/providers/$id" params={{ id: c.provider.id }} className="hover:underline">
                {providerName}
              </Link>
            ) : (
              providerName
            )}
            <Badge variant="secondary" className="font-normal text-[11px] uppercase tracking-wide">
              Initial Credentialing
            </Badge>
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[14px] text-muted-foreground">
            {c.payer ? (
              <Link
                to="/admin/payer-admin/catalog/$payerId"
                params={{ payerId: c.payer.id }}
                className="hover:text-[#1B4D3E] hover:underline"
              >
                {c.payer.name}
              </Link>
            ) : (
              "—"
            )}
            <span className="text-border">·</span>
            {c.state}
            {c.specialty ? (
              <>
                <span className="text-border">·</span>
                {c.specialty}
              </>
            ) : null}
            {c.group?.name ? (
              <>
                <span className="text-border">·</span>
                <span className="text-[#9CA3AF]">under {c.group.name}</span>
              </>
            ) : null}
          </p>
          {trackingId ? <div className="mt-3">{trackingId}</div> : null}
        </div>

        <div className="flex flex-none items-start">{statusControl}</div>
      </CardContent>
    </Card>
  );
}
