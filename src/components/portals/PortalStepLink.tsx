import { ExternalLink } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkInPortalButton } from "@/components/cases/WorkInPortalButton";
import { usePortals } from "@/hooks/usePortals";
import {
  resolveHandoffFacility,
  shouldShowCaseFacilityPicker,
  type HandoffFacilityLoadState,
  type HandoffFacilityOption,
} from "@/lib/casePortals";
import { normalizePortalKey } from "@/lib/tokenFormat";
import { isValidHandoffUrl } from "@/lib/extensionHandoff";
import { portalDisplayName } from "@/lib/portalRetirement";
import { PortalVerificationPill } from "./PortalVerificationPill";

export interface PortalHandoffContext {
  caseId: string;
  providerId: string;
  orgId: string;
  caseFacilityId: string | null;
  facilityLoadState: HandoffFacilityLoadState;
  facilities: HandoffFacilityOption[];
  selectedFacilityId: string | undefined;
  onSelectFacility: (facilityId: string) => void;
}

function facilityBlockMessage(
  reason: "loading" | "load_failed" | "selection_required" | "selection_invalid",
): string {
  if (reason === "loading") return "Loading case locations before handoff.";
  if (reason === "load_failed") {
    return "Case locations are unavailable. Use Open portal directly, then use extension case search.";
  }
  if (reason === "selection_required") {
    return "Choose a location before sending this case to the extension.";
  }
  return "The selected location is no longer available. Choose a current case location.";
}

export function PortalStepLink({
  portalKey,
  handoff,
}: {
  portalKey: string | null | undefined;
  handoff?: PortalHandoffContext;
}) {
  const portalsQ = usePortals();
  const key = normalizePortalKey(portalKey);
  if (!key) return null;
  if (portalsQ.isLoading) return null;
  if (portalsQ.isError) {
    return (
      <div className="rounded-md border border-[#E8E5E0] bg-[#F5F5F4] px-2.5 py-1.5 text-[12px] text-[#57534E]">
        Portal registry unavailable. No launch target was selected.
      </div>
    );
  }

  const portal = (portalsQ.data ?? []).find((item) => normalizePortalKey(item.portalKey) === key);

  if (!portal) {
    return (
      <div className="rounded-md border border-[#E8E5E0] bg-[#F5F5F4] px-2.5 py-1.5 text-[12px] text-[#57534E]">
        Portal not set up in this org. Register it from the payer&apos;s SOP template (Form setup on
        the online-form step).
      </div>
    );
  }

  const facilityResolution = handoff
    ? resolveHandoffFacility(
        handoff.facilityLoadState,
        handoff.facilities,
        handoff.caseFacilityId,
        handoff.selectedFacilityId,
      )
    : null;
  const currentFacilityId =
    facilityResolution?.status === "ready" ? facilityResolution.facilityId : undefined;
  const displayName = portalDisplayName(portal);
  const target =
    portal.formUrl && isValidHandoffUrl(portal.formUrl)
      ? { portalKey: key, name: displayName, url: portal.formUrl }
      : null;
  const invalidPortalUrl = Boolean(portal.formUrl) && target === null;
  const showFacilityPicker = Boolean(
    handoff &&
    facilityResolution &&
    shouldShowCaseFacilityPicker(handoff.facilityLoadState, handoff.facilities, facilityResolution),
  );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#E8E5E0] bg-[#FAFAF9] px-2.5 py-1.5 text-[12px]">
      <span className="font-medium text-foreground">{displayName}</span>
      {target && !handoff ? (
        <a
          href={target.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[#1B4D3E] underline-offset-2 hover:underline"
        >
          Open portal
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      ) : null}
      <PortalVerificationPill portal={portal} />

      {target && handoff ? (
        <>
          {showFacilityPicker ? (
            <div className="basis-full space-y-1">
              <label className="text-[11px] font-medium text-foreground">
                Location for this work
              </label>
              <Select value={currentFacilityId} onValueChange={handoff.onSelectFacility}>
                <SelectTrigger
                  className="h-8 w-full shadow-none"
                  aria-label="Location for this work"
                >
                  <SelectValue placeholder="Choose a location" />
                </SelectTrigger>
                <SelectContent>
                  {handoff.facilities.map((facility) => (
                    <SelectItem key={facility.id} value={facility.id}>
                      {facility.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <WorkInPortalButton
            caseId={handoff.caseId}
            providerId={handoff.providerId}
            orgId={handoff.orgId}
            target={target}
            facilityId={currentFacilityId}
            disabled={facilityResolution?.status !== "ready"}
            disabledReason={
              facilityResolution?.status === "blocked"
                ? facilityBlockMessage(facilityResolution.reason)
                : undefined
            }
          />
        </>
      ) : target ? null : (
        <span className="text-muted-foreground">
          {invalidPortalUrl ? "Portal URL is unavailable for handoff." : "Portal URL not set."}
        </span>
      )}
    </div>
  );
}
