// Case detail header: provider name, submeta, the ONE unified status control
// (E6.0 — the dual credentialing + payer-pipeline pills and the separate
// contract pill are gone), and the tracking ID. The forwarding ID lives in
// the Case Facts card, not here.
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
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
    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold text-foreground flex items-center gap-2 flex-wrap">
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
        <p className="text-[14px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          {c.payer?.name ?? "—"}
          <span className="text-border">·</span>
          {c.state}
          {c.specialty ? (
            <>
              <span className="text-border">·</span>
              {c.specialty}
            </>
          ) : null}
        </p>
        {trackingId ? <div className="mt-2">{trackingId}</div> : null}
      </div>

      <div className="flex items-center gap-6">{statusControl}</div>
    </div>
  );
}
