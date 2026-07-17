// Case detail at /cases/$id. Composes header, MSO callout, side cards, and
// the tasks / touches / history / notes panels from src/components/cases.
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { differenceInDays, parseISO } from "date-fns";
import { AlertTriangle, ExternalLink } from "lucide-react";
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
  useContractFor,
  useDenialReasonCodes,
  useSetPayerReference,
  useUpdateCaseStatus,
} from "@/hooks/useCases";
import { useProviders } from "@/hooks/useProviders";
import { useStatusConfigs } from "@/hooks/useAdmin";
import { usePortals } from "@/hooks/usePortals";
import { useCoordinators, useMsoRoutingRule } from "@/hooks/useLookups";
import { casePortalTargets } from "@/lib/casePortals";
import { WorkInPortalButton } from "@/components/cases/WorkInPortalButton";
import { useCorrectTouch, useLogNote, useLogTouch } from "@/hooks/useTouches";
import { useCanWrite, useIsAdmin } from "@/lib/permissions";
import type { StatusConfig } from "@/types";
import { CaseHeader } from "@/components/cases/CaseHeader";
import { PayerPipelineControl } from "@/components/cases/pipeline/PayerPipelineControl";
import {
  TrackingIdField,
  type TrackingIdSibling,
} from "@/components/cases/pipeline/TrackingIdField";
import { PayerPipelineHistoryPanel } from "@/components/cases/pipeline/PayerPipelineHistoryPanel";
import { isTerminalPipelineState } from "@/lib/payerPipeline";
import { CaseProvenancePanel } from "@/components/generation/CaseProvenancePanel";
import { ReapplyCaseAction } from "@/components/cases/ReapplyCaseAction";
import { CaseTasksPanel } from "@/components/cases/CaseTasksPanel";
import { CaseWizard } from "@/components/cases/CaseWizard";
import { CaseTouchesPanel } from "@/components/cases/CaseTouchesPanel";
import { CaseHistoryPanel } from "@/components/cases/CaseHistoryPanel";
import { ChangeStatusDialog } from "@/components/cases/ChangeStatusDialog";

export const Route = createFileRoute("/cases/$id")({
  component: CaseDetailPage,
});

function isExecutedLabel(label: string | undefined): boolean {
  return (label ?? "").toLowerCase().includes("execut");
}

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
  const contractQ = useContractFor(c?.groupId ?? undefined, c?.payerId, c?.state);
  const routingRuleQ = useMsoRoutingRule(c?.payerId, c?.state, c?.specialty ?? null);
  // Same org + payer cases feed the F4.0.2 duplicate tracking-ID warning.
  const payerCasesQ = useCases(c?.payerId ? { payerId: c.payerId } : {});
  const providersQ = useProviders();

  const updateStatusM = useUpdateCaseStatus();
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

  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [taskView, setTaskView] = useState("list");

  const statusById = useMemo(() => {
    const m = new Map<string, StatusConfig>();
    (statusesQ.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [statusesQ.data]);

  const credentialingStatuses = useMemo(
    () => (statusesQ.data ?? []).filter((s) => s.track === "credentialing"),
    [statusesQ.data],
  );

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

  const credStatus = c.credentialingStatusId ? statusById.get(c.credentialingStatusId) : null;
  const contract = contractQ.data ?? null;
  const contractStatus = contract?.contractingStatusId
    ? statusById.get(contract.contractingStatusId)
    : null;
  const contractIsExecuted = isExecutedLabel(contractStatus?.label);

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
          credStatus={credStatus}
          contractStatus={contractStatus}
          canEdit={canEdit}
          onOpenStatus={() => setStatusModalOpen(true)}
          pipelineControl={
            <PayerPipelineControl
              c={c}
              reasonCodes={reasonCodesQ.data ?? []}
              canEdit={canEdit}
              isAdmin={isAdmin}
            />
          }
          trackingId={
            <TrackingIdField
              value={c.payerReferenceId}
              // F4.0.2/TE-3 — post-terminal tracking-ID edits are admin-only.
              canEdit={canEdit && (!isTerminalPipelineState(c.payerPipelineState) || isAdmin)}
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

        <ReapplyCaseAction c={c} credStatusLabel={credStatus?.label ?? null} canEdit={canEdit} />

        {c.mso ? (
          <div className="bg-[#FEF3C7] border border-[#FDE68A] rounded-md p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-[#D97706]">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span className="text-[14px] font-medium">
                  Route through {c.mso.name}, not {c.payer?.name ?? "payer"} directly
                </span>
              </div>
              {c.mso.portalUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 bg-white border-[#FDE68A] text-[#D97706] hover:bg-[#FEF3C7] hover:text-[#D97706]"
                  asChild
                >
                  <a href={c.mso.portalUrl} target="_blank" rel="noreferrer">
                    Go to Portal <ExternalLink className="w-3 h-3 ml-1.5" />
                  </a>
                </Button>
              )}
            </div>
            {routingRuleQ.data?.notes ? (
              <p className="text-[12px] text-[#92400E] mt-2 ml-8">{routingRuleQ.data.notes}</p>
            ) : null}
          </div>
        ) : null}

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
            <Tabs value={taskView} onValueChange={setTaskView}>
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
              savingTouch={logTouchM.isPending || correctTouchM.isPending}
              savingNote={logNoteM.isPending}
              onSaveTouch={async (input) => {
                try {
                  await logTouchM.mutateAsync({ caseId: c.id, input });
                  toast.success("Touch logged");
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

            <PayerPipelineHistoryPanel history={c.payerPipelineHistory} />

            <CaseHistoryPanel history={statusHistory} statusById={statusById} />
          </div>
        </div>
      </div>

      <ChangeStatusDialog
        open={statusModalOpen}
        onOpenChange={setStatusModalOpen}
        statuses={credentialingStatuses}
        currentStatusId={c.credentialingStatusId}
        payerName={c.payer?.name ?? "payer"}
        state={c.state}
        contractIsExecuted={contractIsExecuted}
        saving={updateStatusM.isPending}
        onSave={async ({ statusId, metadata, withoutContractWarning }) => {
          try {
            const merged: Record<string, unknown> = { ...metadata };
            if (withoutContractWarning) {
              merged.__warning = "set Active without executed contract";
            }
            await updateStatusM.mutateAsync({
              caseId: c.id,
              statusId,
              metadata: merged,
            });
            setStatusModalOpen(false);
            toast.success("Status updated");
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
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
