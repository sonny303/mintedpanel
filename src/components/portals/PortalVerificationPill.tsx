// The verification badge for a portals-registry row, shared by Admin > Portals
// and the case task views (so the rule lives in one place, not duplicated). A
// portal is Verified once a human completes a training pass; a URL change since
// the last verification drops it to "Needs re-verify"; otherwise it's Unverified.
import { StatusPill } from "@/components/StatusPill";
import type { Portal } from "@/types";

export type PortalVerification = "verified" | "needs_reverify" | "unverified";

export function portalVerification(portal: Portal): PortalVerification {
  if (portal.isVerified) return "verified";
  if (portal.urlChangedAt && portal.lastVerifiedAt) return "needs_reverify";
  return "unverified";
}

export function PortalVerificationPill({
  portal,
  className,
}: {
  portal: Portal;
  className?: string;
}) {
  const state = portalVerification(portal);
  if (state === "verified")
    return <StatusPill status="green" label="Verified" className={className} />;
  if (state === "needs_reverify")
    return <StatusPill status="amber" label="Needs re-verify" className={className} />;
  return <StatusPill status="neutral" label="Unverified" className={className} />;
}
