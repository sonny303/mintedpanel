// E4.5 F4.5.2 — the derived expiration pill: expired (red) / expiring soon
// (amber) / current (green). Purely presentational over the shared
// classification — never a stored flag (TE-6).
import { StatusPill } from "@/components/StatusPill";
import type { DocumentExpirationStatus } from "@/types";

export function DocumentExpirationPill({ status }: { status: DocumentExpirationStatus | null }) {
  if (status === "expired") return <StatusPill status="red" label="Expired" />;
  if (status === "expiring_soon") return <StatusPill status="amber" label="Expiring soon" />;
  if (status === "current") return <StatusPill status="green" label="Current" />;
  return null;
}
