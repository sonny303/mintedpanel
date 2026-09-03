// Case detail at /cases/$id — the coordinator's home for working ONE case
// (Slice E, payer-and-cases screen 6). Header card (identity + tracking ID +
// the E6.0 unified status control) over two columns: LEFT the work (Tasks,
// Touchlog), RIGHT the facts (Details = case · identifiers · provenance, then
// the unified Status timeline).
//
// Deliberately NOT here (handoff §2.7 — do not re-add): the required-documents
// card (documents are not a product capability), the Work-in-portal launcher
// (extension surfaces deferred), the duplicate tracking-ID warning, and the
// two legacy pre-unification history ledgers — the unified timeline is the one
// history surface. Every retired component still exists; only this screen
// stopped rendering them.
import { useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { parseISO } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/layout/PageHeader";
import { fmtDate } from "@/lib/format";
import { buildProviderTokenValues } from "@/lib/pdfFill";
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

export const Route = createFileRoute("/cases/$id")({
  component: CaseDetailPage,
});

function CaseDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const canEdit = useCanWrite();
  const isAdmin = useIsAdmin();

  const caseQ = useCase(id);
  const coordinatorsQ = useCoordinators();
  const reasonCodesQ = useDenialReasonCodes();
  const facilitiesQ = useFacilities();
  const facilityAssignmentsQ = useProviderAssignments();
  const caseFacilitiesQ = useCaseFacilities(id);
  const c = caseQ.data;
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
        c?.facility ?? null,
        caseLicense,
        caseGroupInsurance,
      ),
    [c?.provider, c?.group, c?.facility, caseLicense, caseGroupInsurance],
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
