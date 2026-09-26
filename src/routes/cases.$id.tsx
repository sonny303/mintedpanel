// Case detail at /cases/$id — the coordinator's home for working ONE case
// (Slice E, payer-and-cases screen 6). Header card (identity + tracking ID +
// the E6.0 unified status control) over two columns: LEFT the work (Tasks,
// Touchlog), RIGHT the facts (Details = case · identifiers · provenance, then
// the unified Status timeline).
//
// Deliberately NOT here (handoff §2.7 — do not re-add): the required-documents
// card (documents are not a product capability), the duplicate tracking-ID
// warning, and the two legacy pre-unification history ledgers — the unified
// timeline is the one history surface. The narrow Work-in-portal launcher
// lives only inside an eligible case TaskDrawer online-form step.
import { useCallback, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { parseISO } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/layout/PageHeader";
import { fmtDate } from "@/lib/format";
import { buildProviderTokenValues } from "@/lib/pdfFill";
import { useFreshPdfTokenValues, type RefreshPdfTokenValues } from "@/hooks/useFreshPdfTokenValues";
import {
  useAddCaseFacility,
  useCase,
  useCaseFacilities,
  useDenialReasonCodes,
  useRemoveCaseFacility,
  useSetCaseDates,
  useSetCaseStatus,
  useSetPayerReference,
  useSetPrimaryCaseFacility,
} from "@/hooks/useCases";
import { useCoordinators, useFacilities, useStateLicensesByProvider } from "@/hooks/useLookups";
import { useGroupInsurancePolicies } from "@/hooks/useOrgSettings";
import { useProviderAssignments } from "@/hooks/useProviders";
import { useCorrectTouch, useLogNote, useLogTouch } from "@/hooks/useTouches";
import { caseFacilityOptions } from "@/lib/caseFacility";
import { pickGroupInsurancePolicy } from "@/lib/groupInsurancePick";
import { pickLicenseForState } from "@/lib/licensePick";
import { useCanWrite, useIsAdmin } from "@/lib/permissions";
import { useAuthStore } from "@/lib/auth-store";
import { CaseHeader } from "@/components/cases/CaseHeader";
import { CaseStatusControl } from "@/components/cases/CaseStatusControl";
import { CaseStatusHistoryPanel } from "@/components/cases/CaseStatusHistoryPanel";
import { TrackingIdField } from "@/components/cases/pipeline/TrackingIdField";
import { isTerminalCaseStatus } from "@/lib/caseStatus";
import { CaseDetailsPanel } from "@/components/cases/CaseDetailsPanel";
import { ReapplyCaseAction } from "@/components/cases/ReapplyCaseAction";
import { DeleteCaseAction } from "@/components/cases/DeleteCaseAction";
import { CaseTasksPanel } from "@/components/cases/CaseTasksPanel";
import { CaseTouchesPanel } from "@/components/cases/CaseTouchesPanel";
import {
  isSameCasePdfScope,
  resolveFreshCasePdfFacility,
  resolveHandoffFacility,
} from "@/lib/casePortals";

export const Route = createFileRoute("/cases/$id")({
  component: CaseDetailPage,
});

function CaseDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const canEdit = useCanWrite();
  const isAdmin = useIsAdmin();
  const actorId = useAuthStore((state) => state.user?.id ?? null);
  const authGeneration = useAuthStore((state) => state.authGeneration);
  const contextEpoch = useAuthStore((state) => state.contextEpoch);
  const refreshPdfTokenValues = useFreshPdfTokenValues();

  const caseQ = useCase(id);
  const coordinatorsQ = useCoordinators();
  const reasonCodesQ = useDenialReasonCodes();
  const facilitiesQ = useFacilities();
  const facilityAssignmentsQ = useProviderAssignments();
  const caseFacilitiesQ = useCaseFacilities(id);
  const refetchCurrentCase = caseQ.refetch;
  const refetchCaseFacilities = caseFacilitiesQ.refetch;
  const refetchFacilities = facilitiesQ.refetch;
  const c = caseQ.data;
  const selectionContext = [
    c?.orgId ?? "no-org",
    c?.id ?? id,
    c?.groupId ?? "no-group",
    c?.state ?? "no-state",
    actorId ?? "no-actor",
    authGeneration,
    contextEpoch,
  ].join(":");
  const selectionGeneration = useRef({ context: "", generation: 0 });
  if (selectionGeneration.current.context !== selectionContext) {
    selectionGeneration.current = {
      context: selectionContext,
      generation: selectionGeneration.current.generation + 1,
    };
  }
  const selectionOwner = `${selectionContext}:${selectionGeneration.current.generation}`;
  const [facilitySelection, setFacilitySelection] = useState<{
    owner: string;
    facilityId: string;
  } | null>(null);
  const selectedFacilityId =
    facilitySelection?.owner === selectionOwner ? facilitySelection.facilityId : undefined;
  const licensesQ = useStateLicensesByProvider(c?.providerId);
  // DYN-TOKEN-05 — policies for the CASE's group (not the provider's primary
  // mirror). Empty string keeps the query disabled until a group is known.
  const policiesQ = useGroupInsurancePolicies(c?.groupId ?? "");

  const setStatusM = useSetCaseStatus();
  const logTouchM = useLogTouch();
  const correctTouchM = useCorrectTouch();
  const logNoteM = useLogNote();
  const setReferenceM = useSetPayerReference();
  const addFacilityM = useAddCaseFacility();
  const removeFacilityM = useRemoveCaseFacility();
  const setPrimaryFacilityM = useSetPrimaryCaseFacility();
  const savingLocations =
    addFacilityM.isPending || removeFacilityM.isPending || setPrimaryFacilityM.isPending;
  const setDatesM = useSetCaseDates();

  const coordinatorName = useMemo(() => {
    if (!c?.assignedTo) return "—";
    const found = (coordinatorsQ.data ?? []).find((x) => x.id === c.assignedTo);
    return found?.fullName ?? found?.email ?? "—";
  }, [c?.assignedTo, coordinatorsQ.data]);

  const facilityOptions = useMemo(() => {
    if (!c?.providerId) return [];
    return caseFacilityOptions(
      c.providerId,
      c.groupId,
      facilityAssignmentsQ.data ?? [],
      facilitiesQ.data ?? [],
      c.facilityId,
    );
  }, [c?.providerId, c?.groupId, c?.facilityId, facilityAssignmentsQ.data, facilitiesQ.data]);

  const handoffFacilities = useMemo(
    () =>
      (caseFacilitiesQ.data ?? []).map((row) => ({
        id: row.facilityId,
        name: row.facility.name,
      })),
    [caseFacilitiesQ.data],
  );
  const facilityResolution = resolveHandoffFacility(
    caseFacilitiesQ.isError ? "error" : caseFacilitiesQ.isLoading ? "loading" : "ready",
    handoffFacilities,
    c?.facilityId ?? null,
    selectedFacilityId,
  );
  const selectedCaseFacilityId =
    facilityResolution.status === "ready" ? facilityResolution.facilityId : undefined;
  const selectedFacilityIsInCaseSet = selectedCaseFacilityId
    ? handoffFacilities.some((facility) => facility.id === selectedCaseFacilityId)
    : false;
  const selectedCaseFacility = selectedFacilityIsInCaseSet
    ? ((facilitiesQ.data ?? []).find((facility) => facility.id === selectedCaseFacilityId) ?? null)
    : null;
  const selectedFacilityDataState = selectedCaseFacilityId
    ? facilitiesQ.isError
      ? "full-facility-error"
      : facilitiesQ.isLoading
        ? "full-facility-loading"
        : selectedCaseFacility
          ? "full-facility-ready"
          : "full-facility-missing"
    : "no-facility-data-required";
  const pdfContextKey = `${selectionOwner}:${facilityResolution.status === "ready" ? `ready:${facilityResolution.facilityId ?? "no-facility"}` : `blocked:${facilityResolution.reason}`}:${selectedFacilityDataState}`;
  const refreshCasePdfTokenValues: RefreshPdfTokenValues = useCallback(
    async (baseValues, isCurrent = () => true) => {
      if (!isCurrent()) {
        throw new Error("The fill context changed. Start a new fill in the current context.");
      }
      const isRouteContextCurrent = () => {
        const current = useAuthStore.getState();
        return (
          isCurrent() &&
          current.activeOrgId === c?.orgId &&
          current.user?.id === actorId &&
          current.authGeneration === authGeneration &&
          current.contextEpoch === contextEpoch
        );
      };
      const [caseResult, caseFacilitiesResult, facilitiesResult] = await Promise.all([
        refetchCurrentCase(),
        refetchCaseFacilities(),
        refetchFacilities(),
      ]);
      if (!isRouteContextCurrent()) {
        throw new Error("The fill context changed. Start a new fill in the current context.");
      }
      const currentCase = caseResult.data;
      if (
        caseResult.isError ||
        !currentCase ||
        !c ||
        !isSameCasePdfScope(
          {
            id: c.id,
            orgId: c.orgId,
            providerId: c.providerId,
            groupId: c.groupId,
            state: c.state,
          },
          currentCase,
        ) ||
        caseFacilitiesResult.isError ||
        facilitiesResult.isError
      ) {
        throw new Error(
          "The case location could not be refreshed. Reload the case before filling.",
        );
      }
      const freshCaseFacilities = (caseFacilitiesResult.data ?? []).map((row) => ({
        id: row.facilityId,
        name: row.facility.name,
      }));
      const freshFacility = resolveFreshCasePdfFacility(
        freshCaseFacilities,
        facilitiesResult.data ?? [],
        currentCase.facilityId,
        selectedFacilityId,
      );
      if (freshFacility.status !== "ready") {
        throw new Error(
          freshFacility.reason === "selection_required"
            ? "Choose a case location before generating this PDF."
            : freshFacility.reason === "selection_invalid"
              ? "The selected case location was removed. Choose a current location before generating this PDF."
              : "The selected case location details are unavailable. Reload the case before generating this PDF.",
        );
      }
      const withoutOldFacility = Object.fromEntries(
        Object.entries(baseValues).filter(([token]) => !token.startsWith("facility.")),
      );
      const freshFacilityValues = buildProviderTokenValues(null, null, freshFacility.facility);
      return refreshPdfTokenValues(
        { ...withoutOldFacility, ...freshFacilityValues },
        isRouteContextCurrent,
      );
    },
    [
      c?.id,
      c?.orgId,
      c?.providerId,
      c?.groupId,
      c?.state,
      actorId,
      authGeneration,
      contextEpoch,
      refetchCurrentCase,
      refetchCaseFacilities,
      refetchFacilities,
      refreshPdfTokenValues,
      selectedFacilityId,
    ],
  );

  // DYN-TOKEN-05 — which of the provider's state licenses the license.* tokens
  // mean. The CASE names exactly one state (it is part of the 4-part case key),
  // so this is unambiguous here in a way the web profile's ?state= param has to
  // ask for. Same shared rule either way: no state match, or several licenses
  // and no state, resolves to null rather than to a plausible wrong number on a
  // payer application.
  const caseLicense = useMemo(
    () => pickLicenseForState(licensesQ.data ?? [], c?.state).row,
    [licensesQ.data, c?.state],
  );

  // DYN-TOKEN-05 — which group insurance policy groupInsurance.* tokens mean.
  // Same shared rule as the web profile (malpractice → primary → newest end
  // date). The CASE's groupId decides which policies are candidates; the web
  // profile uses the provider's primary group because it has no case.
  const caseGroupInsurance = useMemo(
    () => pickGroupInsurancePolicy(policiesQ.data ?? [], Boolean(c?.groupId)).row,
    [policiesQ.data, c?.groupId],
  );

  // token -> value map for the TaskDrawer's pdf-step form filler and the Payer
  // PDF action, from the data this page already holds. PHI stays in the browser.
  const stepTokenValues = useMemo(
    () =>
      buildProviderTokenValues(
        c?.provider ?? null,
        c?.group ?? null,
        selectedCaseFacility,
        caseLicense,
        caseGroupInsurance,
      ),
    [c?.provider, c?.group, selectedCaseFacility, caseLicense, caseGroupInsurance],
  );

  if (caseQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (caseQ.isError) {
    return (
      <div>
        <PageHeader title="Something went wrong loading this case" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => caseQ.refetch()}>
            Retry
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: "/cases" })}>
            Back to cases
          </Button>
        </div>
      </div>
    );
  }
  if (!c) {
    return (
      <div>
        <PageHeader title="Case not found" />
        <Button variant="outline" onClick={() => navigate({ to: "/cases" })}>
          Back to cases
        </Button>
      </div>
    );
  }

  const tasks = (c.tasks ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const touches = (c.touches ?? [])
    .slice()
    .sort((a, b) => parseISO(b.touchDate).getTime() - parseISO(a.touchDate).getTime());

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <CaseHeader
          c={c}
          statusControl={
            <CaseStatusControl
              c={c}
              reasonCodes={reasonCodesQ.data ?? []}
              canEdit={canEdit}
              isAdmin={isAdmin}
            />
          }
          trackingId={
            <TrackingIdField
              value={c.payerReferenceId}
              // F4.0.2/TE-3 (re-keyed E6.0) — post-terminal tracking-ID edits
              // are admin-only. No sibling list is passed: the duplicate
              // warning is a §2.7 removal (each submission mints a new ID per
              // provider, so a collision is only ever a data-entry error).
              canEdit={canEdit && (!isTerminalCaseStatus(c.caseStatus) || isAdmin)}
              saving={setReferenceM.isPending}
              onSave={async (value) => {
                try {
                  await setReferenceM.mutateAsync({ caseId: c.id, value });
                  toast.success("Tracking ID saved");
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            />
          }
        />

        {c.provider?.status === "terminated" ? (
          <div className="border border-border bg-[#F3F4F6] text-[#9CA3AF] rounded-md p-3 text-[13px]">
            Provider terminated {fmtDate(c.provider.terminatedDate)} — termination tasks generated.
          </div>
        ) : null}

        <ReapplyCaseAction c={c} canEdit={canEdit} />
        <DeleteCaseAction c={c} isAdmin={isAdmin} />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-6">
            {/* The step-at-a-time Wizard is retired (2026-07-20): ONE task
                list, each task's ordered steps beneath it, and the current
                step's drawer carrying the step bodies (Gmail hand-off, pdf
                filler, resolved fields) + Mark step done. */}
            <CaseTasksPanel
              tasks={tasks}
              tokenValues={stepTokenValues}
              groupId={c?.groupId ?? null}
              providerName={
                c?.provider ? `${c.provider.firstName} ${c.provider.lastName}` : "this provider"
              }
              groupName={c?.group?.name ?? null}
              refreshPdfTokenValues={refreshCasePdfTokenValues}
              pdfContextKey={pdfContextKey}
              portalHandoff={{
                caseId: c.id,
                providerId: c.providerId,
                orgId: c.orgId,
                caseFacilityId: c.facilityId,
                facilityLoadState: caseFacilitiesQ.isError
                  ? "error"
                  : caseFacilitiesQ.isLoading
                    ? "loading"
                    : "ready",
                // The whole case-location set is required: reducing this to
                // credential_cases.facility_id would erase a selected
                // secondary and make safe choice impossible.
                facilities: handoffFacilities,
                selectedFacilityId,
                onSelectFacility: (facilityId) =>
                  setFacilitySelection({ owner: selectionOwner, facilityId }),
              }}
            />
            <CaseTouchesPanel
              touches={touches}
              coordinators={coordinatorsQ.data ?? []}
              canEdit={canEdit}
              savingTouch={logTouchM.isPending || correctTouchM.isPending || setStatusM.isPending}
              savingNote={logNoteM.isPending}
              // E6.0 F6.0.3 — the Add-touch dialog offers a status bump when
              // the touch implies one; accepting logs touch + transition
              // together, the touch linked as the transition's evidence.
              currentStatus={c.caseStatus}
              // Same embed the Status history panel below renders — passed so a
              // touch can mark the transition it evidenced. No second fetch.
              history={c.caseStatusHistory ?? []}
              onSaveTouch={async (input) => {
                try {
                  const touch = await logTouchM.mutateAsync({ caseId: c.id, input });
                  toast.success("Touch logged");
                  return touch;
                } catch (e) {
                  toast.error((e as Error).message);
                  return null;
                }
              }}
              onStatusBump={async (toStatus, evidenceTouchId) => {
                try {
                  // expectedStatus is deliberately NULL: the touch just logged
                  // may itself have auto-advanced the case (first recorded
                  // work), so the bump validates against the live status.
                  await setStatusM.mutateAsync({
                    caseId: c.id,
                    toStatus,
                    evidenceTouchId,
                  });
                  toast.success("Status updated with the touch as evidence");
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
              onSaveNote={async (content) => {
                try {
                  await logNoteM.mutateAsync({ caseId: c.id, input: { content } });
                  toast.success("Note added");
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
              onCorrectTouch={async (originalTouchId, input) => {
                try {
                  await correctTouchM.mutateAsync({ caseId: c.id, originalTouchId, input });
                  toast.success("Correction logged");
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            />
          </div>

          <div className="lg:col-span-2 space-y-6">
            {/* Case facts · identifiers (incl. the payer-issued IDs an
                approval captured) · provenance — one card, three groups. */}
            <CaseDetailsPanel
              c={c}
              tasks={tasks}
              coordinatorName={coordinatorName}
              locations={caseFacilitiesQ.data ?? []}
              locationsLoading={caseFacilitiesQ.isLoading}
              facilityOptions={facilityOptions}
              canEditLocations={canEdit}
              savingLocations={savingLocations}
              onAddLocation={async (facilityId) => {
                try {
                  await addFacilityM.mutateAsync({ caseId: c.id, facilityId });
                  toast.success("Location added");
                } catch (e) {
                  toast.error((e as Error).message);
                  throw e;
                }
              }}
              onRemoveLocation={async (facilityId) => {
                try {
                  await removeFacilityM.mutateAsync({ caseId: c.id, facilityId });
                  toast.success("Location removed");
                } catch (e) {
                  toast.error((e as Error).message);
                  throw e;
                }
              }}
              onMakePrimaryLocation={async (facilityId) => {
                try {
                  await setPrimaryFacilityM.mutateAsync({ caseId: c.id, facilityId });
                  toast.success("Primary location updated");
                } catch (e) {
                  toast.error((e as Error).message);
                  throw e;
                }
              }}
              canEditDates={canEdit}
              savingDates={setDatesM.isPending}
              onSaveDates={async (input) => {
                try {
                  await setDatesM.mutateAsync({ caseId: c.id, input });
                  toast.success("Date saved");
                } catch (e) {
                  toast.error((e as Error).message);
                  throw e;
                }
              }}
            />
            {/* E6.0 — the unified timeline is the ONE history surface: the two
                pre-unification ledgers are a §2.7 removal from this screen. */}
            <CaseStatusHistoryPanel history={c.caseStatusHistory ?? []} touches={touches} />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
