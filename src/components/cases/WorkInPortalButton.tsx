// E4.3 F4.3.1 — the "Work in portal" launch action. Hands the exact case
// context to the extension (SET_ACTIVE_CASE, identifiers + URL only), then
// opens the portal tab REGARDLESS of whether the extension is present. When the
// extension isn't detected, a one-line non-blocking toast points the user at
// the panel's own case search — the degraded path is first-class UX, never an
// error (TE-1). Normal layer (a hook-free presentational button over the pure
// handoff util); no protected layout/ui edits.
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useActiveOrgId } from "@/lib/auth-store";
import { sendSetActiveCase } from "@/lib/extensionHandoff";
import type { CasePortalTarget } from "@/lib/casePortals";

export function WorkInPortalButton({
  caseId,
  providerId,
  target,
  size = "sm",
  variant = "outline",
  className,
}: {
  caseId: string;
  providerId: string;
  target: CasePortalTarget;
  size?: "sm" | "default";
  variant?: "outline" | "default";
  className?: string;
}) {
  const orgId = useActiveOrgId();

  const launch = () => {
    // Hand off the case context before opening the tab; the extension binds the
    // next tab opened to the portal origin (TE-1). orgId is required so a
    // multi-org user can never be filled from the wrong org.
    const handedOff = orgId
      ? sendSetActiveCase({ caseId, providerId, orgId, portalUrl: target.url })
      : false;
    if (!handedOff) {
      toast("Extension not detected — use its case search", {
        description: "The portal is opening in a new tab.",
      });
    }
    // Open the portal regardless (never blocked on the extension).
    window.open(target.url, "_blank", "noopener,noreferrer");
  };

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      onClick={launch}
      title={`Work ${target.name} in the portal`}
    >
      Work in portal
      <ExternalLink className="ml-1.5 h-3 w-3" aria-hidden />
    </Button>
  );
}
