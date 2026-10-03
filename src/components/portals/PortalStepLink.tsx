import { ExternalLink } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { WorkInPortalButton } from "@/components/cases/WorkInPortalButton";
import { WorkInPortalV2Button } from "@/components/cases/WorkInPortalV2Button";
import { useExactPortalConfiguration } from "@/hooks/useExactPortalConfiguration";
import {
  resolveHandoffFacility,
  shouldShowCaseFacilityPicker,
  type HandoffFacilityLoadState,
  type HandoffFacilityOption,
} from "@/lib/casePortals";
import { isOpenCaseStatus, type CaseStatus } from "@/lib/caseStatus";
import { normalizePortalKey } from "@/lib/tokenFormat";
import { isValidHandoffUrl } from "@/lib/extensionHandoff";
import type { WorkContextLaunchTuple } from "@/lib/workContext";

export interface PortalHandoffContext {
  caseId: string;
  providerId: string;
  orgId: string;
  caseType?: string | null;
  caseStatus?: CaseStatus | null;
  contextVersion?: number;
  payerId?: string;
  caseFacilityId: string | null;
  facilityLoadState: HandoffFacilityLoadState;
  facilities: HandoffFacilityOption[];
  selectedFacilityId: string | undefined;
  onSelectFacility: (facilityId: string) => void;
  workStep?: {
    taskId: string;
    taskExecutionType: string | null;
    sopTemplateId: string | null;
    sopVersion: number | null;
    stepId: string;
    stepIdentity: string | null;
  };
}

function facilityBlockMessage(
  reason: "loading" | "load_failed" | "selection_required" | "selection_invalid",
): string {
  if (reason === "loading") return "Loading case locations before handoff.";
  if (reason === "load_failed") {
    return "Case locations are unavailable. Refresh before starting an exact work step.";
  }
  if (reason === "selection_required") {
    return "Choose a location before sending this case to the extension.";
  }
  return "The selected location is no longer available. Choose a current case location.";
}

function displayPortalName(key: string): string {
  return key
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function PortalStepLink({
  portalKey,
  handoff,
}: {
  portalKey: string | null | undefined;
  handoff?: PortalHandoffContext;
}) {
  const key = normalizePortalKey(portalKey);
  const portalsQ = useExactPortalConfiguration(key);
  if (!key) return null;
  if (portalsQ.isPending) return null;
  if (portalsQ.isError) {
    return (
      <div className="rounded-md border border-[#E8E5E0] bg-[#F5F5F4] px-2.5 py-1.5 text-[12px] text-[#57534E]">
        Portal configuration unavailable. No launch target was selected.
      </div>
    );
  }

  const configuration = portalsQ.data;
  if (
    !configuration ||
    configuration.status === "configuration_missing" ||
    !configuration.portalId
  ) {
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
  const portalName = displayPortalName(key);
  const portalUrl =
    configuration.formUrl && isValidHandoffUrl(configuration.formUrl)
      ? configuration.formUrl
      : null;
  const showFacilityPicker = Boolean(
    handoff &&
    facilityResolution &&
    shouldShowCaseFacilityPicker(handoff.facilityLoadState, handoff.facilities, facilityResolution),
  );
  const workStep = handoff?.workStep;
  const caseIsOpen = Boolean(handoff?.caseStatus && isOpenCaseStatus(handoff.caseStatus));
  const workTuple: WorkContextLaunchTuple | null =
    handoff &&
    workStep &&
    (handoff.caseType === "enrollment" || handoff.caseType === "recredentialing") &&
    handoff.contextVersion &&
    handoff.payerId &&
    workStep.taskExecutionType === "extension_fill" &&
    workStep.sopTemplateId &&
    workStep.sopVersion &&
    workStep.stepIdentity &&
    configuration.requiresExplicitSelection &&
    configuration.isReady &&
    configuration.caseType === handoff.caseType &&
    configuration.payerId === handoff.payerId &&
    configuration.mappingGeneration &&
    configuration.effectiveMappingFingerprint &&
    caseIsOpen &&
    facilityResolution?.status === "ready"
      ? {
          ownerKind: "case",
          ownerId: handoff.caseId,
          orgId: handoff.orgId,
          contextVersion: handoff.contextVersion,
          sopTemplateId: workStep.sopTemplateId,
          sopVersion: workStep.sopVersion,
          portalId: configuration.portalId,
          portalKey: key,
          mappingGeneration: configuration.mappingGeneration,
          effectiveMappingFingerprint: configuration.effectiveMappingFingerprint,
          providerId: handoff.providerId,
          facilityId: currentFacilityId ?? null,
          stepIdentity: workStep.stepIdentity,
          taskId: workStep.taskId,
          stepId: workStep.stepId,
        }
      : null;
  const explicitConfigUnavailable =
    configuration.requiresExplicitSelection &&
    (!configuration.isReady ||
      configuration.caseType !== handoff?.caseType ||
      configuration.payerId !== handoff?.payerId ||
      !configuration.mappingGeneration ||
      !configuration.effectiveMappingFingerprint);
  const invalidPortalUrl = Boolean(configuration.formUrl) && portalUrl === null;
  const showLegacyDirectLink = Boolean(portalUrl && !configuration.requiresExplicitSelection);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#E8E5E0] bg-[#FAFAF9] px-2.5 py-1.5 text-[12px]">
      <span className="font-medium text-foreground">{portalName}</span>
      {showLegacyDirectLink && !handoff ? (
        <a
          href={portalUrl!}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[#1B4D3E] underline-offset-2 hover:underline"
        >
          Open portal
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      ) : null}
      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
        {configuration.isVerified ? "Verified" : "Unverified"}
      </span>

      {portalUrl && handoff && showFacilityPicker ? (
        <div className="basis-full space-y-1">
          <label className="text-[11px] font-medium text-foreground">Location for this work</label>
          <Select value={currentFacilityId} onValueChange={handoff.onSelectFacility}>
            <SelectTrigger className="h-8 w-full shadow-none" aria-label="Location for this work">
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

      {portalUrl && handoff && configuration.requiresExplicitSelection ? (
        <>
          {workTuple ? (
            <WorkInPortalV2Button
              tuple={workTuple}
              portalUrl={portalUrl}
              portalName={portalName}
              disabled={facilityResolution?.status !== "ready"}
              disabledReason={
                facilityResolution?.status === "blocked"
                  ? facilityBlockMessage(facilityResolution.reason)
                  : undefined
              }
            />
          ) : (
            <div className="basis-full space-y-1">
              <Button type="button" size="sm" variant="outline" disabled>
                Work in portal
              </Button>
              <p className="text-[11px] text-muted-foreground">
                {facilityResolution?.status === "blocked"
                  ? facilityBlockMessage(facilityResolution.reason)
                  : explicitConfigUnavailable
                    ? "This exact portal configuration is not ready for this case type."
                    : workStep?.taskExecutionType !== "extension_fill"
                      ? "This task is not enabled for the exact Extension work handoff."
                      : !caseIsOpen
                        ? "This case is not open for new work."
                        : "The exact case step context is incomplete; refresh before launching."}
              </p>
            </div>
          )}
        </>
      ) : configuration.requiresExplicitSelection ? (
        <span className="text-muted-foreground">
          {handoff
            ? "Portal URL or exact work context is unavailable."
            : "Choose this portal from an exact case or Contract SOP step."}
        </span>
      ) : portalUrl && handoff ? (
        <WorkInPortalButton
          caseId={handoff.caseId}
          providerId={handoff.providerId}
          orgId={handoff.orgId}
          target={{ portalKey: key, name: portalName, url: portalUrl }}
          facilityId={currentFacilityId}
          disabled={facilityResolution?.status !== "ready"}
          disabledReason={
            facilityResolution?.status === "blocked"
              ? facilityBlockMessage(facilityResolution.reason)
              : undefined
          }
        />
      ) : portalUrl ? null : (
        <span className="text-muted-foreground">
          {invalidPortalUrl ? "Portal URL is unavailable for handoff." : "Portal URL not set."}
        </span>
      )}
    </div>
  );
}
