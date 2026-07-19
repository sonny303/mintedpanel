// Case detail at /cases/$id. Composes header (with the E6.0 unified status
// control), MSO callout, side cards, and the tasks / touches / history /
// notes panels from src/components/cases.
import { useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { differenceInDays, parseISO } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CopyButton } from "@/components/CopyButton";
import { PageHeader } from "@/components/layout/PageHeader";
import { fmtDate } from "@/lib/format";
import { buildProviderTokenValues } from "@/lib/pdfFill";
import {
  useCase,
  useCases,
  useDenialReasonCodes,
  useSetCaseStatus,
  useSetPayerReference,
} from "@/hooks/useCases";
import { useProviders } from "@/hooks/useProviders";
import { useStatusConfigs } from "@/hooks/useAdmin";
import { usePortals } from "@/hooks/usePortals";
import { useCoordinators } from "@/hooks/useLookups";
import { casePortalTargets } from "@/lib/casePortals";
import { WorkInPortalButton } from "@/components/cases/WorkInPortalButton";
import { useCorrectTouch, useLogNote, useLogTouch } from "@/hooks/useTouches";
import { useCanWrite, useIsAdmin } from "@/lib/permissions";
import type { StatusConfig } from "@/types";
import { CaseHeader } from "@/components/cases/CaseHeader";
import { CaseStatusControl } from "@/components/cases/CaseStatusControl";
import { CaseStatusHistoryPanel } from "@/components/cases/CaseStatusHistoryPanel";
import {
  TrackingIdField,
  type TrackingIdSibling,
} from "@/components/cases/pipeline/TrackingIdField";
import { PayerPipelineHistoryPanel } from "@/components/cases/pipeline/PayerPipelineHistoryPanel";
import { isTerminalCaseStatus } from "@/lib/caseStatus";
import { CaseProvenancePanel } from "@/components/generation/CaseProvenancePanel";
import { CaseRequiredDocuments } from "@/components/documents/CaseRequiredDocuments";
import { ReapplyCaseAction } from "@/components/cases/ReapplyCaseAction";
import { CaseTasksPanel } from "@/components/cases/CaseTasksPanel";
import { CaseWizard } from "@/components/cases/CaseWizard";
import { CaseTouchesPanel } from "@/components/cases/CaseTouchesPanel";
import { CaseHistoryPanel } from "@/components/cases/CaseHistoryPanel";

export const Route = createFileRoute("/cases/$id")({
  component: CaseDetailPage,
});

function CaseDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const canEdit = useCanWrite();
  const isAdmin = useIsAdmin();

  const caseQ = useCase(id);
  const statusesQ = useStatusConfigs();
  const portalsQ = usePortals();
  const coordinatorsQ = useCoordinators();
  const reasonCodesQ = useDenialReasonCodes();
  const c = caseQ.data;
  // Same org + payer cases feed the F4.0.2 duplicate tracking-ID warning.
  const payerCasesQ = useCases(c?.payerId ? { payerId: c.payerId } : {});
  const providersQ = useProviders();

  const setStatusM = useSetCaseStatus();
  const logTouchM = useLogTouch();
  const correctTouchM = useCorrectTouch();
  const logNoteM = useLogNote();
  const setReferenceM = useSetPayerReference();

  const trackingSiblings = useMemo<TrackingIdSibling[]>(() => {
    if (!c) return [];
    const providerById = new Map((providersQ.data ?? []).map((p) => [p.id, p]));
    return (payerCasesQ.data ?? [])
      .filter((sc) => sc.id !== c.id && sc.payerReferenceId)
      .map((sc) => {
        const p = providerById.get(sc.providerId);
        const name = p ? `${p.firstName} ${p.lastName}` : "another case";
        return {
          caseId: sc.id,
          label: `${name} · ${sc.state}`,
          reference: sc.payerReferenceId as string,
        };
      });
  }, [c, payerCasesQ.data, providersQ.data]);

  // The legacy (pre-unification) status_configs map still names the retained
  // read-only status_history ledger's entries.
  const statusById = useMemo(() => {
    const m = new Map<string, StatusConfig>();
    (statusesQ.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [statusesQ.data]);

  const coordinatorName = useMemo(() => {
    if (!c?.assignedTo) return "—";
    const found = (coordinatorsQ.data ?? []).find((x) => x.id === c.assignedTo);
    return found?.fullName ?? found?.email ?? "—";
  }, [c?.assignedTo, coordinatorsQ.data]);

  // token -> value map for the Wizard's pdf-step form filler, from the data this
  // page already holds (no extra fetch). PHI stays in the browser.
  const wizardTokenValues = useMemo(
    () => buildProviderTokenValues(c?.provider ?? null, c?.group ?? null, c?.facility ?? null),
    [c?.provider, c?.group, c?.facility],
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
  // E4.3 F4.3.1 — the case's launchable portals (from its open tasks' portal
  // steps), resolved to a name + URL for the "Work in portal" handoff.
  const portalTargets = casePortalTargets(tasks, portalsQ.data ?? []);
  const touches = (c.touches ?? [])
    .slice()
    .sort((a, b) => parseISO(b.touchDate).getTime() - parseISO(a.touchDate).getTime());
  const statusHistory = (c.statusHistory ?? [])
    .slice()
    .sort((a, b) => parseISO(b.changedAt).getTime() - parseISO(a.changedAt).getTime());

  const daysOpen = c.submittedDate ? differenceInDays(new Date(), parseISO(c.submittedDate)) : null;

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
              // are admin-only.
              canEdit={canEdit && (!isTerminalCaseStatus(c.caseStatus) || isAdmin)}
              saving={setReferenceM.isPending}
              siblings={trackingSiblings}
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

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-6">
            {/* E4.3 F4.3.1 — hand the case to the Workbench extension and open
                the portal tab. One launcher per resolvable portal; hidden when
                the case has no portal-linked open task. */}
            {portalTargets.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#E8E5E0] p-3">
                <span className="text-[13px] font-medium text-foreground">Work in portal</span>
                {portalTargets.map((target) => (
                  <WorkInPortalButton
                    key={target.portalKey}
                    caseId={c.id}
                    providerId={c.providerId}
                    target={target}
                  />
                ))}
                <span className="text-[12px] text-muted-foreground">
                  Opens the portal and hands this case to the extension.
                </span>
              </div>
            ) : null}
            {/* E2.4 F2.4.2 — origin (run link / manual) + actor/date + the
                E2.2 SOP-version lines + derived reapply cycles. */}
            <CaseProvenancePanel c={c} tasks={tasks} />
            {/* E4.5 F4.5.3 — the Assigned-phase document verification: the
                SOP-required kinds derived live against the provider's and
                group's current document versions, with one-click audited
                download for the manual portal attach (D3 interim path).
                Hidden when the case's tasks require no documents. */}
            <CaseRequiredDocuments providerId={c.providerId} groupId={c.groupId} tasks={tasks} />
            <Tabs defaultValue="list">
              <TabsList className="mb-3">
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="wizard">Wizard</TabsTrigger>
              </TabsList>
              <TabsContent value="list" className="mt-0">
                <CaseTasksPanel tasks={tasks} />
              </TabsContent>
              <TabsContent value="wizard" className="mt-0">
                <CaseWizard tasks={tasks} tokenValues={wizardTokenValues} />
              </TabsContent>
            </Tabs>
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
            <Card className="shadow-none border-border">
              <CardHeader className="p-4 pb-2 border-b border-border">
                <CardTitle className="text-[14px] font-semibold">Case Facts</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <dl className="space-y-3 text-[13px]">
                  <Row
                    label="Submitted"
                    value={<span className="tabular-nums">{fmtDate(c.submittedDate)}</span>}
                  />
                  <Row
                    label="Expected effective"
                    value={<span className="tabular-nums">{fmtDate(c.expectedEffectiveDate)}</span>}
                  />
                  <Row
                    label="Confirmed effective"
                    value={
                      <span className="tabular-nums">{fmtDate(c.confirmedEffectiveDate)}</span>
                    }
                  />
                  <Row
                    label="Contract executed"
                    value={<span className="tabular-nums">{fmtDate(c.contractExecutedDate)}</span>}
                  />
                  <Row
                    label="Days open"
                    value={
                      <span className="tabular-nums">
                        {daysOpen !== null ? `${daysOpen}d` : "—"}
                      </span>
                    }
                  />
                  <Separator className="my-2" />
                  <Row label="Coordinator" value={coordinatorName} />
                  <Row label="Group" value={c.group?.name ?? "—"} />
                  <Row label="Facility" value={c.facility?.name ?? "—"} />
                  {c.caseEmailToken && (
                    <>
                      <Separator className="my-2" />
                      <IdRow label="Forwarding ID" value={c.caseEmailToken} />
                    </>
                  )}
                </dl>
              </CardContent>
            </Card>

            <Card className="shadow-none border-border">
              <CardHeader className="p-4 pb-2 border-b border-border">
                <CardTitle className="text-[14px] font-semibold">Key Identifiers</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <dl className="space-y-3 text-[13px]">
                  <IdRow label="Provider NPI" value={c.provider?.npi ?? null} />
                  <IdRow label="CAQH ID" value={c.provider?.caqhId ?? null} />
                  <IdRow label="Taxonomy" value={c.provider?.taxonomyCode ?? null} />
                  <IdRow label="Group NPI" value={c.group?.npiType2 ?? null} />
                  <IdRow label="Group TIN" value={c.group?.tin ?? null} />
                  {c.payerIndividualProviderId || c.payerGroupProviderId ? (
                    <>
                      <Separator className="my-2" />
                      <IdRow label="Payer Provider ID" value={c.payerIndividualProviderId} />
                      <IdRow label="Group/Billing ID" value={c.payerGroupProviderId} />
                    </>
                  ) : null}
                </dl>
              </CardContent>
            </Card>

            {/* E6.0 — the unified timeline, then the two retained read-only
                pre-unification ledgers (rendered only when they carry rows;
                zero cases lose history). */}
            <CaseStatusHistoryPanel history={c.caseStatusHistory ?? []} touches={touches} />
            {(c.payerPipelineHistory ?? []).length > 0 ? (
              <PayerPipelineHistoryPanel history={c.payerPipelineHistory} />
            ) : null}
            {statusHistory.length > 0 ? (
              <CaseHistoryPanel history={statusHistory} statusById={statusById} />
            ) : null}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-right">{value}</dd>
    </div>
  );
}

function IdRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2">
        <span className="font-medium tabular-nums">{value ?? "—"}</span>
        {value ? <CopyButton value={value} label={label} /> : null}
      </dd>
    </div>
  );
}
