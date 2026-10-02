import { normalizePortalKey } from "@/lib/tokenFormat";
import type { Portal } from "@/types";

export type PortalMappingResetAvailability =
  | { allowed: true; ownerScope: "global" | "organization" }
  | { allowed: false; reason: "wrong-organization" | "shared-fallback" };

/** Keep the confirmation affordance aligned with the server rule: an
 * organization-only reset is available only when no same-key shared fallback
 * exists. This checks the exact immutable portal key, never the form URL. */
export function portalMappingResetAvailability(input: {
  portal: Portal;
  visiblePortals: readonly Portal[];
  activeOrgId: string;
}): PortalMappingResetAvailability {
  const { portal, visiblePortals, activeOrgId } = input;
  if (portal.orgId === null) return { allowed: true, ownerScope: "global" };
  if (portal.orgId !== activeOrgId) return { allowed: false, reason: "wrong-organization" };

  const key = normalizePortalKey(portal.portalKey);
  const hasSharedFallback = visiblePortals.some(
    (candidate) => candidate.orgId === null && normalizePortalKey(candidate.portalKey) === key,
  );
  return hasSharedFallback
    ? { allowed: false, reason: "shared-fallback" }
    : { allowed: true, ownerScope: "organization" };
}

export function portalMappingResetImpactText(portal: Portal): string {
  return portal.orgId === null
    ? "Shared mappings for this exact key will stop being active until reviewed and recaptured. Existing organization overrides remain stored and are paused for review. Configurations with another key, including same-URL siblings, are not reset."
    : "Only this organization configuration is reset. Shared configurations and same-URL sibling keys are untouched.";
}
