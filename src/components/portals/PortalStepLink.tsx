// The portal link rendered on a resolved SOP online_form step (TaskDrawer,
// the TaskDrawer step bodies (StepDetails), /tasks/$id). Resolves the step's portal_key against the org's
// portal registry and shows the portal name, an "Open portal" external link,
// and its verification state. If the key resolves to no portal in the active
// org, a neutral note points at Admin > Portals. Callers guard on
// step.portalKey, so an unlinked step never renders this.
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { usePortals } from "@/hooks/usePortals";
import { normalizePortalKey } from "@/lib/tokenFormat";
import { PortalVerificationPill } from "./PortalVerificationPill";

export function PortalStepLink({ portalKey }: { portalKey: string | null | undefined }) {
  const portalsQ = usePortals();
  const key = normalizePortalKey(portalKey);
  if (!key) return null;
  // Stay quiet while the registry loads rather than flashing a "not set up" note.
  if (portalsQ.isLoading) return null;

  const portal = (portalsQ.data ?? []).find((p) => normalizePortalKey(p.portalKey) === key);

  if (!portal) {
    return (
      <div className="rounded-md border border-[#E8E5E0] bg-[#F5F5F4] px-2.5 py-1.5 text-[12px] text-[#57534E]">
        Portal not set up in this org.{" "}
        <Link
          to="/admin/portals"
          className="text-[#1B4D3E] underline underline-offset-2 hover:opacity-80"
        >
          Add it in Admin &gt; Portals
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#E8E5E0] bg-[#FAFAF9] px-2.5 py-1.5 text-[12px]">
      <span className="font-medium text-foreground">{portal.name}</span>
      {portal.formUrl ? (
        <a
          href={portal.formUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[#1B4D3E] underline-offset-2 hover:underline"
        >
          Open portal
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
      <PortalVerificationPill portal={portal} />
    </div>
  );
}
